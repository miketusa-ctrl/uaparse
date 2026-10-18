/**
 * UAParse Pro (Polar) — single place for the public checkout URL, product slug, key prefix and price. Pattern:
 * DnsGuard src/lib/pro.js. License validation uses fleet-license.js + the shared LICENSES KV written by the license
 * gateway (no Polar HTTP on the request path). Never log or echo a license key. Limits live in keys.js PLANS.pro
 * (one place for both minted Pro keys and Polar Pro licenses).
 */
import { hashApiKey } from './keys.js';

/** Polar checkout link (persistent). */
export const PRO_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_VCK4amieG34XihTeJLv5yET9ZBjbTn7PViSQK4Ogxks';
/** Polar customer portal (manage / cancel), same org as the other shared Pro products. */
export const PRO_PORTAL_URL = 'https://polar.sh/digital-promo/portal';
export const PRO_PRODUCT_SLUG = 'uaparse-pro';
export const PRO_KEY_PREFIX = 'UAPR';

/** Case-insensitive product prefix before the first dash (Polar license-key benefit prefix). */
export function looksLikeProKey(key) {
  if (!key || typeof key !== 'string') return false;
  const head = key.trim().split('-')[0] || '';
  return head.toUpperCase() === PRO_KEY_PREFIX;
}

/** Stable, non-reversible id for a license (limiter + daily quota). Never store or return the raw key. */
export async function proKeyIdFor(rawKey) {
  const hash = await hashApiKey(rawKey);
  return `pro:${hash.slice(0, 32)}`;
}
