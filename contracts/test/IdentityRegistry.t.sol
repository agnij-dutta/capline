// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {MandateRegistry, IERC3009, IIdentity} from "../src/MandateRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry id;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        id = new IdentityRegistry();
    }

    function test_register_mintsToCaller_andRecordsDomain() public {
        vm.prank(alice);
        uint256 agentId = id.register("demo-agent.mandate.box");
        assertEq(agentId, 1);
        assertEq(id.ownerOf(1), alice);
        assertEq(id.balanceOf(alice), 1);
        assertEq(id.agentDomain(1), "demo-agent.mandate.box");
    }

    function test_register_incrementsIds() public {
        vm.prank(alice);
        uint256 a = id.register("a.box");
        vm.prank(bob);
        uint256 b = id.register("b.box");
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(id.ownerOf(2), bob);
    }

    function test_ownerOf_revertsForNonexistent() public {
        vm.expectRevert(IdentityRegistry.NonexistentToken.selector);
        id.ownerOf(999);
    }

    function test_setAgentCard_onlyOwner() public {
        vm.prank(alice);
        id.register("a.box");
        vm.prank(bob);
        vm.expectRevert(IdentityRegistry.NotAuthorized.selector);
        id.setAgentCard(1, "ipfs://card");
        vm.prank(alice);
        id.setAgentCard(1, "ipfs://card");
        assertEq(id.agentCard(1), "ipfs://card");
    }

    function test_transferFrom_movesOwnership() public {
        vm.prank(alice);
        id.register("a.box");
        vm.prank(alice);
        id.transferFrom(alice, bob, 1);
        assertEq(id.ownerOf(1), bob);
        assertEq(id.balanceOf(alice), 0);
        assertEq(id.balanceOf(bob), 1);
    }

    /// @notice The whole point: IdentityRegistry satisfies MandateRegistry's
    ///         controller check, end-to-end.
    function test_integratesWithMandateRegistry() public {
        MockUSDC usdc = new MockUSDC();
        MandateRegistry reg =
            new MandateRegistry(IIdentity(address(id)), IERC3009(address(usdc)));

        vm.startPrank(alice);
        uint256 agentId = id.register("demo-agent.mandate.box");
        MandateRegistry.Mandate memory m = MandateRegistry.Mandate({
            principal: alice,
            agentId: agentId,
            agentSigner: alice,
            maxPerTx: 5e6,
            maxCumulative: 20e6,
            expiry: 0,
            allowedPayeesRoot: bytes32(0),
            revoked: false
        });
        bytes32 mid = keccak256("demo");
        reg.createMandate(mid, m);
        vm.stopPrank();

        (address p,,,,,,,) = reg.mandates(mid);
        assertEq(p, alice);

        // A non-controller cannot grant a mandate for alice's agent.
        vm.prank(bob);
        vm.expectRevert(MandateRegistry.NotController.selector);
        reg.createMandate(keccak256("evil"), m);
    }
}
