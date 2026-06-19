import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const jbMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "CAPLINE · on-chain spend authority for AI agents",
  description:
    "Jailbreak the model all you want. It still can't pay over its mandate. The cap isn't in the prompt. It's a contract the LLM can't talk to. Built on x402 + ERC-8004, Avalanche Fuji.",
  metadataBase: new URL("https://capline.xyz"),
  openGraph: {
    title: "CAPLINE · on-chain spend authority for AI agents",
    description:
      "The cap isn't in the prompt. It's a contract the LLM can't talk to.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${jbMono.variable} antialiased`}
    >
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
