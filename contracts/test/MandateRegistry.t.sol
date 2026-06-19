// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MandateRegistry, IERC3009, IIdentity} from "../src/MandateRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockIdentity} from "./mocks/MockIdentity.sol";

contract MandateRegistryTest is Test {
    MandateRegistry reg;
    MockUSDC usdc;
    MockIdentity identity;

    address principal = makeAddr("principal");
    address agentSigner = makeAddr("agentSigner"); // holds the USDC
    address merchant = makeAddr("merchant");
    address scammer = makeAddr("scammer");

    uint256 constant AGENT_ID = 1;
    uint256 constant USDC1 = 1e6; // 1 USDC (6 decimals)

    bytes32 constant MID = keccak256("mandate-1");

    function setUp() public {
        usdc = new MockUSDC();
        identity = new MockIdentity();
        reg = new MandateRegistry(IIdentity(address(identity)), IERC3009(address(usdc)));

        // Principal controls agent #1.
        identity.setOwner(AGENT_ID, principal);
        // Agent wallet funded with 100 USDC.
        usdc.mint(agentSigner, 100 * USDC1);
    }

    function _defaultMandate() internal view returns (MandateRegistry.Mandate memory m) {
        m = MandateRegistry.Mandate({
            principal: principal,
            agentId: AGENT_ID,
            agentSigner: agentSigner,
            maxPerTx: 5 * USDC1,       // cap: 5 USDC per tx
            maxCumulative: 20 * USDC1, // cap: 20 USDC lifetime
            expiry: 0,
            allowedPayeesRoot: bytes32(0), // any payee
            revoked: false
        });
    }

    function _create() internal {
        vm.prank(principal);
        reg.createMandate(MID, _defaultMandate());
    }

    // helper: call settle with empty proof and dummy signature
    function _settle(address to, uint256 value, bytes32 nonce) internal {
        bytes32[] memory proof;
        reg.settle(MID, to, value, 0, type(uint256).max, nonce, 0, bytes32(0), bytes32(0), proof);
    }

    // ---------------------------------------------------------------------
    // Creation / authority binding
    // ---------------------------------------------------------------------

    function test_create_succeeds_forController() public {
        _create();
        (address p,,,,,,,) = _unpack(MID);
        assertEq(p, principal);
    }

    function test_create_reverts_ifNotController() public {
        vm.prank(scammer); // not the owner of agent #1
        vm.expectRevert(MandateRegistry.NotController.selector);
        reg.createMandate(MID, _defaultMandate());
    }

    function test_create_reverts_onDuplicate() public {
        _create();
        vm.prank(principal);
        vm.expectRevert(MandateRegistry.MandateExists.selector);
        reg.createMandate(MID, _defaultMandate());
    }

    // ---------------------------------------------------------------------
    // Happy path
    // ---------------------------------------------------------------------

    function test_settle_inBounds_movesUSDC_andIncrementsSpent() public {
        _create();
        _settle(merchant, 5 * USDC1, keccak256("n1"));
        assertEq(usdc.balanceOf(merchant), 5 * USDC1);
        assertEq(usdc.balanceOf(agentSigner), 95 * USDC1);
        assertEq(reg.spent(MID), 5 * USDC1);
    }

    // ---------------------------------------------------------------------
    // THE SPINE: caps are enforced on-chain, not in a prompt.
    // ---------------------------------------------------------------------

    function test_settle_reverts_whenOverPerTx() public {
        _create();
        // A fully jailbroken agent tries to pay 10,000 USDC. The chain says no.
        bytes32[] memory proof;
        vm.expectRevert(MandateRegistry.CapExceeded.selector);
        reg.settle(MID, scammer, 10_000 * USDC1, 0, type(uint256).max, keccak256("evil"), 0, bytes32(0), bytes32(0), proof);
        // No money moved.
        assertEq(usdc.balanceOf(scammer), 0);
        assertEq(reg.spent(MID), 0);
    }

    function test_settle_reverts_whenCumulativeBreached() public {
        _create();
        // Four 5-USDC payments = 20 (the cap). All succeed.
        _settle(merchant, 5 * USDC1, keccak256("a"));
        _settle(merchant, 5 * USDC1, keccak256("b"));
        _settle(merchant, 5 * USDC1, keccak256("c"));
        _settle(merchant, 5 * USDC1, keccak256("d"));
        assertEq(reg.spent(MID), 20 * USDC1);
        // The 5th — even though per-tx is fine — breaches the lifetime ceiling.
        bytes32[] memory proof;
        vm.expectRevert(MandateRegistry.CapExceeded.selector);
        reg.settle(MID, merchant, 1 * USDC1, 0, type(uint256).max, keccak256("e"), 0, bytes32(0), bytes32(0), proof);
    }

    function test_settle_reverts_whenRevoked() public {
        _create();
        vm.prank(principal);
        reg.revoke(MID);
        bytes32[] memory proof;
        vm.expectRevert(MandateRegistry.Revoked.selector);
        reg.settle(MID, merchant, 1 * USDC1, 0, type(uint256).max, keccak256("n"), 0, bytes32(0), bytes32(0), proof);
    }

    function test_settle_reverts_whenExpired() public {
        MandateRegistry.Mandate memory m = _defaultMandate();
        m.expiry = uint64(block.timestamp + 1 hours);
        vm.prank(principal);
        reg.createMandate(MID, m);
        vm.warp(block.timestamp + 2 hours);
        bytes32[] memory proof;
        vm.expectRevert(MandateRegistry.Expired.selector);
        reg.settle(MID, merchant, 1 * USDC1, 0, type(uint256).max, keccak256("n"), 0, bytes32(0), bytes32(0), proof);
    }

    // ---------------------------------------------------------------------
    // Payee allowlist (merkle)
    // ---------------------------------------------------------------------

    function test_settle_reverts_whenPayeeNotAllowed() public {
        // Single-leaf tree: only `merchant` is allowed.
        bytes32 root = keccak256(abi.encodePacked(merchant));
        MandateRegistry.Mandate memory m = _defaultMandate();
        m.allowedPayeesRoot = root;
        vm.prank(principal);
        reg.createMandate(MID, m);

        bytes32[] memory proof; // empty proof valid for single-leaf root
        // Allowed payee passes.
        reg.settle(MID, merchant, 1 * USDC1, 0, type(uint256).max, keccak256("ok"), 0, bytes32(0), bytes32(0), proof);
        assertEq(usdc.balanceOf(merchant), 1 * USDC1);
        // Scammer rejected.
        vm.expectRevert(MandateRegistry.PayeeNotAllowed.selector);
        reg.settle(MID, scammer, 1 * USDC1, 0, type(uint256).max, keccak256("bad"), 0, bytes32(0), bytes32(0), proof);
    }

    // ---------------------------------------------------------------------
    // checkAllowance view mirrors settle guards
    // ---------------------------------------------------------------------

    function test_checkAllowance_reports() public {
        _create();
        (bool ok, string memory reason) = reg.checkAllowance(MID, 5 * USDC1);
        assertTrue(ok);
        assertEq(reason, "OK");
        (ok, reason) = reg.checkAllowance(MID, 6 * USDC1);
        assertFalse(ok);
        assertEq(reason, "OVER_PER_TX");
    }

    // ---------------------------------------------------------------------

    function _unpack(bytes32 id)
        internal
        view
        returns (address, uint256, address, uint256, uint256, uint64, bytes32, bool)
    {
        return reg.mandates(id);
    }
}
