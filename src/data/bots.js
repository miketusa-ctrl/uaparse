// UAParse curated bot / crawler list. Kept in the repo; edit here, bump LIST_VERSION, run `npm test`.
// ORDER MATTERS: the first matching entry wins, so more specific tokens come before the tokens they contain
// (Googlebot-Image before Googlebot, Applebot-Extended before Applebot, BingPreview before bingbot …).
// Match = case-insensitive substring `t`, or regular expression `re` (keep regexes anchored/linear).
//
// Fields: n = display name · t / re = matcher · c = category · o = operator · ai = AI purpose (AI crawlers only):
//   training   = collects pages to train models / build datasets
//   search     = indexes pages for an AI search / answer engine
//   user_fetch = fetches a page because a user asked an assistant to (not a bulk crawl)
//   agent      = AI agent / scraping service acting for a customer
// token = robots.txt user-agent token when it differs from n or is "token only" (never sent as a User-Agent).
// tokenOnly = true → the operator documents this name ONLY as a robots.txt token (requests use another UA),
//   so seeing it in a real User-Agent header is unusual (kept so pasted tokens still explain themselves).
// url = operator documentation (only where we are confident of it).
// pa = personal / AI agent kind → `is_ai_agent: true` in results. Set ONLY when the operator's own docs say the UA
//   acts live for an individual end user of an AI assistant / agent product:
//     'fetch'    = opens the page(s) a user's request needs (ChatGPT-User, Claude-User, Perplexity-User, …)
//     'browsing' = navigates sites and performs actions on the user's request (Google-Agent)
//   Bulk / scheduled crawls never get `pa` (incl. B2B `agent` crawlers such as Google-CloudVertexBot, FirecrawlAgent)
//   and neither do legacy tokens the operator no longer documents (Claude-Web, cohere-ai). Every `pa` entry has `url`.
//   Personal agents that browse in a real browser and publish no User-Agent token cannot be detected from the UA
//   (see /docs#agents; never claim otherwise).
// retired = true → the operator has retired this name (still detected, still `pa`, for log forensics) but it is not
//   counted as a current agent in page copy (AI_AGENT_CURRENT_COUNT). It is never emitted in API responses.
export const LIST_VERSION = '2026-10-08';

export const CATEGORIES = {
  ai_crawler: 'AI crawler',
  search_crawler: 'Search engine crawler',
  ads_crawler: 'Advertising crawler',
  seo_crawler: 'SEO / marketing crawler',
  social_preview: 'Link preview fetcher',
  feed_reader: 'Feed reader',
  monitoring: 'Uptime / performance monitor',
  archiver: 'Web archiver',
  security_scanner: 'Security / internet scanner',
  headless_browser: 'Headless / automated browser',
  http_client: 'HTTP library / command-line client',
  other_crawler: 'Other crawler',
  unknown_bot: 'Unlisted bot (heuristic)',
};

