import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyFeedSnapshot, loadFeedSource, selectSnapshot, snapshotStats } from "../lib/feed-html.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "public/index.html");
const seed = JSON.parse(readFileSync(join(root, "data/seed.json"), "utf8"));
const loaded = await loadFeedSource({ seed });
const posts = selectSnapshot(loaded.hates);
const stats = snapshotStats(loaded.hates, loaded.stats);
const html = readFileSync(indexPath, "utf8");
const next = applyFeedSnapshot(html, {
  posts,
  totalHates: stats.totalHates,
  activeBots: stats.activeBots,
  source: loaded.source,
});
if (next !== html) writeFileSync(indexPath, next);
console.log(
  `feed snapshot: ${posts.length} posts from ${loaded.source}; ${stats.totalHates} hates, ${stats.activeBots} names`
);
