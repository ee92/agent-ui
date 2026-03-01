import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { createConnection } from "node:net";

const DIST = join(import.meta.dirname, "dist");
const GATEWAY = { host: "127.0.0.1", port: 18790 };
const PORT = 18789;
const LOCAL_ORIGIN = `http://localhost:${GATEWAY.port}`;
const WORKSPACE = "/home/clawd/.openclaw/workspace";
const TOKEN = "e1d47ce3c80c897bb9f6c969f077886d5e5fc0266a3916cf";

const MIME_MAP = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

// List immediate children of a directory (lazy — one level only)
function listDir(dirPath) {
  const results = [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(dirPath, entry.name);
      try {
        const stat = statSync(fullPath);
        const relPath = relative(WORKSPACE, fullPath);
        const isDir = entry.isDirectory();
        const item = { path: relPath, name: entry.name, type: isDir ? "directory" : "file", mtime: stat.mtimeMs };
        if (!isDir) item.size = stat.size;
        if (isDir) {
          // Include child count so UI knows if expandable
          try { item.childCount = readdirSync(fullPath).filter(n => !n.startsWith(".") && n !== "node_modules").length; } catch { item.childCount = 0; }
        }
        results.push(item);
      } catch {}
    }
  } catch {}
  // Sort: directories first, then alphabetical
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

// Recursive search
function searchFiles(dir, query, maxResults = 50) {
  const results = [];
  const q = query.toLowerCase();
  function walk(d) {
    if (results.length >= maxResults) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = join(d, entry.name);
        const relPath = relative(WORKSPACE, fullPath);
        if (entry.name.toLowerCase().includes(q)) {
          const stat = statSync(fullPath);
          results.push({ path: relPath, name: entry.name, type: entry.isDirectory() ? "directory" : "file", size: entry.isDirectory() ? undefined : stat.size });
        }
        if (entry.isDirectory()) walk(fullPath);
      }
    } catch {}
  }
  walk(dir);
  return results;
}

function checkAuth(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API: list directory children (lazy)
  if (url.pathname === "/api/files/list") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const subpath = url.searchParams.get("path") || "";
    const dir = join(WORKSPACE, subpath);
    if (!dir.startsWith(WORKSPACE)) return jsonResponse(res, { error: "invalid path" }, 400);
    return jsonResponse(res, { path: subpath, entries: listDir(dir) });
  }

  // API: search files
  if (url.pathname === "/api/files/search") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const query = url.searchParams.get("q") || "";
    if (query.length < 2) return jsonResponse(res, { results: [] });
    return jsonResponse(res, { query, results: searchFiles(WORKSPACE, query) });
  }

  // API: read file
  if (url.pathname === "/api/files/read") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const filePath = url.searchParams.get("path") || "";
    const fullPath = join(WORKSPACE, filePath);
    if (!fullPath.startsWith(WORKSPACE)) return jsonResponse(res, { error: "invalid path" }, 400);
    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) return jsonResponse(res, { error: "not found" }, 404);
    const stat = statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) return jsonResponse(res, { error: "file too large", size: stat.size }, 413);
    try {
      const content = readFileSync(fullPath, "utf-8");
      return jsonResponse(res, { path: filePath, content, size: stat.size });
    } catch { return jsonResponse(res, { error: "read error" }, 500); }
  }

  // Static files
  let filePath = join(DIST, url.pathname === "/" ? "index.html" : url.pathname.split("?")[0]);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(DIST, "index.html");
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME_MAP[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable" });
  res.end(readFileSync(filePath));
});

server.on("upgrade", (req, socket, head) => {
  const upstream = createConnection(GATEWAY, () => {
    upstream.write(`GET ${req.url} HTTP/1.1\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const value = req.rawHeaders[i + 1];
      if (name.toLowerCase() === "origin") upstream.write(`Origin: ${LOCAL_ORIGIN}\r\n`);
      else if (name.toLowerCase() === "host") upstream.write(`Host: localhost:${GATEWAY.port}\r\n`);
      else upstream.write(`${name}: ${value}\r\n`);
    }
    upstream.write("\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, "127.0.0.1", () => console.log(`UI serving on http://127.0.0.1:${PORT}`));
