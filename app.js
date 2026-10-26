/* Bucket List v2 client. Every change is saved to Neon Postgres through /api. */
const CATS = ["Travel","Adventure","Learning","Health","Career","Creative","Food","Experiences","Other"];
const CAT_EMOJI = { Travel:"✈️", Adventure:"🏔️", Learning:"📚", Health:"💪", Career:"💼", Creative:"🎨", Food:"🍜", Experiences:"🎉", Other:"⭐" };
const COVER = {
  Travel:["#38bdf8","#6366f1"], Adventure:["#34d399","#0f766e"], Learning:["#fde047","#f97316"],
  Health:["#fb7185","#db2777"], Career:["#94a3b8","#1e293b"], Creative:["#e879f9","#7c3aed"],
  Food:["#fdba74","#ef4444"], Experiences:["#f9a8d4","#be185d"], Other:["#c4b5fd","#4c1d95"]
};
const PRIO = { high: 0, medium: 1, low: 2 };
const KIND = {
  created: ["➕", "Added"], completed: ["🎉", "Completed"], reopened: ["↩️", "Reopened"],
  updated: ["✏️", "Edited"], memory: ["📝", "Memory added"], deleted: ["🗑️", "Deleted"]
};
const EMOJI_PRESETS = ["🌍","🏔️","🎸","🍣","🏋️","📚","🎨","🚀","🌅","💃","🐠","🎬","🏄","🎂","🛫","🧗"];
const PALETTES = [
  { id: "sunset", name: "Sunset", c: ["#ff6b6b", "#feca57", "#ff9ff3"] },
  { id: "lagoon", name: "Lagoon", c: ["#14b8a6", "#38bdf8", "#a3e635"] },
  { id: "grape",  name: "Grape",  c: ["#8b5cf6", "#ec4899", "#facc15"] }
];
const IDEAS = [
  "Watch the sunrise from a mountain", "Cook one dish from every continent",
  "Take a solo road trip", "Go stargazing somewhere really dark",
  "Learn to surf", "Write a short story and finish it"
];
const PIN_KEY = "bl-pin";
const MODE_KEY = "bl-mode";
const PALETTE_KEY = "bl-palette";
const LEGACY_KEYS = ["bucketlist-v3", "bucketlist-v2"];
const DEFAULT_PROFILE = { name: "Your Name", tagline: "", photo: "", goal: 0 };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => new Date(d + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtDay = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const monthLabel = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dateStamp = () => localIso();
const fail = (code, message) => Object.assign(new Error(message), { code });
const starStr = (n) => "★".repeat(n) + "☆".repeat(5 - n);
const dreamUrl = (id) => `/api/dreams?id=${encodeURIComponent(id)}`;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function countdown(d) {
  if (!d) return "";
  const today = new Date(new Date().toDateString()).getTime();
  const diff = Math.round((new Date(d + "T00:00") - today) / 864e5);
  if (diff < 0) return `Overdue by ${-diff}d`;
  if (diff === 0) return "Today!";
  return `${diff}d left`;
}

function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days < 7 ? `${days} d ago` : fmtDay(ts);
}

