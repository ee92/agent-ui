#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
process.chdir(rootDir);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(resolve(rootDir, "node_modules"))) {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["install"]);
}

if (!existsSync(resolve(rootDir, "dist"))) {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
}

run(process.execPath, ["serve.mjs"]);