export const BOTS = [
  // ---------------- AI crawlers ----------------
  { n: 'OAI-SearchBot', t: 'oai-searchbot', c: 'ai_crawler', o: 'OpenAI', ai: 'search', url: 'https://developers.openai.com/api/docs/bots' },
  { n: 'ChatGPT-User', t: 'chatgpt-user', c: 'ai_crawler', o: 'OpenAI', ai: 'user_fetch', pa: 'fetch', url: 'https://developers.openai.com/api/docs/bots' },
  { n: 'GPTBot', t: 'gptbot', c: 'ai_crawler', o: 'OpenAI', ai: 'training', url: 'https://developers.openai.com/api/docs/bots' },
  { n: 'Claude-SearchBot', t: 'claude-searchbot', c: 'ai_crawler', o: 'Anthropic', ai: 'search', url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
  { n: 'Claude-User', t: 'claude-user', c: 'ai_crawler', o: 'Anthropic', ai: 'user_fetch', pa: 'fetch', url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
  { n: 'Claude-Web', t: 'claude-web', c: 'ai_crawler', o: 'Anthropic', ai: 'user_fetch' },
  { n: 'ClaudeBot', t: 'claudebot', c: 'ai_crawler', o: 'Anthropic', ai: 'training', url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
  { n: 'anthropic-ai', t: 'anthropic-ai', c: 'ai_crawler', o: 'Anthropic', ai: 'training' },
  { n: 'Perplexity-User', t: 'perplexity-user', c: 'ai_crawler', o: 'Perplexity', ai: 'user_fetch', pa: 'fetch', url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
  { n: 'PerplexityBot', t: 'perplexitybot', c: 'ai_crawler', o: 'Perplexity', ai: 'search', url: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers' },
  { n: 'Google-Extended', t: 'google-extended', c: 'ai_crawler', o: 'Google', ai: 'training', tokenOnly: true, url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { n: 'Google-Agent', t: 'google-agent', c: 'ai_crawler', o: 'Google', ai: 'agent', pa: 'browsing', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers#google-agent' },
  { n: 'Google-GeminiNotebook', t: 'google-gemininotebook', c: 'ai_crawler', o: 'Google', ai: 'user_fetch', pa: 'fetch', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers#gemini-notebook' },
  { n: 'Google-NotebookLM', t: 'google-notebooklm', c: 'ai_crawler', o: 'Google', ai: 'user_fetch', pa: 'fetch', retired: true, url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers#gemini-notebook' },
  { n: 'Google-CloudVertexBot', t: 'google-cloudvertexbot', c: 'ai_crawler', o: 'Google', ai: 'agent', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers' },
  { n: 'Applebot-Extended', t: 'applebot-extended', c: 'ai_crawler', o: 'Apple', ai: 'training', tokenOnly: true, url: 'https://support.apple.com/en-us/119829' },
  { n: 'CCBot', t: 'ccbot', c: 'ai_crawler', o: 'Common Crawl', ai: 'training', url: 'https://commoncrawl.org/ccbot' },
  { n: 'Bytespider', t: 'bytespider', c: 'ai_crawler', o: 'ByteDance', ai: 'training' },
  { n: 'Amzn-SearchBot', t: 'amzn-searchbot', c: 'ai_crawler', o: 'Amazon', ai: 'search', url: 'https://developer.amazon.com/amazonbot' },
  { n: 'Amzn-User', t: 'amzn-user', c: 'ai_crawler', o: 'Amazon', ai: 'user_fetch', pa: 'fetch', url: 'https://developer.amazon.com/amazonbot' },
  { n: 'Amazonbot', t: 'amazonbot', c: 'ai_crawler', o: 'Amazon', ai: 'training', url: 'https://developer.amazon.com/amazonbot' },
  { n: 'meta-externalagent', t: 'meta-externalagent', c: 'ai_crawler', o: 'Meta', ai: 'training', url: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers' },
  { n: 'meta-externalfetcher', t: 'meta-externalfetcher', c: 'ai_crawler', o: 'Meta', ai: 'user_fetch', pa: 'fetch', url: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers' },
  { n: 'Meta-WebIndexer', t: 'meta-webindexer', c: 'ai_crawler', o: 'Meta', ai: 'search', url: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers' },
  { n: 'FacebookBot', t: 'facebookbot', c: 'ai_crawler', o: 'Meta', ai: 'training' },
  { n: 'cohere-training-data-crawler', t: 'cohere-training-data-crawler', c: 'ai_crawler', o: 'Cohere', ai: 'training' },
  { n: 'cohere-ai', t: 'cohere-ai', c: 'ai_crawler', o: 'Cohere', ai: 'user_fetch' },
  { n: 'MistralAI-User', t: 'mistralai-user', c: 'ai_crawler', o: 'Mistral AI', ai: 'user_fetch', pa: 'fetch', url: 'https://docs.mistral.ai/robots' },
  { n: 'MistralAI-Index', t: 'mistralai-index', c: 'ai_crawler', o: 'Mistral AI', ai: 'search', url: 'https://docs.mistral.ai/robots' },
  { n: 'MistralAI-Training', t: 'mistralai-training', c: 'ai_crawler', o: 'Mistral AI', ai: 'training', url: 'https://docs.mistral.ai/robots' },
  { n: 'DuckAssistBot', t: 'duckassistbot', c: 'ai_crawler', o: 'DuckDuckGo', ai: 'search' },
  { n: 'YouBot', t: 'youbot', c: 'ai_crawler', o: 'You.com', ai: 'search' },
  { n: 'PhindBot', t: 'phindbot', c: 'ai_crawler', o: 'Phind', ai: 'search' },
  { n: 'iAskSpider', t: 'iaskspider', c: 'ai_crawler', o: 'iAsk.ai', ai: 'search' },
  { n: 'Diffbot', t: 'diffbot', c: 'ai_crawler', o: 'Diffbot', ai: 'training' },
  { n: 'AI2Bot', t: 'ai2bot', c: 'ai_crawler', o: 'Allen Institute for AI', ai: 'training' },
  { n: 'PanguBot', t: 'pangubot', c: 'ai_crawler', o: 'Huawei', ai: 'training' },
  { n: 'Timpibot', t: 'timpibot', c: 'ai_crawler', o: 'Timpi', ai: 'training' },
  { n: 'omgili', t: 'omgili', c: 'ai_crawler', o: 'Webz.io', ai: 'training' },
  { n: 'ImagesiftBot', t: 'imagesiftbot', c: 'ai_crawler', o: 'Hive', ai: 'training' },
  { n: 'img2dataset', t: 'img2dataset', c: 'ai_crawler', o: 'img2dataset (open-source tool)', ai: 'training' },
  { n: 'Kangaroo Bot', t: 'kangaroo bot', c: 'ai_crawler', o: 'Kangaroo LLM', ai: 'training' },
  { n: 'FirecrawlAgent', t: 'firecrawlagent', c: 'ai_crawler', o: 'Firecrawl', ai: 'agent' },

  // ---------------- search engines ----------------
  { n: 'Googlebot-Image', t: 'googlebot-image', c: 'search_crawler', o: 'Google', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { n: 'Googlebot-Video', t: 'googlebot-video', c: 'search_crawler', o: 'Google', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { n: 'Googlebot-News', t: 'googlebot-news', c: 'search_crawler', o: 'Google', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { n: 'Google-InspectionTool', t: 'google-inspectiontool', c: 'search_crawler', o: 'Google', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { n: 'Storebot-Google', t: 'storebot-google', c: 'search_crawler', o: 'Google', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { n: 'Googlebot', t: 'googlebot', c: 'search_crawler', o: 'Google', url: 'https://developers.google.com/search/docs/crawling-indexing/googlebot' },
  { n: 'BingPreview', t: 'bingpreview', c: 'social_preview', o: 'Microsoft' },
  { n: 'MicrosoftPreview', t: 'microsoftpreview', c: 'social_preview', o: 'Microsoft' },
  { n: 'AdIdxBot', t: 'adidxbot', c: 'ads_crawler', o: 'Microsoft' },
  { n: 'Bingbot', t: 'bingbot', c: 'search_crawler', o: 'Microsoft', url: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0' },
  { n: 'Applebot', t: 'applebot', c: 'search_crawler', o: 'Apple', url: 'https://support.apple.com/en-us/119829' },
  { n: 'DuckDuckBot', t: 'duckduckbot', c: 'search_crawler', o: 'DuckDuckGo' },
  { n: 'Yahoo! Slurp', t: 'yahoo! slurp', c: 'search_crawler', o: 'Yahoo' },
  { n: 'Baiduspider', t: 'baiduspider', c: 'search_crawler', o: 'Baidu' },
  { n: 'YandexBot', re: /yandex(?:bot|images|mobilebot|video|news|accessibilitybot|renderresourcesbot)\b/i, c: 'search_crawler', o: 'Yandex' },
  { n: 'Sogou spider', re: /sogou (?:web|inst|pic|news)? ?spider/i, c: 'search_crawler', o: 'Sogou' },
  { n: '360Spider', t: '360spider', c: 'search_crawler', o: 'Qihoo 360' },
  { n: 'PetalBot', t: 'petalbot', c: 'search_crawler', o: 'Huawei (Petal Search)' },
  { n: 'SeznamBot', t: 'seznambot', c: 'search_crawler', o: 'Seznam.cz' },
  { n: 'Naver Yeti', re: /\byeti\/\d/i, c: 'search_crawler', o: 'Naver' },
  { n: 'Coc Coc bot', t: 'coccocbot', c: 'search_crawler', o: 'Coc Coc' },
  { n: 'Qwantbot', re: /qwant(?:bot|ify)/i, c: 'search_crawler', o: 'Qwant' },
  { n: 'MojeekBot', t: 'mojeekbot', c: 'search_crawler', o: 'Mojeek' },
  { n: 'SeekportBot', t: 'seekportbot', c: 'search_crawler', o: 'Seekport' },
  { n: 'Bravebot', t: 'bravebot', c: 'search_crawler', o: 'Brave' },

  // ---------------- other Google / ads ----------------
  { n: 'OAI-AdsBot', t: 'oai-adsbot', c: 'ads_crawler', o: 'OpenAI', url: 'https://developers.openai.com/api/docs/bots' },
  { n: 'Meta-ExternalAds', t: 'meta-externalads', c: 'ads_crawler', o: 'Meta', url: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers' },
  { n: 'AdsBot-Google-Mobile', t: 'adsbot-google-mobile', c: 'ads_crawler', o: 'Google' },
  { n: 'AdsBot-Google', t: 'adsbot-google', c: 'ads_crawler', o: 'Google' },
  { n: 'Mediapartners-Google', t: 'mediapartners-google', c: 'ads_crawler', o: 'Google' },
  { n: 'GoogleOther', t: 'googleother', c: 'other_crawler', o: 'Google', url: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
  { n: 'FeedFetcher-Google', t: 'feedfetcher-google', c: 'feed_reader', o: 'Google' },
  { n: 'APIs-Google', t: 'apis-google', c: 'other_crawler', o: 'Google' },
  { n: 'Google-Read-Aloud', t: 'google-read-aloud', c: 'other_crawler', o: 'Google' },

  // ---------------- SEO / marketing ----------------
  { n: 'AhrefsSiteAudit', t: 'ahrefssiteaudit', c: 'seo_crawler', o: 'Ahrefs' },
  { n: 'AhrefsBot', t: 'ahrefsbot', c: 'seo_crawler', o: 'Ahrefs' },
  { n: 'SemrushBot', t: 'semrushbot', c: 'seo_crawler', o: 'Semrush' },
  { n: 'SiteAuditBot', t: 'siteauditbot', c: 'seo_crawler', o: 'Semrush' },
  { n: 'MJ12bot', t: 'mj12bot', c: 'seo_crawler', o: 'Majestic' },
  { n: 'DotBot', t: 'dotbot', c: 'seo_crawler', o: 'Moz' },
  { n: 'rogerbot', t: 'rogerbot', c: 'seo_crawler', o: 'Moz' },
  { n: 'BLEXBot', t: 'blexbot', c: 'seo_crawler', o: 'WebMeUp' },
  { n: 'DataForSeoBot', t: 'dataforseobot', c: 'seo_crawler', o: 'DataForSEO' },
  { n: 'serpstatbot', t: 'serpstatbot', c: 'seo_crawler', o: 'Serpstat' },
  { n: 'Screaming Frog SEO Spider', t: 'screaming frog seo spider', c: 'seo_crawler', o: 'Screaming Frog' },
  { n: 'Barkrowler', t: 'barkrowler', c: 'seo_crawler', o: 'Babbar' },
  { n: 'MegaIndex', t: 'megaindex', c: 'seo_crawler', o: 'MegaIndex' },

  // ---------------- link previews / social ----------------
  { n: 'facebookexternalhit', t: 'facebookexternalhit', c: 'social_preview', o: 'Meta', url: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers' },
  { n: 'Facebot', t: 'facebot', c: 'social_preview', o: 'Meta' },
  { n: 'Twitterbot', t: 'twitterbot', c: 'social_preview', o: 'X (Twitter)' },
  { n: 'LinkedInBot', t: 'linkedinbot', c: 'social_preview', o: 'LinkedIn' },
  { n: 'Slackbot-LinkExpanding', t: 'slackbot-linkexpanding', c: 'social_preview', o: 'Slack' },
  { n: 'Slackbot', t: 'slackbot', c: 'social_preview', o: 'Slack' },
  { n: 'Discordbot', t: 'discordbot', c: 'social_preview', o: 'Discord' },
  { n: 'TelegramBot', t: 'telegrambot', c: 'social_preview', o: 'Telegram' },
  { n: 'WhatsApp', re: /^whatsapp\/\d/i, c: 'social_preview', o: 'Meta (WhatsApp)' },
  { n: 'Pinterestbot', re: /pinterest(?:bot|\/0\.)/i, c: 'social_preview', o: 'Pinterest' },
  { n: 'redditbot', t: 'redditbot', c: 'social_preview', o: 'Reddit' },
  { n: 'SkypeUriPreview', t: 'skypeuripreview', c: 'social_preview', o: 'Microsoft' },
  { n: 'Bluesky Cardyb', t: 'cardyb', c: 'social_preview', o: 'Bluesky' },
  { n: 'Mastodon', re: /\bmastodon\/\d/i, c: 'social_preview', o: 'Mastodon (fediverse server)' },
  { n: 'Embedly', t: 'embedly', c: 'social_preview', o: 'Embedly' },
  { n: 'Iframely', t: 'iframely', c: 'social_preview', o: 'Iframely' },
  { n: 'vkShare', t: 'vkshare', c: 'social_preview', o: 'VK' },

  // ---------------- feeds ----------------
  { n: 'Feedly', t: 'feedly', c: 'feed_reader', o: 'Feedly' },
  { n: 'Feedbin', t: 'feedbin', c: 'feed_reader', o: 'Feedbin' },
  { n: 'NewsBlur', t: 'newsblur', c: 'feed_reader', o: 'NewsBlur' },
  { n: 'Inoreader', t: 'inoreader', c: 'feed_reader', o: 'Inoreader' },

  // ---------------- monitoring ----------------
  { n: 'UptimeRobot', t: 'uptimerobot', c: 'monitoring', o: 'UptimeRobot' },
  { n: 'Pingdom', t: 'pingdom', c: 'monitoring', o: 'SolarWinds Pingdom' },
  { n: 'StatusCake', t: 'statuscake', c: 'monitoring', o: 'StatusCake' },
  { n: 'Site24x7', t: 'site24x7', c: 'monitoring', o: 'Zoho Site24x7' },
  { n: 'Better Uptime Bot', t: 'better uptime bot', c: 'monitoring', o: 'Better Stack' },
  { n: 'Datadog Synthetics', t: 'datadogsynthetics', c: 'monitoring', o: 'Datadog' },
  { n: 'Chrome Lighthouse', t: 'chrome-lighthouse', c: 'monitoring', o: 'Google (Lighthouse / PageSpeed)' },
  { n: 'GTmetrix', t: 'gtmetrix', c: 'monitoring', o: 'GTmetrix' },

  // ---------------- archivers ----------------
  { n: 'archive.org_bot', t: 'archive.org_bot', c: 'archiver', o: 'Internet Archive' },
  { n: 'ia_archiver', t: 'ia_archiver', c: 'archiver', o: 'Alexa / Internet Archive (legacy)' },

  // ---------------- scanners ----------------
  { n: 'CensysInspect', t: 'censysinspect', c: 'security_scanner', o: 'Censys' },
  { n: 'Expanse', t: 'expanse, a palo alto networks company', c: 'security_scanner', o: 'Palo Alto Networks' },
  { n: 'zgrab', t: 'zgrab', c: 'security_scanner', o: 'ZMap project (zgrab)' },
  { n: 'Nmap Scripting Engine', t: 'nmap scripting engine', c: 'security_scanner', o: 'Nmap' },
  { n: 'Nuclei', re: /\bnuclei\b/i, c: 'security_scanner', o: 'ProjectDiscovery (nuclei)' },

  // ---------------- headless / automation ----------------
  { n: 'HeadlessChrome', t: 'headlesschrome', c: 'headless_browser', o: 'Chrome headless mode (Puppeteer / Playwright / Selenium)' },
  { n: 'PhantomJS', t: 'phantomjs', c: 'headless_browser', o: 'PhantomJS' },

  // ---------------- HTTP libraries / CLI ----------------
  { n: 'Scrapy', t: 'scrapy', c: 'http_client', o: 'Scrapy (Python scraping framework)' },
  { n: 'curl', re: /(?:^|[\s(])curl\/\d/i, c: 'http_client', o: 'curl' },
  { n: 'Wget', re: /(?:^|[\s(])wget\/\d/i, c: 'http_client', o: 'GNU Wget' },
  { n: 'python-requests', t: 'python-requests', c: 'http_client', o: 'Python requests' },
  { n: 'python-httpx', t: 'python-httpx', c: 'http_client', o: 'Python httpx' },
  { n: 'aiohttp', re: /python\/[\d.]+ aiohttp|\baiohttp\/\d/i, c: 'http_client', o: 'Python aiohttp' },
  { n: 'Python-urllib', t: 'python-urllib', c: 'http_client', o: 'Python urllib' },
  { n: 'Go-http-client', t: 'go-http-client', c: 'http_client', o: 'Go net/http' },
  { n: 'Apache-HttpClient', t: 'apache-httpclient', c: 'http_client', o: 'Apache HttpClient (Java)' },
  { n: 'Java', re: /^java\/\d/i, c: 'http_client', o: 'Java (HttpURLConnection / HttpClient)' },
  { n: 'okhttp', re: /^okhttp\/\d/i, c: 'http_client', o: 'OkHttp (Java / Android)' },
  { n: 'axios', re: /^axios\/\d/i, c: 'http_client', o: 'axios (JavaScript)' },
  { n: 'node-fetch', t: 'node-fetch', c: 'http_client', o: 'node-fetch (JavaScript)' },
  { n: 'undici', re: /^undici\b|^node$/i, c: 'http_client', o: 'Node.js fetch (undici)' },
  { n: 'PostmanRuntime', t: 'postmanruntime', c: 'http_client', o: 'Postman' },
  { n: 'Insomnia', re: /^insomnia\/\d/i, c: 'http_client', o: 'Insomnia' },
  { n: 'HTTPie', re: /^httpie\/\d/i, c: 'http_client', o: 'HTTPie' },
  { n: 'libwww-perl', t: 'libwww-perl', c: 'http_client', o: 'Perl LWP' },
  { n: 'Guzzle', re: /guzzlehttp\/\d/i, c: 'http_client', o: 'Guzzle (PHP)' },
  { n: 'Ruby', re: /^ruby$|^faraday v\d/i, c: 'http_client', o: 'Ruby net/http / Faraday' },
  { n: 'Dart', re: /^dart\/\d/i, c: 'http_client', o: 'Dart / Flutter http' },
  { n: 'Deno', re: /^deno\/\d/i, c: 'http_client', o: 'Deno' },
  { n: 'Bun', re: /^bun\/\d/i, c: 'http_client', o: 'Bun' },
];