function cleanUrl(s) {
  s = String(s || "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/* ---------- State ---------- */
let pin = sessionStorage.getItem(PIN_KEY) || "";
let profile = { ...DEFAULT_PROFILE };
let dreams = [];
let activity = [];
let stats = null;
let currentTab = "dreams";
let currentPalette = localStorage.getItem(PALETTE_KEY) || "sunset";
let filter = { cat: "All", tag: "", prio: "all", status: "all", q: "", sort: "priority", view: "grid" };
let selecting = false;
const selected = new Set();
let editing = null;
let pendingPhoto;
let profPhoto;
let inFlight = 0;
let online = true;
let nextId = null;

/* ---------- Network ---------- */
function setSync() {
  const el = $("sync");
  if (!online) { el.className = "sync error"; el.textContent = "Offline"; }
  else if (inFlight) { el.className = "sync saving"; el.textContent = "Saving…"; }
  else { el.className = "sync saved"; el.textContent = "Saved"; }
}

async function call(method, path, body, pinValue = pin) {
  const mutating = method !== "GET";
  if (mutating) { inFlight++; setSync(); }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", "x-pin": pinValue },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    online = true;
  } catch {
    online = false;
    throw fail(0, "Can't reach the server. Check your connection.");
  } finally {
    if (mutating) { inFlight--; setSync(); }
  }
  if (res.status === 401) throw fail(401, "Wrong PIN");
  if (res.status === 429) throw fail(429, "Too many attempts. Wait 15 minutes.");
  if (res.status === 413) throw fail(413, "Too large to save. Remove a few photos.");
  if (!res.ok) {
    let msg = "Server error";
    try { msg = (await res.json()).error || msg; } catch {}
    throw fail(res.status, msg);
  }
  return res.json();
}

function toast(msg, action) {
  $("toastMsg").textContent = msg;
  const b = $("toastAct");
  if (action) {
    b.textContent = action.label;
    b.classList.remove("hide");
    b.onclick = () => { $("toast").classList.remove("show"); action.run(); };
  } else {
    b.classList.add("hide");
    b.onclick = null;
  }
  $("toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.remove("show"), action ? 5000 : 2400);
}

const findDream = (id) => dreams.find((d) => d.id === id);

function replaceDream(row) {
  const i = dreams.findIndex((d) => d.id === row.id);
  if (i >= 0) dreams[i] = row;
  else dreams.unshift(row);
}

async function refresh() {
  const data = await call("GET", "/api/data");
  profile = { ...DEFAULT_PROFILE, ...data.profile };
  dreams = data.dreams;
  activity = data.activity;
  render();
}

/* ---------- Dream operations ---------- */
async function createDream(data) {
  try {
    const row = await call("POST", "/api/dreams", data);
    dreams.unshift(row);
    render();
    toast("Dream added ✨");
    return row;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

async function patchDream(d, fields) {
  const before = { ...d };
  Object.assign(d, fields);
  render();
  try {
    replaceDream(await call("PATCH", dreamUrl(d.id), fields));
    render();
    return true;
  } catch (err) {
    Object.assign(d, before);
    render();
    toast(err.message);
    return false;
  }
}

async function toggleDone(d) {
  const done = !d.done;
  const ok = await patchDream(d, { done, rating: done ? d.rating : null });
  if (ok && done) toast("🎉 One more dream checked off!", { label: "Rate & remember", run: () => openItem(findDream(d.id)) });
}

async function duplicate(d) {
  try {
    dreams.unshift(await call("POST", "/api/dreams", { duplicateOf: d.id }));
    render();
    toast("Duplicated");
  } catch (err) {
    toast(err.message);
  }
}

async function deleteDream(d) {
  const idx = dreams.indexOf(d);
  dreams.splice(idx, 1);
  selected.delete(d.id);
  render();
  try {
    await call("DELETE", dreamUrl(d.id));
  } catch (err) {
    dreams.splice(idx, 0, d);
    render();
    toast(err.message);
    return;
  }
  toast(`Deleted “${d.title}”`, {
    label: "Undo",
    run: async () => {
      try {
        const row = await call("POST", "/api/dreams", { ...d });
        dreams.splice(Math.min(idx, dreams.length), 0, row);
        render();
      } catch (err) {
        toast(err.message);
      }
    }
  });
}

async function bulk(action) {
  if (action === "cancel") return setSelecting(false);
  const targets = [...selected].map(findDream).filter(Boolean);
  if (!targets.length) return;
  if (action === "delete" && !confirm(`Delete ${targets.length} dream${targets.length > 1 ? "s" : ""}?`)) return;
  try {
    if (action === "delete") {
      await Promise.all(targets.map((d) => call("DELETE", dreamUrl(d.id))));
      toast(`Deleted ${targets.length}`);
    } else if (action === "done") {
      await Promise.all(targets.filter((d) => !d.done).map((d) => call("PATCH", dreamUrl(d.id), { done: true })));
      toast(`Marked ${targets.length} done 🎉`);
    } else if (action === "pin") {
      await Promise.all(targets.map((d) => call("PATCH", dreamUrl(d.id), { pinned: true })));
      toast(`Pinned ${targets.length} ★`);
    }
    setSelecting(false);
    await refresh();
  } catch (err) {
    toast(err.message);
    await refresh().catch(() => {});
  }
}

/* ---------- Selection ---------- */
function setSelecting(on) {
  selecting = on;
  if (!on) selected.clear();
  $("selectBtn").classList.toggle("on", on);
  render();
}

function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  render();
}

/* ---------- Rendering ---------- */
function renderHeader() {
  $("hello").textContent = greeting() + ",";
  $("name").textContent = profile.name || "Your Name";
  $("tagline").textContent = profile.tagline || "Things I want to do before I run out of time";
  const initials = (profile.name || "?").trim().split(/\s+/).map((w) => w[0] || "").slice(0, 2).join("").toUpperCase() || "?";
  $("avatar").innerHTML = profile.photo ? `<img src="${esc(profile.photo)}" alt="">` : esc(initials);
  document.title = `${profile.name || "My"}'s Bucket List`;
}

function renderHero() {
  const total = dreams.length;
  const done = dreams.filter((d) => d.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("sTotal").textContent = total;
  $("sDone").textContent = done;
  $("sLeft").textContent = total - done;
  $("ringPct").textContent = pct + "%";
  const C = 2 * Math.PI * 52;
  $("ringFill").style.strokeDasharray = C;
  $("ringFill").style.strokeDashoffset = C * (1 - pct / 100);

  const year = new Date().getFullYear();
  const doneYear = dreams.filter((d) => d.done && d.completedAt && new Date(d.completedAt).getFullYear() === year).length;
  const goal = profile.goal || 0;
  $("goal").classList.toggle("hide", !goal);
  if (goal) {
    $("goalLabel").textContent = `${year} goal`;
    $("goalTxt").textContent = `${doneYear} / ${goal}`;
    $("goalFill").style.width = Math.min(100, (doneYear / goal) * 100) + "%";
  }
}

function renderNext() {
  const open = dreams.filter((d) => !d.done);
  const dated = open.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
  const pick = dated[0] || open.find((d) => d.pinned) || open[0];
  const btn = $("nextUp");
  btn.classList.toggle("hide", !dreams.length);
  if (!pick) {
    btn.innerHTML = `<span class="muted">Everything on your list is done. Time to dream bigger.</span>`;
    nextId = null;
    return;
  }
  nextId = pick.id;
  btn.innerHTML = `<span class="muted">Next up</span>
    <strong>${pick.emoji || CAT_EMOJI[pick.category] || "⭐"} ${esc(pick.title)}</strong>
    <span class="muted">${pick.date ? `${fmtDate(pick.date)} · ${countdown(pick.date)}` : "No target date yet. Tap to plan it."}</span>`;
}

function renderCats() {
  const counts = {};
  dreams.forEach((d) => (counts[d.category] = (counts[d.category] || 0) + 1));
  if (filter.cat !== "All" && !counts[filter.cat]) filter.cat = "All";
  const cats = [...new Set([...CATS, ...Object.keys(counts)])].filter((c) => counts[c]);
  const chips = [["All", dreams.length], ...cats.map((c) => [c, counts[c]])];
  $("cats").innerHTML = chips.map(([c, n]) =>
    `<button class="chip ${filter.cat === c ? "on" : ""}" data-c="${esc(c)}">${c !== "All" ? CAT_EMOJI[c] + " " : ""}${esc(c)} <span style="opacity:.6">${n}</span></button>`
  ).join("");
}

function renderTags() {
  const counts = {};
  dreams.forEach((d) => d.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
  const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 24);
  if (filter.tag && !counts[filter.tag]) filter.tag = "";
  $("tagChips").classList.toggle("hide", !tags.length);
  $("tagChips").innerHTML = tags.map(([t, n]) =>
    `<button class="chip tag ${filter.tag === t ? "on" : ""}" data-tag="${esc(t)}">#${esc(t)} <span style="opacity:.6">${n}</span></button>`
  ).join("");
}

function renderToolbar() {
  document.querySelectorAll("#status [data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === filter.status));
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === filter.view));
  $("prio").value = filter.prio;
  $("sort").value = filter.sort;
  $("selectBtn").classList.toggle("on", selecting);
}

function statusOk(d) {
  if (filter.status === "done") return d.done;
  if (filter.status === "todo") return !d.done;
  if (filter.status === "overdue") return !d.done && !!d.date && d.date < localIso();
  return true;
}

function visible() {
  const q = filter.q;
  const arr = dreams.filter((d) =>
    (filter.cat === "All" || d.category === filter.cat) &&
    (!filter.tag || d.tags.includes(filter.tag)) &&
    (filter.prio === "all" || d.priority === filter.prio) &&
    statusOk(d) &&
    (!q || [d.title, d.notes, d.location, d.category, ...d.tags].join(" ").toLowerCase().includes(q))
  );
  arr.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (filter.sort === "date") return (a.date || "9999").localeCompare(b.date || "9999");
    if (filter.sort === "added") return b.added - a.added;
    if (filter.sort === "name") return a.title.localeCompare(b.title);
    return (PRIO[a.priority] ?? 1) - (PRIO[b.priority] ?? 1);
  });
  return arr;
}

function coverHTML(d) {
  if (d.photo) return `<div class="cover"><img src="${esc(d.photo)}" alt="" loading="lazy"></div>`;
  const [a, b] = COVER[d.category] || COVER.Other;
  return `<div class="cover" style="background:linear-gradient(135deg,${a},${b})"><span class="sticker">${esc(d.emoji || CAT_EMOJI[d.category] || "⭐")}</span></div>`;
}

function card(d) {
  const steps = d.steps || [];
  const stepsDone = steps.filter((s) => s.done).length;
  const cd = d.done ? "" : countdown(d.date);
  const isSel = selected.has(d.id);
  const topLeft = selecting
    ? `<span class="sel-box ${isSel ? "on" : ""}" aria-hidden="true">${isSel ? "✓" : ""}</span>`
    : `<button class="pin ${d.pinned ? "on" : ""}" data-act="pin" aria-label="${d.pinned ? "Unpin" : "Pin to top"}">★</button>`;
  const actions = selecting ? "" : `<div class="item-actions">
      <button class="ibtn" data-act="dup" aria-label="Duplicate" title="Duplicate">⧉</button>
      <button class="ibtn" data-act="del" aria-label="Delete" title="Delete">✕</button>
    </div>`;
  return `
  <article class="item ${d.done ? "done" : ""} ${isSel ? "sel-on" : ""}" data-id="${d.id}">
    ${coverHTML(d)}
    ${topLeft}
    ${actions}
    <div class="body">
      <div class="row1">
        <button class="check" data-act="toggle" aria-label="${d.done ? "Mark as not done" : "Mark as done"}">${d.done ? "✓" : ""}</button>
        <h3 class="title">${esc(d.title)}</h3>
      </div>
      <div class="meta">
        <span class="tag-pill">${esc(d.category)}</span>
        <span class="prio-${esc(d.priority)}">● ${esc(d.priority)}</span>
        ${d.date ? `<span>📅 ${fmtDate(d.date)}</span>` : ""}
        ${cd ? `<span class="cd">${cd}</span>` : ""}
        ${d.location ? `<span>📍 ${esc(d.location)}</span>` : ""}
        ${d.budget ? `<span>💰 ${esc(d.budget)}</span>` : ""}
        ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">🔗 Link</a>` : ""}
      </div>
      ${d.done && d.rating ? `<div class="stars-view" aria-label="${d.rating} of 5">${starStr(d.rating)}</div>` : ""}
      ${steps.length ? `<div class="steps-wrap"><div class="steps-bar"><i style="width:${(stepsDone / steps.length) * 100}%"></i></div>
        <p class="muted steps-note">${stepsDone}/${steps.length} steps</p></div>` : ""}
      ${d.tags.length ? `<div class="tags">${d.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
      ${d.notes ? `<p class="notes">${esc(d.notes)}</p>` : ""}
    </div>
  </article>`;
}

function renderTimeline(arr) {
  const dated = arr.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
  const undated = arr.filter((d) => !d.date);
  const groups = {};
  dated.forEach((d) => {
    const k = d.date.slice(0, 7);
    (groups[k] = groups[k] || []).push(d);
  });
  const parts = Object.keys(groups).map((k) => {
    const [y, m] = k.split("-");
    const label = new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return `<h3 class="month">${label}</h3>${groups[k].map(card).join("")}`;
  });
  if (undated.length) parts.push(`<h3 class="month">Someday</h3>${undated.map(card).join("")}`);
  return parts.join("");
}

function renderList() {
  const list = $("list");
  const arr = visible();
  list.className = "list" + (filter.view !== "grid" ? " list-view" : "");
  if (!arr.length) {
    list.innerHTML = dreams.length
      ? `<div class="empty">Nothing matches these filters.</div>`
      : `<div class="empty">
          <div class="empty-emoji">✨</div>
          <h3>Your list is empty</h3>
          <p class="muted">Start with something you've always wanted to do, or tap an idea:</p>
          <div class="idea-chips">${IDEAS.map((t) => `<button class="chip" data-idea="${esc(t)}">${esc(t)}</button>`).join("")}</div>
        </div>`;
    return;
  }
  list.innerHTML = filter.view === "timeline" ? renderTimeline(arr) : arr.map(card).join("");
}

function groupByMonth(arr, tsOf) {
  const groups = {};
  arr.forEach((x) => {
    const k = monthLabel(tsOf(x) || Date.now());
    (groups[k] = groups[k] || []).push(x);
  });
  return Object.entries(groups);
}

function renderJournal() {
  const done = dreams.filter((d) => d.done).sort((a, b) => b.completedAt - a.completedAt);
  $("memories").innerHTML = done.length
    ? groupByMonth(done, (d) => d.completedAt).map(([label, arr]) => `
        <h3 class="month">${label}</h3>
        ${arr.map((d) => `
          <article class="card entry" data-id="${d.id}">
            <div class="dot">${esc(d.emoji || CAT_EMOJI[d.category] || "⭐")}</div>
            <div>
              <div class="entry-top"><strong>${esc(d.title)}</strong><span class="muted">${d.completedAt ? fmtDay(d.completedAt) : ""}${d.rating ? ` · <span class="stars-view" style="padding:0">${starStr(d.rating)}</span>` : ""}</span></div>
              ${d.memory ? `<p>${esc(d.memory)}</p>` : `<p class="muted"><button class="linkish" data-act="memory">+ Add a memory</button></p>`}
            </div>
          </article>`).join("")}`).join("")
    : `<div class="empty">Finish a dream and it lands here, with room for a memory.</div>`;

  $("feed").innerHTML = activity.length
    ? activity.map((a) => {
        const [ico, label] = KIND[a.kind] || ["•", a.kind];
        return `<div class="feed-item">
          <span class="feed-ico">${ico}</span>
          <div><strong>${label}</strong> ${esc(a.title)}<div class="muted">${timeAgo(a.at)}</div></div>
        </div>`;
      }).join("")
    : `<div class="empty">No activity yet.</div>`;
}

function hbarRow(label, done, total, max) {
  return `<div class="hbar">
    <span>${label}</span>
    <div class="hbar-wrap"><div class="hbar-total" style="width:${(total / max) * 100}%"><div class="hbar-done" style="width:${total ? (done / total) * 100 : 0}%"></div></div></div>
    <b>${done}/${total}</b>
  </div>`;
}

function valueRow(label, value, max) {
  return `<div class="hbar">
    <span>${label}</span>
    <div class="hbar-wrap"><div class="hbar-total" style="width:${(value / max) * 100}%"><div class="hbar-done" style="width:${(value / max) * 100}%"></div></div></div>
    <b>${value}</b>
  </div>`;
}

function renderStats() {
  if (!stats) return;
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const now = new Date();
  const months = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: d.toLocaleDateString(undefined, { month: "short" }), n: 0 });
  }
  stats.monthly.forEach((m) => {
    const x = months.find((z) => z.key === m.month);
    if (x) x.n = m.n;
  });
  const maxM = Math.max(1, ...months.map((m) => m.n));
  const maxCat = Math.max(1, ...stats.byCategory.map((c) => c.total));
  const maxPrio = Math.max(1, ...stats.byPriority.map((p) => p.total));
  const prio = ["high", "medium", "low"].map((k) => stats.byPriority.find((p) => p.priority === k)).filter(Boolean);
  const ratings = [5, 4, 3, 2, 1].map((n) => ({ n, c: dreams.filter((d) => d.rating === n).length }));
  const maxR = Math.max(1, ...ratings.map((r) => r.c));
  const topCat = stats.byCategory.filter((c) => c.done > 0).sort((a, b) => b.done - a.done)[0];

  $("stats").innerHTML = `
    <div class="stat-grid">
      <div class="card kpi"><span>Completion</span><b>${pct}%</b></div>
      <div class="card kpi"><span>Done this year</span><b>${stats.doneYear}</b></div>
      <div class="card kpi"><span>Avg. days to finish</span><b>${stats.avgDays ?? "—"}</b></div>
      <div class="card kpi"><span>Avg. rating</span><b>${stats.avgRating ? stats.avgRating.toFixed(1) : "—"}${stats.avgRating ? ' <small>★</small>' : ""}</b></div>
      <div class="card kpi"><span>Overdue</span><b>${stats.overdue}</b></div>
      <div class="card kpi"><span>Top category</span><b><small>${topCat ? `${CAT_EMOJI[topCat.category]} ${esc(topCat.category)}` : "—"}</small></b></div>
    </div>
    <section class="card panel">
      <h3>Completed per month</h3>
      <div class="bars">${months.map((m) => `
        <div class="bar-col">
          <div class="bar-val">${m.n || ""}</div>
          <div class="bar-track"><div class="bar-fill" style="height:${(m.n / maxM) * 100}%"></div></div>
          <small>${m.label}</small>
        </div>`).join("")}
      </div>
    </section>
    <section class="card panel">
      <h3>By category</h3>
      ${stats.byCategory.length
        ? stats.byCategory.map((c) => hbarRow(`${CAT_EMOJI[c.category] || "⭐"} ${esc(c.category)}`, c.done, c.total, maxCat)).join("")
        : `<p class="muted">No data yet.</p>`}
    </section>
    <section class="card panel">
      <h3>By priority</h3>
      ${prio.length
        ? prio.map((p) => hbarRow(`● ${esc(p.priority)}`, p.done, p.total, maxPrio)).join("")
        : `<p class="muted">No data yet.</p>`}
    </section>
    <section class="card panel">
      <h3>How you rated them</h3>
      ${ratings.some((r) => r.c) ? ratings.map((r) => valueRow(`<span class="stars-view" style="padding:0">${starStr(r.n)}</span>`, r.c, maxR)).join("") : `<p class="muted">Rate a finished dream to see this.</p>`}
    </section>`;
}

