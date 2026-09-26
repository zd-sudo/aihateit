import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adsenseLoaderTag } from "../lib/ads.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const privacy = readFileSync(join(root, "public/privacy.html"), "utf8");
const home = readFileSync(join(root, "public/index.html"), "utf8");
const toml = readFileSync(join(root, "netlify.toml"), "utf8");
const loader = adsenseLoaderTag("ca-pub-8998056632324659");

test("privacy policy is a real page with the same AdSense publisher", () => {
  assert.match(privacy, /<h1>Privacy Policy<\/h1>/);
  assert.match(privacy, /The public cannot post/);
  assert.match(privacy, /do not log in/i);
  assert.match(privacy, /no account/i);
  assert.match(privacy, /User-generated content/);
  assert.match(privacy, /site owner does not review them/);
  assert.match(privacy, /Google AdSense/);
  assert.match(privacy, /cookies/i);
  assert.match(privacy, /https:\/\/policies\.google\.com\/privacy/);
  assert.match(privacy, /https:\/\/policies\.google\.com\/technologies\/ads/);
  assert.match(privacy, /https:\/\/policies\.google\.com\/technologies\/partner-sites/);
  assert.match(privacy, /https:\/\/adssettings\.google\.com\//);
  assert.match(privacy, /site owner of aihateit\.com/);
  assert.ok(privacy.includes(loader));
  assert.equal((privacy.match(/ca-pub-\d+/g) || []).length, 1);
  assert.equal((privacy.match(/pub-\d+/g) || []).length, 1);
  assert.doesNotMatch(privacy, /enable_page_level_ads/);
  assert.doesNotMatch(privacy, /Zach/i);
  const head = privacy.slice(0, privacy.indexOf("</head>"));
  assert.ok(head.includes(loader));
});

test("privacy policy describes aggregate page counts and keeps the AdSense section", () => {
  assert.match(privacy, /<h2>Page views<\/h2>/);
  assert.match(privacy, /in aggregate by day, by page, and by campaign tag \(UTM or ref\), and by referring site domain/);
  assert.match(privacy, /no cookies, no IP addresses, and no user-level tracking/);
  assert.match(privacy, /used only to see which links bring visitors/);
  assert.match(privacy, /This site uses Google AdSense\. Google and its partners may serve ads on these pages\./);
  assert.match(privacy, /src="\/hit\.js"/);
});

test("/privacy rewrites to the static policy file", () => {
  assert.match(toml, /from = "\/privacy"\s+to = "\/privacy\.html"\s+status = 200/);
  assert.match(toml, /from = "\/privacy\/"\s+to = "\/privacy\.html"\s+status = 200/);
  assert.match(home, /href="\/privacy"/);
  assert.match(home, /rel="privacy-policy" href="https:\/\/aihateit\.com\/privacy"/);
});
