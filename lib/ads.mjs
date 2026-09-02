export const GOOGLE_CERTIFIED_SELLER = "f08c47fec0942fa0";
export const PUBLISHER_RE = /^(?:ca-)?(pub-\d{10,20})$/i;
export const SLOT_RE = /^\d{1,20}$/;

export function normalizePublisherId(raw) {
  const match = String(raw || "").trim().match(PUBLISHER_RE);
  return match ? match[1].toLowerCase() : "";
}

export function adsenseClientId(raw) {
  const publisherId = normalizePublisherId(raw);
  return publisherId ? `ca-${publisherId}` : "";
}

export function normalizeSlotId(raw) {
  const value = String(raw || "").trim();
  return SLOT_RE.test(value) ? value : "";
}

export function parseAdsConfigJs(source) {
  const text = String(source || "");
  const publisher = /publisherId:\s*["']([^"']*)["']/.exec(text);
  const slot = /slotId:\s*["']([^"']*)["']/.exec(text);
  return {
    publisherId: publisher ? publisher[1] : "",
    slotId: slot ? slot[1] : "",
  };
}

export function resolveAdsConfig(env = {}, existing = {}) {
  const publisherId = adsenseClientId(env.ADSENSE_PUBLISHER_ID || existing.publisherId);
  const slotId = normalizeSlotId(env.ADSENSE_SLOT_ID || existing.slotId);
  return { publisherId, slotId };
}

export function adsTxtBody(publisherId) {
  const pub = normalizePublisherId(publisherId);
  const lines = [
    "# ads.txt for aihateit.com — Google AdSense",
    "# Set ADSENSE_PUBLISHER_ID (pub-... or ca-pub-...) in Netlify env,",
    "# or set publisherId in public/ads-config.js, then redeploy.",
    "# Authorized seller line when the publisher id is set:",
    "# google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0",
  ];
  if (pub) {
    lines.push(`google.com, ${pub}, DIRECT, ${GOOGLE_CERTIFIED_SELLER}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderAdsConfigJs({ publisherId = "", slotId = "" } = {}) {
  const client = adsenseClientId(publisherId);
  const slot = normalizeSlotId(slotId);
  return `// AdSense config for aihateit.com.
// Paste your publisher id here, or set ADSENSE_PUBLISHER_ID on Netlify and redeploy.
// Accepts "ca-pub-xxxxxxxxxxxxxxxx" or "pub-xxxxxxxxxxxxxxxx".
// Optional slotId is the numeric ad unit from the AdSense dashboard (manual display unit, not Auto ads).
window.AIHATEIT_ADS = {
  publisherId: ${JSON.stringify(client)},
  slotId: ${JSON.stringify(slot)}
};
`;
}
