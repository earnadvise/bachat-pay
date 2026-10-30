// SPDX-License-Identifier: MIT
pragma solidity >=0.4.16 ^0.8.20;

// node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// contracts/BachatVault.sol

contract BachatVault {
    address public immutable usdcToken;
    address public rewardPool;
    address public immutable owner;
    uint256 public totalVaults;

    struct Vault {
        address owner;
        string goalName;
        uint256 targetAmount;
        uint256 unlockTime;
        uint256 balance;
        bool withdrawn;
    }

    mapping(uint256 => Vault) public vaults;
    mapping(address => uint256[]) public userVaults;
    mapping(address => uint256) public pendingPenalties;

    event VaultCreated(
        uint256 indexed vaultId,
        address indexed owner,
        string goalName,
        uint256 targetAmount,
        uint256 unlockTime
    );
    event Deposited(uint256 indexed vaultId, uint256 amount);
    event Withdrawn(uint256 indexed vaultId, uint256 amount, bool earlyPenalty);
    event RewardPoolUpdated(address newPool);

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error AlreadyWithdrawn();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _usdcToken, address _rewardPool, address _owner) {
        if (_usdcToken == address(0) || _rewardPool == address(0) || _owner == address(0)) {
            revert ZeroAddress();
        }
        if (_usdcToken.code.length == 0) revert ZeroAddress();

        usdcToken = _usdcToken;
        rewardPool = _rewardPool;
        owner = _owner;
    }

    function createVault(
        string calldata goalName,
        uint256 targetAmount,
        uint256 unlockTime
    ) external returns (uint256 vaultId) {
        vaultId = totalVaults + 1;
        totalVaults = vaultId;

        vaults[vaultId] = Vault({
            owner: msg.sender,
            goalName: goalName,
            targetAmount: targetAmount,
            unlockTime: unlockTime,
            balance: 0,
            withdrawn: false
        });

        userVaults[msg.sender].push(vaultId);

        emit VaultCreated(vaultId, msg.sender, goalName, targetAmount, unlockTime);
    }

    function deposit(uint256 vaultId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (vaultId == 0 || vaultId > totalVaults) revert ZeroAmount();

        Vault storage vault = vaults[vaultId];
        if (vault.withdrawn) revert AlreadyWithdrawn();

        uint256 balanceBefore = IERC20(usdcToken).balanceOf(address(this));
        if (!IERC20(usdcToken).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        uint256 balanceAfter = IERC20(usdcToken).balanceOf(address(this));

        vault.balance += (balanceAfter - balanceBefore);

        emit Deposited(vaultId, amount);
    }

    function withdraw(uint256 vaultId) external {
        if (vaultId == 0 || vaultId > totalVaults) revert ZeroAmount();

        Vault storage vault = vaults[vaultId];
        if (msg.sender != vault.owner) revert NotOwner();
        if (vault.withdrawn) revert AlreadyWithdrawn();

        uint256 balance = vault.balance;
        vault.withdrawn = true;
        vault.balance = 0;

        bool amountMet = vault.targetAmount == 0 || balance >= vault.targetAmount;
        bool timeMet = vault.unlockTime == 0 || block.timestamp >= vault.unlockTime;
        bool goalMet = amountMet && timeMet;

        if (goalMet) {
            if (!IERC20(usdcToken).transfer(vault.owner, balance)) {
                revert TransferFailed();
            }
            emit Withdrawn(vaultId, balance, false);
            return;
        }

        uint256 penalty = (balance * 2) / 100;
        uint256 payout = balance - penalty;

        if (!IERC20(usdcToken).transfer(vault.owner, payout)) {
            revert TransferFailed();
        }

        bool penaltyTransferred;
        try IERC20(usdcToken).transfer(rewardPool, penalty) returns (bool success) {
            penaltyTransferred = success;
        } catch {
            penaltyTransferred = false;
        }

        if (!penaltyTransferred) {
            pendingPenalties[rewardPool] += penalty;
        }

        emit Withdrawn(vaultId, payout, true);
    }

    function claimPenalties() external {
        uint256 amount = pendingPenalties[msg.sender];
        if (amount == 0) return;

        pendingPenalties[msg.sender] = 0;
        if (!IERC20(usdcToken).transfer(msg.sender, amount)) {
            pendingPenalties[msg.sender] = amount;
            revert TransferFailed();
        }
    }

    function setRewardPool(address newPool) external onlyOwner {
        if (newPool == address(0)) revert ZeroAddress();
        rewardPool = newPool;
        emit RewardPoolUpdated(newPool);
    }

    function getVault(uint256 vaultId) external view returns (Vault memory) {
        return vaults[vaultId];
    }

    function getUserVaults(address user) external view returns (uint256[] memory) {
        return userVaults[user];
    }
}

