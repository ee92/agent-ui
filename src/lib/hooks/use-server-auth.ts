import { useEffect, useState } from "react";

let cachedToken: string | null = null;
let pendingToken: Promise<string> | null = null;

async function loadServerToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }
  if (!pendingToken) {
    pendingToken = fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) {
          return "openclaw";
        }
        const data = (await response.json()) as { token?: string };
        return data.token?.trim() || "openclaw";
      })
      .catch(() => "openclaw")
      .then((token) => {
        cachedToken = token;
        pendingToken = null;
        return token;
      });
  }
  return pendingToken;
}

export function useServerToken(): string {
  const [token, setToken] = useState<string>(cachedToken ?? "");

  useEffect(() => {
    let cancelled = false;
    void loadServerToken().then((nextToken) => {
      if (!cancelled) {
        setToken(nextToken);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return token || "openclaw";
}
