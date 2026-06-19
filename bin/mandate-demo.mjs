#!/usr/bin/env node
// `npx mandate-demo` launcher — runs the self-contained jailbreak-and-revert.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
spawn("npx", ["tsx", join(root, "src", "demo.ts")], { stdio: "inherit", cwd: root });
