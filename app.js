"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const kraken = window.KrakenLive;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const storage = { get(key, fallback) { try { return JSON.parse(localStorage.getItem("krakencode:" + key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem("krakencode:" + key, JSON.stringify(value)); } catch { log("STORE", "Browser storage is full or unavailable; this session still works.", true); } } };
  const state = { pairs: [], pages: storage.get("pages", []), logs: [], paused: false, crawlBusy: false, webBusy: false, moversBusy: false, caBusy: false, seed: 0, readerPage: null, token: null, controller: null };
  if (!Array.isArray(state.pages)) state.pages = [];
  state.pages = state.pages.filter(p => p && typeof p.url === "string" && typeof p.text === "string").slice(0, 20);
  const seeds = ["https://solana.com/docs", "https://ethereum.org/en/developers/docs/", "https://docs.jup.ag/", "https://solana.com/solana-whitepaper.pdf"];
  const fmt = n => Number.isFinite(Number(n)) && n != null ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n)) : "—";
  const usd = n => Number.isFinite(Number(n)) && n != null ? "$" + fmt(n) : "—";
  const price = n => n != null && Number.isFinite(Number(n)) ? "$" + Number(n).toLocaleString("en-US", { maximumSignificantDigits: 4 }) : "—";
  const change = n => n != null && Number.isFinite(Number(n)) ? (Number(n) >= 0 ? "+" : "") + Number(n).toFixed(1) + "%" : "—";
  const host = url => { try { return new URL(url).hostname; } catch { return "unknown"; } };
  function publicUrl(value) {
    let u; try { u = new URL(value); } catch { throw new Error("Enter a complete public HTTPS URL."); }
    if (u.protocol !== "https:" || u.username || u.password || u.port && u.port !== "443") throw new Error("Use a public HTTPS URL without credentials or a custom port.");
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || /(^|\.)(localhost|local|internal|test)$/.test(h) || /^\[/.test(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) throw new Error("Only public website domains are supported.");
    u.hash = ""; return u.href;
  }
  function safeLink(value) { try { const u = new URL(value); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } }
  function validCa(value) {
    const ca = String(value || "").trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) throw new Error("Enter a valid Solana contract address (32–44 base58 characters).");
    // Solana public keys decode to exactly 32 bytes, including leading zeros.
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = 0n; for (const c of ca) n = n * 58n + BigInt(alphabet.indexOf(c));
    let bytes = 0; for (; n > 0n; n >>= 8n) bytes++;
    bytes += ca.match(/^1*/)[0].length;
    if (bytes !== 32) throw new Error("This address does not decode to a 32-byte Solana public key.");
    return ca;
  }
  function status(id, message, kind = "") { $(id).textContent = message; $(id).className = "hint " + kind; }
  function log(action, message, failed = false) {
    state.logs.unshift({ time: new Date().toLocaleTimeString("en-US", { hour12: false }), action, message, failed });
    state.logs = state.logs.slice(0, 35);
    $("activity-log").innerHTML = state.logs.map(l => `<div class="log-entry"><span class="log-time">${escape(l.time)}</span><span class="log-action ${l.failed ? "error" : ""}">${escape(l.action)}</span><span class="log-message">${escape(l.message)}</span></div>`).join("");
  }
  async function request(url, timeout = 18000, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 429 ? "Service rate limit reached. Try again in a minute." : `Data service returned HTTP ${response.status}. Try again shortly.`);
      return await response.text();
    } catch (e) {
      if (e.name === "AbortError") throw new Error(signal?.aborted ? "Request paused." : "The service took too long. Please retry.");
      if (e instanceof TypeError) throw new Error("Unable to reach the data service. Check your connection and retry.");
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  const json = async path => JSON.parse(await request("https://api.dexscreener.com" + path));
  function pumpPair(p) { return p?.chainId === "solana" && p.baseToken?.address && (/pump$/i.test(p.baseToken.address) || /pump/i.test(p.dexId || "") || p.info?.websites?.some(w => host(w.url) === "pump.fun")); }
  function dedupePairs(pairs) {
    const map = new Map();
    for (const p of pairs) {
      if (!p?.baseToken?.address) continue;
      const old = map.get(p.baseToken.address);
      if (!old || Number(p.liquidity?.usd || 0) > Number(old.liquidity?.usd || 0) || Number(p.liquidity?.usd || 0) === Number(old.liquidity?.usd || 0) && Number(p.volume?.h24 || 0) > Number(old.volume?.h24 || 0)) map.set(p.baseToken.address, p);
    }
    return [...map.values()];
  }
  function renderMovers() {
    const field = $("sort-movers").value;
    const rank = p => field === "volume" ? Number(p.volume?.h24 || 0) : field === "marketCap" ? Number(p.marketCap ?? p.fdv ?? 0) : Number(p.priceChange?.[field] ?? -Infinity);
    const pairs = [...state.pairs].sort((a, b) => rank(b) - rank(a)).slice(0, 10);
    if (!pairs.length) { $("movers-body").innerHTML = '<tr><td colspan="6" class="empty">No matching pump.fun pairs found. Refresh to try again.</td></tr>'; return; }
    $("movers-body").innerHTML = pairs.map(p => {
      const icon = safeLink(p.info?.imageUrl);
      const ca = p.baseToken.address;
      return `<tr><td><div class="token-name"><span class="token-icon">${icon ? `<img src="${escape(icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : escape((p.baseToken.symbol || "?").slice(0, 2))}</span><div><div class="token-symbol" title="${escape(p.baseToken.name)}">${escape(p.baseToken.symbol)}</div><div class="token-sub">${escape(p.dexId)}</div></div></div></td><td>${escape(price(p.priceUsd))}</td><td class="${Number(p.priceChange?.h24) >= 0 ? "positive" : "negative"}">${escape(change(p.priceChange?.h24))}</td><td>${escape(usd(p.volume?.h24))}</td><td>${escape(usd(p.marketCap))}</td><td><button data-track="${escape(ca)}" aria-label="Track ${escape(p.baseToken.symbol)}">track</button></td></tr>`;
    }).join("");
    $("tokens-stat").textContent = fmt(state.pairs.length);
  }
  async function loadMovers() {
    if (state.moversBusy) return;
    state.moversBusy = true; $("refresh-movers").disabled = true; $("movers-meta").textContent = "Fetching live pairs…";
    try {
      const candidates = await Promise.allSettled([json("/token-profiles/latest/v1"), json("/token-boosts/top/v1"), json("/latest/dex/search?q=pumpfun"), json("/latest/dex/search?q=pumpswap")]);
      const direct = candidates.slice(2).flatMap(r => r.status === "fulfilled" ? r.value.pairs || [] : []);
      const profiles = candidates.slice(0, 2).flatMap(r => r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
      const addresses = [...new Set(profiles.filter(p => p.chainId === "solana" && /pump$/i.test(p.tokenAddress)).map(p => p.tokenAddress))].slice(0, 30);
      let detailed = []; let partial = candidates.some(r => r.status === "rejected");
      if (addresses.length) { try { detailed = await json("/tokens/v1/solana/" + addresses.join(",")); } catch { partial = true; } }
      const pairs = dedupePairs([...direct, ...(Array.isArray(detailed) ? detailed : [])].filter(pumpPair));
      if (!pairs.length && candidates.every(r => r.status === "rejected")) throw candidates[0].reason;
      state.pairs = pairs; renderMovers();
      const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
      $("movers-meta").textContent = `${partial ? "Partial feed · " : "Live · "}${timestamp} · ${pairs.length} tokens`;
      $("network-status").textContent = partial ? "partial feed" : "market connected";
      storage.set("movers", { pairs, timestamp: Date.now() });
      log("MARKET", `${pairs.length} pump.fun / PumpSwap tokens surfaced${partial ? " · partial feed" : ""}.`);
    } catch (e) {
      $("movers-meta").textContent = "Feed unavailable · " + e.message;
      $("network-status").textContent = "feed unavailable";
      if (!state.pairs.length) $("movers-body").innerHTML = `<tr><td colspan="6" class="empty">${escape(e.message)} Use refresh to reconnect.</td></tr>`;
      else $("movers-meta").textContent += " Showing previous data.";
      log("ERROR", e.message, true);
    } finally { state.moversBusy = false; $("refresh-movers").disabled = false; }
  }
  async function trackToken(raw) {
    if (state.caBusy) throw new Error("A token lookup is already running.");
    let ca; try { ca = validCa(raw); } catch (e) { status("ca-message", e.message, "error"); throw e; }
    state.caBusy = true; $("ca-input").value = ca; const button = $("ca-form").querySelector("button"); button.disabled = true;
    status("ca-message", "Looking up indexed Solana pairs…"); $("token-detail").hidden = true;
    try {
      const result = await json("/token-pairs/v1/solana/" + ca);
      const pairs = (Array.isArray(result) ? result : []).filter(p => p.baseToken?.address === ca);
      pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0) || Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0));
      const p = pairs[0]; state.token = p || null; storage.set("ca", ca);
      const pump = "https://pump.fun/coin/" + ca;
      const dex = safeLink(p?.url) || "https://dexscreener.com/solana/" + ca;
      $("token-detail").innerHTML = `<h3>${p ? escape(p.baseToken.name) + " <span>(" + escape(p.baseToken.symbol) + ")</span>" : "CA saved · waiting for an indexed pair"}</h3>${p ? `<div class="token-metrics"><span>price <b>${escape(price(p.priceUsd))}</b></span><span>mcap <b>${escape(usd(p.marketCap))}</b></span><span>24h <b class="${Number(p.priceChange?.h24) >= 0 ? "positive" : "negative"}">${escape(change(p.priceChange?.h24))}</b></span><span>volume <b>${escape(usd(p.volume?.h24))}</b></span></div>` : ""}<a href="${escape(pump)}" target="_blank" rel="noopener noreferrer">open on pump.fun</a><a href="${escape(dex)}" target="_blank" rel="noopener noreferrer">DEX Screener</a><button id="copy-ca">copy CA</button>`;
      $("token-detail").hidden = false;
      status("ca-message", p ? `${pairs.length} indexed pair${pairs.length === 1 ? "" : "s"} · ${p.dexId} · saved in this browser` : "No indexed pair yet. Your CA is saved; check again after trading begins.", p ? "success" : "");
      log("TOKEN", `${p?.baseToken.symbol || ca.slice(0, 8)} · ${pairs.length} indexed pairs.`);
      return { contractAddress: ca, indexed: !!p, symbol: p?.baseToken.symbol || null, priceUsd: p?.priceUsd || null };
    } catch (e) { status("ca-message", e.message, "error"); log("ERROR", "Token lookup: " + e.message, true); throw e; }
    finally { state.caBusy = false; button.disabled = false; }
  }
  function renderLibrary() {
    const pages = state.pages;
    $("pages-stat").textContent = fmt(pages.length); $("words-stat").textContent = fmt(pages.reduce((sum, p) => sum + (p.words || 0), 0));
    $("domains-stat").textContent = new Set(pages.map(p => host(p.url))).size + " domains"; $("library-count").textContent = pages.length + " saved";
    $("library-list").innerHTML = pages.length ? pages.map((p, i) => `<article class="page-card"><h3 title="${escape(p.title)}">${escape(p.title)}</h3><p>${escape(host(p.url))} · ${escape(fmt(p.words))} words · ${escape(new Date(p.at).toLocaleDateString())}</p><button data-page="${i}">read page</button></article>`).join("") : '<p class="empty">Your collected pages will appear here.</p>';
  }
  function openPage(page) {
    state.readerPage = page; $("reader-title").textContent = page.title; $("reader-source").href = safeLink(page.url); $("reader-content").textContent = page.text;
    kraken?.setPage(page);
    if (!$("reader").open) $("reader").showModal();
  }
  async function readPage(raw, { show = true, signal } = {}) {
    const url = publicUrl(raw);
    log("GET", url); $("kraken-state").textContent = "reading"; $("monitor-task").textContent = "reading " + host(url);
    kraken?.beginRead(url);
    try {
      const text = await request("https://r.jina.ai/" + url, 55000, signal);
      if (!text.includes("Markdown Content:") || /^(?:Title: )?(?:Just a moment|Access denied|Attention Required)/i.test(text) || text.length < 100) throw new Error("This page could not be read. Open the original source instead.");
      const title = text.match(/^Title: (.+)$/m)?.[1] || host(url);
      const content = text.split("Markdown Content:").slice(1).join("Markdown Content:").trim().slice(0, 70000);
      if (!content) throw new Error("The page returned no readable text.");
      const page = { url, title, text: content, words: content.split(/\s+/).filter(Boolean).length, at: Date.now() };
      state.pages = [page, ...state.pages.filter(p => p.url !== url)].slice(0, 20); storage.set("pages", state.pages); renderLibrary();
      log("READ", `${host(url)} · ${fmt(page.words)} words collected.`);
      $("monitor-task").textContent = host(url) + " · " + fmt(page.words) + " words";
      kraken?.setPage(page);
      if (show) openPage(page);
      return { url, title, words: page.words };
    } catch (e) { log("ERROR", host(url) + " · " + e.message, true); if (e.message !== "Request paused." || !state.webBusy) kraken?.setMode(e.message === "Request paused." ? "paused" : "error"); throw e; }
    finally { $("kraken-state").textContent = state.paused ? "paused" : "awake"; }
  }
  function plain(md) { return md.replace(/\*{4}/g, " ").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^[#*\s]+/, "").trim(); }
  function parseSearch(text) {
    const chunks = text.split(/^## /m).slice(1); const results = [];
    for (const chunk of chunks) {
      const title = chunk.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/);
      if (!title) continue;
      let url = title[2];
      try { const u = new URL(url); if (u.searchParams.has("uddg")) url = u.searchParams.get("uddg"); url = publicUrl(url); } catch { continue; }
      if (results.some(r => r.url === url)) continue;
      const paragraphs = chunk.split(/\n\s*\n/).slice(1);
      const description = paragraphs.find(p => p.startsWith("[") && !p.startsWith("[![") && p.length > 100);
      results.push({ title: plain(title[1]), url, snippet: description ? plain(description).slice(0, 260) : "" });
    }
    return results.slice(0, 8);
  }
  async function searchWeb(query) {
    const q = String(query || "").trim(); if (!q || q.length > 500) throw new Error("Enter a search phrase of 1–500 characters.");
    log("SEARCH", q);
    kraken?.setSearch(q);
    const text = await request("https://r.jina.ai/https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), 55000);
    const results = parseSearch(text);
    kraken?.setSearch(q, results);
    const fallback = "https://duckduckgo.com/?q=" + encodeURIComponent(q);
    $("web-results").innerHTML = results.map(r => `<article class="search-result"><a href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">${escape(r.title)}</a><p>${escape(r.snippet)}</p><div class="result-bottom"><span>${escape(host(r.url))}</span><button data-read="${escape(r.url)}">read page</button></div></article>`).join("") + `<p class="hint"><a href="${escape(fallback)}" target="_blank" rel="noopener noreferrer">${results.length ? "Open full search on DuckDuckGo" : "Search unavailable here. Open DuckDuckGo to search directly."}</a></p>`;
    if (!results.length) { log("SEARCH", "No readable search results returned. Direct search link available.", true); return { query: q, results: [], fallback }; }
    log("FOUND", `${results.length} webpages for “${q}”.`);
    return { query: q, results };
  }
  async function explore(raw) {
    if (state.webBusy) throw new Error("An exploration request is already running.");
    const query = String(raw || "").trim(); if (!query) throw new Error("Enter a search phrase or public HTTPS URL.");
    state.webBusy = true; $("web-submit").disabled = true; $("web-input").value = query;
    // Stop an automatic request so the visitor's own request gets priority.
    state.controller?.abort();
    const isUrl = /^https?:\/\//i.test(query);
    status("web-status", isUrl ? "Reading public page…" : "Searching the web…");
    try {
      const result = isUrl ? await readPage(query) : await searchWeb(query);
      status("web-status", isUrl ? `${fmt(result.words)} words collected. Page saved below.` : result.results.length ? `${result.results.length} results · choose a page to read` : "Search service returned no results. Use the direct search link below.", "success");
      return result;
    } catch (e) { status("web-status", e.message, "error"); kraken?.setMode("error"); if (isUrl) { const link = safeLink(query); $("web-results").innerHTML = link ? `<p class="hint"><a href="${escape(link)}" target="_blank" rel="noopener noreferrer">Open original page</a></p>` : ""; } throw e; }
    finally { state.webBusy = false; $("web-submit").disabled = false; }
  }
  async function crawl() {
    if (state.paused || state.crawlBusy || state.webBusy || document.hidden) return;
    if (state.seed >= seeds.length) { $("crawler-status").textContent = "seed crawl complete / explore to read more"; $("monitor-task").textContent = "seed pages complete · ready to explore"; return; }
    state.crawlBusy = true; const url = seeds[state.seed++]; state.controller = new AbortController();
    $("crawler-status").textContent = "reading / " + host(url);
    try { await readPage(url, { show: false, signal: state.controller.signal }); $("crawler-status").textContent = "waiting / next seed in 45s"; }
    catch (e) { if (e.message === "Request paused.") state.seed--; $("crawler-status").textContent = state.paused ? "crawler paused" : "reader unavailable / next seed in 45s"; }
    finally { state.crawlBusy = false; state.controller = null; }
  }
  $("ca-form").addEventListener("submit", e => { e.preventDefault(); trackToken($("ca-input").value).catch(() => {}); });
  $("focus-ca").addEventListener("click", () => { $("ca-input").scrollIntoView({ block: "center" }); $("ca-input").focus({ preventScroll: true }); });
  $("movers-body").addEventListener("click", e => { const button = e.target.closest("[data-track]"); if (button) { $("ca-input").scrollIntoView({ block: "center" }); trackToken(button.dataset.track).catch(() => {}); } });
  $("token-detail").addEventListener("click", async e => { if (e.target.id !== "copy-ca") return; try { await navigator.clipboard.writeText($("ca-input").value); e.target.textContent = "copied"; setTimeout(() => { if (e.target.isConnected) e.target.textContent = "copy CA"; }, 2000); } catch { status("ca-message", "Select the address in the field and copy it manually."); } });
  $("sort-movers").addEventListener("change", renderMovers); $("refresh-movers").addEventListener("click", loadMovers);
  $("web-form").addEventListener("submit", e => { e.preventDefault(); explore($("web-input").value).catch(() => {}); });
  document.querySelectorAll("[data-query]").forEach(b => b.addEventListener("click", () => explore(b.dataset.query).catch(() => {})));
  $("web-results").addEventListener("click", e => { const button = e.target.closest("[data-read]"); if (button) explore(button.dataset.read).catch(() => {}); });
  $("library-list").addEventListener("click", e => { const button = e.target.closest("[data-page]"); if (button) openPage(state.pages[Number(button.dataset.page)]); });
  $("pause-crawl").addEventListener("click", () => {
    state.paused = !state.paused; if (state.paused) state.controller?.abort();
    kraken?.setMode(state.paused ? "paused" : "idle");
    $("pause-crawl").textContent = state.paused ? "resume crawler" : "pause crawler"; $("kraken-state").textContent = state.paused ? "paused" : "awake"; $("footer-state").textContent = state.paused ? "crawler paused" : "awake"; $("crawler-status").textContent = state.paused ? "crawler paused / manual exploration available" : "crawler resumed";
    log("CRAWL", state.paused ? "Automatic crawler paused." : "Automatic crawler resumed."); if (!state.paused) crawl();
  });
  $("manual-open").addEventListener("click", () => $("manual").showModal());
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => $(b.dataset.close).close()));
  document.querySelectorAll("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) { const rect = d.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) d.close(); } }));
  $("download-page").addEventListener("click", () => { const p = state.readerPage; if (!p) return; const url = URL.createObjectURL(new Blob([p.title + "\n" + p.url + "\n\n" + p.text], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "krakencode-" + host(p.url).replace(/[^a-z0-9.-]/gi, "") + ".txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  document.querySelectorAll("nav a").forEach(a => a.addEventListener("click", () => { document.querySelectorAll("nav a").forEach(x => x.classList.toggle("active", x === a)); }));
  const tick = () => { $("clock").textContent = new Date().toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }; tick(); setInterval(tick, 1000);
  renderLibrary(); log("BOOT", "KrakenCode awake. Connecting to public data sources.");
  if (state.pages[0]) kraken?.setPage(state.pages[0]);
  const cached = storage.get("movers", null); if (cached && Array.isArray(cached.pairs)) { state.pairs = cached.pairs; renderMovers(); $("movers-meta").textContent = "Cached data / reconnecting"; }
  loadMovers(); const initialCa = window.KRAKENCODE_CONFIG?.contractAddress || storage.get("ca", ""); if (initialCa) trackToken(initialCa).catch(() => {});
  setTimeout(crawl, 1800); setInterval(crawl, 45000); setInterval(() => { if (!document.hidden) loadMovers(); }, 60000);
  // Expose the same two visitor actions when the browser supports WebMCP.
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController(); window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
    const tools = [
      { name: "track_solana_token", title: "Track Solana token", description: "Look up a Solana CA, update the visible token panel, and save this CA in this browser.", inputSchema: { type: "object", properties: { contractAddress: { type: "string" } }, required: ["contractAddress"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: input => trackToken(input?.contractAddress) },
      { name: "explore_public_web", title: "Explore public web", description: "Search public webpages or read a public HTTPS URL; update results and locally save any page read. Queries and URLs go to public services.", inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 500 } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: input => explore(input?.query) }
    ];
    for (const tool of tools) { try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {} }
  }
})();
