// User-Agent parsing: ua-parser-js 1.0.41 (MIT; the 2.x line is AGPL-3.0 and must NOT be bundled — see
// THIRD_PARTY_NOTICES.md) for browser / engine / OS / device / CPU, plus src/lib/detect.js for bots.
// In-Worker only, no lookups. Results are cached per isolate by SHA-256 of the UA (cache.js).
import UAParser from 'ua-parser-js';
import { detectBot, LIST_VERSION } from './detect.js';

export const PARSER = 'ua-parser-js 1.0.41';
export const MAX_UA_LENGTH = 2048; // longer input → 400 (real UAs are well under 1 KB)

const DESKTOP_OS = new Set(['Windows', 'Mac OS', 'macOS', 'Linux', 'Ubuntu', 'Debian', 'Fedora', 'Mint', 'Arch', 'Gentoo',
  'Chromium OS', 'Chrome OS', 'FreeBSD', 'OpenBSD', 'NetBSD', 'Solaris', 'SUSE', 'openSUSE', 'Mandriva', 'Slackware',
  'CentOS', 'RedHat', 'Red Hat', 'Kubuntu', 'Xubuntu', 'Lubuntu', 'Zenwalk', 'elementary OS', 'Manjaro', 'Deepin', 'Unix', 'Haiku']);

const v = (x) => (x === undefined || x === '' ? null : x);

/**
 * device.type: ua-parser-js leaves it empty for desktops. We report:
 *   bot (any detected bot/crawler/client) · mobile · tablet · smarttv · console · wearable · xr · embedded ·
 *   desktop (no device type + a desktop OS) · unknown.
 */
function deviceType(r, bot) {
  if (bot.is_bot) return 'bot';
  if (r.device.type) return r.device.type;
  if (r.os.name && DESKTOP_OS.has(r.os.name)) return 'desktop';
  return 'unknown';
}

/** Parse one UA string (already validated: string, 1..MAX_UA_LENGTH chars). */
export function parseUA(ua) {
  const r = new UAParser(ua).getResult();
  const bot = detectBot(ua);
  return {
    ua,
    browser: { name: v(r.browser.name), version: v(r.browser.version), major: v(r.browser.major) },
    engine: { name: v(r.engine.name), version: v(r.engine.version) },
    os: { name: v(r.os.name), version: v(r.os.version) },
    device: { type: deviceType(r, bot), vendor: v(r.device.vendor), model: v(r.device.model) },
    cpu: { architecture: v(r.cpu.architecture) },
    is_bot: bot.is_bot,
    is_ai_crawler: bot.is_ai_crawler,
    is_ai_agent: bot.is_ai_agent,
    is_search_crawler: bot.is_search_crawler,
    bot,
    list_version: LIST_VERSION,
    parser: PARSER,
  };
}
