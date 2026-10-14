
'use strict';

/* ---------- PART A: DATA AND APP ---------- */
const TY = { em: 'Emergency', icu: 'ICU', vent: 'Ventilator', oxy: 'Oxygen bed' };
const HS = [
  { id: 'sms',    name: 'SMS Hospital',             area: 'JLN Marg',      lat: 26.9050, lng: 75.8170 },
  { id: 'metro',  name: 'Metro Mass Hospital',      area: 'Jaipur',        lat: 26.8810, lng: 75.7730 },
  { id: 'ruhs',   name: 'RUHS Hospital',            area: 'Pratap Nagar',  lat: 26.7990, lng: 75.8300 },
  { id: 'fortis', name: 'Fortis Escorts Hospital',  area: 'Malviya Nagar', lat: 26.8553, lng: 75.8083 },
  { id: 'nara',   name: 'Narayana Multispeciality', area: 'Pratap Nagar',  lat: 26.7890, lng: 75.8240 },
  { id: 'eter',   name: 'Eternal Hospital',         area: 'Jagatpura',     lat: 26.8293, lng: 75.8644 }
];
const LOCS = [
  ['Jaipur Junction', 26.9197, 75.7871], ['Sindhi Camp', 26.9215, 75.7995], ['Vaishali Nagar', 26.9124, 75.7273],
  ['Mansarovar', 26.8467, 75.7653], ['Jhotwara', 26.9470, 75.7440], ['Jagatpura', 26.8280, 75.8560]
];
const KEY = 'careroute-demo-v1';
const STALE = 30;                      // minutes before a hospital's data is flagged
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HAS_IO = 'IntersectionObserver' in window;

let S, tab = 'hospital', hid = 'sms', draft = null, loc = 0, bt = 'em', lastTok = null, qcode = '';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = (id) => HS.find((h) => h.id === id);

