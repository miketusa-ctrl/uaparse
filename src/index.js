import html from '../public/index.html';
import docs from '../public/docs.html';
import privacy from '../public/privacy.html';
import js from '../public/app.js.txt';
import css from '../public/style.css';
import { createApp } from './app.js';
// SQLite-backed Durable Object: per-key daily quota + the shared daily pool (instance "global:budget").
export { KeyQuota } from './lib/quota.js';

const handle = createApp({ html, docs, privacy, js, css });
export default { fetch: (req, env, ctx) => handle(req, env, ctx) };
