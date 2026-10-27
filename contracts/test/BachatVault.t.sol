// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BachatVault} from "../BachatVault.sol";
import {MockERC20}   from "../test-helpers/MockERC20.sol";

contract BachatVaultTest is Test {
    // ── actors ────────────────────────────────────────────────────────────────
    address internal contractOwner = makeAddr("contractOwner");
    address internal rewardPool    = makeAddr("rewardPool");
    address internal alice         = makeAddr("alice");
    address internal bob           = makeAddr("bob");

    // ── contracts ─────────────────────────────────────────────────────────────
    MockERC20    internal usdc;
    BachatVault  internal vault;

    // ── constants ─────────────────────────────────────────────────────────────
    uint256 internal constant INITIAL_BALANCE = 10_000e6;
    uint256 internal constant TARGET          = 1_000e6;
    uint256 internal constant ONE_YEAR        = 365 days;

    // ── setUp ─────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc  = new MockERC20("Mock USDC", "mUSDC", 6);
        vault = new BachatVault(address(usdc), rewardPool, contractOwner);

        usdc.mint(alice, INITIAL_BALANCE);
        usdc.mint(bob,   INITIAL_BALANCE);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // createVault
    // ══════════════════════════════════════════════════════════════════════════

    function test_CreateVault_ReturnsIdOne() public {
        vm.prank(alice);
        uint256 id = vault.createVault("Holiday", TARGET, block.timestamp + ONE_YEAR);
        assertEq(id, 1);
        assertEq(vault.totalVaults(), 1);
    }

    function test_CreateVault_StoresFields() public {
        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, unlock);

        BachatVault.Vault memory v = vault.getVault(1);
        assertEq(v.owner,        alice,    "owner");
        assertEq(v.goalName,     "Holiday","goalName");
        assertEq(v.targetAmount, TARGET,   "targetAmount");
        assertEq(v.unlockTime,   unlock,   "unlockTime");
        assertEq(v.balance,      0,        "balance");
        assertFalse(v.withdrawn,           "withdrawn");
    }

    function test_CreateVault_EmitsVaultCreated() public {
        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(vault));
        emit BachatVault.VaultCreated(1, alice, "Holiday", TARGET, unlock);
        vault.createVault("Holiday", TARGET, unlock);
    }

    function test_CreateVault_IncrementsCounter() public {
        vm.startPrank(alice);
        vault.createVault("A", TARGET, 0);
        vault.createVault("B", TARGET, 0);
        vault.createVault("C", TARGET, 0);
        vm.stopPrank();
        assertEq(vault.totalVaults(), 3);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // deposit
    // ══════════════════════════════════════════════════════════════════════════

    function test_Deposit_HappyPath() public {
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, 0);

        uint256 amt = 200e6;
        vm.prank(alice);
        vault.deposit(1, amt);

        BachatVault.Vault memory v = vault.getVault(1);
        assertEq(v.balance, amt);
        assertEq(usdc.balanceOf(address(vault)), amt);
    }

    function test_Deposit_EmitsDeposited() public {
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, 0);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(vault));
        emit BachatVault.Deposited(1, 200e6);
        vault.deposit(1, 200e6);
    }

    function test_Deposit_ZeroAmountReverts() public {
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, 0);

        vm.prank(alice);
        vm.expectRevert(BachatVault.ZeroAmount.selector);
        vault.deposit(1, 0);
    }

    function test_Deposit_InvalidVaultIdReverts() public {
        vm.prank(alice);
        vm.expectRevert(BachatVault.ZeroAmount.selector);
        vault.deposit(99, 100e6);
    }

    function test_Deposit_AfterWithdrawReverts() public {
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, 0);

        vm.prank(alice);
        vault.deposit(1, 100e6);

        vm.prank(alice);
        vault.withdraw(1);

        vm.prank(alice);
        vm.expectRevert(BachatVault.AlreadyWithdrawn.selector);
        vault.deposit(1, 100e6);
    }

    function test_Deposit_MultipleAccumulate() public {
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, 0);

        vm.prank(alice);
        vault.deposit(1, 300e6);
        vm.prank(bob);
        vault.deposit(1, 200e6);

        assertEq(vault.getVault(1).balance, 500e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // withdraw — goal met (no penalty)
    // ══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_GoalMetAmountAndTime_NoPenalty() public {
        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, unlock);

        vm.prank(alice);
        vault.deposit(1, TARGET);

        // warp past unlock
        vm.warp(block.timestamp + ONE_YEAR + 1);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(1);

        assertEq(usdc.balanceOf(alice), aliceBefore + TARGET, "alice gets full amount");
        assertEq(usdc.balanceOf(rewardPool), 0,               "no penalty to pool");
    }

    function test_Withdraw_GoalMet_EmitsWithdrawnNoPenalty() public {
        vm.prank(alice);
        vault.createVault("Holiday", 0, 0); // zero conditions → always met

        vm.prank(alice);
        vault.deposit(1, 500e6);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(vault));
        emit BachatVault.Withdrawn(1, 500e6, false);
        vault.withdraw(1);
    }

    function test_Withdraw_GoalMet_MarksWithdrawn() public {
        vm.prank(alice);
        vault.createVault("Holiday", 0, 0);
        vm.prank(alice);
        vault.deposit(1, 500e6);
        vm.prank(alice);
        vault.withdraw(1);

        assertTrue(vault.getVault(1).withdrawn);
        assertEq(vault.getVault(1).balance, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // withdraw — ragequit (2 % penalty)
    // ══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_RagequitPenalty_CorrectAmounts() public {
        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, unlock);

        uint256 deposited = 500e6;
        vm.prank(alice);
        vault.deposit(1, deposited);

        // withdraw before unlock  → ragequit
        uint256 aliceBefore    = usdc.balanceOf(alice);
        uint256 poolBefore     = usdc.balanceOf(rewardPool);

        vm.prank(alice);
        vault.withdraw(1);

        uint256 penalty = (deposited * 2) / 100; // 10e6
        uint256 payout  = deposited - penalty;    // 490e6

        assertEq(usdc.balanceOf(alice),      aliceBefore + payout,  "alice payout");
        assertEq(usdc.balanceOf(rewardPool), poolBefore  + penalty, "pool penalty");
    }

    function test_Withdraw_Ragequit_EmitsWithdrawnPenalty() public {
        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        vault.createVault("Holiday", TARGET, unlock);

        vm.prank(alice);
        vault.deposit(1, 500e6);

        uint256 payout = 500e6 - (500e6 * 2) / 100;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(vault));
        emit BachatVault.Withdrawn(1, payout, true);
        vault.withdraw(1);
    }

    function test_Withdraw_OnlyTargetNotMet_IsRagequit() public {
        // time is ok but amount not reached → still ragequit
        vm.prank(alice);
        vault.createVault("Save", TARGET, 0); // no time lock

        vm.prank(alice);
        vault.deposit(1, TARGET - 1);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(1);

        uint256 deposited = TARGET - 1;
        uint256 penalty   = (deposited * 2) / 100;
        assertEq(usdc.balanceOf(alice), aliceBefore + deposited - penalty, "penalty applied");
    }

    function test_Withdraw_OnlyTimeLockNotMet_IsRagequit() public {
        // amount ok but time lock not passed → ragequit
        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        vault.createVault("Save", 0, unlock); // no amount lock

        vm.prank(alice);
        vault.deposit(1, 500e6);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(1);

        uint256 deposited = 500e6;
        uint256 penalty   = (deposited * 2) / 100;
        assertEq(usdc.balanceOf(alice), aliceBefore + deposited - penalty, "penalty applied");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // withdraw — already withdrawn revert
    // ══════════════════════════════════════════════════════════════════════════

    function test_Withdraw_AlreadyWithdrawn_Reverts() public {
        vm.prank(alice);
        vault.createVault("Holiday", 0, 0);
        vm.prank(alice);
        vault.deposit(1, 100e6);
        vm.prank(alice);
        vault.withdraw(1);

        vm.prank(alice);
        vm.expectRevert(BachatVault.AlreadyWithdrawn.selector);
        vault.withdraw(1);
    }

    function test_Withdraw_NonOwnerReverts() public {
        vm.prank(alice);
        vault.createVault("Holiday", 0, 0);
        vm.prank(alice);
        vault.deposit(1, 100e6);

        vm.prank(bob);
        vm.expectRevert(BachatVault.NotOwner.selector);
        vault.withdraw(1);
    }

    function test_Withdraw_InvalidVaultIdReverts() public {
        vm.prank(alice);
        vm.expectRevert(BachatVault.ZeroAmount.selector);
        vault.withdraw(99);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // setRewardPool
    // ══════════════════════════════════════════════════════════════════════════

    function test_SetRewardPool_HappyPath() public {
        address newPool = makeAddr("newPool");
        vm.prank(contractOwner);
        vault.setRewardPool(newPool);
        assertEq(vault.rewardPool(), newPool);
    }

    function test_SetRewardPool_EmitsEvent() public {
        address newPool = makeAddr("newPool");
        vm.prank(contractOwner);
        vm.expectEmit(false, false, false, true, address(vault));
        emit BachatVault.RewardPoolUpdated(newPool);
        vault.setRewardPool(newPool);
    }

    function test_SetRewardPool_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(BachatVault.NotOwner.selector);
        vault.setRewardPool(makeAddr("newPool"));
    }

    function test_SetRewardPool_ZeroAddressReverts() public {
        vm.prank(contractOwner);
        vm.expectRevert(BachatVault.ZeroAddress.selector);
        vault.setRewardPool(address(0));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // getUserVaults
    // ══════════════════════════════════════════════════════════════════════════

    function test_GetUserVaults_ReturnsCorrectIds() public {
        vm.startPrank(alice);
        vault.createVault("A", 0, 0);
        vault.createVault("B", 0, 0);
        vault.createVault("C", 0, 0);
        vm.stopPrank();

        vm.prank(bob);
        vault.createVault("X", 0, 0);

        uint256[] memory aliceVaults = vault.getUserVaults(alice);
        assertEq(aliceVaults.length, 3);
        assertEq(aliceVaults[0], 1);
        assertEq(aliceVaults[1], 2);
        assertEq(aliceVaults[2], 3);

        uint256[] memory bobVaults = vault.getUserVaults(bob);
        assertEq(bobVaults.length, 1);
        assertEq(bobVaults[0], 4);
    }

    function test_GetUserVaults_EmptyForNewUser() public {
        address stranger = makeAddr("stranger");
        uint256[] memory vaults_ = vault.getUserVaults(stranger);
        assertEq(vaults_.length, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // pendingPenalties (pull) — scenario where penalty transfer is caught
    //
    // The contract wraps the penalty transfer in a try/catch:
    //   try IERC20(usdcToken).transfer(rewardPool, penalty) returns (bool s) { … }
    //   catch { pendingPenalties[rewardPool] += penalty; }
    //
    // The only way to hit the catch is if the ERC-20 token itself reverts on
    // transfer (e.g. a blocklist).  We deploy a fresh TogglableERC20 that can
    // be set to revert all transfers to a specific address, and build a
    // dedicated BachatVault instance that uses it.
    // ══════════════════════════════════════════════════════════════════════════

    function _setupBlockableVault()
        internal
        returns (TogglableERC20 tok, BachatVault bvault)
    {
        tok    = new TogglableERC20("Block USDC", "bUSDC", 6);
        bvault = new BachatVault(address(tok), rewardPool, contractOwner);

        tok.mint(alice, INITIAL_BALANCE);
        vm.prank(alice);
        tok.approve(address(bvault), type(uint256).max);
    }

    function test_PendingPenalties_AccumulatesWhenTransferFails() public {
        (TogglableERC20 tok, BachatVault bvault) = _setupBlockableVault();

        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        bvault.createVault("Holiday", TARGET, unlock);

        uint256 deposited = 1000e6;
        vm.prank(alice);
        bvault.deposit(1, deposited);

        // Block transfers to rewardPool so the try/catch fires
        tok.blockRecipient(rewardPool);

        vm.prank(alice);
        bvault.withdraw(1);

        uint256 penalty = (deposited * 2) / 100; // 20e6
        assertEq(bvault.pendingPenalties(rewardPool), penalty);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // claimPenalties
    // ══════════════════════════════════════════════════════════════════════════

    function test_ClaimPenalties_HappyPath() public {
        (TogglableERC20 tok, BachatVault bvault) = _setupBlockableVault();

        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        bvault.createVault("Holiday", TARGET, unlock);

        uint256 deposited = 1000e6;
        vm.prank(alice);
        bvault.deposit(1, deposited);

        // First withdrawal with blocked pool → fills pendingPenalties
        tok.blockRecipient(rewardPool);
        vm.prank(alice);
        bvault.withdraw(1);

        uint256 penalty = (deposited * 2) / 100; // 20e6
        assertEq(bvault.pendingPenalties(rewardPool), penalty, "pending before claim");

        // Unblock and let rewardPool pull its pending amount
        tok.unblockRecipient(rewardPool);

        uint256 poolBefore = tok.balanceOf(rewardPool);
        vm.prank(rewardPool);
        bvault.claimPenalties();

        assertEq(tok.balanceOf(rewardPool),           poolBefore + penalty, "pool received");
        assertEq(bvault.pendingPenalties(rewardPool), 0,                    "cleared");
    }

    function test_ClaimPenalties_ZeroNoop() public {
        // Calling with no pending amount does not revert
        vm.prank(alice);
        vault.claimPenalties(); // amount == 0 → early return, no revert
    }

    // ══════════════════════════════════════════════════════════════════════════
    // fuzz
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_Deposit_AccumulatesCorrectly(uint96 a, uint96 b) public {
        vm.assume(a > 0 && b > 0);
        uint256 amt1 = uint256(a);
        uint256 amt2 = uint256(b);

        usdc.mint(alice, amt1 + amt2);

        vm.prank(alice);
        vault.createVault("Fuzz", 0, 0);

        vm.prank(alice);
        vault.deposit(1, amt1);
        vm.prank(alice);
        vault.deposit(1, amt2);

        assertEq(vault.getVault(1).balance, amt1 + amt2);
    }

    function testFuzz_RagequitPenalty(uint96 deposited_) public {
        uint256 deposited = bound(uint256(deposited_), 100, type(uint96).max);
        usdc.mint(alice, deposited);

        uint256 unlock = block.timestamp + ONE_YEAR;
        vm.prank(alice);
        vault.createVault("Fuzz", deposited + 1, unlock); // goal never met

        vm.prank(alice);
        vault.deposit(1, deposited);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 poolBefore  = usdc.balanceOf(rewardPool);

        vm.prank(alice);
        vault.withdraw(1);

        uint256 penalty = (deposited * 2) / 100;
        uint256 payout  = deposited - penalty;

        assertEq(usdc.balanceOf(alice),      aliceBefore + payout,  "alice payout");
        assertEq(usdc.balanceOf(rewardPool), poolBefore  + penalty, "pool penalty");
    }
}

// ── helper: ERC-20 that can block transfers to a specific recipient ───────────
/// @dev Extends MockERC20 semantics; reverts on transfer/transferFrom to a
///      blocked address — simulating a token blocklist.  This causes the
///      `try IERC20.transfer(rewardPool, penalty)` in BachatVault to hit the
///      catch branch and accumulate `pendingPenalties`.
contract TogglableERC20 {
    string public name;
    string public symbol;
    uint8  public decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _dec) {
        name = _name; symbol = _symbol; decimals = _dec;
    }

    function blockRecipient(address to) external { blocked[to] = true; }
    function unblockRecipient(address to) external { blocked[to] = false; }

    function mint(address to, uint256 amount) external {
        totalSupply   += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(!blocked[to], "TogglableERC20: blocked");
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(!blocked[to], "TogglableERC20: blocked");
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "TogglableERC20: allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "TogglableERC20: balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }
}
