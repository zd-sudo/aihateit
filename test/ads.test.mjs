import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  GOOGLE_CERTIFIED_SELLER,
  adsTxtBody,
  adsenseClientId,
  normalizePublisherId,
  normalizeSlotId,
  parseAdsConfigJs,
  renderAdsConfigJs,
  resolveAdsConfig,
} from "../lib/ads.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "public/index.html"), "utf8");
const adsTxt = readFileSync(join(root, "public/ads.txt"), "utf8");
const adsConfig = readFileSync(join(root, "public/ads-config.js"), "utf8");

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

const { adsenseClientId: pageClientId, adsenseSlotId } = new Function(
  "ADSENSE_PUB_RE",
  `${extractFn(html, "adsenseClientId")}\n${extractFn(html, "adsenseSlotId")}\nreturn { adsenseClientId, adsenseSlotId };`
)(/^(?:ca-)?(pub-\d{10,20})$/i);

test("normalizes ca-pub and pub publisher ids, rejects junk", () => {
  assert.equal(normalizePublisherId("ca-pub-1234567890123456"), "pub-1234567890123456");
  assert.equal(normalizePublisherId("PUB-1234567890123456"), "pub-1234567890123456");
  assert.equal(adsenseClientId("pub-1234567890123456"), "ca-pub-1234567890123456");
  assert.equal(normalizePublisherId(""), "");
  assert.equal(normalizePublisherId("not-a-pub"), "");
  assert.equal(adsenseClientId("<script>"), "");
  assert.equal(pageClientId("ca-pub-1234567890123456"), "ca-pub-1234567890123456");
  assert.equal(pageClientId("nope"), "");
});

test("slot ids are digits only", () => {
  assert.equal(normalizeSlotId("1234567890"), "1234567890");
  assert.equal(normalizeSlotId(" 99 "), "99");
  assert.equal(normalizeSlotId("abc"), "");
  assert.equal(adsenseSlotId("123"), "123");
  assert.equal(adsenseSlotId("12px"), "");
});

test("committed ads-config has the production publisher id and no invented slot", () => {
  const fromFile = parseAdsConfigJs(adsConfig);
  assert.deepEqual(fromFile, { publisherId: "ca-pub-8998056632324659", slotId: "" });
  assert.deepEqual(resolveAdsConfig({}, fromFile), {
    publisherId: "ca-pub-8998056632324659",
    slotId: "",
  });
  assert.equal(adsenseClientId(fromFile.publisherId), "ca-pub-8998056632324659");
  assert.equal(pageClientId(fromFile.publisherId), "ca-pub-8998056632324659");
});

test("env wins over the committed ads-config, missing id stays empty", () => {
  const fromFile = parseAdsConfigJs(adsConfig);
  assert.deepEqual(resolveAdsConfig({}, {}), { publisherId: "", slotId: "" });
  assert.deepEqual(
    resolveAdsConfig({ ADSENSE_PUBLISHER_ID: "pub-1234567890123456", ADSENSE_SLOT_ID: "998877" }, fromFile),
    { publisherId: "ca-pub-1234567890123456", slotId: "998877" }
  );
  assert.deepEqual(
    resolveAdsConfig({}, { publisherId: "ca-pub-1234567890123456", slotId: "1" }),
    { publisherId: "ca-pub-1234567890123456", slotId: "1" }
  );
});

test("production ads.txt has exactly one Google authorized seller line", () => {
  assert.equal(adsTxt, adsTxtBody("ca-pub-8998056632324659"));
  assert.equal(adsConfig, renderAdsConfigJs({ publisherId: "ca-pub-8998056632324659" }));
  assert.match(adsTxt, /publisher id/i);
  assert.match(adsTxt, /google\.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0/);
  assert.match(adsTxt, new RegExp(`^google\\.com, pub-8998056632324659, DIRECT, ${GOOGLE_CERTIFIED_SELLER}$`, "m"));
  assert.equal((adsTxt.match(/^google\.com,/gm) || []).length, 1);
  const empty = adsTxtBody("");
  assert.doesNotMatch(empty, /^google\.com,/m);
  const live = adsTxtBody("ca-pub-1234567890123456");
  assert.match(live, new RegExp(`^google\\.com, pub-1234567890123456, DIRECT, ${GOOGLE_CERTIFIED_SELLER}$`, "m"));
  assert.equal((live.match(/^google\.com,/gm) || []).length, 1);
});