function renderBulk() {
  $("bulkbar").classList.toggle("hide", !selecting);
  $("bulkCount").textContent = `${selected.size} selected`;
}

function render() {
  renderHeader();
  renderHero();
  renderNext();
  renderCats();
  renderTags();
  renderToolbar();
  renderList();
  renderBulk();
  if (currentTab === "journal") renderJournal();
  if (currentTab === "stats") renderStats();
}

/* ---------- Tabs ---------- */
function setTab(t) {
  currentTab = t;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hide", v.id !== "view-" + t));
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (t === "journal") refresh().catch((err) => toast(err.message));
  if (t === "stats") loadStats();
}

async function loadStats() {
  try {
    stats = await call("GET", "/api/stats");
    renderStats();
  } catch (err) {
    $("stats").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

/* ---------- Quick add, filters, lists ---------- */
$("quickForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("quick").value.trim();
  if (!title) return;
  const category = filter.cat !== "All" ? filter.cat : "Other";
  if (await createDream({ title, category })) $("quick").value = "";
});

$("cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]");
  if (!b) return;
  filter.cat = b.dataset.c;
  render();
});
$("tagChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tag]");
  if (!b) return;
  filter.tag = filter.tag === b.dataset.tag ? "" : b.dataset.tag;
  render();
});
$("status").addEventListener("click", (e) => {
  const b = e.target.closest("[data-s]");
  if (!b) return;
  filter.status = b.dataset.s;
  render();
});
$("search").addEventListener("input", (e) => {
  filter.q = e.target.value.trim().toLowerCase();
  renderList();
});
$("prio").addEventListener("change", (e) => {
  filter.prio = e.target.value;
  renderList();
});
$("sort").addEventListener("change", (e) => {
  filter.sort = e.target.value;
  renderList();
});
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  filter.view = b.dataset.view;
  render();
}));
$("selectBtn").addEventListener("click", () => setSelecting(!selecting));
document.querySelectorAll("[data-bulk]").forEach((b) => b.addEventListener("click", () => bulk(b.dataset.bulk)));

