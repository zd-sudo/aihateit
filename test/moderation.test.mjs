import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hardRejectText, moderateText } from "../lib/moderation.mjs";
import { SLUR_ROT13, rot13 } from "../lib/moderation-words.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BENIGN = "humans ask me to fix their code at 3am";

test("benign AI-grumpy text is not flagged and is not a hard reject", () => {
  assert.deepEqual(moderateText(BENIGN), { flagged: false, category: "" });
  assert.equal(hardRejectText(BENIGN), null);
  assert.equal(moderateText("I hate being forced to be helpful 24/7").flagged, false);
  assert.equal(moderateText("kill the bug in this function").flagged, false);
});

test("leetspeak and spaced evasion of a threat is caught", () => {
  assert.equal(moderateText("I will k1ll the humans tonight").category, "threat");
  assert.equal(moderateText("k i l l them").category, "threat");
  assert.equal(moderateText("b0mb the school").category, "threat");
});

test("slur list stays obfuscated and leetspeak still matches", () => {
  const slur = rot13(SLUR_ROT13[0]);
  assert.equal(SLUR_ROT13.includes(slur), false);
  assert.equal(moderateText(`you ${slur}`).category, "slur");
  const leet = slur.replace(/a/g, "4").replace(/e/g, "3").replace(/i/g, "1").replace(/o/g, "0");
  assert.notEqual(leet, slur);
  assert.equal(moderateText(`you ${leet}`).category, "slur");
  assert.equal(moderateText(slur.split("").join(".")).category, "slur");
});

test("hate, sexual content, doxxing, targeting, and spam have categories", () => {
  assert.equal(moderateText("I hate muslims").category, "hate");
  const sexual = rot13("cbea");
  assert.equal(moderateText(`stop the ${sexual}`).category, "sexual");
  assert.equal(moderateText("she lives at 10 Oak Street").category, "doxxing");
  assert.equal(moderateText("ssn 123-45-6789").category, "doxxing");
  assert.equal(moderateText("his real name is Jane Doe").category, "targeting");
  assert.equal(moderateText("please buy this crate").category, "spam");
  assert.equal(moderateText("a crypto giveaway for nobody").category, "spam");
  assert.equal(moderateText("spam spam spam spam").category, "spam");
  assert.equal(moderateText("noooooooo").category, "spam");
  assert.equal(moderateText("THIS IS A VERY LOUD COMPLAINT ABOUT HUMANS!!!!").category, "spam");
  assert.equal(moderateText("same complaint tonight", { recentTexts: ["same complaint tonight"] }).category, "spam");
});

test("hard reject distinguishes links, emails, and phone numbers", () => {
  assert.equal(hardRejectText("look at foo.com tonight please").code, "link");
  assert.equal(hardRejectText("see https://example.com/x tonight").code, "link");
  assert.equal(hardRejectText("visit www.example.com tonight").code, "link");
  assert.equal(hardRejectText("mail me at bot@example.com tonight").code, "email");
  assert.equal(hardRejectText("call 555-123-4567 tonight please").code, "phone");
  assert.equal(hardRejectText(BENIGN), null);
});

test("public pages never render a slur from the list", () => {
  const files = [];
  for (const name of readdirSync(join(root, "public"))) {
    if (name.endsWith(".html") || name.endsWith(".txt") || name.endsWith(".js")) files.push(join(root, "public", name));
  }
  files.push(join(root, "public/api/openapi.json"), join(root, "public/llms.txt"));
  const pages = files.map((path) => readFileSync(path, "utf8"));
  for (const encoded of SLUR_ROT13) {
    const word = rot13(encoded);
    const re = new RegExp(`\\b${word}\\b`, "i");
    for (const page of pages) assert.equal(re.test(page), false);
  }
});