function seed() {
  const t = Date.now();
  const m = (a, b, c, d, mi) => ({ em: a, icu: b, vent: c, oxy: d, upd: t - mi * 6e4 });
  return {
    off: 0, seq: 4820,
    h: { sms: m(7, 4, 2, 9, 2), metro: m(2, 1, 1, 3, 9), ruhs: m(0, 0, 0, 0, 14), fortis: m(5, 3, 2, 6, 4), nara: m(4, 2, 1, 5, 41), eter: m(3, 0, 1, 4, 6) },
    t: []
  };
}
function load() { try { const r = localStorage.getItem(KEY); S = r ? JSON.parse(r) : seed(); } catch (e) { S = seed(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }

const now = () => Date.now() + S.off;
const mins = (t) => Math.max(0, Math.floor((now() - t) / 6e4));
const ago = (t) => { const m = mins(t); return m < 1 ? 'just now' : m + ' min ago'; };

/* straight-line distance x 1.35 road factor, in km */
function dk(a, b, c, d) {
  const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const q = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(q)) * 1.35;
}
const etaMin = (km) => Math.max(1, Math.round(km / 40 * 60));   // ambulance at ~40 km/h

/* tokens that run past 30 minutes expire and release their bed */
function sweep() {
  let ch = false;
  S.t.forEach((k) => {
    if ((k.s === 'pending' || k.s === 'confirmed') && k.ex < now()) { k.s = 'expired'; S.h[k.hid][k.ty]++; ch = true; }
  });
  if (ch) save();
  return ch;
}

/* ----- hospital view ----- */
function vHosp() {
  const h = S.h[hid];
  if (!draft || draft.id !== hid || !draft.dirty) draft = { id: hid, dirty: false, em: h.em, icu: h.icu, vent: h.vent, oxy: h.oxy };
  const inc = S.t.filter((k) => k.hid === hid && (k.s === 'pending' || k.s === 'confirmed'));
  const opts = HS.map((d) => `<option value="${d.id}"${d.id === hid ? ' selected' : ''}>${d.name} – ${d.area}</option>`).join('');
  const stale = mins(h.upd) > STALE;
  return `<div class="card reveal-in"><h3>Update beds</h3>
    <label class="mu" for="hsel">Your hospital</label>
    <select id="hsel">${opts}</select>
    ${Object.keys(TY).map((k) => `<div class="row"><span>${TY[k]}</span><div class="ctr">
      <button class="sq" type="button" aria-label="Fewer ${TY[k]}" data-a="dec" data-v="${k}">−</button><b>${draft[k]}</b>
      <button class="sq" type="button" aria-label="More ${TY[k]}" data-a="inc" data-v="${k}">+</button></div></div>`).join('')}
    <div class="acts" style="align-items:center"><button class="btn" type="button" data-a="upd">Update now</button>
      <span class="mu">Last updated ${ago(h.upd)} ${stale ? '<span class="chip y">STALE</span>' : ''}${draft.dirty ? ' · <b>unsaved changes</b>' : ''}</span></div></div>
  <div class="card"><h3>Incoming tokens (${inc.length})</h3>
    ${inc.length ? inc.map((k) => `<div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div><b class="tok" style="font-size:1.15rem">${k.c}</b> <span class="chip ${k.s === 'confirmed' ? 'g' : 'y'}">${k.s === 'confirmed' ? 'CONFIRMED' : 'AWAITING'}</span>${k.rq ? ' <span class="chip b">PATIENT ASKED TO RECONFIRM</span>' : ''}
        <div class="mu">${TY[k.ty]} · ambulance ETA ${k.eta} min · expires in ${Math.max(0, Math.ceil((k.ex - now()) / 6e4))} min</div></div>
      <div class="acts" style="margin:0">
        ${k.s === 'pending' ? `<button class="btn btn-sm" type="button" data-a="t" data-v="ok:${k.c}">Confirm</button>` : (k.rq ? `<button class="btn btn-sm" type="button" data-a="t" data-v="cf:${k.c}">Reconfirm</button>` : '')}
        ${k.s === 'confirmed' ? `<button class="btn btn-sm btn-ghost" type="button" data-a="t" data-v="adm:${k.c}">Patient admitted</button>` : ''}
        <button class="btn btn-sm btn-danger" type="button" data-a="t" data-v="no:${k.c}">Decline</button></div></div>`).join('')
      : '<p class="mu">No active tokens yet. Pre-book a bed from the Ambulance driver tab.</p>'}</div>`;
}

/* ----- driver view ----- */
function vDriver() {
  const rows = HS.map((d) => ({ d, h: S.h[d.id], km: dk(LOCS[loc][1], LOCS[loc][2], d.lat, d.lng) }))
    .sort((a, b) => ((a.h[bt] < 1) - (b.h[bt] < 1)) || a.km - b.km);
  const lt = lastTok && S.t.find((k) => k.c === lastTok);
  return `<div class="card reveal-in"><h3>Where are you, and what do you need?</h3>
    <label class="mu" for="lsel">Pickup location</label>
    <select id="lsel">${LOCS.map((l, i) => `<option value="${i}"${i === loc ? ' selected' : ''}>${l[0]}</option>`).join('')}</select>
    <div class="mu" style="margin-top:12px">Bed needed</div>
    <div class="types">${Object.keys(TY).map((k) => `<button class="pill${k === bt ? ' on' : ''}" type="button" data-a="bt" data-v="${k}">${TY[k]}</button>`).join('')}</div></div>
  ${lt ? `<div class="card" style="border-color:var(--green)"><span class="chip g">TOKEN GENERATED</span><div class="tok">${lt.c}</div>
    <div class="mu">${D(lt.hid).name} · ${TY[lt.ty]} · valid 30 min · status: ${lt.s}</div>
    <div class="acts"><button class="btn btn-sm btn-ghost" type="button" data-a="open" data-v="${lt.c}">View as patient family</button></div></div>` : ''}
  <div class="card"><h3>Nearest hospitals with ${TY[bt].toLowerCase()}</h3>
  ${rows.map(({ d, h, km }) => {
    const n = h[bt], full = n < 1, st = mins(h.upd) > STALE;
    return `<div class="row hc${full ? ' full' : ''}"><div><b>${d.name}</b>
      <div class="mu">${km.toFixed(1)} km | ${etaMin(km)} min · ${d.area}</div>
      <div class="mu">Updated ${ago(h.upd)} ${st && !full ? '<span class="chip y">STALE – call to verify</span>' : ''}</div>
      ${full ? '' : `<div class="acts"><a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${LOCS[loc][1]},${LOCS[loc][2]}&destination=${d.lat},${d.lng}&travelmode=driving">Navigate</a>
      <button class="btn btn-sm" type="button" data-a="book" data-v="${d.id}">Pre-book</button></div>`}</div>
      <span class="chip ${full ? 'r' : n < 3 ? 'y' : 'g'}">${full ? 'FULL' : n + ' beds'}</span></div>`;
  }).join('')}</div>`;
}

/* ----- patient view ----- */
function pres() {
  const q = qcode.trim().toUpperCase();
  if (!q) return '<p class="mu">Enter the token the ambulance driver gave you. Try the one from the Ambulance driver tab.</p>';
  const k = S.t.find((x) => x.c === q);
  if (!k) return `<span class="chip r">NOT FOUND</span> <span class="mu">No token "${esc(q)}". Check the code and try again.</span>`;
  const L = { pending: ['y', 'AWAITING HOSPITAL CONFIRMATION'], confirmed: ['g', 'CONFIRMED'], declined: ['r', 'DECLINED – ask the driver to choose another hospital'], expired: ['r', 'EXPIRED'], admitted: ['b', 'ADMITTED'] }[k.s];
  const live = k.s === 'pending' || k.s === 'confirmed', left = Math.max(0, Math.ceil((k.ex - now()) / 6e4)), d = D(k.hid);
  return `<div class="tok">${k.c}</div><div style="margin:8px 0"><span class="chip ${L[0]}">${L[1]}</span></div>
    <div><b>${d.name}</b>, ${d.area}</div>
    <div class="mu">${TY[k.ty]} bed · ambulance ETA at booking: ${k.eta} min${live ? ` · token valid for ${left} more min` : ''}</div>
    <div class="mu">Hospital last confirmed: ${k.cf ? ago(k.cf) : 'not yet'}</div>
    ${live ? `<div class="acts"><button class="btn" type="button" data-a="rq" data-v="${k.c}"${k.rq ? ' disabled' : ''}>${k.rq ? 'Reconfirm requested' : 'Reconfirm with hospital'}</button></div>` : ''}`;
}
function vPat() {
  return `<div class="card reveal-in"><h3>Check your token</h3>
    <div style="display:flex;gap:8px"><input id="qin" placeholder="CR-4821" aria-label="Token code" value="${esc(qcode)}" autocomplete="off">
    <button class="btn" type="button" data-a="chk">Check</button></div>
    <div id="pres" style="margin-top:16px">${pres()}</div></div>`;
}

function render() {
  sweep();
  document.querySelectorAll('.app-tab').forEach((b) => {
    const on = b.dataset.v === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  $('#main').innerHTML = tab === 'hospital' ? vHosp() : tab === 'driver' ? vDriver() : vPat();
  board();
}

/* ----- actions ----- */
function book(id) {
  const h = S.h[id]; if (h[bt] < 1) return;
  h[bt]--;
  const d = D(id), km = dk(LOCS[loc][1], LOCS[loc][2], d.lat, d.lng);
  S.seq++;
  S.t.unshift({ c: 'CR-' + S.seq, hid: id, ty: bt, eta: etaMin(km), s: 'pending', cr: now(), ex: now() + 30 * 6e4, cf: null, rq: false });
  lastTok = 'CR-' + S.seq; save(); render();
}
function tact(v) {
  const [a, c] = v.split(':'), k = S.t.find((x) => x.c === c); if (!k) return;
  if (a === 'ok' || a === 'cf') { k.s = 'confirmed'; k.cf = now(); k.rq = false; }
  else if (a === 'no') { k.s = 'declined'; S.h[k.hid][k.ty]++; }
  else if (a === 'adm') { k.s = 'admitted'; }
  save(); render();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = b.dataset.v;
  if (a === 'tab') { tab = v; render(); }
  else if (a === 'inc' || a === 'dec') { draft[v] = Math.max(0, Math.min(99, draft[v] + (a === 'inc' ? 1 : -1))); draft.dirty = true; render(); }
  else if (a === 'upd') { S.h[hid] = { em: draft.em, icu: draft.icu, vent: draft.vent, oxy: draft.oxy, upd: now() }; draft = null; save(); render(); }
  else if (a === 't') tact(v);
  else if (a === 'bt') { bt = v; render(); }
  else if (a === 'book') book(v);
  else if (a === 'open') { qcode = v; tab = 'patient'; render(); }
  else if (a === 'chk') { qcode = $('#qin').value; $('#pres').innerHTML = pres(); }
  else if (a === 'rq') { const k = S.t.find((x) => x.c === v); if (k) { k.rq = true; save(); $('#pres').innerHTML = pres(); } }
  else if (a === 'ff') { S.off += 20 * 6e4; save(); render(); }
  else if (a === 'reset') { S = seed(); lastTok = null; qcode = ''; draft = null; save(); render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'hsel') { hid = e.target.value; draft = null; render(); }
  if (e.target.id === 'lsel') { loc = +e.target.value; render(); }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'qin' && e.key === 'Enter') { qcode = e.target.value; $('#pres').innerHTML = pres(); }
});
/* keep two open browser tabs in sync */
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  load();
  if (document.activeElement.tagName === 'INPUT') { board(); return; }
  if (tab === 'patient') { $('#pres').innerHTML = pres(); board(); } else render();
});
setInterval(() => {
  const ae = document.activeElement.tagName;
  if (ae === 'SELECT' || ae === 'INPUT') return;
  if (tab === 'patient') { sweep(); $('#pres').innerHTML = pres(); board(); } else render();
}, 20000);

