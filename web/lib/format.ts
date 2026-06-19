// USDC has 6 decimals everywhere in this app.
export const USDC_DECIMALS = 6;

export const toUsdc = (n: number | string): bigint =>
  BigInt(Math.round(Number(n) * 10 ** USDC_DECIMALS));

export const fromUsdc = (v: bigint): number => Number(v) / 10 ** USDC_DECIMALS;

export const fmtUsdc = (v: bigint, dp = 2): string =>
  fromUsdc(v).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export const shortAddr = (a?: string, n = 4): string =>
  a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : "";
