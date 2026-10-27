// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
