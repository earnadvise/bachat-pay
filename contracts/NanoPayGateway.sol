// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
