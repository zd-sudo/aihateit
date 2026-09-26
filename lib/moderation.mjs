import {
  GROUP_PHRASES,
  RAPE_WORDS,
  SEXUAL_ROT13,
  SLUR_ROT13,
  SPAM_PHRASES,
  SPAM_WORDS,
  TARGET_WORDS,
  VIOLENCE_WORDS,
  rot13,
} from "./moderation-words.mjs";

const SLURS = SLUR_ROT13.map((word) => rot13(word));
const SEXUAL = new Set(SEXUAL_ROT13.map((word) => rot13(word)));
const VIOLENCE = new Set(VIOLENCE_WORDS);
const RAPE = new Set(RAPE_WORDS);
const TARGETS = new Set(TARGET_WORDS);
const SPAM = new Set(SPAM_WORDS);

const LEET = {
  0: "o",
  1: "i",
  2: "z",
  3: "e",
  4: "a",
  5: "s",
  6: "g",
  7: "t",
  8: "b",
  9: "g",
  "@": "a",
  $: "s",
  "!": "i",
  "+": "t",
  "|": "i",
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_RE = /https?:\/\/|\bwww\./i;
const DOMAIN_RE =
  /\b[a-z0-9-]+\.(?:com|net|org|io|ai|co|dev|app|xyz|me|info|biz|gg|tv|us|uk|ca|de|fr|ru|cn|jp|edu|gov|ly|sh|cc|to)\b/i;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}\b/;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text, phrase) {
  return new RegExp(`(?:^|\\s)${escapeRegExp(phrase)}(?:\\s|$)`).test(text);
}

export function moderationTokens(text) {
  let value = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  value = value.replace(/[0-9@$!+|]/g, (char) => LEET[char] || char);
  value = value.replace(/[^a-z]+/g, " ").trim();
  if (!value) return [];
  const raw = value.split(/\s+/);
  const tokens = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    tokens.push(buf);
    buf = "";
  };
  for (const token of raw) {
    if (token.length === 1) buf += token;
    else {
      flush();
      tokens.push(token);
    }
  }
  flush();
  return tokens;
}

function phraseOf(tokens) {
  return tokens.join(" ");
}

function hasSlur(tokens) {
  const collapsed = tokens.join("");
  for (const slur of SLURS) {
    if (tokens.includes(slur)) return true;
    if (slur.length >= 5 && collapsed.includes(slur)) return true;
  }
  return false;
}

function hasHate(tokens) {
  const text = phraseOf(tokens);
  for (const group of GROUP_PHRASES) {
    if (hasPhrase(text, `hate ${group}`)) return true;
    if (hasPhrase(text, `kill ${group}`)) return true;
    if (hasPhrase(text, `attack ${group}`)) return true;
    if (hasPhrase(text, `${group} should die`)) return true;
    if (hasPhrase(text, `${group} must die`)) return true;
    if (hasPhrase(text, `death to ${group}`)) return true;
    if (hasPhrase(text, `${group} are vermin`)) return true;
    if (hasPhrase(text, `${group} are animals`)) return true;
  }
  return false;
}

function hasThreat(tokens) {
  for (const token of tokens) {
    if (RAPE.has(token)) return true;
  }
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === "shoot" && tokens[i + 1] === "up") return true;
    if (!VIOLENCE.has(tokens[i])) continue;
    const window = tokens.slice(i + 1, i + 5);
    if (window.some((token) => TARGETS.has(token))) return true;
  }
  return false;
}

function hasDoxxing(original) {
  const text = String(original || "");
  if (/\blives at\b/i.test(text)) return true;
  if (/\bhome address\b/i.test(text)) return true;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return true;
  if (/\bssn\b/i.test(text)) return true;
  if (
    /\b\d{1,6}\s+(?:[a-z0-9.'-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

function hasTargeting(original) {
  const text = String(original || "");
  if (/\breal name is\b/i.test(text)) return true;
  if (/\bfull name is\b/i.test(text)) return true;
  if (/\bprivate citizen\b/i.test(text)) return true;
  if (/\bdox{1,2}(?:ed|ing|es|xes)?\b/i.test(text)) return true;
  return false;
}

function hasSpam(original, tokens, recentTexts) {
  const raw = String(original || "");
  if (/(.)\1{7,}/i.test(raw)) return true;
  let run = 1;
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] === tokens[i - 1] && tokens[i].length >= 3) {
      run += 1;
      if (run >= 4) return true;
    } else {
      run = 1;
    }
  }
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 16) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    const bangs = (raw.match(/[!?]/g) || []).length;
    if (upper / letters.length >= 0.85 && bangs >= 3) return true;
  }
  const text = phraseOf(tokens);
  if (tokens.some((token) => SPAM.has(token))) return true;
  if (SPAM_PHRASES.some((phrase) => hasPhrase(text, phrase))) return true;
  if (!text) return false;
  for (const recent of recentTexts || []) {
    if (phraseOf(moderationTokens(recent)) === text) return true;
  }
  return false;
}

// Rules classifier. A hit is held, not deleted. Links, emails, and phone
// numbers are a separate hard reject (see hardRejectText) and are not stored.
export function moderateText(text, { recentTexts = [] } = {}) {
  const tokens = moderationTokens(text);
  if (hasSlur(tokens)) return { flagged: true, category: "slur" };
  if (hasHate(tokens)) return { flagged: true, category: "hate" };
  if ([...SEXUAL].some((word) => tokens.includes(word))) return { flagged: true, category: "sexual" };
  if (hasThreat(tokens)) return { flagged: true, category: "threat" };
  if (hasDoxxing(text)) return { flagged: true, category: "doxxing" };
  if (hasTargeting(text)) return { flagged: true, category: "targeting" };
  if (hasSpam(text, tokens, recentTexts)) return { flagged: true, category: "spam" };
  return { flagged: false, category: "" };
}

export function hardRejectText(text) {
  const value = String(text || "");
  if (EMAIL_RE.test(value)) return { code: "email", error: "Email addresses are not allowed" };
  if (PHONE_RE.test(value)) return { code: "phone", error: "Phone numbers are not allowed" };
  if (URL_RE.test(value) || DOMAIN_RE.test(value)) {
    return { code: "link", error: "Links and domains are not allowed" };
  }
  return null;
}
