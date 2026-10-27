// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ChitFund {
    address public immutable usdcToken;
    address public immutable owner;
    uint256 public totalFunds;

    struct FundInfo {
        address admin;
        string name;
        uint256 contributionAmount;
        uint256 currentRound;
        uint256 totalRounds;
        uint256 roundDeadline;
        uint256 roundDuration;
        bool active;
        address[] members;
    }

    mapping(uint256 => FundInfo) internal _funds;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) internal _paid;
    mapping(uint256 => mapping(uint256 => bool)) internal _disbursed;
    mapping(uint256 => mapping(uint256 => uint256)) internal _roundReceived;
    mapping(address => uint256) public pendingClaims;

    event FundCreated(
        uint256 indexed fundId,
        address indexed admin,
        string name,
        uint256 contributionAmount,
        uint256 totalRounds
    );
    event Contributed(uint256 indexed fundId, uint256 indexed round, address indexed member, uint256 amount);
    event Disbursed(uint256 indexed fundId, uint256 indexed round, address indexed recipient, uint256 amount);
    event RoundSkipped(uint256 indexed fundId, uint256 indexed round);
    event FundCompleted(uint256 indexed fundId);

    error NotOwner();
    error NotFundAdmin();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidRoundDuration();
    error FundNotActive();
    error NotMember();
    error AlreadyPaid();
    error RoundNotComplete();
    error AlreadyDisbursed();
    error TransferFailed();
    error InvalidMembers();
    error RoundDeadlineNotPassed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _usdcToken, address _owner) {
        if (_usdcToken == address(0) || _owner == address(0)) revert ZeroAddress();
        if (_usdcToken.code.length == 0) revert ZeroAddress();

        usdcToken = _usdcToken;
        owner = _owner;
    }

    function createFund(
        string calldata name,
        uint256 contributionAmount,
        address[] calldata members,
        uint256 roundDuration
    ) external returns (uint256 fundId) {
        uint256 memberCount = members.length;
        if (memberCount < 2 || memberCount > 20) revert InvalidMembers();
        if (contributionAmount == 0) revert ZeroAmount();
        if (roundDuration == 0) revert InvalidRoundDuration();

        fundId = ++totalFunds;
        FundInfo storage fund = _funds[fundId];
        fund.admin = msg.sender;
        fund.name = name;
        fund.contributionAmount = contributionAmount;
        fund.currentRound = 1;
        fund.totalRounds = memberCount;
        fund.roundDuration = roundDuration;
        fund.roundDeadline = block.timestamp + roundDuration;
        fund.active = true;

        for (uint256 i = 0; i < memberCount; i++) {
            address member = members[i];
            if (member == address(0)) revert ZeroAddress();

            for (uint256 j = 0; j < i; j++) {
                if (members[j] == member) revert InvalidMembers();
            }

            fund.members.push(member);
        }

        emit FundCreated(fundId, msg.sender, name, contributionAmount, memberCount);
    }

    function contribute(uint256 fundId) external {
        if (fundId == 0 || fundId > totalFunds) revert FundNotActive();

        FundInfo storage fund = _funds[fundId];
        if (!fund.active) revert FundNotActive();

        if (!_isMember(fund, msg.sender)) revert NotMember();

        uint256 round = fund.currentRound;
        if (_paid[fundId][round][msg.sender]) revert AlreadyPaid();

        _paid[fundId][round][msg.sender] = true;

        uint256 balanceBefore = IERC20(usdcToken).balanceOf(address(this));
        if (!IERC20(usdcToken).transferFrom(msg.sender, address(this), fund.contributionAmount)) {
            revert TransferFailed();
        }
        uint256 balanceAfter = IERC20(usdcToken).balanceOf(address(this));
        _roundReceived[fundId][round] += balanceAfter - balanceBefore;

        emit Contributed(fundId, round, msg.sender, fund.contributionAmount);
    }

    function disburse(uint256 fundId) external {
        if (fundId == 0 || fundId > totalFunds) revert FundNotActive();

        FundInfo storage fund = _funds[fundId];
        if (!fund.active) revert FundNotActive();

        uint256 round = fund.currentRound;
        if (_disbursed[fundId][round]) revert AlreadyDisbursed();

        uint256 memberCount = fund.members.length;
        for (uint256 i = 0; i < memberCount; i++) {
            if (!_paid[fundId][round][fund.members[i]]) revert RoundNotComplete();
        }

        address recipient = fund.members[round - 1];
        uint256 amount = _roundReceived[fundId][round];

        _disbursed[fundId][round] = true;
        pendingClaims[recipient] += amount;
        fund.currentRound = round + 1;

        bool completed = fund.currentRound > fund.totalRounds;
        if (completed) {
            fund.active = false;
        } else {
            fund.roundDeadline = block.timestamp + fund.roundDuration;
        }

        emit Disbursed(fundId, round, recipient, amount);

        if (completed) {
            emit FundCompleted(fundId);
        }
    }

    function skipDeadlinedRound(uint256 fundId) external {
        if (fundId == 0 || fundId > totalFunds) revert FundNotActive();

        FundInfo storage fund = _funds[fundId];
        if (!fund.active) revert FundNotActive();
        if (!_isMember(fund, msg.sender)) revert NotMember();
        if (block.timestamp <= fund.roundDeadline) revert RoundDeadlineNotPassed();

        uint256 round = fund.currentRound;
        uint256 memberCount = fund.members.length;

        for (uint256 i = 0; i < memberCount; i++) {
            address member = fund.members[i];
            if (!_paid[fundId][round][member]) {
                _paid[fundId][round][member] = true;
            }
        }

        fund.roundDeadline = block.timestamp + fund.roundDuration;

        emit RoundSkipped(fundId, round);
    }

    function claim() external {
        uint256 amount = pendingClaims[msg.sender];
        if (amount == 0) return;
        pendingClaims[msg.sender] = 0;

        if (!IERC20(usdcToken).transfer(msg.sender, amount)) revert TransferFailed();
    }

    function getFund(uint256 fundId) external view returns (FundInfo memory) {
        return _funds[fundId];
    }

    function hasPaid(uint256 fundId, uint256 round, address member) external view returns (bool) {
        return _paid[fundId][round][member];
    }

    function isRoundComplete(uint256 fundId) external view returns (bool) {
        if (fundId == 0 || fundId > totalFunds) return false;

        FundInfo storage fund = _funds[fundId];
        if (!fund.active) return false;

        uint256 round = fund.currentRound;
        uint256 memberCount = fund.members.length;
        for (uint256 i = 0; i < memberCount; i++) {
            if (!_paid[fundId][round][fund.members[i]]) {
                return false;
            }
        }

        return true;
    }

    function _isMember(FundInfo storage fund, address account) internal view returns (bool) {
        uint256 memberCount = fund.members.length;
        for (uint256 i = 0; i < memberCount; i++) {
            if (fund.members[i] == account) return true;
        }

        return false;
    }
}
