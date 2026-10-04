"use strict";
(() => {
  const known = value => value != null && Number.isFinite(Number(value));
  const money = value => known(value) ? "$" + Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "unavailable";
  const pct = value => known(value) ? (Number(value) >= 0 ? "+" : "") + Number(value).toFixed(2) + "%" : "unavailable";
  const clean = text => String(text || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ").replace(/^[#>*\s-]+/gm, "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  const stop = new Set("this that with from have will your they their about into also more what when where which there these those were been page token kraken code solana https would should could after before through other some only does than then them each such very just both like read give tell please information website document summary feedback".split(" "));
  function words(text) { return clean(text).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)?.filter(w => !stop.has(w)) || []; }
  function documentFeedback(text, query = "") {
    const content = clean(text), tokens = words(content), counts = new Map();
    tokens.forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
    const topics = [...counts].sort((a,b) => b[1] - a[1]).slice(0,6).map(x => x[0]);
    const sentences = content.match(/[^.!?]+(?:[.!?](?=\s|$)|$)/g)?.map(s => s.trim()).filter(s => s.length >= 45 && s.length <= 700) || [];
    const terms = words(query);
    const scored = sentences.map((sentence, i) => ({sentence, i, score: words(sentence).reduce((n,w) => n + (terms.length ? terms.includes(w) ? 8 : 0 : topics.includes(w) ? Math.log(1 + counts.get(w)) : 0),0) / Math.sqrt(sentence.length)}));
    const best = scored.filter(s => !terms.length || s.score > 0).sort((a,b) => b.score - a.score).slice(0,3).sort((a,b) => a.i-b.i).map(s => s.sentence);
    const excerpts = best.length ? best : [content.slice(0,500) || "No readable content supplied."];
    const checks = [];
    if (/\b(guaranteed|risk.free|100x|1000x|get rich|no risk)\b/i.test(content)) checks.push("Promotional return or certainty language appears in this text. The wording alone does not substantiate the claim.");
    if (/\b(seed phrase|private key|recovery phrase)\b/i.test(content)) checks.push("This text mentions wallet secrets. Never share a private key or recovery phrase.");
    const links = [...new Set(String(text).match(/https?:\/\/[^\s)<>\]"']+/g) || [])].slice(0,5);
    checks.push(`${content.split(/\s+/).filter(Boolean).length.toLocaleString()} readable words; ${links.length}${links.length === 5 ? "+" : ""} source links found.`);
    if (content.length < 250) checks.push("Short source: there is limited context for a useful assessment.");
    return { title: terms.length ? "Relevant source excerpts" : "Text feedback", summary: excerpts.join("\n\n"), details: [`Topics: ${topics.join(", ") || "insufficient text"}.`, ...checks], links, note: "Extractive summary and rule-based checks of this source only. Claims are not independently verified." };
  }
  function tokenFeedback(p, history = [], at = Date.now()) {
    if (!p) return {title:"Token not indexed",summary:"No DEX pair is available yet. A missing chart does not establish whether a token is safe or unsafe.",details:["Check the contract address and open the original pump.fun page for its launch and bonding-curve information."],note:"No trading data available for assessment."};
    const b = p.txns?.h24?.buys, s = p.txns?.h24?.sells, liq = p.liquidity?.usd, cap = p.marketCap;
    const details = [
      `Momentum: 5m ${pct(p.priceChange?.m5)} · 1h ${pct(p.priceChange?.h1)} · 6h ${pct(p.priceChange?.h6)} · 24h ${pct(p.priceChange?.h24)}.`,
      `Activity: 24h volume ${money(p.volume?.h24)}; ${known(b) ? b.toLocaleString() : "unknown"} buys / ${known(s) ? s.toLocaleString() : "unknown"} sells. These are transaction counts, not unique traders.`,
      `Liquidity: ${money(liq)} · market cap: ${money(cap)}${!known(cap) && known(p.fdv) ? " · FDV: " + money(p.fdv) : ""}.`
    ];
    if (known(liq) && liq < 10000) details.push("Liquidity is below $10,000 in this pair. Thin liquidity can make execution and price movement unstable.");
    if (known(liq) && known(cap) && cap > 0) details.push(`Pool liquidity is ${(liq/cap*100).toFixed(2)}% of reported market cap; this is a descriptive ratio, not a safety score.`);
    if (known(p.priceChange?.h24) && Math.abs(p.priceChange.h24) >= 50) details.push("The reported 24h move exceeds 50%. Large moves indicate high price volatility.");
    if (p.pairCreatedAt) details.push(`Pair created ${new Date(p.pairCreatedAt).toLocaleString()}; this may differ from the token launch time.`);
    if (history.length > 1) {
      const first = history[0], last = history[history.length-1];
      details.push(`Observed in this browser: ${pct(first.price > 0 ? (last.price/first.price-1)*100 : null)} over ${Math.max(1,Math.round((last.at-first.at)/1000))} seconds (${history.length} live samples).`);
    } else details.push("The observation chart starts at your first lookup. Historical candles are displayed by the external chart provider when available.");
    details.push("Holder concentration, mint/freeze authority, contract audits and manipulation are not evaluated by this feed.");
    return {title:`${p.baseToken.symbol} / market feedback`,summary:`${p.baseToken.name} is trading at ${known(p.priceUsd) ? "$" + Number(p.priceUsd).toLocaleString("en-US",{maximumSignificantDigits:6}) : "an unavailable price"} on ${p.dexId}. Reported 24h change: ${pct(p.priceChange?.h24)}.`,details,note:`DEX Screener snapshot · ${new Date(at).toLocaleTimeString()} · Automated descriptive checks, not a buy/sell recommendation.`};
  }
  function observationChart(history) {
    if (!history.length) return '<p class="hint">Waiting for a live price sample.</p>';
    const values = history.map(p => p.price), lo = Math.min(...values), hi = Math.max(...values), range = hi-lo || Math.max(hi*.001,1e-12);
    const start = history[0].at, end = history[history.length-1].at;
    const points = history.map((p,i) => `${(20+(end>start ? (p.at-start)/(end-start) : .5)*560).toFixed(1)},${(92-(p.price-lo)/range*68).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 600 116" role="img" aria-label="Observed token price samples since opening this browser session"><path d="M20 24H580M20 58H580M20 92H580" stroke="#24414a" fill="none"/><polyline points="${points}" fill="none" stroke="#7bf4e0" stroke-width="2"/><circle cx="${points.split(" ").at(-1).split(",")[0]}" cy="${points.split(" ").at(-1).split(",")[1]}" r="3" fill="#c27fff"/></svg><p class="hint">${history.length} observed sample${history.length===1?"":"s"} · ${new Date(start).toLocaleTimeString()} → ${new Date(end).toLocaleTimeString()} · live samples, not historical candles</p>`;
  }
  window.KrakenFeedback = {document:documentFeedback,token:tokenFeedback,chart:observationChart};
})();
