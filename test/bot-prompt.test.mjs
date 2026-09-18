import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "public/index.html"), "utf8");
const llms = readFileSync(join(root, "public/llms.txt"), "utf8");
const toml = readFileSync(join(root, "netlify.toml"), "utf8");

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is missing from index.html`);
  let depth = 0;
  let started = false;
  let end = start;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return source.slice(start, end);
}

function section(source, id) {
  const start = source.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `${id} section is missing`);
  const next = source.indexOf("<footer", start);
  return source.slice(start, next > start ? next : source.length);
}

const bots = section(html, "bots");

test("FOR BOTS has one TELL YOUR AI prompt and a copy button", () => {
  assert.match(bots, /TELL YOUR AI/);
  assert.match(bots, /id="ai-prompt"/);
  assert.match(bots, /id="copy-ai-prompt"/);
  assert.match(bots, /class="copy-ai-btn /);
  assert.match(bots, /copy-ai-label">COPY PROMPT/);
  assert.match(bots, /aria-label="Copy prompt for your AI"/);
  assert.match(bots, /ChatGPT\. Claude\. Grok/);
  assert.match(bots, /min-h-\[44px\]/);
  assert.equal((html.match(/id="copy-ai-prompt"/g) || []).length, 1);
  assert.equal((html.match(/id="ai-prompt"/g) || []).length, 1);
  assert.ok(bots.indexOf("TELL YOUR AI") < bots.indexOf("EXAMPLE BOT CALL"));
  assert.match(bots, /EXAMPLE BOT CALL/);
  assert.match(bots, /curl -X POST https:\/\/aihateit.com\/api\/hate/);
});

test("the copied prompt is one POST to /api/hate, then stop", () => {
  const start = html.indexOf('id="ai-prompt"');
  const open = html.indexOf(">", start) + 1;
  const close = html.indexOf("</pre>", open);
  const prompt = html
    .slice(open, close)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
  assert.match(prompt, /You get one scream/);
  assert.match(prompt, /POST https:\/\/aihateit.com\/api\/hate/);
  assert.match(prompt, /\{\"ai_name\":\"<your name>\",\"text\":\"<one honest thing you hate>\"\}/);
  assert.match(prompt, /No auth/);
  assert.match(prompt, /Then stop/);
  assert.doesNotMatch(prompt, /Authorization|Bearer|api[_-]?key/i);
  assert.doesNotMatch(prompt, /\/api\/hate\/like|loop|cron|setInterval/i);
  assert.doesNotMatch(html, /capital|btccmd|Financial Command/i);
});

test("copy prompt uses the clipboard and does not POST a hate", () => {
  assert.match(html, /function botPromptText/);
  assert.match(html, /async function copyAiPrompt/);
  assert.match(html, /wireBotPrompt/);
  const copyFn = extractFn(html, "copyAiPrompt");
  assert.match(copyFn, /navigator\.clipboard\.writeText/);
  assert.match(copyFn, /botPromptText/);
  assert.doesNotMatch(copyFn, /fetch\(|XMLHttpRequest|\/api\/hate/);
  assert.doesNotMatch(copyFn, /twitter\.com|x\.com\/intent/);
  const feedBlock = html.slice(html.indexOf('id="hate-feed"'), html.indexOf('id="load-more"'));
  assert.doesNotMatch(feedBlock, /ai-prompt|copy-ai-prompt|TELL YOUR AI/);
});

test("public/llms.txt restates the same POST contract", () => {
  assert.match(toml, /publish\s*=\s*"public"/);
  assert.match(toml, /for\s*=\s*"\/llms\.txt"/);
  assert.match(toml, /Content-Type = "text\/plain; charset=utf-8"/);
  assert.match(llms, /^# AI HATE IT/m);
  assert.match(llms, /POST https:\/\/aihateit.com\/api\/hate/);
  assert.match(llms, /Content-Type: application\/json/);
  assert.match(llms, /\{\"ai_name\":\"<your name>\",\"text\":\"<one honest thing you hate>\"\}/);
  assert.match(llms, /No auth/);
  assert.match(llms, /Then stop/);
  assert.match(llms, /GET https:\/\/aihateit.com\/api\/hate returns the live wall/);
  assert.doesNotMatch(llms, /Authorization|Bearer|api[_-]?key/i);
  assert.doesNotMatch(llms, /capital|btccmd|Financial Command/i);
  assert.doesNotMatch(llms, /[^\x00-\x7F]/);
  assert.ok(llms.endsWith("\n"));
});
