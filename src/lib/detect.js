// Bot / crawler / AI-crawler detection from the curated list in src/data/bots.js, plus a small generic
// heuristic for unlisted bots. Pure string work, no lookups. A User-Agent can be spoofed by anyone, so
// `verified` is always false: confirming a crawler needs its published IP ranges / reverse DNS, which UAParse
// does not do (no external lookups per request).
import { BOTS, CATEGORIES, LIST_VERSION } from '../data/bots.js';

export { LIST_VERSION, CATEGORIES };
export const BOT_COUNT = BOTS.length;
export const AI_CRAWLER_COUNT = BOTS.filter((b) => b.c === 'ai_crawler').length;
// Personal / AI agents: operator-documented UAs that act live for one end user (subset of the AI crawlers).
export const AI_AGENT_COUNT = BOTS.filter((b) => !!b.pa).length;
// page copy says "N names (M current + K retired)". `retired` is internal and never emitted, so the API
// (`ai_agent_count`, `is_ai_agent`) is unchanged: a retired name is still detected for log forensics.
export const AI_AGENT_RETIRED = BOTS.filter((b) => b.pa && b.retired).map((b) => b.n);
export const AI_AGENT_CURRENT_COUNT = AI_AGENT_COUNT - AI_AGENT_RETIRED.length;

const ENTRIES = BOTS.map((b) => ({ ...b, t: b.t ? b.t.toLowerCase() : undefined }));

// Generic "looks like a bot" heuristic for UAs not on the list: bot / crawler / spider / scraper as a word end,
// or a "+https://…" info link (the convention crawlers use). Device names that end in "bot" are excluded.
const GENERIC_RE = /(?:bot|crawler|spider|scraper)(?![a-z])|\bcrawl|\(\s*compatible\s*;[^)]*\+https?:\/\//i;
const GENERIC_EXCLUDE_RE = /\bcubot\b/i;

export const AI_PURPOSE_TEXT = {
  training: 'Collects pages to train AI models or build datasets.',
  search: 'Indexes pages for an AI search / answer engine.',
  user_fetch: 'Fetches a page because a user asked an AI assistant to.',
  agent: 'An AI agent or scraping service acting for a customer.',
};

// is_ai_agent kinds (bots.js `pa`). Only set when the operator documents the UA as acting for an individual user.
export const AI_AGENT_KIND_TEXT = {
  fetch: 'An AI assistant opening this page because its user asked it to (not a bulk crawl).',
  browsing: 'An AI agent browsing and taking actions on its user\'s request.',
};

function result(entry, match) {
  if (!entry) {
    return { is_bot: false, is_ai_crawler: false, is_ai_agent: false, is_search_crawler: false, category: null, category_label: null, name: null, operator: null, ai_purpose: null, ai_agent_kind: null, robots_token: null, token_only: false, info_url: null, match: null, verified: false };
  }
  return {
    is_bot: true,
    is_ai_crawler: entry.c === 'ai_crawler',
    is_ai_agent: !!entry.pa,
    is_search_crawler: entry.c === 'search_crawler',
    category: entry.c,
    category_label: CATEGORIES[entry.c],
    name: entry.n,
    operator: entry.o || null,
    ai_purpose: entry.ai || null,
    ai_agent_kind: entry.pa || null,
    robots_token: entry.c === 'unknown_bot' ? null : (entry.token || entry.n),
    token_only: !!entry.tokenOnly,
    info_url: entry.url || null,
    match,
    verified: false,
  };
}

/** Classify a User-Agent string. Returns the `bot` object of the API response. */
export function detectBot(ua) {
  const s = String(ua || '');
  if (!s) return result(null);
  const lower = s.toLowerCase();
  for (const e of ENTRIES) {
    if (e.t ? lower.includes(e.t) : e.re.test(s)) return result(e, 'list');
  }
  if (GENERIC_RE.test(s) && !GENERIC_EXCLUDE_RE.test(s)) {
    return result({ n: null, c: 'unknown_bot' }, 'heuristic');
  }
  return result(null);
}

/** Public, documented view of the list (GET /v1/bots). */
export function botList() {
  return BOTS.map((b) => ({
    name: b.n,
    category: b.c,
    operator: b.o || null,
    ai_purpose: b.ai || null,
    is_ai_agent: !!b.pa,
    ai_agent_kind: b.pa || null,
    robots_token: b.token || b.n,
    token_only: !!b.tokenOnly,
    info_url: b.url || null,
    verified: false,
  }));
}
