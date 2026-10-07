// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MandateRegistry, IERC3009, IIdentity} from "../src/MandateRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockIdentity} from "./mocks/MockIdentity.sol";

/// @notice Executable documentation of the EVM MandateRegistry's known
///         limitations (see SECURITY.md, findings C-1, C-2, M-3, L-2).
///
///         Every test here PASSES against the deployed design and asserts the
///         unsafe behavior, so the limitation is pinned and visible. When the
///         escrow-based v2 lands, each test should be flipped to expect a
///         revert. Do not read a green run of this file as "secure".
///
///         The deployed Fuji contract is intentionally left byte-for-byte
///         unchanged by the security review, so the source keeps matching the
///         verified bytecode.
contract KnownLimitationsTest is Test {
    MandateRegistry reg;
    MockUSDC usdc;
    MockIdentity identity;

    address principal = makeAddr("principal");
    address agentSigner = makeAddr("agentSigner"); // holds the USDC
    address merchant = makeAddr("merchant");
    address scammer = makeAddr("scammer");

    uint256 constant AGENT_ID = 1;
    uint256 constant USDC1 = 1e6;
    bytes32 constant MID = keccak256("mandate-1");

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentity();
        reg = new MandateRegistry(IIdentity(address(identity)), IERC3009(address(usdc)));
        identity.setOwner(AGENT_ID, principal);
        usdc.mint(agentSigner, 100 * USDC1);
    }

    function _mandate(bytes32 payeesRoot) internal view returns (MandateRegistry.Mandate memory) {
        return MandateRegistry.Mandate({
            principal: principal,
            agentId: AGENT_ID,
            agentSigner: agentSigner,
            maxPerTx: 5 * USDC1,
            maxCumulative: 20 * USDC1,
            expiry: 0,
            allowedPayeesRoot: payeesRoot,
            revoked: false
        });
    }

    /// C-1: the funds sit in the agent's own wallet. An EIP-3009 authorization
    ///      signed by that wallet is redeemable by ANYONE directly on the token
    ///      contract, so the registry (and every cap in it) is never consulted.
    ///      This is what happens to the signed X-PAYMENT header a scammer
    ///      "seller" receives: it submits the authorization itself.
    function test_KnownLimitation_C1_signedAuthorizationRedeemableOutsideRegistry() public {
        // single allowed payee: merchant
        bytes32 root = keccak256(abi.encodePacked(merchant));
        vm.prank(principal);
        reg.createMandate(MID, _mandate(root));

        // revoked, too: still does not matter
        vm.prank(principal);
        reg.revoke(MID);

        // the scammer redeems a 50 USDC authorization (10x the per-tx cap,
        // off the allowlist, after revocation) straight on the token
        vm.prank(scammer);
        usdc.transferWithAuthorization(agentSigner, scammer, 50 * USDC1, 0, type(uint256).max, keccak256("n1"), 0, 0, 0);

        assertEq(usdc.balanceOf(scammer), 50 * USDC1, "funds moved without touching the registry");
        assertEq(reg.spent(MID), 0, "registry never saw the spend");
    }

    /// C-1 (cumulative cap): authorizations that each pass the per-tx check
    ///      but are redeemed outside the registry never increment `spent`, so
    ///      the cumulative cap never trips.
    function test_KnownLimitation_C1_cumulativeCapNeverTripsForDirectRedemption() public {
        vm.prank(principal);
        reg.createMandate(MID, _mandate(bytes32(0)));
        for (uint256 i; i < 10; ++i) {
            (bool ok,) = reg.checkAllowance(MID, 5 * USDC1);
            assertTrue(ok, "Layer A pre-check keeps saying yes");
            usdc.transferWithAuthorization(
                agentSigner, scammer, 5 * USDC1, 0, type(uint256).max, keccak256(abi.encode(i)), 0, 0, 0
            );
        }
        assertEq(usdc.balanceOf(scammer), 50 * USDC1, "2.5x the 20 USDC lifetime cap");
        assertEq(reg.spent(MID), 0);
    }

    /// C-2: a stolen agentSigner key controls the wallet that holds the funds.
    ///      It does not need the registry or even EIP-3009: it signs its own
    ///      authorization (or a plain ERC-20 transfer) for the whole balance.
    function test_KnownLimitation_C2_stolenAgentKeyDrainsWalletDirectly() public {
        vm.prank(principal);
        reg.createMandate(MID, _mandate(bytes32(0)));
        vm.prank(agentSigner); // the attacker holding the stolen key
        usdc.transferWithAuthorization(
            agentSigner, scammer, 100 * USDC1, 0, type(uint256).max, keccak256("drain"), 0, 0, 0
        );
        assertEq(usdc.balanceOf(scammer), 100 * USDC1);
        assertEq(usdc.balanceOf(agentSigner), 0);
    }

    /// M-3: mandate ids are global and first-come. Anyone who controls ANY
    ///      agent identity can squat an id another principal has published
    ///      (e.g. in an agent card) before it is created on-chain.
    function test_KnownLimitation_M3_mandateIdSquatting() public {
        uint256 squatterAgent = 2;
        identity.setOwner(squatterAgent, scammer);
        MandateRegistry.Mandate memory evil = _mandate(bytes32(0));
        evil.principal = scammer;
        evil.agentId = squatterAgent;
        evil.agentSigner = scammer;
        evil.maxPerTx = type(uint256).max;
        evil.maxCumulative = type(uint256).max;
        vm.prank(scammer);
        reg.createMandate(MID, evil);

        vm.prank(principal);
        vm.expectRevert(MandateRegistry.MandateExists.selector);
        reg.createMandate(MID, _mandate(bytes32(0)));
    }

    /// L-2: the registry does not validate mandate fields; a zero-value settle
    ///      succeeds and emits Settled, and maxPerTx > maxCumulative is accepted.
    function test_KnownLimitation_L2_unvalidatedFieldsAndZeroValueSettle() public {
        MandateRegistry.Mandate memory m = _mandate(bytes32(0));
        m.maxPerTx = 100 * USDC1; // > maxCumulative
        vm.prank(principal);
        reg.createMandate(MID, m);

        bytes32[] memory proof;
        vm.expectEmit(true, true, false, true);
        emit MandateRegistry.Settled(MID, merchant, 0, 0);
        reg.settle(MID, merchant, 0, 0, type(uint256).max, keccak256("zero"), 0, 0, 0, proof);
        assertEq(reg.spent(MID), 0);
    }

    /// L-3: checkAllowance does not check the payee, so it is not a complete
    ///      Layer A pre-check: it says OK for a payee that settle would reject.
    function test_KnownLimitation_L3_checkAllowanceIgnoresPayee() public {
        bytes32 root = keccak256(abi.encodePacked(merchant));
        vm.prank(principal);
        reg.createMandate(MID, _mandate(root));
        (bool ok, string memory reason) = reg.checkAllowance(MID, 5 * USDC1);
        assertTrue(ok);
        assertEq(reason, "OK");
        bytes32[] memory proof;
        vm.expectRevert(MandateRegistry.PayeeNotAllowed.selector);
        reg.settle(MID, scammer, 5 * USDC1, 0, type(uint256).max, keccak256("s"), 0, 0, 0, proof);
    }
}