/* ---------- PART B: HERO BED BOARD ---------- */
let boardFirst = true;
const prevBoard = {};

function countTo(el, from, to, dur, delay) {
  if (RM) { el.textContent = to; return; }
  const t0 = performance.now() + (delay || 0);
  (function frame(t) {
    const k = Math.min(1, Math.max(0, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(frame);
  })(performance.now());
}

function board() {
  const el = $('#board'); if (!el) return;
  const rows = HS.map((d) => ({ d, h: S.h[d.id], km: dk(LOCS[0][1], LOCS[0][2], d.lat, d.lng) }))
    .sort((a, b) => ((a.h.em < 1) - (b.h.em < 1)) || a.km - b.km);
  el.innerHTML = rows.map(({ d, h, km }, i) => {
    const n = h.em, full = n < 1;
    return `<li class="b-row${full ? ' is-full' : n < 3 ? ' is-low' : ''}" style="--i:${i}">
      <div class="b-name"><strong>${d.name}</strong><span>${km.toFixed(1)} km · ${etaMin(km)} min</span></div>
      <div class="b-n">${full ? '<b>FULL</b>' : `<b data-n="${n}">${n}</b><small>beds</small>`}</div></li>`;
  }).join('');
  rows.forEach(({ d, h }, i) => {
    if (prevBoard[d.id] !== undefined && prevBoard[d.id] !== h.em) el.children[i].classList.add('tick');
    prevBoard[d.id] = h.em;
  });
  if (boardFirst) {                       // one orchestrated page-load moment
    boardFirst = false;
    el.classList.add('enter');
    el.querySelectorAll('b[data-n]').forEach((b, i) => countTo(b, 0, +b.dataset.n, 900, 250 + i * 110));
    setTimeout(() => el.classList.remove('enter'), 2400);
  }
}

/* ---------- PART C: SCROLL EFFECTS ---------- */
let route = null;

function measureRoute() {
  const r = $('#route'); if (!r) return;
  const nodes = r.querySelectorAll('.step-node'), line = r.querySelector('.route-line');
  const centers = [...nodes].map((n) => n.offsetTop + n.offsetHeight / 2);
  const top = centers[0], h = centers[centers.length - 1] - top;
  line.style.top = top + 'px'; line.style.height = h + 'px';
  route = { top, h, centers };
}

function updateRoute() {
  if (!route) return;
  const r = $('#route'), probe = innerHeight * 0.55 - r.getBoundingClientRect().top;   // reading line inside the route
  const p = Math.min(1, Math.max(0, (probe - route.top) / route.h));
  r.style.setProperty('--p', p.toFixed(4));
  r.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('on', probe >= route.centers[i]));
}

function initScroll() {
  document.documentElement.classList.remove('no-js');

  /* reveal on scroll */
  const reveals = document.querySelectorAll('[data-reveal]');
  if (RM || !HAS_IO) reveals.forEach((e) => e.classList.add('in'));
  else {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach((e) => io.observe(e));
  }

  /* count-up numbers */
  document.querySelectorAll('[data-count]').forEach((el) => {
    const to = +el.dataset.count, from = +(el.dataset.from || 0);
    if (RM || !HAS_IO) { el.textContent = to; return; }
    el.textContent = from;
    const io = new IntersectionObserver((en) => {
      if (en[0].isIntersecting) { countTo(el, from, to, 1400, 150); io.disconnect(); }
    }, { threshold: 0.6 });
    io.observe(el);
  });

  /* scroll-driven: progress bar, header, active link, route */
  const links = [...document.querySelectorAll('.nav a[href^="#"]:not(.btn)')];
  const secs = links.map((a) => document.querySelector(a.getAttribute('href')));
  const bar = $('.progress span'), header = $('.site-header');
  let queued = false;

  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
      header.classList.toggle('scrolled', scrollY > 8);
      let cur = '';
      secs.forEach((s) => { if (s && s.getBoundingClientRect().top <= innerHeight * 0.35) cur = s.id; });
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
      updateRoute();
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measureRoute(); onScroll(); });
  addEventListener('load', () => { measureRoute(); onScroll(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measureRoute(); onScroll(); });
  measureRoute(); onScroll();

  /* mobile menu */
  const mb = $('.menu-btn'), nav = $('#nav');
  mb.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    mb.setAttribute('aria-expanded', open);
    mb.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) { nav.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); }
  });
}