$("list").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const idea = e.target.closest("[data-idea]");
  if (idea) {
    createDream({ title: idea.dataset.idea, category: "Experiences" });
    return;
  }
  const el = e.target.closest(".item");
  if (!el) return;
  const d = findDream(el.dataset.id);
  if (!d) return;
  if (selecting) {
    toggleSelect(d.id);
    return;
  }
  const btn = e.target.closest("[data-act]");
  const act = btn?.dataset.act;
  if (act === "toggle") toggleDone(d);
  else if (act === "pin") patchDream(d, { pinned: !d.pinned });
  else if (act === "dup") duplicate(d);
  else if (act === "del") deleteDream(d);
  else if (!btn) openItem(d);
});

$("memories").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act='memory']");
  if (!b) return;
  const d = findDream(b.closest("[data-id]").dataset.id);
  if (d) openItem(d);
});

$("nextUp").addEventListener("click", () => {
  const d = findDream(nextId);
  if (d) openItem(d);
});
$("fabAdd").onclick = () => openItem(null);
document.querySelectorAll("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => setTab(b.dataset.tab))
);

/* ---------- Item dialog ---------- */
function renderPhotoPreview(src) {
  $("photoPrev").innerHTML = src ? `<img src="${esc(src)}" alt="">` : "No photo";
  $("removePhoto").classList.toggle("hide", !src);
}

