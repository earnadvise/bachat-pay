// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ChitFund}  from "../ChitFund.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract ChitFundTest is Test {
    // ── actors ────────────────────────────────────────────────────────────────
    address internal contractOwner = makeAddr("contractOwner");
    address internal admin         = makeAddr("admin");

    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");
    address internal carol = makeAddr("carol");

    // ── contracts ─────────────────────────────────────────────────────────────
    MockERC20 internal usdc;
    ChitFund  internal chit;

    // ── constants ─────────────────────────────────────────────────────────────
    uint256 internal constant CONTRIBUTION = 100e6;
    uint256 internal constant ROUND_DUR    = 7 days;
    uint256 internal constant INITIAL_BAL  = 10_000e6;

    // ── helpers ───────────────────────────────────────────────────────────────

    /// @dev Returns the canonical 3-member array [alice, bob, carol].
    function _members3() internal view returns (address[] memory m) {
        m = new address[](3);
        m[0] = alice;
        m[1] = bob;
        m[2] = carol;
    }

    /// @dev Creates a fund with [alice, bob, carol], 3 rounds.
    function _createFund3() internal returns (uint256 fundId) {
        vm.prank(admin);
        fundId = chit.createFund("Saving Circle", CONTRIBUTION, _members3(), ROUND_DUR);
    }

    /// @dev Approves vault from each of alice, bob, carol.
    function _approveAll() internal {
        vm.prank(alice); usdc.approve(address(chit), type(uint256).max);
        vm.prank(bob);   usdc.approve(address(chit), type(uint256).max);
        vm.prank(carol); usdc.approve(address(chit), type(uint256).max);
    }

    /// @dev All three members contribute in the current round.
    function _contributeAll(uint256 fundId) internal {
        vm.prank(alice); chit.contribute(fundId);
        vm.prank(bob);   chit.contribute(fundId);
        vm.prank(carol); chit.contribute(fundId);
    }

    // ── setUp ─────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        chit = new ChitFund(address(usdc), contractOwner);

        usdc.mint(alice, INITIAL_BAL);
        usdc.mint(bob,   INITIAL_BAL);
        usdc.mint(carol, INITIAL_BAL);

        _approveAll();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // createFund
    // ══════════════════════════════════════════════════════════════════════════

    function test_CreateFund_ReturnsIdOne() public {
        uint256 id = _createFund3();
        assertEq(id, 1);
        assertEq(chit.totalFunds(), 1);
    }

    function test_CreateFund_StoresFields() public {
        uint256 id = _createFund3();
        ChitFund.FundInfo memory f = chit.getFund(id);

        assertEq(f.admin,              admin,        "admin");
        assertEq(f.name,               "Saving Circle", "name");
        assertEq(f.contributionAmount, CONTRIBUTION, "contribution");
        assertEq(f.currentRound,       1,            "round");
        assertEq(f.totalRounds,        3,            "totalRounds");
        assertEq(f.roundDuration,      ROUND_DUR,    "duration");
        assertTrue(f.active,                         "active");
        assertEq(f.members.length,     3,            "members");
    }

    function test_CreateFund_EmitsFundCreated() public {
        vm.prank(admin);
        vm.expectEmit(true, true, false, true, address(chit));
        emit ChitFund.FundCreated(1, admin, "Saving Circle", CONTRIBUTION, 3);
        chit.createFund("Saving Circle", CONTRIBUTION, _members3(), ROUND_DUR);
    }

    function test_CreateFund_TooFewMembersReverts() public {
        address[] memory m = new address[](1);
        m[0] = alice;
        vm.prank(admin);
        vm.expectRevert(ChitFund.InvalidMembers.selector);
        chit.createFund("X", CONTRIBUTION, m, ROUND_DUR);
    }

    function test_CreateFund_TooManyMembersReverts() public {
        address[] memory m = new address[](21);
        for (uint256 i = 0; i < 21; i++) m[i] = makeAddr(string(abi.encode(i)));
        vm.prank(admin);
        vm.expectRevert(ChitFund.InvalidMembers.selector);
        chit.createFund("X", CONTRIBUTION, m, ROUND_DUR);
    }

    function test_CreateFund_DuplicateMemberReverts() public {
        address[] memory m = new address[](3);
        m[0] = alice; m[1] = alice; m[2] = carol;
        vm.prank(admin);
        vm.expectRevert(ChitFund.InvalidMembers.selector);
        chit.createFund("X", CONTRIBUTION, m, ROUND_DUR);
    }

    function test_CreateFund_ZeroContributionReverts() public {
        vm.prank(admin);
        vm.expectRevert(ChitFund.ZeroAmount.selector);
        chit.createFund("X", 0, _members3(), ROUND_DUR);
    }

    function test_CreateFund_ZeroRoundDurationReverts() public {
        vm.prank(admin);
        vm.expectRevert(ChitFund.InvalidRoundDuration.selector);
        chit.createFund("X", CONTRIBUTION, _members3(), 0);
    }

    function test_CreateFund_ZeroMemberAddressReverts() public {
        address[] memory m = new address[](3);
        m[0] = alice; m[1] = address(0); m[2] = carol;
        vm.prank(admin);
        vm.expectRevert(ChitFund.ZeroAddress.selector);
        chit.createFund("X", CONTRIBUTION, m, ROUND_DUR);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // contribute — happy path
    // ══════════════════════════════════════════════════════════════════════════

    function test_Contribute_HappyPath_TransfersTokens() public {
        uint256 id = _createFund3();

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        chit.contribute(id);

        assertEq(usdc.balanceOf(alice), aliceBefore - CONTRIBUTION, "alice deducted");
        assertEq(usdc.balanceOf(address(chit)), CONTRIBUTION,       "chit received");
    }

    function test_Contribute_HappyPath_EmitsContributed() public {
        uint256 id = _createFund3();
        vm.prank(alice);
        vm.expectEmit(true, true, true, true, address(chit));
        emit ChitFund.Contributed(id, 1, alice, CONTRIBUTION);
        chit.contribute(id);
    }

    function test_Contribute_MarksPaid() public {
        uint256 id = _createFund3();
        vm.prank(alice);
        chit.contribute(id);
        assertTrue(chit.hasPaid(id, 1, alice));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // contribute — revert paths
    // ══════════════════════════════════════════════════════════════════════════

    function test_Contribute_AlreadyPaidReverts() public {
        uint256 id = _createFund3();
        vm.prank(alice);
        chit.contribute(id);

        vm.prank(alice);
        vm.expectRevert(ChitFund.AlreadyPaid.selector);
        chit.contribute(id);
    }

    function test_Contribute_NotMemberReverts() public {
        uint256 id = _createFund3();
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(ChitFund.NotMember.selector);
        chit.contribute(id);
    }

    function test_Contribute_InvalidFundIdReverts() public {
        vm.prank(alice);
        vm.expectRevert(ChitFund.FundNotActive.selector);
        chit.contribute(99);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // disburse — all paid
    // ══════════════════════════════════════════════════════════════════════════

    function test_Disburse_AllPaid_AssignsPendingClaim() public {
        uint256 id = _createFund3();
        _contributeAll(id);

        uint256 expectedPayout = CONTRIBUTION * 3;
        chit.disburse(id);

        // Round 1 → alice is recipient (members[0])
        assertEq(chit.pendingClaims(alice), expectedPayout, "alice pending");
    }

    function test_Disburse_AllPaid_EmitsDisbursed() public {
        uint256 id = _createFund3();
        _contributeAll(id);

        vm.expectEmit(true, true, true, true, address(chit));
        emit ChitFund.Disbursed(id, 1, alice, CONTRIBUTION * 3);
        chit.disburse(id);
    }

    function test_Disburse_AllPaid_AdvancesRound() public {
        uint256 id = _createFund3();
        _contributeAll(id);
        chit.disburse(id);

        ChitFund.FundInfo memory f = chit.getFund(id);
        assertEq(f.currentRound, 2, "advanced to round 2");
    }

    function test_Disburse_AlreadyDisbursedReverts() public {
        uint256 id = _createFund3();
        _contributeAll(id);
        chit.disburse(id);

        // round 2 — nobody has paid yet — disburse should revert RoundNotComplete
        // (not AlreadyDisbursed, because we moved to round 2)
        vm.expectRevert(ChitFund.RoundNotComplete.selector);
        chit.disburse(id);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // disburse — round not complete revert
    // ══════════════════════════════════════════════════════════════════════════

    function test_Disburse_RoundNotCompleteReverts() public {
        uint256 id = _createFund3();
        // Only alice has paid
        vm.prank(alice);
        chit.contribute(id);

        vm.expectRevert(ChitFund.RoundNotComplete.selector);
        chit.disburse(id);
    }

    function test_Disburse_NobodyPaidReverts() public {
        uint256 id = _createFund3();
        vm.expectRevert(ChitFund.RoundNotComplete.selector);
        chit.disburse(id);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // claim — pull pattern
    // ══════════════════════════════════════════════════════════════════════════

    function test_Claim_PullTransfersTokens() public {
        uint256 id = _createFund3();
        _contributeAll(id);
        chit.disburse(id);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        chit.claim();

        assertEq(usdc.balanceOf(alice), aliceBefore + CONTRIBUTION * 3, "alice received payout");
        assertEq(chit.pendingClaims(alice), 0,                          "claims zeroed");
    }

    function test_Claim_ZeroBalanceNoop() public {
        // No pending claim → does not revert, balance unchanged
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        chit.claim();
        assertEq(usdc.balanceOf(alice), aliceBefore);
    }

    function test_Claim_CannotClaimTwice() public {
        uint256 id = _createFund3();
        _contributeAll(id);
        chit.disburse(id);

        vm.prank(alice);
        chit.claim();

        uint256 aliceAfter = usdc.balanceOf(alice);
        vm.prank(alice);
        chit.claim(); // second claim → noop
        assertEq(usdc.balanceOf(alice), aliceAfter, "no double-claim");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // skipDeadlinedRound — by member after deadline
    // ══════════════════════════════════════════════════════════════════════════

    function test_SkipDeadlinedRound_MarksAllPaid() public {
        uint256 id = _createFund3();
        // Only alice pays; deadline passes
        vm.prank(alice);
        chit.contribute(id);

        vm.warp(block.timestamp + ROUND_DUR + 1);

        vm.prank(bob); // member can call
        chit.skipDeadlinedRound(id);

        // All members should now be marked paid for round 1
        assertTrue(chit.hasPaid(id, 1, alice));
        assertTrue(chit.hasPaid(id, 1, bob));
        assertTrue(chit.hasPaid(id, 1, carol));
    }

    function test_SkipDeadlinedRound_EmitsRoundSkipped() public {
        uint256 id = _createFund3();
        vm.warp(block.timestamp + ROUND_DUR + 1);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false, address(chit));
        emit ChitFund.RoundSkipped(id, 1);
        chit.skipDeadlinedRound(id);
    }

    function test_SkipDeadlinedRound_ResetsDeadline() public {
        uint256 id = _createFund3();
        vm.warp(block.timestamp + ROUND_DUR + 1);

        uint256 skipTime = block.timestamp;
        vm.prank(alice);
        chit.skipDeadlinedRound(id);

        ChitFund.FundInfo memory f = chit.getFund(id);
        assertEq(f.roundDeadline, skipTime + ROUND_DUR, "deadline reset");
    }

    function test_SkipDeadlinedRound_BeforeDeadlineReverts() public {
        uint256 id = _createFund3();
        vm.prank(alice);
        vm.expectRevert(ChitFund.RoundDeadlineNotPassed.selector);
        chit.skipDeadlinedRound(id);
    }

    function test_SkipDeadlinedRound_NotMemberReverts() public {
        uint256 id = _createFund3();
        vm.warp(block.timestamp + ROUND_DUR + 1);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(ChitFund.NotMember.selector);
        chit.skipDeadlinedRound(id);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // full rotation — all members receive once
    // ══════════════════════════════════════════════════════════════════════════

    function test_FullRotation_EachMemberReceivesOnce() public {
        uint256 id = _createFund3();

        // Round 1 → alice receives
        _contributeAll(id);
        chit.disburse(id);

        // Round 2 → bob receives
        _contributeAll(id);
        chit.disburse(id);

        // Round 3 → carol receives
        _contributeAll(id);
        chit.disburse(id);

        uint256 payout = CONTRIBUTION * 3;
        assertEq(chit.pendingClaims(alice), payout, "alice pending");
        assertEq(chit.pendingClaims(bob),   payout, "bob pending");
        assertEq(chit.pendingClaims(carol),  payout, "carol pending");
    }

    function test_FullRotation_FundInactiveAfterLastRound() public {
        uint256 id = _createFund3();

        _contributeAll(id); chit.disburse(id);
        _contributeAll(id); chit.disburse(id);

        // Last round — contributeAll first, then expect the emit on disburse
        _contributeAll(id);
        vm.expectEmit(true, false, false, false, address(chit));
        emit ChitFund.FundCompleted(id);
        chit.disburse(id);

        ChitFund.FundInfo memory f = chit.getFund(id);
        assertFalse(f.active, "fund inactive");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // fund completion
    // ══════════════════════════════════════════════════════════════════════════

    function test_FundCompletion_ContributeRevertsAfterComplete() public {
        uint256 id = _createFund3();

        _contributeAll(id); chit.disburse(id);
        _contributeAll(id); chit.disburse(id);
        _contributeAll(id); chit.disburse(id);

        vm.prank(alice);
        vm.expectRevert(ChitFund.FundNotActive.selector);
        chit.contribute(id);
    }

    function test_FundCompletion_DisburseRevertsAfterComplete() public {
        uint256 id = _createFund3();

        _contributeAll(id); chit.disburse(id);
        _contributeAll(id); chit.disburse(id);
        _contributeAll(id); chit.disburse(id);

        vm.expectRevert(ChitFund.FundNotActive.selector);
        chit.disburse(id);
    }

    function test_FundCompletion_ClaimAfterComplete() public {
        uint256 id = _createFund3();

        _contributeAll(id); chit.disburse(id);
        _contributeAll(id); chit.disburse(id);
        _contributeAll(id); chit.disburse(id);

        vm.prank(alice); chit.claim();
        vm.prank(bob);   chit.claim();
        vm.prank(carol);  chit.claim();

        // Each member paid CONTRIBUTION * 3 rounds and received CONTRIBUTION * 3 (all members per round).
        // Net balance = INITIAL_BAL - CONTRIBUTION*3 + CONTRIBUTION*3 = INITIAL_BAL.
        assertEq(usdc.balanceOf(alice), INITIAL_BAL, "alice net");
        assertEq(usdc.balanceOf(bob),   INITIAL_BAL, "bob net");
        assertEq(usdc.balanceOf(carol),  INITIAL_BAL, "carol net");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // fuzz
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_Contribute_TwoMemberFund(uint96 contribution_) public {
        // Each person pays twice (2 rounds × 1 contribution each)
        uint256 contribution = bound(uint256(contribution_), 1, 1_000_000e6);

        address[] memory m = new address[](2);
        m[0] = alice; m[1] = bob;

        usdc.mint(alice, contribution * 2);
        usdc.mint(bob,   contribution * 2);

        vm.prank(admin);
        uint256 id = chit.createFund("Fuzz", contribution, m, ROUND_DUR);

        vm.prank(alice); chit.contribute(id);
        vm.prank(bob);   chit.contribute(id);

        chit.disburse(id); // round 1 → alice

        vm.prank(alice); chit.contribute(id);
        vm.prank(bob);   chit.contribute(id);

        chit.disburse(id); // round 2 → bob

        assertEq(chit.pendingClaims(alice), contribution * 2, "alice");
        assertEq(chit.pendingClaims(bob),   contribution * 2, "bob");
    }
}