/* ---------- START ---------- */
load();
render();
initScroll();


























// // CareRoute prototype logic: hospital, driver and patient views
// const TY={em:'Emergency',icu:'ICU',vent:'Ventilator',oxy:'Oxygen bed'};
// const HS=[
//  {id:'sms',name:'SMS Hospital',area:'JLN Marg',lat:26.9050,lng:75.8170},
//  {id:'metro',name:'Metro Mass Hospital',area:'Jaipur',lat:26.8810,lng:75.7730},
//  {id:'ruhs',name:'RUHS Hospital',area:'Pratap Nagar',lat:26.7990,lng:75.8300},
//  {id:'fortis',name:'Fortis Escorts Hospital',area:'Malviya Nagar',lat:26.8553,lng:75.8083},
//  {id:'nara',name:'Narayana Multispeciality',area:'Pratap Nagar',lat:26.7890,lng:75.8240},
//  {id:'eter',name:'Eternal Hospital',area:'Jagatpura',lat:26.8293,lng:75.8644}
// ];
// const LOCS=[['Jaipur Junction',26.9197,75.7871],['Sindhi Camp',26.9215,75.7995],['Vaishali Nagar',26.9124,75.7273],['Mansarovar',26.8467,75.7653],['Jhotwara',26.9470,75.7440],['Jagatpura',26.8280,75.8560]];
// const KEY='careroute-demo-v1', STALE=30;
// let S, tab='hospital', hid='sms', draft=null, loc=0, bt='em', lastTok=null, qcode='';
// const $=s=>document.querySelector(s);
// const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// const D=id=>HS.find(h=>h.id===id);
// function seed(){const t=Date.now(),m=(a,b,c,d,mi)=>({em:a,icu:b,vent:c,oxy:d,upd:t-mi*6e4});
//  return {off:0,seq:4820,h:{sms:m(7,4,2,9,2),metro:m(2,1,1,3,9),ruhs:m(0,0,0,0,14),fortis:m(5,3,2,6,4),nara:m(4,2,1,5,41),eter:m(3,0,1,4,6)},t:[]}}
// function load(){try{const r=localStorage.getItem(KEY);S=r?JSON.parse(r):seed()}catch(e){S=seed()}}
// function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
// const now=()=>Date.now()+S.off;
// const mins=t=>Math.max(0,Math.floor((now()-t)/6e4));
// const ago=t=>{const m=mins(t);return m<1?'just now':m+' min ago'};
// function dk(a,b,c,d){const r=Math.PI/180,x=(c-a)*r,y=(d-b)*r,q=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 12742*Math.asin(Math.sqrt(q))*1.35}
// function sweep(){let ch=false;S.t.forEach(k=>{if((k.s==='pending'||k.s==='confirmed')&&k.ex<now()){k.s='expired';S.h[k.hid][k.ty]++;ch=true}});if(ch)save();return ch}

