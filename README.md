# KrakenCode

A public, terminal-style crypto explorer with a luminous code kraken in translucent water. Built as a dependency-free static website for GitHub Pages.

## Features

- Live pump.fun / PumpSwap discovery feed via DEX Screener; refreshes every minute while visible. Sort by 24h/1h change, volume, or market cap.
- Solana contract-address validation and lookup, price, market cap, volume and original-market links. Visitor CA saved in their browser.
- Web search through DuckDuckGo via Jina Reader; read public HTTPS pages and download collected text.
- A real seed crawler runs while the page is open, one page every 45 seconds, with pause/resume and a log of actual requests.
- Local collection of the 20 most recent pages, responsive layout, keyboard support, reduced motion, and optional browser WebMCP actions.

## Publish on GitHub Pages

Upload `index.html`, `style.css`, `app.js`, `config.js`, `kraken.png`, and `.nojekyll` to the root of a public repository. In **Settings → Pages**, select **Deploy from a branch**, branch **main**, folder **/(root)**, and Save. No build step or secrets are needed.

## Add your launched token for every visitor

Edit `config.js`, replacing the empty `contractAddress` value with your token's Solana CA and commit the change. Visitors may paste their own CA in the dashboard. A CA pasted by a visitor is local to that browser; it does not rewrite the public website.

## Local preview

Serve this folder with a static HTTP server. Opening the HTML as a local file may prevent fetch requests or browser storage from working. No packages are required.

## Service limits

DEX Screener only shows indexed token pairs. The movers feed is a discovery sample, not the entire pump.fun market, and market data may be delayed. Identification uses the pump address suffix, a pump.fun website link, or a pump.fun / PumpSwap market. Symbols and addresses should be independently checked.

Jina Reader and DuckDuckGo are public third-party services. They can rate-limit requests, change response formats, or block particular sites. The UI displays errors and links to original sources. Enter public URLs only: search phrases and submitted URLs are sent to these services. No private API key is exposed or required.

Data lives in the visitor's local browser storage, not in a shared server database. The crawler stops when the page closes and reads only a finite seed list plus manually requested pages. This website does not train models, launch a token, split fees, provide a treasury, or execute trades.

## Credits

Visual inspiration: the CrawlNet terminal interface. KrakenCode uses original branding, code, and generated kraken artwork; it is not affiliated with CrawlNet, pump.fun, DEX Screener, or Jina AI.
