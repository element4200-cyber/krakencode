# KrakenCode

Public dashboard: https://element4200-cyber.github.io/krakencode/

Dependency-free static website. Upload index.html, style.css, app.js, feedback.js, kraken-live.js, config.js, kraken.png and .nojekyll to GitHub Pages. No build required.

## Features
- Top project CA and separate visitor scanner accepting Solana CAs and pump.fun URLs.
- Indexed token metrics, live DEX Screener chart, source links, rule-based market feedback and actual session price samples.
- Movers refresh every 15 seconds while visible. Candidate discovery every 60 seconds; tokens are refreshed in API batches of at most 30.
- Web search and public URL retrieval through Jina Reader, extractive feedback, original source embed with octopus overlay and text fallback. Some external sources block embedding or retrieval.
- Session chat: pasted text analyzed locally; token/URL lookup; search command; questions matched to passages in the active source. No LLM backend, fabricated candle history, contract security score or trading recommendations.
- Automatic 20-second rotation: ranked movers, collected/seed pages, pasted text. Manual actions have at least 35 seconds priority. Five-minute page cache. Cycle pause/resume, independent motion pause, mobile layout and reduced-motion support.
- Eight procedural animated tentacles scan retrieved text; red/purple eyes react to request state.

## Launch CA
Edit config.js contractAddress to set the public KrakenCode CA for all visitors after launch. A visitor's saved last lookup is independent of that project address.

## Runtime & privacy
Runs only while the browser tab is visible. Service rate limits, caching, outages and pending requests can delay refresh. Last CA, public pages (20 maximum), and movers cache use localStorage. Chat messages (30) and pasted sources (10) stay only in session memory. Pasted text is never sent to a text-analysis backend. URLs, searches and CAs use their documented public services. External chart/page frames are sandboxed without forms, popups or top-level navigation. Cross-origin frames cannot be read; feedback uses fetched text/API data. Untrusted content is escaped or inserted as text.