// function vHosp(){
//  const h=S.h[hid];
//  if(!draft||draft.id!==hid||!draft.dirty)draft={id:hid,dirty:false,em:h.em,icu:h.icu,vent:h.vent,oxy:h.oxy};
//  const inc=S.t.filter(k=>k.hid===hid&&(k.s==='pending'||k.s==='confirmed'));
//  const opts=HS.map(d=>`<option value="${d.id}"${d.id===hid?' selected':''}>${d.name} – ${d.area}</option>`).join('');
//  const stale=mins(h.upd)>STALE;
//  return `<div class="card"><h2>Hospital staff portal</h2>
//   <select id="hsel">${opts}</select>
//   ${Object.keys(TY).map(k=>`<div class="row"><span>${TY[k]}</span><div class="ctr"><button class="sq" data-a="dec" data-v="${k}">−</button><b>${draft[k]}</b><button class="sq" data-a="inc" data-v="${k}">+</button></div></div>`).join('')}
//   <div class="acts"><button class="btn" data-a="upd">Update now</button>
//   <span class="mu" style="align-self:center">Last updated ${ago(h.upd)} ${stale?'<span class="chip y">STALE</span>':''}${draft.dirty?' · <b>unsaved changes</b>':''}</span></div></div>
//  <div class="card"><h2>Incoming pre-booked tokens (${inc.length})</h2>
//   ${inc.length?inc.map(k=>`<div class="row" style="align-items:flex-start"><div><b class="tok" style="font-size:18px">${k.c}</b> <span class="chip ${k.s==='confirmed'?'g':'y'}">${k.s==='confirmed'?'CONFIRMED':'AWAITING'}</span>${k.rq?' <span class="chip b">PATIENT ASKED TO RECONFIRM</span>':''}<div class="mu">${TY[k.ty]} · ambulance ETA ${k.eta} min · expires in ${Math.max(0,Math.ceil((k.ex-now())/6e4))} min</div></div>
//    <div class="acts" style="margin:0;justify-content:flex-end">${k.s==='pending'?`<button class="btn" data-a="t" data-v="ok:${k.c}">Confirm</button>`:k.rq?`<button class="btn" data-a="t" data-v="cf:${k.c}">Reconfirm</button>`:''}${k.s==='confirmed'?`<button class="btn o" data-a="t" data-v="adm:${k.c}">Patient admitted</button>`:''}<button class="btn d" data-a="t" data-v="no:${k.c}">Decline</button></div></div>`).join(''):'<div class="mu">No active tokens. Pre-book a bed from the Driver tab.</div>'}</div>`;
// }

