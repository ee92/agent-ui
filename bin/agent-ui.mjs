#!/usr/bin/env node

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SERVE = resolve(ROOT, "serve.mjs");
const DATA_DIR = resolve(homedir(), ".agent-ui");
const PID_FILE = resolve(DATA_DIR, "agent-ui.pid");
const LOG_FILE = resolve(DATA_DIR, "agent-ui.log");
const PORT = process.env.PORT || 18789;

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPid() {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isFinite(pid) && isRunning(pid) ? pid : null;
  } catch { return null; }
}

function writePid(pid) {
  ensureDataDir();
  writeFileSync(PID_FILE, String(pid));
}

function clearPid() {
  try { unlinkSync(PID_FILE); } catch {}
}

function detectAgent() {
  if (existsSync(resolve(homedir(), ".openclaw", "openclaw.json"))) return "openclaw";
  if (existsSync(resolve(homedir(), ".claude"))) return "claude-code";
  return "none";
}

// ── systemd user service (Linux) ──

const SYSTEMD_DIR = resolve(homedir(), ".config", "systemd", "user");
const SYSTEMD_UNIT = resolve(SYSTEMD_DIR, "agent-ui.service");

function installSystemd() {
  const node = process.execPath;
  const unit = `[Unit]
Description=Agent UI Dashboard
After=network.target

[Service]
Type=simple
ExecStart=${node} ${SERVE}
WorkingDirectory=${ROOT}
Restart=on-failure
RestartSec=5
Environment=PORT=${PORT}

[Install]
WantedBy=default.target
`;
  mkdirSync(SYSTEMD_DIR, { recursive: true });
  writeFileSync(SYSTEMD_UNIT, unit);
  execSync("systemctl --user daemon-reload", { stdio: "ignore" });
  execSync("systemctl --user enable agent-ui", { stdio: "ignore" });
  execSync("systemctl --user start agent-ui", { stdio: "ignore" });
  console.log("✓ Installed systemd user service");
}

function uninstallSystemd() {
  try { execSync("systemctl --user stop agent-ui", { stdio: "ignore" }); } catch {}
  try { execSync("systemctl --user disable agent-ui", { stdio: "ignore" }); } catch {}
  try { unlinkSync(SYSTEMD_UNIT); } catch {}
  try { execSync("systemctl --user daemon-reload", { stdio: "ignore" }); } catch {}
}

// ── launchd plist (macOS) ──

const LAUNCHD_DIR = resolve(homedir(), "Library", "LaunchAgents");
const LAUNCHD_PLIST = resolve(LAUNCHD_DIR, "com.agent-ui.plist");