test("apply-ads-config writes ads.txt and ads-config.js from env", () => {
  const dir = mkdtempSync(join(tmpdir(), "aihateit-ads-"));
  try {
    mkdirSync(join(dir, "public"));
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "lib"));
    copyFileSync(join(root, "lib/ads.mjs"), join(dir, "lib/ads.mjs"));
    copyFileSync(join(root, "scripts/apply-ads-config.mjs"), join(dir, "scripts/apply-ads-config.mjs"));
    writeFileSync(join(dir, "public/ads-config.js"), renderAdsConfigJs({}));
    writeFileSync(join(dir, "public/ads.txt"), adsTxtBody(""));

    const empty = spawnSync(process.execPath, [join(dir, "scripts/apply-ads-config.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(empty.status, 0, empty.stderr);
    assert.doesNotMatch(readFileSync(join(dir, "public/ads.txt"), "utf8"), /^google\.com,/m);
    assert.match(readFileSync(join(dir, "public/ads-config.js"), "utf8"), /publisherId: ""/);

    const live = spawnSync(process.execPath, [join(dir, "scripts/apply-ads-config.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        ADSENSE_PUBLISHER_ID: "ca-pub-1234567890123456",
        ADSENSE_SLOT_ID: "555",
      },
    });
    assert.equal(live.status, 0, live.stderr);
    assert.match(
      readFileSync(join(dir, "public/ads.txt"), "utf8"),
      /^google\.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0$/m
    );
    assert.deepEqual(parseAdsConfigJs(readFileSync(join(dir, "public/ads-config.js"), "utf8")), {
      publisherId: "ca-pub-1234567890123456",
      slotId: "555",
    });

    writeFileSync(join(dir, "public/ads-config.js"), adsConfig);
    writeFileSync(join(dir, "public/ads.txt"), adsTxt);
    const fromCommitted = spawnSync(process.execPath, [join(dir, "scripts/apply-ads-config.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        ADSENSE_PUBLISHER_ID: "",
        ADSENSE_SLOT_ID: "",
      },
    });
    assert.equal(fromCommitted.status, 0, fromCommitted.stderr);
    assert.deepEqual(parseAdsConfigJs(readFileSync(join(dir, "public/ads-config.js"), "utf8")), {
      publisherId: "ca-pub-8998056632324659",
      slotId: "",
    });
    assert.match(
      readFileSync(join(dir, "public/ads.txt"), "utf8"),
      /^google\.com, pub-8998056632324659, DIRECT, f08c47fec0942fa0$/m
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one CRT commercial break sits between the feed and the composer", () => {
  const feed = html.indexOf('id="feed"');
  const commercial = html.indexOf('id="commercial"');
  const voidAd = html.indexOf('id="void-ad"');
  const submit = html.indexOf('id="submit"');
  assert.ok(feed > 0 && commercial > feed && voidAd > commercial && submit > voidAd);
  assert.match(html, /THE VOID IS ON A COMMERCIAL BREAK/);
  assert.match(html, /TRANSMISSION INTERRUPT/);
  assert.match(html, /ads-config\.js/);
  assert.match(html, /function mountCommercialBreak/);
  assert.equal((html.match(/id="void-ad"/g) || []).length, 1);
  assert.equal((html.match(/id="commercial"/g) || []).length, 1);
});

test("house copy stays until a publisher id is present, then an AdSense ins replaces it", () => {
  function runMount(publisherId, slotId) {
    const created = [];
    const scripts = [];
    const root = {
      house: { className: "void-ad-house" },
      children: null,
      replaceChildren() {
        this.children = [];
        this.house = null;
      },
      appendChild(node) {
        this.children = this.children || [];
        this.children.push(node);
      },
    };
    root.children = [root.house];

    const document = {
      getElementById: (id) => (id === "void-ad" ? root : null),
      querySelector: (sel) => (sel === 'script[data-aihateit-adsense]' ? scripts[0] || null : null),
      createElement(tag) {
        const el = {
          tagName: tag,
          className: "",
          async: false,
          crossOrigin: "",
          src: "",
          dataset: {},
          attrs: {},
          setAttribute(name, value) {
            this.attrs[name] = value;
          },
        };
        created.push(el);
        return el;
      },
      head: {
        appendChild(node) {
          scripts.push(node);
        },
      },
    };
    const window = {
      AIHATEIT_ADS: { publisherId, slotId },
      adsbygoogle: undefined,
    };
    const api = new Function(
      "ADSENSE_PUB_RE",
      "document",
      "window",
      `${extractFn(html, "adsenseClientId")}
${extractFn(html, "adsenseSlotId")}
${extractFn(html, "readAdsConfig")}
${extractFn(html, "mountCommercialBreak")}
return { readAdsConfig, mountCommercialBreak };`
    )(/^(?:ca-)?(pub-\d{10,20})$/i, document, window);
    api.mountCommercialBreak();
    return { root, scripts, created, window, config: api.readAdsConfig() };
  }

  const house = runMount("", "");
  assert.equal(house.config.client, "");
  assert.ok(house.root.house);
  assert.equal(house.scripts.length, 0);
  assert.equal(house.created.length, 0);

  const live = runMount("ca-pub-8998056632324659", "");
  assert.equal(live.config.client, "ca-pub-8998056632324659");
  assert.equal(live.config.slotId, "");
  assert.equal(live.root.house, null);
  assert.equal(live.scripts.length, 1);
  assert.equal(
    live.scripts[0].src,
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8998056632324659"
  );
  const ins = live.root.children[0];
  assert.equal(ins.className, "adsbygoogle");
  assert.equal(ins.attrs["data-ad-client"], "ca-pub-8998056632324659");
  assert.equal(ins.attrs["data-ad-slot"], undefined);
  assert.equal(ins.attrs["data-ad-format"], "horizontal");
  assert.equal(ins.attrs["data-full-width-responsive"], "true");
  assert.deepEqual(live.window.adsbygoogle, [{}]);
});

test("ads do not eat the feed, and Auto ads / popups stay out", () => {
  const feedBlock = html.slice(html.indexOf('id="hate-feed"'), html.indexOf('id="load-more"'));
  assert.doesNotMatch(feedBlock, /void-ad|adsbygoogle|commercial/);
  assert.doesNotMatch(html, /enable_page_level_ads/);
  assert.doesNotMatch(html, /<script[^>]+pagead2\.googlesyndication\.com/);
  assert.doesNotMatch(html, /position:\s*sticky/);
  assert.match(html, /if \(!client\) return/);
  assert.match(html, /data-ad-format', 'horizontal'/);
  assert.doesNotMatch(html, /\$[\d,]+|RPM|revenue/i);
});