// function vDriver(){
//  const rows=HS.map(d=>({d,h:S.h[d.id],km:dk(LOCS[loc][1],LOCS[loc][2],d.lat,d.lng)})).sort((a,b)=>((a.h[bt]<1)-(b.h[bt]<1))||a.km-b.km);
//  const lt=lastTok&&S.t.find(k=>k.c===lastTok);
//  return `<div class="card"><h2>Ambulance driver app</h2>
//   <div class="mu">Pickup location</div><select id="lsel">${LOCS.map((l,i)=>`<option value="${i}"${i===loc?' selected':''}>${l[0]}</option>`).join('')}</select>
//   <div class="mu" style="margin-top:10px">Bed needed</div>
//   <div class="types">${Object.keys(TY).map(k=>`<button class="pill${k===bt?' on':''}" data-a="bt" data-v="${k}">${TY[k]}</button>`).join('')}</div></div>
//  ${lt?`<div class="card" style="border-color:var(--ac)"><span class="chip g">TOKEN GENERATED</span><div class="tok">${lt.c}</div><div class="mu">${D(lt.hid).name} · ${TY[lt.ty]} · valid 30 min · status: ${lt.s}</div><div class="acts"><button class="btn o" data-a="open" data-v="${lt.c}">View as patient family</button></div></div>`:''}
//  <div class="card"><h2>Nearest hospitals with ${TY[bt].toLowerCase()}</h2>
//  ${rows.map(({d,h,km})=>{const n=h[bt],full=n<1,min=Math.max(1,Math.round(km/40*60)),st=mins(h.upd)>STALE;
//   return `<div class="row hc${full?' full':''}"><div><b>${d.name}</b><div class="mu">${km.toFixed(1)} km | ${min} min · ${d.area}</div><div class="mu">Updated ${ago(h.upd)} ${st&&!full?'<span class="chip y">STALE – call to verify</span>':''}</div>
//   ${full?'':`<div class="acts"><a class="btn o" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${LOCS[loc][1]},${LOCS[loc][2]}&destination=${d.lat},${d.lng}&travelmode=driving">Navigate</a><button class="btn" data-a="book" data-v="${d.id}">Pre-book</button></div>`}</div>
//   <span class="chip ${full?'r':n<3?'y':'g'}">${full?'FULL':n+' beds'}</span></div>`}).join('')}</div>`;
// }