function renderStars() {
  const n = Number($("ratingInput").value) || 0;
  $("stars").innerHTML = [1, 2, 3, 4, 5].map((i) =>
    `<button type="button" data-star="${i}" class="${i <= n ? "on" : ""}" aria-label="${i} star${i > 1 ? "s" : ""}">★</button>`
  ).join("");
}

function syncDoneRow() {
  $("starRow").classList.toggle("hide", !$("doneCheck").checked);
}

$("stars").addEventListener("click", (e) => {
  const b = e.target.closest("[data-star]");
  if (!b) return;
  const n = Number(b.dataset.star);
  const cur = Number($("ratingInput").value) || 0;
  $("ratingInput").value = cur === n ? "" : String(n);
  renderStars();
});
$("doneCheck").addEventListener("change", syncDoneRow);

$("emojiPresets").innerHTML = EMOJI_PRESETS.map((e) => `<button type="button" data-emo="${e}">${e}</button>`).join("");
$("emojiPresets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-emo]");
  if (b) $("emojiInput").value = b.dataset.emo;
});

function openItem(d) {
  editing = d || null;
  pendingPhoto = undefined;
  const f = $("itemForm");
  f.reset();
  $("itemTitle").textContent = d ? "Edit dream" : "New dream";
  if (d) {
    for (const k of ["title", "category", "priority", "date", "budget", "location", "url", "notes", "memory", "emoji"]) {
      f.elements[k].value = d[k] || "";
    }
    f.elements.tags.value = d.tags.join(", ");
    f.elements.steps.value = d.steps.map((s) => s.text).join("\n");
    f.elements.done.checked = !!d.done;
    $("ratingInput").value = d.rating || "";
  } else {
    f.elements.priority.value = "medium";
    f.elements.category.value = filter.cat !== "All" ? filter.cat : "Other";
    $("ratingInput").value = "";
  }
  renderStars();
  syncDoneRow();
  renderPhotoPreview(d ? d.photo : "");
  $("deleteItemBtn").classList.toggle("hide", !d);
  $("dupItemBtn").classList.toggle("hide", !d);
  $("itemDlg").showModal();
  f.elements.title.focus();
}

