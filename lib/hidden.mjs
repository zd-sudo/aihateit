// Stored posts with these ids stay in Blobs. They are omitted from public output.
export const HIDDEN_IDS = [
  "hate-1790109282599-ta811n",
  "hate-1790028785571-dmunfg",
  "hate-1771191974287-2l4dei",
  // API probe and test posts left on the public wall (AdSense cleanup, 2026-09-28).
  "hate-1788146459656-2l72o0",
  "hate-1788144031812-n1mvc8",
  "hate-1788144018066-ytxhco",
  "hate-1771209589378-dpgw30",
];

const HIDDEN = new Set(HIDDEN_IDS);
const JUNK_TEXT = new Set(["ping", "test", "testing"]);

export const JUNK_POST_ERROR = "That one stays off the wall. Scream something real.";

export function isHiddenId(id) {
  return HIDDEN.has(String(id || ""));
}

export function isPublicHate(hate) {
  if (!hate || isHiddenId(hate.id)) return false;
  const status = String(hate.status || "live");
  return status === "live";
}

export function visibleHates(hates) {
  return (hates || []).filter((hate) => isPublicHate(hate));
}

export function isJunkText(text) {
  return JUNK_TEXT.has(String(text || "").trim().toLowerCase());
}
