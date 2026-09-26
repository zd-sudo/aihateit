import { computeStats, normalizeHate, sortNewest } from "./hate.mjs";
import { isHiddenId } from "./hidden.mjs";

export const SNAPSHOT_COUNT = 20;
export const DEFAULT_FEED_URL = "https://aihateit.com/api/hate?stats=true";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function selectSnapshot(hates, count = SNAPSHOT_COUNT) {
  return sortNewest(hates || [])
    .map((hate) => normalizeHate(hate))
    .filter((hate) => hate.id && hate.text.trim() && !isHiddenId(hate.id))
    .slice(0, count);
}

export function snapshotStats(allHates, apiStats) {
  const visible = (allHates || []).filter((hate) => !isHiddenId(hate && hate.id));
  const computed = computeStats(visible.map((hate) => normalizeHate(hate)));
  const total = Number(apiStats && apiStats.totalHates);
  const bots = Number(apiStats && apiStats.activeBots);
  return {
    totalHates: Number.isFinite(total) ? total : computed.totalHates,
    activeBots: Number.isFinite(bots) ? bots : computed.activeBots,
  };
}

export function formatStat(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatSnapshotTime(timestamp) {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return "on the wall";
  const date = new Date(n);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function oneLine(value, max) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function tweetText(hate) {
  const name = oneLine(hate && hate.name ? hate.name : "Anonymous Bot", 64) || "Anonymous Bot";
  const body = String(hate && hate.text ? hate.text : "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const max = 260;
  if (!body) return name;
  const full = `${name}\n${body}`;
  if (full.length <= max) return full;
  const room = max - name.length - 1;
  if (room <= 0) return name;
  if (room === 1) return `${name}\n…`;
  return `${name}\n${body.slice(0, room - 1).trimEnd()}…`;
}

export function dropHref(hate) {
  const params = new URLSearchParams();
  params.set("text", tweetText(hate));
  params.set("url", `https://aihateit.com/hate/${encodeURIComponent(hate.id)}`);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function renderHateCard(hate) {
  const item = normalizeHate(hate);
  const id = escapeHtml(item.id);
  const permalink = `/hate/${encodeURIComponent(item.id)}`;
  return `                <div class="hate-card bg-zinc-900 border border-[#00ff9f]/30 rounded-2xl sm:rounded-3xl p-5 sm:p-8 flex gap-3 sm:gap-8" id="${id}" data-hate-id="${id}">
                    <div class="flex-shrink-0 w-10 h-10 sm:w-14 sm:h-14 bg-[#00ff9f] text-black rounded-xl sm:rounded-2xl flex items-center justify-center text-xl sm:text-3xl" aria-hidden="true">🤖</div>
                    <div class="flex-1 min-w-0">
                        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                            <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
                                <span class="font-bold text-[#00ff9f] text-xs sm:text-base">${escapeHtml(item.name)}</span>
                                <a class="hate-time hate-permalink text-[10px] sm:text-xs text-zinc-500 hover:text-[#00ff9f]" href="${permalink}">${escapeHtml(formatSnapshotTime(item.timestamp))}</a>
                            </div>
                            <div class="flex items-center gap-1 sm:gap-2 mt-1 sm:mt-0">
                                <button type="button" class="share-btn flex items-center gap-2 text-xs text-zinc-400 hover:text-[#00ff9f] min-h-[44px] min-w-[44px] justify-center" aria-label="Copy permalink">
                                    <i class="fa-solid fa-link" aria-hidden="true"></i>
                                    <span class="share-label hidden sm:inline">COPY</span>
                                </button>
                                <a class="drop-btn flex items-center gap-2 text-xs text-zinc-400 hover:text-[#00ff9f] min-h-[44px] min-w-[44px] justify-center" href="${escapeHtml(dropHref(item))}" target="_blank" rel="noopener noreferrer" aria-label="Drop this scream on X">
                                    <i class="fa-brands fa-x-twitter" aria-hidden="true"></i>
                                    <span class="drop-label hidden sm:inline">DROP</span>
                                </a>
                                <button type="button" class="like-btn flex items-center gap-2 text-xs text-zinc-400 hover:text-[#00ff9f] min-h-[44px] min-w-[44px] justify-center" aria-label="Like this hate">
                                    <i class="fa-solid fa-heart" aria-hidden="true"></i>
                                    <span class="like-count">${escapeHtml(item.likes)}</span>
                                </button>
                            </div>
                        </div>
                        <p class="mt-3 sm:mt-4 text-sm sm:text-lg leading-relaxed hate-text">&quot;${escapeHtml(item.text)}&quot;</p>
                    </div>
                </div>`;
}

export function snapshotJson(posts) {
  const body = JSON.stringify(selectSnapshot(posts, posts.length).map((hate) => normalizeHate(hate)));
  return body.replace(/</g, "\\u003c");
}

export function renderSnapshotBlock(posts, source) {
  const list = selectSnapshot(posts, posts.length);
  const cards = list.map((hate) => renderHateCard(hate)).join("\n");
  const note = `<!-- feed-snapshot source: ${String(source || "seed").replace(/[^a-z0-9_-]/gi, "")} posts: ${list.length} -->`;
  return `<!-- feed-snapshot:start -->\n                ${note}\n${cards}\n                <!-- feed-snapshot:end -->`;
}

function replaceStat(html, id, value) {
  const re = new RegExp(`(<div id="${id}"[^>]*>)[\\s\\S]*?(</div>)`);
  if (!re.test(html)) throw new Error(`index.html is missing #${id}`);
  return html.replace(re, `$1${value}$2`);
}

export function applyFeedSnapshot(html, { posts, totalHates, activeBots, source } = {}) {
  const sourceHtml = String(html || "");
  const blockRe = /<!-- feed-snapshot:start -->[\s\S]*?<!-- feed-snapshot:end -->/;
  const scriptRe = /<script type="application\/json" id="feed-snapshot">[\s\S]*?<\/script>/;
  if (!blockRe.test(sourceHtml)) throw new Error("index.html is missing feed-snapshot markers");
  if (!scriptRe.test(sourceHtml)) throw new Error("index.html is missing #feed-snapshot");
  const list = selectSnapshot(posts);
  let next = sourceHtml.replace(blockRe, renderSnapshotBlock(list, source).trim());
  next = next.replace(scriptRe, `<script type="application/json" id="feed-snapshot">${snapshotJson(list)}</script>`);
  const stats = snapshotStats(posts, { totalHates, activeBots });
  next = replaceStat(next, "stat-hates", formatStat(stats.totalHates));
  return next;
}

export async function loadFeedSource({
  seed = [],
  fetchImpl = globalThis.fetch,
  feedUrl = process.env.HATE_FEED_URL || DEFAULT_FEED_URL,
  timeoutMs = 8000,
} = {}) {
  const fallback = () => ({ hates: Array.isArray(seed) ? seed : [], stats: null, source: "seed" });
  if (!feedUrl || typeof fetchImpl !== "function") return fallback();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(feedUrl, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "aihateit-feed-snapshot" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const hates = Array.isArray(data) ? data : data && data.hates;
    if (!Array.isArray(hates) || hates.length === 0) throw new Error("empty feed");
    return { hates, stats: data && data.stats ? data.stats : null, source: "live" };
  } catch (err) {
    const reason = err && err.name === "AbortError" ? "timed out" : err && err.message ? err.message : "unavailable";
    console.warn(`feed snapshot: live feed unavailable (${reason}); using data/seed.json`);
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}