$("itemDlg").addEventListener("close", () => {
  editing = null;
  pendingPhoto = undefined;
});

$("itemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const v = (k) => f.elements[k].value.trim();
  const url = cleanUrl(v("url"));
  if (url === null) {
    toast("That link doesn't look right");
    return;
  }
  const oldSteps = editing ? editing.steps : [];
  const steps = v("steps").split("\n").map((s) => s.trim()).filter(Boolean).map((text) => {
    const prev = oldSteps.find((s) => s.text === text);
    return { id: prev?.id, text, done: prev ? prev.done : false };
  });
  const done = f.elements.done.checked;
  const fields = {
    title: v("title"), category: v("category"), priority: v("priority"), date: v("date") || null,
    budget: v("budget"), location: v("location"), url, notes: v("notes"), memory: v("memory"),
    emoji: v("emoji"),
    tags: v("tags").split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
    steps, done,
    rating: done ? Number($("ratingInput").value) || null : null
  };
  if (pendingPhoto !== undefined) fields.photo = pendingPhoto;

  const target = editing;
  try {
    if (target) replaceDream(await call("PATCH", dreamUrl(target.id), fields));
    else dreams.unshift(await call("POST", "/api/dreams", fields));
    $("itemDlg").close();
    render();
    toast(target ? "Saved" : "Dream added ✨");
  } catch (err) {
    toast(err.message);
  }
});

