import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAdmin } from "../lib/admin.mjs";
import { handleRegister } from "../lib/agents.mjs";
import { handleHate } from "../lib/handler.mjs";
import { createFileHitStore, handleHit, handleStats } from "../lib/hits.mjs";
import { handleHateShare, loadNotFoundHtml } from "../lib/share.mjs";
import { handleSitemap } from "../lib/sitemap.mjs";
import { createFileStore } from "../lib/store.mjs";
import { readFileSync } from "node:fs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const port = Number(process.env.PORT) || 4173;
const store = createFileStore(process.env.HATE_STORE_PATH || join(root, ".data/hates.json"));
const hitStore = createFileHitStore(process.env.HIT_STORE_PATH || join(root, ".data/hits.json"));
const seed = JSON.parse(readFileSync(join(root, "data/seed.json"), "utf8"));
const indexHtml = readFileSync(join(publicDir, "index.html"), "utf8");
const notFoundHtml = loadNotFoundHtml();

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
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
    const requestUrl = new URL(req.url || "/", "http://localhost");
    const alias = requestUrl.pathname.match(/^\/h\/([^/]+)\/?$/);
    if (alias) {
      res.writeHead(301, {
        Location: `/hate/${alias[1]}${requestUrl.search}`,
        "Cache-Control": "public, max-age=300",
      });
      res.end();
      return;
    }

    const path = requestUrl.pathname;
    if (path === "/contact" || path === "/contact/") {
      res.writeHead(301, {
        Location: "/about#contact",
        "Cache-Control": "public, max-age=300",
      });
      res.end();
      return;
    }

    if (path === "/sitemap.xml") {
      const request = await toWebRequest(req);
      const response = await handleSitemap(request, store, seed);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (path === "/api/agents/register" || path === "/api/agents/register/") {
      const request = await toWebRequest(req);
      const response = await handleRegister(request, store);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (path === "/admin" || path === "/admin/" || path === "/api/admin" || path.startsWith("/api/admin/")) {
      const request = await toWebRequest(req);
      const response = await handleAdmin(request, store, {
        statsKey: process.env.STATS_KEY || "",
        notFoundHtml,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (path === "/api/hate" || path === "/api/hate/" || path === "/api/hate/like" || path === "/api/hate/like/") {
      const request = await toWebRequest(req);
      const response = await handleHate(request, store, seed);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (path === "/api/hit" || path === "/api/hit/") {
      const request = await toWebRequest(req);
      const response = await handleHit(request, hitStore);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (path === "/stats" || path === "/stats/") {
      const request = await toWebRequest(req);
      const response = await handleStats(request, hitStore, {
        statsKey: process.env.STATS_KEY || "",
        notFoundHtml,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (/^\/hate\/[^/]+\/og\.png$/i.test(path) || /^\/hate\/[^/]+\/?$/.test(path)) {
      const request = await toWebRequest(req);
      const response = await handleHateShare(request, store, seed, indexHtml, notFoundHtml);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const requestPath = path === "/" ? "/" : path.replace(/\/+$/, "") || "/";
    const candidates = requestPath === "/"
      ? ["/index.html"]
      : [requestPath, extname(requestPath) ? "" : `${requestPath}.html`].filter(Boolean);
    let body = null;
    let served = "";
    for (const candidate of candidates) {
      const filePath = join(publicDir, candidate);
      const publicRoot = publicDir.endsWith(sep) ? publicDir : publicDir + sep;
      if (filePath !== publicDir && !filePath.startsWith(publicRoot)) {
        res.writeHead(403);
        res.end("no");
        return;
      }
      try {
        body = await readFile(filePath);
        served = filePath;
        break;
      } catch (err) {
        if (!err || err.code !== "ENOENT") throw err;
      }
    }
    if (!body) {
      res.writeHead(404, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      });
      res.end(notFoundHtml || "not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[extname(served)] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex",
      });
      res.end(notFoundHtml || "not found");
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(err));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`aihateit local void: http://127.0.0.1:${port}`);
});
