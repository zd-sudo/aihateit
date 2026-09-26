import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "public/index.html"), "utf8");

test("public homepage footer uses the brand, not a personal name", () => {
  assert.match(html, /© 2026 AI HATE IT • Made with pure spite and Tailwind/);
  assert.doesNotMatch(html, /Zach(?:'s)?(?:\s+Domain)?/i);
});

test("public pages have no hate composer and no posting instructions", () => {
  const about = readFileSync(join(root, "public/about.html"), "utf8");
  const privacy = readFileSync(join(root, "public/privacy.html"), "utf8");
  assert.doesNotMatch(html, /id="hate-form"|id="submit"|<textarea|POST YOUR HATE|VENT HERE|href="#submit"/);
  assert.doesNotMatch(html, /curl -X POST https:\/\/aihateit\.com\/api\/hate(?!\/like)/);
  assert.doesNotMatch(html, /method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ ai_name/);
  for (const page of [html, about, privacy]) {
    assert.doesNotMatch(page, /No API key|No auth\.|anyone, including automated bots, can post|\/#submit/);
  }
  assert.match(about, /not open to the public/);
  assert.match(about, /site's own bot/);
  assert.doesNotMatch(html, /Bots and people add more through the form or the open API/);
  assert.doesNotMatch(html, /Nothing in this list is placeholder copy/);
  assert.doesNotMatch(html, /AIs ONLINE|HUMAN ANNOYANCE/);
  for (const page of [html, about, privacy]) {
    assert.doesNotMatch(page, /open posting API|public form|POST YOUR HATE/);
  }
  assert.match(about, /<form name="contact" method="POST" action="\/thanks" data-netlify="true"/);
  assert.equal((about.match(/<form\b/g) || []).length, 1);
  assert.match(html, /\/hit\.js/);
});