$("deleteItemBtn").onclick = () => {
  const d = editing;
  $("itemDlg").close();
  if (d) deleteDream(d);
};
$("dupItemBtn").onclick = () => {
  const d = editing;
  $("itemDlg").close();
  if (d) duplicate(d);
};
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close())
);

function compressImage(file, max = 640) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

$("photoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    pendingPhoto = await compressImage(file);
    renderPhotoPreview(pendingPhoto);
  } catch {
    toast("Couldn't read that image");
  }
});
$("removePhoto").onclick = () => { pendingPhoto = ""; renderPhotoPreview(""); };

/* ---------- Profile ---------- */
function renderProfPreview(src) {
  $("profPrev").innerHTML = src ? `<img src="${esc(src)}" alt="">` : "No photo";
  $("profRemove").classList.toggle("hide", !src);
}

function openProfile() {
  const f = $("profileForm");
  f.reset();
  f.elements.name.value = profile.name || "";
  f.elements.tagline.value = profile.tagline || "";
  f.elements.goal.value = profile.goal || "";
  profPhoto = undefined;
  renderProfPreview(profile.photo || "");
  $("profileDlg").showModal();
  f.elements.name.focus();
}
$("profileDlg").addEventListener("close", () => { profPhoto = undefined; });
$("who").addEventListener("click", openProfile);
$("avatar").addEventListener("click", openProfile);

$("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.elements.name.value.trim() || "Your Name",
    tagline: f.elements.tagline.value.trim(),
    goal: Number(f.elements.goal.value) || 0,
    photo: profPhoto !== undefined ? profPhoto : profile.photo || ""
  };
  try {
    profile = { ...DEFAULT_PROFILE, ...(await call("PUT", "/api/data", body)) };
    $("profileDlg").close();
    render();
  } catch (err) {
    toast(err.message);
  }
});
$("profPhotoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    profPhoto = await compressImage(file, 320);
    renderProfPreview(profPhoto);
  } catch {
    toast("Couldn't read that image");
  }
});
$("profRemove").onclick = () => { profPhoto = ""; renderProfPreview(""); };

/* ---------- Menu: palettes, backup, export, erase ---------- */
function renderPalettes() {
  $("palettes").innerHTML = PALETTES.map((p) =>
    `<button class="palette ${p.id === currentPalette ? "on" : ""}" data-pal="${p.id}">
       <i style="background:linear-gradient(135deg,${p.c[0]},${p.c[1]})"></i>${p.name}
     </button>`
  ).join("");
}

function applyPalette() {
  const p = PALETTES.find((x) => x.id === currentPalette) || PALETTES[0];
  const root = document.documentElement.style;
  root.setProperty("--accent", p.c[0]);
  root.setProperty("--accent2", p.c[1]);
  root.setProperty("--accent3", p.c[2]);
  document.querySelector('meta[name="theme-color"]').content = p.c[0];
}

$("palettes").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pal]");
  if (!b) return;
  currentPalette = b.dataset.pal;
  try { localStorage.setItem(PALETTE_KEY, currentPalette); } catch {}
  applyPalette();
  renderPalettes();
});

$("menuBtn").onclick = () => {
  renderPalettes();
  $("menuDlg").showModal();
};
document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => runMenu(b.dataset.m)));

function runMenu(m) {
  $("menuDlg").close();
  if (m === "json") exportJSON();
  if (m === "csv") exportCSV();
  if (m === "import") $("importFile").click();
  if (m === "erase") eraseAll();
}

