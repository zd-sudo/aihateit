import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adsTxtBody, parseAdsConfigJs, renderAdsConfigJs, resolveAdsConfig } from "../lib/ads.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "public/ads-config.js");
const adsTxtPath = join(root, "public/ads.txt");

function existingConfig() {
  try {
    return parseAdsConfigJs(readFileSync(configPath, "utf8"));
  } catch {
    return { publisherId: "", slotId: "" };
  }
}

const config = resolveAdsConfig(process.env, existingConfig());
writeFileSync(configPath, renderAdsConfigJs(config));
writeFileSync(adsTxtPath, adsTxtBody(config.publisherId));

if (config.publisherId) {
  console.log(`ads: AdSense client ${config.publisherId}${config.slotId ? ` slot ${config.slotId}` : " (no slot yet)"}`);
} else {
  console.log("ads: no publisher id — house commercial break, placeholder ads.txt");
}
