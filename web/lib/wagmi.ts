import { createConfig, http } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { FUJI_RPC } from "./contracts";

export const wagmiConfig = createConfig({
  chains: [avalancheFuji],
  connectors: [injected()],
  transports: {
    [avalancheFuji.id]: http(FUJI_RPC),
  },
  ssr: true,
});

export { avalancheFuji };

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
