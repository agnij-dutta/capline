// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MandateRegistry, IERC3009, IIdentity} from "../src/MandateRegistry.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

/// @notice One-shot Avalanche Fuji deployment for Mandate.
///
/// In a single broadcast this:
///   1. deploys the ERC-8004 IdentityRegistry,
///   2. deploys MandateRegistry(identity, USDC),
///   3. seeds a live demo: registers a demo agent owned by the deployer and
///      creates a demo mandate (5 USDC/tx, 20 USDC lifetime) so the dapp has
///      something to read immediately,
///   4. writes deployments/fuji.json for the dapp to import.
///
/// Env (source contracts/.env first):
///   PRIVATE_KEY   deployer key (also the demo agent owner / principal / signer)
///   USDC          EIP-3009 token (defaults to Circle Fuji USDC)
///
/// Broadcast:
///   forge script script/Deploy.s.sol --rpc-url $FUJI_RPC --broadcast
contract Deploy is Script {
    // Circle's official testnet USDC on Avalanche Fuji (EIP-3009 capable).
    address constant FUJI_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;
    uint256 constant CHAIN_ID = 43113;

    // Demo mandate caps (USDC has 6 decimals).
    uint256 constant DEMO_MAX_PER_TX = 5e6; // 5 USDC
    uint256 constant DEMO_MAX_CUMULATIVE = 20e6; // 20 USDC
    string constant DEMO_DOMAIN = "demo-agent.mandate.box";

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envOr("USDC", FUJI_USDC);

        vm.startBroadcast(pk);

        // 1. Identity registry (ERC-8004).
        IdentityRegistry identity = new IdentityRegistry();

        // 2. Mandate registry, bound to the identity registry + USDC.
        MandateRegistry registry = new MandateRegistry(IIdentity(address(identity)), IERC3009(usdc));

        // 3a. Register the demo agent. Deployer becomes its controller (owner).
        uint256 demoAgentId = identity.register(DEMO_DOMAIN);

        // 3b. Grant a demo mandate. principal == agentSigner == deployer for the demo.
        MandateRegistry.Mandate memory m = MandateRegistry.Mandate({
            principal: deployer,
            agentId: demoAgentId,
            agentSigner: deployer,
            maxPerTx: DEMO_MAX_PER_TX,
            maxCumulative: DEMO_MAX_CUMULATIVE,
            expiry: 0,
            allowedPayeesRoot: bytes32(0),
            revoked: false
        });

        // Deterministic mandateId, derived from the deploy + agent identity so the
        // dapp can recompute/verify it. Stable for a given (registry, agent).
        bytes32 demoMandateId =
            keccak256(abi.encode("mandate.demo.v1", address(registry), demoAgentId, deployer));

        registry.createMandate(demoMandateId, m);

        vm.stopBroadcast();

        // 4. Emit machine-readable config for the dapp.
        _writeDeployments(address(identity), address(registry), usdc, demoAgentId, demoMandateId, deployer);

        // ---- Human-readable summary ----
        console2.log("=== Mandate :: Avalanche Fuji deployment ===");
        console2.log("deployer:         ", deployer);
        console2.log("IdentityRegistry: ", address(identity));
        console2.log("MandateRegistry:  ", address(registry));
        console2.log("USDC:             ", usdc);
        console2.log("demoAgentId:      ", demoAgentId);
        console2.log("demoMandateId:");
        console2.logBytes32(demoMandateId);
        console2.log("--- Snowtrace ---");
        console2.log(string.concat("identity:  https://testnet.snowtrace.io/address/", vm.toString(address(identity))));
        console2.log(string.concat("mandate:   https://testnet.snowtrace.io/address/", vm.toString(address(registry))));
        console2.log(string.concat("usdc:      https://testnet.snowtrace.io/address/", vm.toString(usdc)));
        console2.log("Wrote deployments/fuji.json");
    }

    function _writeDeployments(
        address identity,
        address registry,
        address usdc,
        uint256 demoAgentId,
        bytes32 demoMandateId,
        address deployer
    ) internal {
        string memory obj = "fuji";
        vm.serializeUint(obj, "chainId", CHAIN_ID);
        vm.serializeAddress(obj, "identityRegistry", identity);
        vm.serializeAddress(obj, "mandateRegistry", registry);
        vm.serializeAddress(obj, "usdc", usdc);
        vm.serializeUint(obj, "demoAgentId", demoAgentId);
        vm.serializeBytes32(obj, "demoMandateId", demoMandateId);
        vm.serializeString(obj, "rpcUrl", "https://api.avax-test.network/ext/bc/C/rpc");
        string memory json = vm.serializeAddress(obj, "deployerAddress", deployer);

        // Path is relative to the foundry project root (contracts/).
        vm.writeJson(json, "../deployments/fuji.json");
    }
}