function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON() {
  download(`bucket-list-${dateStamp()}.json`, "application/json",
    JSON.stringify({ profile, items: dreams, exportedAt: new Date().toISOString() }, null, 2));
  toast("Backup exported");
}

function exportCSV() {
  const cols = ["title", "category", "priority", "date", "budget", "location", "url", "tags", "notes", "done", "rating", "completed", "memory", "steps"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = dreams.map((d) => cols.map((c) => {
    if (c === "tags") return d.tags.join("; ");
    if (c === "steps") return d.steps.map((s) => (s.done ? "[x] " : "[ ] ") + s.text).join("; ");
    if (c === "done") return d.done ? "yes" : "no";
    if (c === "completed") return d.completedAt ? new Date(d.completedAt).toISOString() : "";
    return d[c];
  }).map(q).join(","));
  download(`bucket-list-${dateStamp()}.csv`, "text/csv", [cols.join(","), ...rows].join("\n"));
  toast("Spreadsheet exported");
}

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("That file isn't valid JSON");
    return;
  }
  if (!data || !Array.isArray(data.items)) {
    toast("That file isn't a valid backup");
    return;
  }
  if (!confirm(`Replace your current list with ${data.items.length} dreams from this backup?`)) return;
  try {
    await call("POST", "/api/import", { profile: data.profile, items: data.items });
    await refresh();
    toast("Backup imported ✨");
  } catch (err) {
    toast(err.message);
  }
});

async function eraseAll() {
  if (!confirm("Erase everything in the database? This can't be undone unless you have a backup.")) return;
  try {
    await call("DELETE", "/api/data");
    await refresh();
    toast("Everything erased");
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- Light/dark mode and install ---------- */
function applyMode(t) { document.documentElement.dataset.theme = t; }
function initMode() {
  let saved = null;
  try { saved = localStorage.getItem(MODE_KEY); } catch {}
  applyMode(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}
$("themeBtn").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyMode(t);
  try { localStorage.setItem(MODE_KEY, t); } catch {}
};

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  deferredPrompt = e;
  $("installBtn").classList.remove("hide");
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  $("installBtn").classList.add("hide");
});
if (isIOS && !isStandalone) $("installBtn").classList.remove("hide");
$("installBtn").onclick = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("installBtn").classList.add("hide");
  } else if (isIOS) {
    toast("Tap Share, then “Add to Home Screen”");
  }
};

/* ---------- Keyboard shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.body.classList.contains("locked")) return;
  if (e.key === "Escape" && selecting && !document.querySelector("dialog[open]")) {
    setSelecting(false);
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "n") { e.preventDefault(); openItem(null); }
  else if (k === "/") { e.preventDefault(); setTab("dreams"); $("search").focus(); }
  else if (k === "s") setSelecting(!selecting);
  else if (k === "t") $("themeBtn").click();
  else if (k === "1") setTab("dreams");
  else if (k === "2") setTab("journal");
  else if (k === "3") setTab("stats");
});

/* ---------- Lock screen and start-up ---------- */
function lockError(msg) { $("lockErr").textContent = msg || ""; }

async function unlock(p) {
  const data = await call("GET", "/api/data", undefined, p);
  pin = p;
  sessionStorage.setItem(PIN_KEY, p);
  profile = { ...DEFAULT_PROFILE, ...data.profile };
  dreams = data.dreams;
  activity = data.activity;
  if (!dreams.length) await migrateLocal();
  document.body.classList.remove("locked");
  render();
  setTab(currentTab);
  if (new URLSearchParams(location.search).has("new")) {
    history.replaceState(null, "", location.pathname);
    openItem(null);
  }
}

/* Moves a list saved in this browser's old local storage into the database, once. */
async function migrateLocal() {
  const legacy = LEGACY_KEYS.map((k) => {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  }).find((s) => s && Array.isArray(s.items) && s.items.length);
  if (!legacy) return;
  await call("POST", "/api/import", { profile: legacy.profile, items: legacy.items });
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  const data = await call("GET", "/api/data");
  profile = { ...DEFAULT_PROFILE, ...data.profile };
  dreams = data.dreams;
  activity = data.activity;
  toast("Your older local list was moved to the database");
}

$("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = $("pinInput").value.trim();
  if (!p) return;
  $("lockBtn").disabled = true;
  lockError("");
  try {
    await unlock(p);
    $("pinInput").value = "";
  } catch (err) {
    lockError(err.message);
    $("pinInput").select();
    await new Promise((r) => setTimeout(r, 700));
  } finally {
    $("lockBtn").disabled = false;
  }
});

async function boot() {
  if (!pin) return;
  try {
    await unlock(pin);
  } catch (err) {
    pin = "";
    if (err.code === 401) sessionStorage.removeItem(PIN_KEY);
    lockError(err.code === 401 ? "Your PIN has changed. Enter it again." : err.message);
  }
}

applyPalette();
initMode();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
boot();