function installLaunchd() {
  const node = process.execPath;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.agent-ui</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${SERVE}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${PORT}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>`;
  mkdirSync(LAUNCHD_DIR, { recursive: true });
  writeFileSync(LAUNCHD_PLIST, plist);
  execSync(`launchctl load ${LAUNCHD_PLIST}`, { stdio: "ignore" });
  console.log("✓ Installed launchd service");
}

function uninstallLaunchd() {
  try { execSync(`launchctl unload ${LAUNCHD_PLIST}`, { stdio: "ignore" }); } catch {}
  try { unlinkSync(LAUNCHD_PLIST); } catch {}
}

// ── Commands ──

const cmd = process.argv[2] || "start";

switch (cmd) {
  case "start": {
    const existing = readPid();
    if (existing) {
      console.log(`Agent UI already running (PID ${existing})`);
      console.log(`  → http://localhost:${PORT}`);
      process.exit(0);
    }

    ensureDataDir();
    const agent = detectAgent();
    console.log(`Agent UI v${JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version}`);
    console.log(`Detected agent: ${agent === "none" ? "none (standalone mode)" : agent}`);

    const os = platform();
    if (os === "linux") {
      try {
        installSystemd();
        console.log(`\n  → http://localhost:${PORT}\n`);
        console.log("Service installed. Survives reboots.");
        console.log("  agent-ui stop      — stop the service");
        console.log("  agent-ui logs      — view logs");
        console.log("  agent-ui uninstall — remove service");
        process.exit(0);
      } catch {
        console.log("⚠ Could not install systemd service, starting in background...");
      }
    } else if (os === "darwin") {
      try {
        installLaunchd();
        console.log(`\n  → http://localhost:${PORT}\n`);
        console.log("Service installed. Survives reboots.");
        console.log("  agent-ui stop      — stop the service");
        console.log("  agent-ui logs      — view logs");
        console.log("  agent-ui uninstall — remove service");
        process.exit(0);
      } catch {
        console.log("⚠ Could not install launchd service, starting in background...");
      }
    }

    // Fallback: background process with PID file
    const child = spawn(process.execPath, [SERVE], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, PORT: String(PORT) },
    });

    const logStream = require("fs").createWriteStream(LOG_FILE, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.unref();
    writePid(child.pid);

    console.log(`\n  → http://localhost:${PORT}  (PID ${child.pid})\n`);
    console.log("⚠ Running as background process (will not survive reboot).");
    console.log("  Run 'agent-ui start' again after reboot, or install as a service manually.");
    process.exit(0);
  }

  case "stop": {
    const os = platform();
    if (os === "linux" && existsSync(SYSTEMD_UNIT)) {
      execSync("systemctl --user stop agent-ui", { stdio: "inherit" });
      console.log("✓ Stopped");
    } else if (os === "darwin" && existsSync(LAUNCHD_PLIST)) {
      execSync(`launchctl unload ${LAUNCHD_PLIST}`, { stdio: "inherit" });
      console.log("✓ Stopped");
    } else {
      const pid = readPid();
      if (pid) {
        process.kill(pid, "SIGTERM");
        clearPid();
        console.log(`✓ Stopped (PID ${pid})`);
      } else {
        console.log("Agent UI is not running.");
      }
    }
    break;
  }

  case "status": {
    const os = platform();
    let running = false;

    if (os === "linux" && existsSync(SYSTEMD_UNIT)) {
      try {
        execSync("systemctl --user is-active agent-ui", { stdio: "pipe" });
        running = true;
      } catch {}
    } else if (os === "darwin" && existsSync(LAUNCHD_PLIST)) {
      try {
        const out = execSync("launchctl list com.agent-ui 2>/dev/null", { encoding: "utf8" });
        running = !out.includes("Could not find");
      } catch {}
    } else {
      running = readPid() !== null;
    }

    const agent = detectAgent();
    console.log(`Agent UI ${running ? "●" : "○"} ${running ? "running" : "stopped"}`);
    console.log(`  Agent:  ${agent}`);
    console.log(`  Port:   ${PORT}`);
    console.log(`  URL:    http://localhost:${PORT}`);
    console.log(`  Data:   ${DATA_DIR}`);
    break;
  }

  case "logs": {
    const os = platform();
    if (os === "linux" && existsSync(SYSTEMD_UNIT)) {
      execSync("journalctl --user -u agent-ui -f --no-pager -n 50", { stdio: "inherit" });
    } else if (existsSync(LOG_FILE)) {
      execSync(`tail -f -n 50 ${LOG_FILE}`, { stdio: "inherit" });
    } else {
      console.log("No logs found.");
    }
    break;
  }

  case "config": {
    const configPath = resolve(DATA_DIR, "config.json");
    if (existsSync(configPath)) {
      console.log(readFileSync(configPath, "utf8"));
    } else {
      console.log("No config file. Using auto-detected defaults.");
      console.log(`Config path: ${configPath}`);
      console.log(`\nCreate it with:\n  echo '{}' > ${configPath}`);
    }
    break;
  }

  case "uninstall": {
    const os = platform();
    if (os === "linux") uninstallSystemd();
    else if (os === "darwin") uninstallLaunchd();
    const pid = readPid();
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch {} }
    clearPid();
    console.log("✓ Service removed. Data preserved at " + DATA_DIR);
    break;
  }

  default:
    console.log(`agent-ui — self-hosted dashboard for AI agent workflows

Usage:
  agent-ui start      Start the dashboard (installs as service)
  agent-ui stop       Stop the dashboard
  agent-ui status     Show status
  agent-ui logs       View logs
  agent-ui config     Show configuration
  agent-ui uninstall  Remove service

Environment:
  PORT=18789          Server port (default: 18789)
  MC_WORKSPACE=path   Workspace directory
  MC_TOKEN=token      Auth token
`);
}
