"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const kraken = window.KrakenLive;
  const insights = window.KrakenFeedback;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const storage = { get(key, fallback) { try { return JSON.parse(localStorage.getItem("krakencode:" + key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem("krakencode:" + key, JSON.stringify(value)); } catch { log("STORE", "Browser storage is full or unavailable; this session still works.", true); } } };
  const state = { pairs: [], pages: storage.get("pages", []), logs: [], paused: false, crawlBusy: false, webBusy: false, moversBusy: false, caBusy: false, seed: 0, readerPage: null, token: null, controller: null, selectedCa: "", active: null, histories: new Map(), pasted: [], chatBusy: false, manualUntil: 0, step: 0, moverIndex: 0, pageIndex: 0, pasteIndex: 0, discoveryAt: 0, moversAt: 0 };
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
    let ca = String(value || "").trim();
    if (/^https?:\/\//i.test(ca)) {
      const u = new URL(publicUrl(ca));
      if (!/^(www\.)?pump\.fun$/.test(u.hostname)) throw new Error("Paste a Solana CA or a pump.fun token URL.");
      ca = u.pathname.match(/^\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/)?.[1] || "";
    }
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
  function manualPriority() { state.manualUntil = Date.now() + 35000; state.controller?.abort(); }
  function feedbackHtml(f) {
    return `<h3>${escape(f.title)}</h3><p class="feedback-summary">${escape(f.summary)}</p><ul>${f.details.map(d => `<li>${escape(d)}</li>`).join("")}</ul>${f.links?.length ? `<div class="feedback-links">${f.links.map((link,i) => safeLink(link) ? `<a href="${escape(safeLink(link))}" target="_blank" rel="noopener noreferrer">source ${i+1} ↗</a>` : "").join(" ")}</div>` : ""}<p class="hint">${escape(f.note)}</p>`;
  }
  function feedbackText(f) { return [f.summary, ...f.details, f.note].join("\n\n"); }
  function viewSource(enabled) {
    const pumpView = state.active?.kind === "token" && state.active.sourceMode === "pump";
    const destination = pumpView ? safeLink(state.active.page.url) : state.active?.embed;
    const can = !!destination;
    enabled = enabled && can;
    if (enabled && $("live-source-frame").getAttribute("src") !== destination) $("live-source-frame").src = destination;
    $("kraken-ocean").classList.toggle("show-source", enabled);
    $("live-source-frame").hidden = !enabled;
    $("live-document").hidden = enabled;
    $("view-source").setAttribute("aria-pressed", String(enabled && !pumpView));
    $("view-pump").setAttribute("aria-pressed",String(enabled && pumpView));
    $("view-text").setAttribute("aria-pressed", String(!enabled));
  }
  function showWorkspace(page, {kind = "page", embed = "", feedback, sourceView = false, ca = ""} = {}) {
    const sourceMode = kind === "token" && state.active?.ca === ca ? state.active.sourceMode : "chart";
    state.active = {page, kind, embed, feedback: feedback || insights.document(page.text), ca, sourceMode};
    kraken?.setPage(page);
    $("feedback-content").innerHTML = feedbackHtml(state.active.feedback);
    $("monitor-task").textContent = page.title;
    $("view-source").disabled = !embed;
    $("view-pump").hidden = kind !== "token";
    const link = safeLink(page.url); $("source-external").hidden = !link; $("source-external").href = link || "#";
    const frame = $("live-source-frame");
    const destination = kind === "token" && sourceMode === "pump" ? safeLink(page.url) : embed;
    if (frame.getAttribute("src") !== (destination || "about:blank")) frame.src = "about:blank";
    frame.title = kind === "token" ? sourceMode === "pump" ? "Original pump.fun token page" : "Live token chart from DEX Screener" : "Original public webpage";
    $("source-note").textContent = kind === "token" ? "Live chart from DEX Screener; feedback reads indexed price, volume and liquidity. If the embed is blocked, use scanned text or open original. It does not analyze chart pixels." : embed ? "Original site preview. Some sites block embeds: use scanned text or open original. Feedback is based on retrieved text." : "Pasted text is scanned locally in this session.";
    if (kind === "token" && sourceMode === "pump") $("source-note").textContent = "Original pump.fun preview. If it blocks embedding, use scanned text, the live chart or open original. Feedback uses indexed market data.";
    viewSource(sourceView);
  }
  function recordPrice(p, at = Date.now()) {
    if (!p?.baseToken?.address || !(Number(p.priceUsd) > 0)) return;
    const ca = p.baseToken.address, history = state.histories.get(ca) || [];
    if (!history.length || at-history.at(-1).at >= 10000) history.push({price:Number(p.priceUsd),at});
    state.histories.delete(ca); state.histories.set(ca, history.slice(-120));
    if (state.histories.size > 100) state.histories.delete(state.histories.keys().next().value);
  }
  function tokenPage(p, ca, at = Date.now()) {
    const f = insights.token(p, state.histories.get(ca) || [], at);
    return {url:"https://pump.fun/coin/" + ca, title:p ? `${p.baseToken.name} (${p.baseToken.symbol})` : "Unindexed token / " + ca.slice(0,8), text:`CA: ${ca}\nData source: DEX Screener\nSnapshot: ${new Date(at).toLocaleString()}\n\n${feedbackText(f)}\n\n${p?.info?.websites?.map(w => w.url).join("\n") || "No project website in the indexed metadata."}`,words:0,at};
  }
  function scanToken(p, ca, {sourceView = true, at = Date.now()} = {}) {
    at = p?._observedAt || at;
    const f = insights.token(p, state.histories.get(ca) || [], at);
    const embed = p?.pairAddress ? `https://dexscreener.com/solana/${encodeURIComponent(p.pairAddress)}?embed=1&theme=dark&chartTheme=dark&trades=0&info=0` : "";
    const page = tokenPage(p,ca,at);
    showWorkspace(page, {kind:"token",ca,embed,feedback:f,sourceView});
    $("feedback-content").insertAdjacentHTML("beforeend", `<div class="observation-chart">${insights.chart(state.histories.get(ca) || [])}</div>`);
    return f;
  }
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
      let candidates, detailed = [], partial = false;
      const discover = !state.pairs.length || Date.now()-state.discoveryAt >= 60000;
      if (discover) {
      candidates = await Promise.allSettled([json("/token-profiles/latest/v1"), json("/token-boosts/top/v1"), json("/latest/dex/search?q=pumpfun"), json("/latest/dex/search?q=pumpswap")]);
      const direct = candidates.slice(2).flatMap(r => r.status === "fulfilled" ? r.value.pairs || [] : []);
      const profiles = candidates.slice(0, 2).flatMap(r => r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
      const addresses = [...new Set(profiles.filter(p => p.chainId === "solana" && /pump$/i.test(p.tokenAddress)).map(p => p.tokenAddress))].slice(0, 30);
      partial = candidates.some(r => r.status === "rejected");
      if (addresses.length) { try { detailed = await json("/tokens/v1/solana/" + addresses.join(",")); } catch { partial = true; } }
      const pairs = dedupePairs([...direct, ...(Array.isArray(detailed) ? detailed : [])].filter(pumpPair));
      if (!pairs.length && candidates.every(r => r.status === "rejected")) throw candidates[0].reason;
      state.pairs = pairs.map(p => ({...p,_observedAt:Date.now()})); renderMovers();
      state.discoveryAt = Date.now();
      } else {
        const addresses = [...new Set(state.pairs.map(p => p.baseToken.address))].slice(0,90);
        const batches = []; for (let i=0;i<addresses.length;i+=30) batches.push(json("/tokens/v1/solana/" + addresses.slice(i,i+30).join(",")));
        const refreshed = await Promise.allSettled(batches);
        if (refreshed.every(r => r.status === "rejected")) throw refreshed[0].reason;
        const fresh = dedupePairs(refreshed.flatMap(r => r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []).filter(pumpPair)).map(p => ({...p,_observedAt:Date.now()}));
        partial = refreshed.some(r => r.status === "rejected");
        // Keep failed batches visible, but mark the feed as partial rather than pretending they refreshed.
        state.pairs = partial ? dedupePairs([...fresh,...state.pairs.filter(p => !fresh.some(f => f.baseToken.address === p.baseToken.address))]) : fresh;
        renderMovers();
      }
      state.moversAt = Date.now(); state.pairs.forEach(p => recordPrice(p,p._observedAt || state.moversAt));
      if (!state.webBusy && !state.caBusy && !state.chatBusy && state.active?.kind === "token" && state.active.ca !== state.selectedCa) {
        const current = state.pairs.find(p => p.baseToken.address === state.active.ca);
        if (current) scanToken(current,state.active.ca,{at:state.moversAt,sourceView:$("kraken-ocean").classList.contains("show-source")});
      }
      const pairs = state.pairs;
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
  async function trackToken(raw, {refresh = false, show = true} = {}) {
    if (state.caBusy) throw new Error("A token lookup is already running.");
    let ca; try { ca = validCa(raw); } catch (e) { status("ca-message", e.message, "error"); throw e; }
    if (!refresh) {manualPriority();state.caEditing=false;}
    state.caBusy = true; if (!refresh) $("ca-input").value = ca; const button = $("ca-form").querySelector("button"); button.disabled = true;
    if (!refresh) {status("ca-message", "Looking up indexed Solana pairs…"); kraken?.setMode("reading");}
    try {
      const result = await json("/token-pairs/v1/solana/" + ca);
      const pairs = (Array.isArray(result) ? result : []).filter(p => p.baseToken?.address === ca);
      pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0) || Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0));
      const p = pairs[0]; state.token = p || null; state.selectedCa = ca; storage.set("ca", ca); const at = Date.now(); if (p) p._observedAt=at; recordPrice(p,at);
      const pump = "https://pump.fun/coin/" + ca;
      const dex = safeLink(p?.url) || "https://dexscreener.com/solana/" + ca;
      $("token-detail").innerHTML = `<h3>${p ? escape(p.baseToken.name) + " <span>(" + escape(p.baseToken.symbol) + ")</span>" : "CA saved · waiting for an indexed pair"}</h3>${p ? `<div class="token-metrics"><span>price <b>${escape(price(p.priceUsd))}</b></span><span>mcap <b>${escape(usd(p.marketCap))}</b></span><span>24h <b class="${Number(p.priceChange?.h24) >= 0 ? "positive" : "negative"}">${escape(change(p.priceChange?.h24))}</b></span><span>volume <b>${escape(usd(p.volume?.h24))}</b></span><span>liquidity <b>${escape(usd(p.liquidity?.usd))}</b></span></div>` : ""}<a href="${escape(pump)}" target="_blank" rel="noopener noreferrer">open on pump.fun</a><a href="${escape(dex)}" target="_blank" rel="noopener noreferrer">DEX Screener</a><button id="copy-ca">copy CA</button><button id="rescan-token">view scan</button>`;
      $("token-detail").hidden = false;
      if (!refresh || !state.caEditing) status("ca-message", p ? `${pairs.length} indexed pair${pairs.length === 1 ? "" : "s"} · ${p.dexId} · updated ${new Date(at).toLocaleTimeString()} · refresh / 15s` : "No indexed pair yet. Retrying every 15s while visible. Open pump.fun for the original launch page.", p ? "success" : "");
      if (show) scanToken(p,ca,{at,sourceView:!refresh || $("kraken-ocean").classList.contains("show-source")});
      log("TOKEN", `${p?.baseToken.symbol || ca.slice(0, 8)} · ${pairs.length} indexed pairs.`);
      return { contractAddress: ca, indexed: !!p, symbol: p?.baseToken.symbol || null, priceUsd: p?.priceUsd || null, feedback:feedbackText(insights.token(p,state.histories.get(ca) || [],at)) };
    } catch (e) { status("ca-message", e.message, "error"); log("ERROR", "Token lookup: " + e.message, true); throw e; }
    finally { state.caBusy = false; button.disabled = false; $("kraken-state").textContent = state.paused ? "paused" : "awake"; }
  }
  function renderLibrary() {
    const pages = state.pages;
    $("pages-stat").textContent = fmt(pages.length); $("words-stat").textContent = fmt(pages.reduce((sum, p) => sum + (p.words || 0), 0));
    $("domains-stat").textContent = new Set(pages.map(p => host(p.url))).size + " domains"; $("library-count").textContent = pages.length + " saved";
    $("library-list").innerHTML = pages.length ? pages.map((p, i) => `<article class="page-card"><h3 title="${escape(p.title)}">${escape(p.title)}</h3><p>${escape(host(p.url))} · ${escape(fmt(p.words))} words · ${escape(new Date(p.at).toLocaleDateString())}</p><button data-page="${i}">read page</button></article>`).join("") : '<p class="empty">Your collected pages will appear here.</p>';
  }
  function openPage(page) {
    state.readerPage = page; $("reader-title").textContent = page.title; $("reader-source").href = safeLink(page.url); $("reader-content").textContent = page.text;
    manualPriority(); showWorkspace(page,{embed:safeLink(page.url)});
    $("reader-feedback").innerHTML = feedbackHtml(insights.document(page.text));
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
      showWorkspace(page,{embed:url});
      if (show) openPage(page);
      return { url, title, words: page.words, feedback:feedbackText(insights.document(page.text)) };
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
    if (results.length) showWorkspace({title:"Search / " + q,url:"https://duckduckgo.com/?q=" + encodeURIComponent(q),text:results.map(r => r.title + "\n" + r.snippet + "\n" + r.url).join("\n\n")},{kind:"search"});
    const fallback = "https://duckduckgo.com/?q=" + encodeURIComponent(q);
    $("web-results").innerHTML = results.map(r => `<article class="search-result"><a href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">${escape(r.title)}</a><p>${escape(r.snippet)}</p><div class="result-bottom"><span>${escape(host(r.url))}</span><button data-read="${escape(r.url)}">read page</button></div></article>`).join("") + `<p class="hint"><a href="${escape(fallback)}" target="_blank" rel="noopener noreferrer">${results.length ? "Open full search on DuckDuckGo" : "Search unavailable here. Open DuckDuckGo to search directly."}</a></p>`;
    if (!results.length) { log("SEARCH", "No readable search results returned. Direct search link available.", true); return { query: q, results: [], fallback }; }
    log("FOUND", `${results.length} webpages for “${q}”.`);
    return { query: q, results };
  }
  async function explore(raw, {show = true} = {}) {
    if (state.webBusy) throw new Error("An exploration request is already running.");
    const query = String(raw || "").trim(); if (!query) throw new Error("Enter a search phrase or public HTTPS URL.");
    manualPriority(); state.webBusy = true; $("web-submit").disabled = true; $("web-input").value = query;
    // Stop an automatic request so the visitor's own request gets priority.
    state.controller?.abort();
    const isUrl = /^https?:\/\//i.test(query);
    status("web-status", isUrl ? "Reading public page…" : "Searching the web…");
    try {
      const result = isUrl ? await readPage(query,{show}) : await searchWeb(query);
      status("web-status", isUrl ? `${fmt(result.words)} words collected. Page saved below.` : result.results.length ? `${result.results.length} results · choose a page to read` : "Search service returned no results. Use the direct search link below.", "success");
      return result;
    } catch (e) { status("web-status", e.message, "error"); kraken?.setMode("error"); if (isUrl) { const link = safeLink(query); $("web-results").innerHTML = link ? `<p class="hint"><a href="${escape(link)}" target="_blank" rel="noopener noreferrer">Open original page</a></p>` : ""; } throw e; }
    finally { state.webBusy = false; $("web-submit").disabled = false; }
  }
  async function crawl() {
    if (state.paused || state.crawlBusy || state.webBusy || state.caBusy || state.chatBusy || document.hidden || $("reader").open || Date.now()<state.manualUntil) return;
    state.crawlBusy = true; state.controller = new AbortController();
    const slot = state.step++ % 3;
    try {
      if (slot === 0 || slot === 2 && !state.pasted.length) {
        const ranked = rankedMovers();
        const p = ranked[state.moverIndex++ % (ranked.length || 1)];
        if (p) {
          const label = "mover / " + p.baseToken.symbol;
          $("crawler-status").textContent = label; $("cycle-status").textContent = label + " · next scan / 20s";
          scanToken(p,p.baseToken.address,{at:state.moversAt || Date.now()});
          log("SCAN", "Automatic mover feedback: " + p.baseToken.symbol);
        } else if (state.selectedCa) scanToken(state.token,state.selectedCa);
        else $("cycle-status").textContent = "Waiting for market data · next scan / 20s";
      } else if (slot === 1) {
        const urls = [...new Set([...state.pages.map(p => p.url),...seeds])];
        const url = urls[state.pageIndex++ % urls.length];
        $("crawler-status").textContent = "page / " + host(url); $("cycle-status").textContent = "page / " + host(url) + " · scanning";
        const cached = state.pages.find(p => p.url === url && Date.now()-p.at < 300000);
        if (cached) {showWorkspace(cached,{embed:url});log("SCAN", "Collected page: " + host(url));}
        else await readPage(url,{show:false,signal:state.controller.signal});
        $("cycle-status").textContent = "page / " + host(url) + " · next scan / 20s";
      } else {
        const page = state.pasted[state.pasteIndex++ % state.pasted.length];
        showWorkspace(page,{kind:"paste"});
        $("cycle-status").textContent = "pasted text / " + page.title + " · next scan / 20s";
        $("crawler-status").textContent = "pasted text / scanning"; log("SCAN", "Pasted text reviewed locally.");
      }
    } catch (e) { $("crawler-status").textContent = state.paused ? "cycle paused" : "reader unavailable / retry on next rotation"; log("CYCLE",e.message,e.message!=="Request paused."); }
    finally {state.crawlBusy = false;state.controller = null;}
  }
  function rankedMovers() {
    const field = $("sort-movers").value;
    const value = p => field === "volume" ? Number(p.volume?.h24 || 0) : field === "marketCap" ? Number(p.marketCap ?? p.fdv ?? 0) : Number(p.priceChange?.[field] ?? -Infinity);
    return [...state.pairs].sort((a,b) => value(b)-value(a)).slice(0,10);
  }
  function chatMessage(role, text) {
    const article = document.createElement("article"); article.className = "chat-message " + role;
    const author = document.createElement("b"); author.textContent = role === "visitor" ? "YOU" : "KRAKEN_01";
    const content = document.createElement("p"); content.textContent = text;
    article.append(author,content); $("chat-messages").append(article);
    while ($("chat-messages").children.length > 30) $("chat-messages").firstElementChild.remove();
    $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
  }
  async function chat(raw) {
    const message = String(raw || "").trim();
    if (!message || message.length > 20000) throw new Error("Paste a message of 1–20,000 characters.");
    if (state.chatBusy || state.caBusy || state.webBusy) throw new Error("A request is running. Wait for it to finish, then send again.");
    manualPriority(); state.chatBusy = true; $("chat-submit").disabled = true; status("chat-status","Reading your message…");
    chatMessage("visitor",message); $("chat-input").value = "";
    try {
      let reply;
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(message) || /^https:\/\/(www\.)?pump\.fun\/(coin\/)?[1-9A-HJ-NP-Za-km-z]{32,44}\/?(?:\?.*)?$/.test(message)) {
        const result = await trackToken(message); reply = result.feedback;
      } else if (/^https:\/\/\S+$/i.test(message)) {
        const result = await explore(message,{show:false}); reply = result.feedback;
      } else if (/^(search|find)\s+/i.test(message)) {
        const result = await explore(message.replace(/^(search|find)\s+/i,""),{show:false});
        reply = result.results.map((r,i) => `${i+1}. ${r.title}\n${r.snippet}\n${r.url}`).join("\n\n") || "No search results returned. Try a direct public URL.";
      } else {
        const asksContext = message.length < 300 && /^(summari[sz]e|summary|risks?|what|why|how|tell|explain|show|analy[sz]e|feedback|compare|is\b|are\b|does\b)/i.test(message);
        let page, f;
        if (asksContext && state.active) {
          page = state.active.page;
          f = state.active.kind === "token" ? state.active.feedback : insights.document(page.text,/^(summari[sz]e|summary|risks?|feedback)\b/i.test(message) ? "" : message);
          reply = `Source: ${page.title}\n\n${feedbackText(f)}`;
        } else {
          page = {title:"Pasted text / " + new Date().toLocaleTimeString(),url:"",text:message,at:Date.now(),words:message.split(/\s+/).length};
          state.pasted.unshift(page);state.pasted = state.pasted.slice(0,10);
          f = insights.document(message); showWorkspace(page,{kind:"paste",feedback:f});
          reply = feedbackText(f);log("CHAT",`${page.words} pasted words read locally.`);
        }
        if (asksContext && !state.active) reply += "\n\nPaste the source text, CA or URL first so I can answer from it.";
        if (asksContext && page && state.active?.kind !== "token") $("feedback-content").innerHTML = feedbackHtml(f);
      }
      chatMessage("kraken",reply); status("chat-status","Read complete · included in the scan session.","success");
      return {reply};
    } catch (e) {chatMessage("kraken",e.message);status("chat-status",e.message,"error");kraken?.setMode("error");throw e;}
    finally {state.chatBusy = false;$("chat-submit").disabled = false;state.manualUntil = Date.now()+35000;}
  }
  $("ca-form").addEventListener("submit", e => { e.preventDefault(); trackToken($("ca-input").value).catch(() => {}); });
  $("ca-input").addEventListener("input", () => {state.caEditing=true;status("ca-message","Editing address · click scan token to look up this CA.");});
  $("view-source").addEventListener("click", () => {manualPriority();if(state.active)state.active.sourceMode="chart";viewSource(true);});
  $("view-pump").addEventListener("click", () => {manualPriority();if(!state.active)return;state.active.sourceMode="pump";$("live-source-frame").title="Original pump.fun token page";viewSource(true);$("source-note").textContent="Original pump.fun preview. If it blocks embedding, use scanned text, the live chart or open original. Feedback uses indexed market data.";});
  $("view-text").addEventListener("click", () => {manualPriority();viewSource(false);});
  $("live-source-frame").addEventListener("error", () => {viewSource(false);$("source-note").textContent = "The source embed could not load. Scanned text is available; open the original in a new tab.";});
  $("reader-live").addEventListener("click", () => {const page=state.readerPage;if(!page)return;$("reader").close();manualPriority();showWorkspace(page,{embed:safeLink(page.url),sourceView:true});$("live").scrollIntoView({block:"start"});});
  $("chat-form").addEventListener("submit", e => {e.preventDefault();chat($("chat-input").value).catch(e => status("chat-status",e.message,"error"));});
  $("focus-ca").addEventListener("click", () => { $("ca-input").scrollIntoView({ block: "center" }); $("ca-input").focus({ preventScroll: true }); });
  $("movers-body").addEventListener("click", e => { const button = e.target.closest("[data-track]"); if (button) { $("ca-input").scrollIntoView({ block: "center" }); trackToken(button.dataset.track).catch(() => {}); } });
  $("token-detail").addEventListener("click", async e => { if (e.target.id === "rescan-token") {manualPriority();scanToken(state.token,state.selectedCa);$("live").scrollIntoView({block:"start"});return;} if (e.target.id !== "copy-ca") return; try { await navigator.clipboard.writeText(state.selectedCa); e.target.textContent = "copied"; setTimeout(() => { if (e.target.isConnected) e.target.textContent = "copy CA"; }, 2000); } catch { status("ca-message", "Select the address in the field and copy it manually."); } });
  $("sort-movers").addEventListener("change", renderMovers); $("refresh-movers").addEventListener("click", loadMovers);
  $("web-form").addEventListener("submit", e => { e.preventDefault(); explore($("web-input").value).catch(() => {}); });
  document.querySelectorAll("[data-query]").forEach(b => b.addEventListener("click", () => explore(b.dataset.query).catch(() => {})));
  $("web-results").addEventListener("click", e => { const button = e.target.closest("[data-read]"); if (button) explore(button.dataset.read).catch(() => {}); });
  $("library-list").addEventListener("click", e => { const button = e.target.closest("[data-page]"); if (button) openPage(state.pages[Number(button.dataset.page)]); });
  $("pause-crawl").addEventListener("click", () => {
    state.paused = !state.paused; if (state.paused) state.controller?.abort();
    kraken?.setMode(state.paused ? "paused" : "idle");
    $("pause-crawl").textContent = state.paused ? "resume cycle" : "pause cycle"; $("pause-crawl").setAttribute("aria-pressed",String(state.paused)); $("kraken-state").textContent = state.paused ? "paused" : "awake"; $("footer-state").textContent = state.paused ? "cycle paused" : "awake"; $("crawler-status").textContent = state.paused ? "cycle paused / manual exploration available" : "cycle resumed"; $("cycle-status").textContent = state.paused ? "paused · manual scans still available" : "automatic cycle resumed";
    log("CYCLE", state.paused ? "Automatic scan cycle paused." : "Automatic scan cycle resumed."); if (!state.paused) {state.manualUntil=0;crawl();}
  });
  $("manual-open").addEventListener("click", () => $("manual").showModal());
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => $(b.dataset.close).close()));
  document.querySelectorAll("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) { const rect = d.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) d.close(); } }));
  $("download-page").addEventListener("click", () => { const p = state.readerPage; if (!p) return; const url = URL.createObjectURL(new Blob([p.title + "\n" + p.url + "\n\n" + p.text], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "krakencode-" + host(p.url).replace(/[^a-z0-9.-]/gi, "") + ".txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  document.querySelectorAll("nav a").forEach(a => a.addEventListener("click", () => { document.querySelectorAll("nav a").forEach(x => x.classList.toggle("active", x === a)); }));
  const tick = () => { $("clock").textContent = new Date().toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }; tick(); setInterval(tick, 1000);
  renderLibrary(); log("BOOT", "KrakenCode awake. Connecting to public data sources.");
  if (state.pages[0]) showWorkspace(state.pages[0],{embed:safeLink(state.pages[0].url)});
  const cached = storage.get("movers", null); if (cached && Array.isArray(cached.pairs)) { state.pairs = cached.pairs; renderMovers(); $("movers-meta").textContent = "Cached data / reconnecting"; }
  const projectCa = window.KRAKENCODE_CONFIG?.contractAddress || "";
  if (projectCa) {try {$("project-ca").textContent=validCa(projectCa);$("copy-project-ca").hidden=false;} catch {$("project-ca").textContent="Project CA is not configured correctly.";}}
  $("copy-project-ca").addEventListener("click",async () => {try {await navigator.clipboard.writeText(projectCa);$("copy-project-ca").textContent="copied";setTimeout(() => $("copy-project-ca").textContent="copy",2000);}catch {$("copy-project-ca").textContent="select CA to copy";}});
  loadMovers(); const initialCa = projectCa || storage.get("ca", ""); if (initialCa) trackToken(initialCa).catch(() => {});
  let nextMarketAt = Date.now()+15000;
  setTimeout(crawl,1800); setInterval(crawl,20000);
  setInterval(() => {
    if (Date.now() >= nextMarketAt) {
      nextMarketAt = Date.now()+15000;
      if (!document.hidden) {
        loadMovers();
        if (state.selectedCa && !state.caBusy && !state.chatBusy && !state.webBusy) trackToken(state.selectedCa,{refresh:true,show:state.active?.kind==="token" && state.active.ca===state.selectedCa}).catch(() => {});
      }
    }
    $("refresh-countdown").textContent = document.hidden ? "paused / tab hidden" : "refresh / " + Math.max(1,Math.ceil((nextMarketAt-Date.now())/1000)) + "s";
    if (!state.paused && Date.now()<state.manualUntil) $("cycle-status").textContent="your scan · cycle resumes in " + Math.ceil((state.manualUntil-Date.now())/1000)+"s";
  },1000);
  // Expose the same two visitor actions when the browser supports WebMCP.
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController(); window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
    const tools = [
      { name: "track_solana_token", title: "Track Solana token", description: "Look up a Solana CA, update the visible token panel, and save this CA in this browser.", inputSchema: { type: "object", properties: { contractAddress: { type: "string" } }, required: ["contractAddress"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: input => trackToken(input?.contractAddress) },
      { name: "explore_public_web", title: "Explore public web", description: "Search public webpages or read a public HTTPS URL with extractive feedback; update results and locally save any page read. Queries and URLs go to public services.", inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 500 } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: input => explore(input?.query) },
      { name: "chat_with_kraken", title:"Chat with the Kraken reader",description:"Analyze pasted text locally or retrieve a public URL or token CA and return automated source excerpts or market feedback. Updates the on-screen chat and scan. URLs and CAs go to public services.",inputSchema:{type:"object",properties:{message:{type:"string",maxLength:20000}},required:["message"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:input=>chat(input?.message)}
    ];
    for (const tool of tools) { try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {} }
  }
})();