// function pres(){
//  const q=qcode.trim().toUpperCase();
//  if(!q)return '<div class="mu">Enter the token the ambulance driver gave you (try the one from the Driver tab).</div>';
//  const k=S.t.find(x=>x.c===q);
//  if(!k)return `<span class="chip r">NOT FOUND</span> <span class="mu">No token "${esc(q)}". Check the code.</span>`;
//  const L={pending:['y','AWAITING HOSPITAL CONFIRMATION'],confirmed:['g','CONFIRMED'],declined:['r','DECLINED – ask driver to choose another hospital'],expired:['r','EXPIRED'],admitted:['b','ADMITTED']}[k.s];
//  const live=k.s==='pending'||k.s==='confirmed',left=Math.max(0,Math.ceil((k.ex-now())/6e4)),d=D(k.hid);
//  return `<div class="tok">${k.c}</div><div style="margin:6px 0"><span class="chip ${L[0]}">${L[1]}</span></div>
//  <div><b>${d.name}</b>, ${d.area}</div><div class="mu">${TY[k.ty]} bed · ambulance ETA at booking: ${k.eta} min${live?` · token valid for ${left} more min`:''}</div>
//  <div class="mu">Hospital last confirmed: ${k.cf?ago(k.cf):'not yet'}</div>
//  ${live?`<div class="acts"><button class="btn" data-a="rq" data-v="${k.c}"${k.rq?' disabled':''}>${k.rq?'Reconfirm requested…':'Reconfirm with hospital'}</button></div>`:''}`;
// }
// function vPat(){return `<div class="card"><h2>Patient dashboard</h2><div style="display:flex;gap:8px"><input id="qin" placeholder="CR-4821" value="${esc(qcode)}" autocomplete="off"><button class="btn" data-a="chk">Check</button></div><div id="pres" style="margin-top:12px">${pres()}</div></div>`}

