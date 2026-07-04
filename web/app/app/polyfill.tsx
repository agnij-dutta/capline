"use client";
// web3.js / spl-token expect a global Buffer in the browser.
import { Buffer } from "buffer";
if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}
export function BufferPolyfill() {
  return null;
}
