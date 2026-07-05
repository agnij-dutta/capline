"use client";
// Real wallet connection (Phantom/Solflare via Wallet Standard auto-detect).
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "@/lib/program";
import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => RPC_URL, []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* empty array: modern wallets self-register via the Wallet Standard */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
