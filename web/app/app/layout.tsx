import { Providers } from "./providers";
import { DappNav } from "@/components/app/DappNav";

export default function DappLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <DappNav />
      <div className="min-h-[calc(100vh-58px)]">{children}</div>
    </Providers>
  );
}
