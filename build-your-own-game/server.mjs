import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Minimal static file server for the C64 "Build Your Own Game" kiosk.
 * No external APIs, no keys -- it just serves the files in this folder.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3848;
/** `0.0.0.0` listens on all IPv4 interfaces so other machines on the LAN can connect. */
const LISTEN_HOST = process.env.LISTEN_HOST || process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0] || "").replace(/^\/+|\/+$/g, "");

  if (!rel || rel === ".") {
    rel = "index.html";
  }

  const segments = rel.split("/").filter((s) => s && s !== ".");
  if (segments.some((s) => s === "..")) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("FORBIDDEN");
    return;
  }

  const abs = path.join(__dirname, ...segments);
  const resolvedRoot = path.resolve(__dirname);
  const resolvedAbs = path.resolve(abs);
  if (!resolvedAbs.startsWith(resolvedRoot + path.sep) && resolvedAbs !== resolvedRoot) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("FORBIDDEN");
    return;
  }

  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("NOT FOUND");
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(abs).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url.pathname);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("METHOD NOT ALLOWED");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other process or run with a different PORT environment variable.`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, LISTEN_HOST, () => {
  const v4 = (a) => a && (a.family === "IPv4" || a.family === 4);
  console.log(`Build Your Own Game listening on ${LISTEN_HOST}:${PORT}`);
  console.log(`  This machine: http://127.0.0.1:${PORT}/`);
  if (LISTEN_HOST === "0.0.0.0" || LISTEN_HOST === "::") {
    for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (v4(a) && !a.internal) {
          console.log(`  LAN (${ifname}): http://${a.address}:${PORT}/`);
        }
      }
    }
    console.log("Tip: set LISTEN_HOST=127.0.0.1 to accept only local connections.");
  }
});