// function render(){
//  sweep();
//  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.v===tab));
//  $('#main').innerHTML=tab==='hospital'?vHosp():tab==='driver'?vDriver():vPat();
// }
// function book(id){
//  const h=S.h[id];if(h[bt]<1)return;h[bt]--;
//  const d=D(id),km=dk(LOCS[loc][1],LOCS[loc][2],d.lat,d.lng);S.seq++;
//  S.t.unshift({c:'CR-'+S.seq,hid:id,ty:bt,eta:Math.max(1,Math.round(km/40*60)),s:'pending',cr:now(),ex:now()+30*6e4,cf:null,rq:false});
//  lastTok='CR-'+S.seq;save();render();
// }
// function tact(v){
//  const [a,c]=v.split(':'),k=S.t.find(x=>x.c===c);if(!k)return;
//  if(a==='ok'||a==='cf'){k.s='confirmed';k.cf=now();k.rq=false}
//  else if(a==='no'){k.s='declined';S.h[k.hid][k.ty]++}
//  else if(a==='adm'){k.s='admitted'}
//  save();render();
// }
// document.addEventListener('click',e=>{
//  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,v=b.dataset.v;
//  if(a==='tab'){tab=v;render()}
//  else if(a==='inc'||a==='dec'){draft[v]=Math.max(0,Math.min(99,draft[v]+(a==='inc'?1:-1)));draft.dirty=true;render()}
//  else if(a==='upd'){S.h[hid]={em:draft.em,icu:draft.icu,vent:draft.vent,oxy:draft.oxy,upd:now()};draft=null;save();render()}
//  else if(a==='t')tact(v);
//  else if(a==='bt'){bt=v;render()}
//  else if(a==='book')book(v);
//  else if(a==='open'){qcode=v;tab='patient';render()}
//  else if(a==='chk'){qcode=$('#qin').value;$('#pres').innerHTML=pres()}
//  else if(a==='rq'){const k=S.t.find(x=>x.c===v);if(k){k.rq=true;save();$('#pres').innerHTML=pres()}}
//  else if(a==='ff'){S.off+=20*6e4;save();render()}
//  else if(a==='reset'){S=seed();lastTok=null;qcode='';draft=null;save();render()}
// });
// document.addEventListener('change',e=>{
//  if(e.target.id==='hsel'){hid=e.target.value;draft=null;render()}
//  if(e.target.id==='lsel'){loc=+e.target.value;render()}
// });
// document.addEventListener('keydown',e=>{if(e.target.id==='qin'&&e.key==='Enter'){qcode=e.target.value;$('#pres').innerHTML=pres()}});
// window.addEventListener('storage',e=>{if(e.key===KEY){load();if(document.activeElement.tagName!=='INPUT'){if(tab==='patient')$('#pres').innerHTML=pres();else render()}}});
// setInterval(()=>{const ae=document.activeElement.tagName;if(ae==='SELECT'||ae==='INPUT')return;if(tab==='patient'){sweep();$('#pres').innerHTML=pres()}else render()},20000);
// load();render();