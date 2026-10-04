"use strict";
(() => {
  // The creature is articulated every frame, rather than moving a still image.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scenes = [];
  let motionPaused = reduced.matches;
  let mode = "idle", page = null, lines = [], offset = 0, lastAdvance = 0, pulseUntil = 0;
  const $ = id => document.getElementById(id);
  const chars = "01{}<>/;∑λ";
  const wrap = text => String(text || "").split(/\n/).flatMap(line => {
    if (!line.trim()) return [""];
    const pieces = []; let value = line.trim();
    while (value.length > 66) { let at = value.lastIndexOf(" ", 66); if (at < 20) at = 66; pieces.push(value.slice(0, at)); value = value.slice(at).trimStart(); }
    pieces.push(value); return pieces;
  }).slice(0, 1600);
  function renderDocument() {
    const el = $("live-document"); if (!el || !lines.length) return;
    const fragment = document.createDocumentFragment();
    lines.slice(offset, offset + 24).forEach((line, i) => {
      const row = document.createElement("div"); row.className = "doc-line";
      const number = document.createElement("span"); number.className = "line-number"; number.textContent = String(offset + i + 1).padStart(3, "0");
      const content = document.createElement("span"); content.className = "line-text"; content.textContent = line || " ";
      row.append(number, content); fragment.append(row);
    });
    el.replaceChildren(fragment);
    scenes.forEach(s => { s.scanTick = -1; });
  }
  function setMode(next) {
    mode = next;
    scenes.forEach(s => { s.host.dataset.mode = next; });
    const labels = { idle: page ? "swimming / scanning collected text" : "swimming / awaiting page", searching: "searching / eyes: purple pulse", reading: "reading / tentacles scanning", collected: "page collected / eyes: red + purple", error: "request blocked / eyes: red alert", paused: "crawler paused / swimming" };
    if ($("live-scan-status")) $("live-scan-status").textContent = labels[next] || next;
    if (next === "collected" || next === "error") pulseUntil = performance.now() + 6000;
  }
  function setPage(value) {
    if (!value?.text) return;
    page = value; lines = wrap(value.text); offset = 0; lastAdvance = performance.now();
    $("live-doc-title").textContent = value.title || "Retrieved document";
    const source = $("live-doc-source");
    try { const url = new URL(value.url); source.href = url.protocol === "https:" ? url.href : "#"; source.hidden = url.protocol !== "https:"; } catch { source.hidden = true; }
    renderDocument(); setMode("collected");
  }
  function beginRead(url) {
    lines = wrap(`GET ${url}\n\nRetrieving the public document…\n\nThe page text will appear when the request completes.`);
    offset = 0; renderDocument();
    $("live-doc-title").textContent = "retrieving / " + new URL(url).hostname;
    $("live-doc-source").href = url; $("live-doc-source").hidden = false;
    setMode("reading");
  }
  function setSearch(query, results) {
    const text = results?.length ? results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}\n`).join("\n") : `Searching public webpages for:\n${query}\n\nWaiting for search results…`;
    lines = wrap(text); offset = 0; lastAdvance = performance.now();
    $("live-doc-title").textContent = "search / " + query; $("live-doc-source").hidden = true;
    renderDocument(); setMode(results?.length ? "collected" : "searching");
  }
  class Scene {
    constructor(host) {
      this.host = host; this.canvas = host.querySelector("canvas"); this.ctx = this.canvas.getContext("2d");
      this.width = 0; this.height = 0; this.visible = false; this.targets = []; this.tips = []; this.clock = 0; this.last = 0; this.pointer = null; this.scanTick = -1;
      this.resize = new ResizeObserver(() => this.size()); this.resize.observe(host);
      this.intersection = new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; }); this.intersection.observe(host);
      host.addEventListener("pointermove", e => { const r = host.getBoundingClientRect(); this.pointer = {x:e.clientX-r.left,y:e.clientY-r.top}; });
      host.addEventListener("pointerleave", () => { this.pointer = null; });
      this.size();
    }
    size() {
      const rect = this.host.getBoundingClientRect(); this.width = rect.width; this.height = rect.height;
      if (!this.width || !this.height) return;
      const dpr = Math.min(devicePixelRatio || 1, 1.6);
      this.canvas.width = Math.round(this.width * dpr); this.canvas.height = Math.round(this.height * dpr); this.ctx.setTransform(dpr,0,0,dpr,0,0);
      this.tips = []; this.scanTick = -1;
    }
    getTargets(t) {
      const step = Math.floor(t * .7);
      if (this.scanTick === step) return;
      this.scanTick = step;
      const rect = this.host.getBoundingClientRect();
      if (this.host.id === "kraken-ocean") {
        const rows = [...$("live-document").querySelectorAll(".doc-line")]; rows.forEach(r => r.classList.remove("scanned"));
        const visible = rows.filter(r => { const b = r.getBoundingClientRect(); return b.top >= rect.top + 48 && b.bottom <= rect.bottom - 46; });
        this.targets = Array.from({length:8}, (_, i) => {
          if (!visible.length) return null;
          const row = visible[(step + i * 3) % visible.length]; const b = row.getBoundingClientRect();
          row.classList.add("scanned");
          const content = row.querySelector(".line-text");
          const x = Math.min(this.width - 28, Math.max(30, b.left - rect.left + 52 + Math.min(content.textContent.length * 7, this.width - 100) * ((i % 3 + 1) / 3)));
          return {x, y:b.top-rect.top+b.height*.55, line:row.querySelector(".line-number").textContent};
        });
      } else {
        const scroll = this.host.querySelector(".reader-scroll");
        this.targets = Array.from({length:8}, (_, i) => ({x:28 + ((i * 83 + step * 29) % Math.max(1, this.width - 58)),y:60 + ((i * 53 + step * 22) % Math.max(1, this.height - 110)),line:String(Math.floor(scroll.scrollTop/26) + i*2+1).padStart(3,"0")}));
      }
    }
    draw(now) {
      if (!this.ctx || !this.visible || !this.width || !this.height) { this.last = now; return; }
      const dt = Math.min((now - (this.last || now)) / 1000, .05); this.last = now;
      if (!motionPaused) this.clock += dt;
      const t = this.clock, ctx = this.ctx, w = this.width, h = this.height;
      ctx.clearRect(0,0,w,h); this.getTargets(t);
      const scale = Math.min(w / 600, h / 500, 1.25);
      const active = mode === "reading" || mode === "searching";
      const x = w * (.5 + .18 * Math.sin(t * .25));
      const y = h * (.47 + .13 * Math.sin(t * .36 + 1.2));
      this.canvas.dataset.position = `${Math.round(x)},${Math.round(y)}`; this.canvas.dataset.phase = mode;
      this.canvas.dataset.frame = String(Math.floor(t * 30));
      // Floating particles stay in the same watery coordinate space as the page.
      for (let i=0;i<22;i++) {
        const bx=(i*73.7 + Math.sin(t*.22+i)*12)%w, by=(h-((t*11+i*41.3)%h));
        ctx.strokeStyle=`rgba(137,157,222,${.07 + (i%3)*.035})`; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(bx,by,1.5+(i%4),0,Math.PI*2); ctx.stroke();
      }
      const bodyR = 59*scale;
      // Eight independently curling, articulated arms. Their tips follow text rows.
      for(let arm=0;arm<8;arm++) {
        const angle = Math.PI*.14 + arm / 7 * Math.PI*.72;
        const root={x:x+Math.cos(angle)*bodyR*.65,y:y+Math.sin(angle)*bodyR*.53};
        const fallback={x:x+Math.cos((arm/8)*Math.PI*2+t*.10)*bodyR*2.8,y:y+Math.sin((arm/8)*Math.PI*2+t*.10)*bodyR*2.4};
        const target=this.targets[arm] || fallback;
        const tip=this.tips[arm] ||= {...fallback};
        const lerp=motionPaused ? 0 : 1-Math.exp(-dt*1.8);
        tip.x+=(target.x-tip.x)*lerp; tip.y+=(target.y-tip.y)*lerp;
        const dx=tip.x-root.x, dy=tip.y-root.y, length=Math.hypot(dx,dy), side=arm%2 ? 1:-1;
        const bend=(45+25*Math.sin(t*.8+arm))*scale*side;
        const c1={x:root.x+dx*.22+Math.cos(angle)*bodyR*.9,y:root.y+bodyR*.9};
        const c2={x:root.x+dx*.68-dy/(length||1)*bend,y:root.y+dy*.65+dx/(length||1)*bend};
        const points=[];
        for(let j=0;j<=34;j++) {
          const u=j/34, v=1-u;
          const wave=Math.sin(u*9-t*(active ? 2.8:1.8)+arm*1.1)*Math.sin(u*Math.PI)*16*scale;
          points.push({x:v*v*v*root.x+3*v*v*u*c1.x+3*v*u*u*c2.x+u*u*u*tip.x-dy/(length||1)*wave,y:v*v*v*root.y+3*v*v*u*c1.y+3*v*u*u*c2.y+u*u*u*tip.y+dx/(length||1)*wave,u});
        }
        // Glow silhouette, dark core, segmented teal/purple circuitry and suckers.
        ctx.beginPath(); points.forEach((p,j)=>j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
        ctx.lineWidth=10*scale; ctx.strokeStyle=arm%2?"#9856d16b":"#46d6d37d";ctx.shadowColor=arm%2?"#b26cff":"#5becd9";ctx.shadowBlur=11*scale;ctx.lineCap="round";ctx.stroke();ctx.shadowBlur=0;
        for(let j=1;j<points.length;j++) {
          const p=points[j], prev=points[j-1], thick=(17*Math.pow(1-p.u,1.2)+2)*scale;
          ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(p.x,p.y);ctx.lineWidth=thick;
          ctx.strokeStyle=`rgba(${arm%2?"37,36,64":"12,49,58"},.96)`;ctx.stroke();
          ctx.lineWidth=Math.max(1,thick*.15);ctx.strokeStyle=arm%2?"#c393efb0":"#85f4e0cc";ctx.stroke();
          if(j%3===0 && j>4) {
            const a=Math.atan2(p.y-prev.y,p.x-prev.x), nx=-Math.sin(a),ny=Math.cos(a);
            ctx.beginPath();ctx.ellipse(p.x+nx*thick*.32,p.y+ny*thick*.32,Math.max(1.2,thick*.25),Math.max(.8,thick*.13),a,0,Math.PI*2);
            ctx.strokeStyle="#ca9fffbb";ctx.lineWidth=.8;ctx.stroke();
          }
          if(j%7===0){ctx.fillStyle="#b6ffeea0";ctx.font=`${Math.max(8,9*scale)}px monospace`;ctx.fillText(chars[(arm+j)%chars.length],p.x+3,p.y-3);}
        }
        if(this.targets[arm]) {
          const radius=(5+Math.sin(t*3+arm)*2)*scale;
          ctx.beginPath();ctx.arc(tip.x,tip.y,Math.max(2,radius),0,Math.PI*2);ctx.strokeStyle="#cb8dff99";ctx.lineWidth=1;ctx.stroke();
          if(arm===1 || arm===5){ctx.font="10px monospace";ctx.fillStyle="#debaffb0";ctx.fillText("READ:"+target.line,Math.min(w-75,tip.x+9),tip.y-9);}
        }
      }
      // A translucent three-dimensional code mantle, with latitude mesh and glyphs.
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(t*.35)*.12);
      const rx=bodyR*.78,ry=bodyR;
      const gradient=ctx.createRadialGradient(-rx*.3,-ry*.35,2,0,0,ry*1.3);
      gradient.addColorStop(0,"#2c616edd");gradient.addColorStop(.6,"#17333ff5");gradient.addColorStop(1,"#170f2fe6");
      ctx.beginPath();ctx.ellipse(0,-bodyR*.35,rx,ry,0,0,Math.PI*2);ctx.fillStyle=gradient;ctx.shadowBlur=16*scale;ctx.shadowColor="#8875e6";ctx.fill();ctx.strokeStyle="#8ae4e3bc";ctx.lineWidth=1.3;ctx.stroke();ctx.shadowBlur=0;
      ctx.save();ctx.clip();
      for(let row=-7;row<=7;row++) {
        const yy=row*ry/8-bodyR*.35;const radius=rx*Math.sqrt(Math.max(0,1-(row/8)**2));
        ctx.beginPath();ctx.ellipse(0,yy,radius,7*scale,0,0,Math.PI*2);ctx.strokeStyle=row%2?"#b696e340":"#91eceb40";ctx.lineWidth=.7;ctx.stroke();
        for(let col=-4;col<=4;col++) {
          const xx=col*rx/5;if(Math.abs(xx)>radius-3)continue;
          ctx.fillStyle=(row+col)%3?"#9befdd81":"#d8a8ffb0";ctx.font=`${Math.max(7,9*scale)}px monospace`;
          ctx.fillText(chars[Math.abs(row*3+col+Math.floor(t*.8))%chars.length],xx,yy);
        }
      }
      for(let i=-3;i<=3;i++){ctx.beginPath();ctx.ellipse(i*rx*.12,-bodyR*.35,rx*.18+Math.abs(i)*rx*.13,ry,0,0,Math.PI*2);ctx.strokeStyle="#92e1de33";ctx.stroke();}
      ctx.restore();
      // Eye colors and brightness react to the request lifecycle, not a random timer.
      const pulse=.8+Math.sin(t*(active?5:2))*.2, boosted=now<pulseUntil;
      const focus=this.pointer || this.tips[1] || {x:x+20,y:y+20};
      for(let eye=0;eye<2;eye++) {
        const ex=(eye?1:-1)*rx*.48,ey=bodyR*.01;
        const red=mode==="error" || eye===0 && mode!=="searching";
        const color=red?"#ff285f":"#bb49ff";
        ctx.beginPath();ctx.ellipse(ex,ey,11*scale,14*scale,(eye?1:-1)*-.2,0,Math.PI*2);ctx.fillStyle="#050813";ctx.fill();
        const glow=ctx.createRadialGradient(ex,ey,0,ex,ey,24*scale);glow.addColorStop(0,color);glow.addColorStop(.3,color+"dd");glow.addColorStop(1,color+"00");
        ctx.fillStyle=glow;ctx.globalAlpha=(boosted?1:.85)*pulse;ctx.beginPath();ctx.arc(ex,ey,24*scale,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
        ctx.shadowBlur=(boosted?25:18)*scale;ctx.shadowColor=color;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(ex,ey,8*scale,10*scale,0,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
        const direction=Math.atan2(focus.y-y,focus.x-x);
        ctx.fillStyle="#0b0010";ctx.beginPath();ctx.ellipse(ex+Math.cos(direction)*2*scale,ey+Math.sin(direction)*2*scale,2.4*scale,7*scale,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#ffe6ff";ctx.beginPath();ctx.arc(ex-2*scale,ey-4*scale,1.5*scale,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
  }
  document.querySelectorAll(".kraken-stage").forEach(host=>scenes.push(new Scene(host)));
  function updateMotionButton(){const button=$("motion-toggle");if(button){button.textContent=motionPaused?"resume motion":"pause motion";button.setAttribute("aria-pressed",String(motionPaused));}}
  $("motion-toggle")?.addEventListener("click",()=>{motionPaused=!motionPaused;updateMotionButton();});
  reduced.addEventListener("change",e=>{motionPaused=e.matches;updateMotionButton();});updateMotionButton();
  let lastFrame=0;
  function animate(now) {
    requestAnimationFrame(animate);
    if(document.hidden || now-lastFrame<33)return;lastFrame=now;
    if(!motionPaused && lines.length>24 && now-lastAdvance>11000){offset=(offset+5)%Math.max(1,lines.length-16);renderDocument();lastAdvance=now;scenes.forEach(s=>s.scanTick=-1);}
    scenes.forEach(s=>s.draw(now));
  }
  requestAnimationFrame(animate);
  window.KrakenLive={setMode,setPage,setSearch,beginRead};setMode("idle");
})();
