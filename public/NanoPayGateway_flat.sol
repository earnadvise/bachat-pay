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

// contracts/NanoPayGateway.sol

contract NanoPayGateway {
    address public owner;
    uint256 public pricePerCall;
    address public usdcToken;
    uint256 public totalCalls;
    mapping(address => uint256) public callCount;

    event CallPaid(address indexed caller, uint256 callId, uint256 amount, string requestData);
    event PriceUpdated(uint256 newPrice);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error ZeroAddress();
    error InsufficientAllowance(uint256 required, uint256 actual);
    error ZeroPrice();
    error WithdrawFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _usdcToken, uint256 _pricePerCall, address _owner) {
        if (_usdcToken == address(0) || _owner == address(0)) revert ZeroAddress();
        if (_pricePerCall == 0) revert ZeroPrice();

        usdcToken = _usdcToken;
        pricePerCall = _pricePerCall;
        owner = _owner;
    }

    function pay(string calldata requestData) external {
        uint256 allowance = IERC20(usdcToken).allowance(msg.sender, address(this));
        if (allowance < pricePerCall) revert InsufficientAllowance(pricePerCall, allowance);

        uint256 callId = totalCalls + 1;
        totalCalls = callId;
        callCount[msg.sender] += 1;

        if (!IERC20(usdcToken).transferFrom(msg.sender, address(this), pricePerCall)) {
            revert WithdrawFailed();
        }

        emit CallPaid(msg.sender, callId, pricePerCall, requestData);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroPrice();
        pricePerCall = newPrice;
        emit PriceUpdated(newPrice);
    }

    function withdraw(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = IERC20(usdcToken).balanceOf(address(this));
        if (!IERC20(usdcToken).transfer(to, balance)) revert WithdrawFailed();

        emit Withdrawn(to, balance);
    }

    function getBalance() external view returns (uint256) {
        return IERC20(usdcToken).balanceOf(address(this));
    }
}

