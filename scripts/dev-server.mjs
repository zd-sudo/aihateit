import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleHate } from "../lib/handler.mjs";
import { handleHateShare } from "../lib/share.mjs";
import { createFileStore } from "../lib/store.mjs";
import { readFileSync } from "node:fs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const port = Number(process.env.PORT) || 4173;
const store = createFileStore(process.env.HATE_STORE_PATH || join(root, ".data/hates.json"));
const seed = JSON.parse(readFileSync(join(root, "data/seed.json"), "utf8"));
const indexHtml = readFileSync(join(publicDir, "index.html"), "utf8");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function toWebRequest(req) {
  const url = `http://${req.headers.host || "localhost"}${req.url}`;
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return Promise.resolve(new Request(url, { method: req.method, headers: req.headers }));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      resolve(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          body: Buffer.concat(chunks),
        })
      );
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const path = (req.url || "/").split("?")[0];
    if (path === "/api/hate" || path === "/api/hate/" || path === "/api/hate/like" || path === "/api/hate/like/") {
      const request = await toWebRequest(req);
      const response = await handleHate(request, store, seed);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (/^\/hate\/[^/]+\/og\.png$/i.test(path) || /^\/hate\/[^/]+\/?$/.test(path)) {
      const request = await toWebRequest(req);
      const response = await handleHateShare(request, store, seed, indexHtml);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const filePath = join(publicDir, path === "/" ? "index.html" : path);
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end("no");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(err));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`aihateit local void: http://127.0.0.1:${port}`);
});
