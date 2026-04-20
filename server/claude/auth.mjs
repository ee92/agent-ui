import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_AUTH_PROFILE_PATH = join(homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const CLAUDE_CONFIG_PATH = join(homedir(), ".claude", "config.json");

export async function resolveAnthropicApiKey() {
  if (process.env.MC_ANTHROPIC_KEY?.trim()) {
    return process.env.MC_ANTHROPIC_KEY.trim();
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return process.env.ANTHROPIC_API_KEY.trim();
  }

  const authProfileCandidates = [
    process.env.MC_AUTH_PROFILE_PATH,
    process.env.AUTH_PROFILE_PATH,
    DEFAULT_AUTH_PROFILE_PATH,
  ].filter((value) => typeof value === "string" && value.trim()).map((value) => resolve(value));

  for (const profilePath of authProfileCandidates) {
    try {
      const raw = await readFile(profilePath, "utf8");
      const parsed = JSON.parse(raw);
      const profile = parsed?.profiles?.["anthropic:manual"];
      const authValue = profile?.token || profile?.headers?.authorization;
      if (typeof authValue === "string" && authValue.trim()) {
        return authValue.replace(/^Bearer\s+/i, "").trim();
      }
    } catch {
      // try next source
    }
  }

  const claudeConfigPaths = [CLAUDE_SETTINGS_PATH, CLAUDE_CONFIG_PATH];
  for (const configPath of claudeConfigPaths) {
    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const key = parsed?.anthropicApiKey || parsed?.apiKey || parsed?.anthropic_api_key;
      if (typeof key === "string" && key.trim()) {
        return key.trim();
      }
    } catch {
      // try next source
    }
  }

  return "";
}
