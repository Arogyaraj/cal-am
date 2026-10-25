/* Bucket List: app logic, no dependencies */
const THEME_KEY = "bucketlist-theme";
const CATS = ["Travel","Adventure","Learning","Health","Career","Creative","Food","Experiences","Other"];
const EMOJI = { Travel:"✈️", Adventure:"🏔️", Learning:"📚", Health:"💪", Career:"💼", Creative:"🎨", Food:"🍜", Experiences:"🎉", Other:"⭐" };
const COVER = {
  Travel:["#38bdf8","#4f46e5"], Adventure:["#34d399","#0f766e"], Learning:["#fbbf24","#ea580c"],
  Health:["#f43f5e","#db2777"], Career:["#64748b","#1e293b"], Creative:["#c084fc","#7c3aed"],
  Food:["#fb923c","#dc2626"], Experiences:["#f472b6","#be185d"], Other:["#a8a29e","#57534e"]
};
const PRIO = { high: 0, medium: 1, low: 2 };
const ACCENTS = [["#6366f1","#a855f7"],["#e11d48","#f97316"],["#059669","#14b8a6"],["#d97706","#eab308"],["#0284c7","#06b6d4"],["#c026d3","#ec4899"]];
const QUOTES = [
  "Small steps still move you forward.",
  "Dreams without deadlines stay dreams. Pick a date.",
  "The best time was yesterday. The next best is today.",
  "Make a list you'd be proud to finish.",
  "Someday is not a day of the week.",
  "Adventure is worth the inconvenience."
];
const IDEAS = ["Watch the sunrise from a mountain","Cook one dish from every continent","Take a solo road trip","Go stargazing somewhere really dark","Learn to surf","Write a short story and finish it"];
const MILESTONES = [[1,"🌱","First step"],[3,"🔥","On a roll"],[5,"🧭","Explorer"],[10,"🏆","Dreamer"],[25,"👑","Legend"]];
const RING = 2 * Math.PI * 52;

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayMs = () => new Date(new Date().toDateString()).getTime();
const dateStamp = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => new Date(d + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtDay = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const monthLabel = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });

function countdown(d) {
  if (!d) return "";
  const diff = Math.round((new Date(d + "T00:00") - todayMs()) / 864e5);
  if (diff < 0) return `Overdue by ${-diff}d`;
  if (diff === 0) return "Today!";
  return `${diff}d left`;
}

function cleanUrl(s) {
  s = String(s || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function newItem(over = {}) {
  return {
    id: uid(), title: "", category: "Other", priority: "medium", date: "", budget: "", location: "",
    url: "", tags: [], notes: "", photo: "", steps: [], pinned: false, done: false,
    added: Date.now(), completedAt: 0, memory: "", ...over
  };
}

const SAMPLE = {
  profile: { name: "Alex Morgan", tagline: "Things I want to do before I run out of time", photo: "" },
  items: [
    { title: "See the Northern Lights", category: "Travel", priority: "high", location: "Tromsø, Norway", tags: ["winter", "sky"], notes: "Go in winter, far from city lights.", pinned: true, steps: [{ id: uid(), text: "Check flight dates", done: true }, { id: uid(), text: "Book a cabin", done: false }] },
    { title: "Run a half marathon", category: "Health", priority: "medium", done: true, completedAt: Date.now() - 864e5 * 20, memory: "Crossed the line tired, happy and already planning the next one." },
    { title: "Learn to play piano", category: "Learning", priority: "medium", tags: ["music"] }
  ]
};

function normalize(data) {
  const profile = { name: "Your Name", tagline: "", photo: "", ...(data.profile || {}) };
  const settings = { accent: 0, view: "grid", ...(data.settings || {}) };
  if (!ACCENTS[settings.accent]) settings.accent = 0;
  if (!["grid", "list"].includes(settings.view)) settings.view = "grid";
  const items = data.items.map((i) => {
    const base = newItem();
    return {
      ...base, ...i,
      id: i.id || uid(),
      title: String(i.title || "Untitled"),
      tags: Array.isArray(i.tags) ? i.tags.map(String).slice(0, 8) : [],
      url: cleanUrl(i.url || "") || "",
      done: !!i.done,
      steps: (i.steps || []).map((s) => ({ id: s.id || uid(), text: String(s.text || ""), done: !!s.done }))
    };
  });
  return { profile, settings, items };
}

/* ---------- Data: saved in Vercel Postgres through /api/state, behind a PIN ---------- */
const LEGACY_KEYS = ["bucketlist-v3", "bucketlist-v2"];   // old local copies, migrated once
const PIN_KEY = "bl-pin";                                  // sessionStorage: cleared when the tab closes
let pin = sessionStorage.getItem(PIN_KEY) || "";
let state = null;
let dirty = false, saving = false, saveTimer = null, legacyToClear = false;

function seedState() {
  return normalize({ ...structuredClone(SAMPLE), items: SAMPLE.items.map((i) => ({ ...structuredClone(i), added: Date.now() - 864e5 * 30 })) });
}

function readLegacy() {
  for (const key of LEGACY_KEYS) {
    try {
      const s = JSON.parse(localStorage.getItem(key));
      if (s && s.profile && Array.isArray(s.items)) return { data: normalize(s) };
    } catch {}
  }
  return null;
}

async function api(method, body, pinValue) {
  let res;
  try {
    res = await fetch("/api/state", {
      method,
      headers: { "Content-Type": "application/json", "x-pin": pinValue },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
  } catch {
    throw Object.assign(new Error("Can't reach the server. Check your connection."), { code: 0 });
  }
  if (res.status === 401) throw Object.assign(new Error("Wrong PIN"), { code: 401 });
  if (res.status === 429) throw Object.assign(new Error("Too many attempts. Wait 15 minutes."), { code: 429 });
  if (res.status === 413) throw Object.assign(new Error("Too large to save. Remove a few photos."), { code: 413 });
  if (!res.ok) throw Object.assign(new Error("Server error"), { code: res.status });
  return res.json();
}

function setSync(status, msg = "") {
  const el = $("sync");
  el.className = "sync " + status;
  el.textContent = { saving: "Saving…", saved: "Saved", error: "Not saved, retrying", idle: "" }[status] || "";
  el.title = msg;
}

let toastTimer;
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
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), action ? 5000 : 2200);
}

/* ---------- Rendering ---------- */
function applyAccent() {
  const [a, b] = ACCENTS[state.settings.accent] || ACCENTS[0];
  document.documentElement.style.setProperty("--accent", a);
  document.documentElement.style.setProperty("--accent2", b);
}

function renderHeader() {
  const p = state.profile;
  $("name").textContent = p.name || "Your Name";
  $("tagline").textContent = p.tagline || "";
  $("tagline").classList.toggle("hide", !p.tagline);
  const initials = (p.name || "?").trim().split(/\s+/).map((w) => w[0] || "").slice(0, 2).join("").toUpperCase() || "?";
  $("avatar").innerHTML = p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials);
  document.title = `${p.name || "My"}'s Bucket List`;
  applyAccent();
}

function renderHero() {
  const total = state.items.length;
  const done = state.items.filter((i) => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("sTotal").textContent = total;
  $("sDone").textContent = done;
  $("sLeft").textContent = total - done;
  $("ringPct").textContent = pct + "%";
  $("ringFill").style.strokeDasharray = RING;
  $("ringFill").style.strokeDashoffset = RING * (1 - pct / 100);
  $("quote").textContent = "“" + QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length] + "”";
}

function renderCats() {
  const counts = {};
  state.items.forEach((i) => (counts[i.category] = (counts[i.category] || 0) + 1));
  if (filter.cat !== "All" && !counts[filter.cat]) filter.cat = "All";
  const cats = [...new Set([...CATS, ...Object.keys(counts)])].filter((c) => counts[c]);
  const chips = [["All", state.items.length], ...cats.map((c) => [c, counts[c]])];
  $("cats").innerHTML = chips.map(([c, n]) =>
    `<button class="chip ${filter.cat === c ? "on" : ""}" data-c="${esc(c)}">${c !== "All" ? EMOJI[c] + " " : ""}${esc(c)} <span style="opacity:.6">${n}</span></button>`
  ).join("");
}

function renderToolbar() {
  document.querySelectorAll("#status [data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === filter.status));
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === state.settings.view));
}

function visible() {
  const q = filter.q;
  const arr = state.items.filter((i) =>
    (filter.cat === "All" || i.category === filter.cat) &&
    (filter.status === "all" || (filter.status === "done") === i.done) &&
    (!q || [i.title, i.notes, i.location, i.category, ...i.tags].join(" ").toLowerCase().includes(q))
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

function coverHTML(i) {
  if (i.photo) return `<div class="cover"><img src="${esc(i.photo)}" alt="" loading="lazy"><span class="emoji" style="display:none"></span></div>`;
  const [a, b] = COVER[i.category] || COVER.Other;
  return `<div class="cover" style="background:linear-gradient(135deg,${a},${b})"><span class="emoji">${EMOJI[i.category] || "⭐"}</span></div>`;
}

function card(i) {
  const steps = i.steps || [];
  const stepsDone = steps.filter((s) => s.done).length;
  const cd = i.done ? "" : countdown(i.date);
  return `
  <article class="item ${i.done ? "done" : ""}" data-id="${i.id}">
    ${coverHTML(i)}
    <button class="pin ${i.pinned ? "on" : ""}" data-act="pin" aria-label="${i.pinned ? "Unpin" : "Pin"}" title="${i.pinned ? "Unpin" : "Pin to top"}">★</button>
    <div class="item-actions">
      <button class="ibtn" data-act="dup" aria-label="Duplicate" title="Duplicate">⧉</button>
      <button class="ibtn" data-act="del" aria-label="Delete" title="Delete">✕</button>
    </div>
    <div class="body">
      <div class="row1">
        <button class="check" data-act="toggle" aria-label="${i.done ? "Mark as not done" : "Mark as done"}">${i.done ? "✓" : ""}</button>
        <h3 class="title">${esc(i.title)}</h3>
      </div>
      <div class="meta">
        <span class="tag-pill">${esc(i.category)}</span>
        <span class="prio-${esc(i.priority)}">● ${esc(i.priority)}</span>
        ${i.date ? `<span>📅 ${fmtDate(i.date)}</span>` : ""}
        ${cd ? `<span class="cd">${cd}</span>` : ""}
        ${i.location ? `<span>📍 ${esc(i.location)}</span>` : ""}
        ${i.budget ? `<span>💰 ${esc(i.budget)}</span>` : ""}
        ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">🔗 Link</a>` : ""}
      </div>
      ${steps.length ? `<div class="steps-wrap"><div class="steps-bar"><i style="width:${(stepsDone / steps.length) * 100}%"></i></div>
        <p class="muted steps-note">${stepsDone}/${steps.length} steps</p></div>` : ""}
      ${i.tags.length ? `<div class="tags">${i.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
      ${i.notes ? `<p class="notes">${esc(i.notes)}</p>` : ""}
    </div>
  </article>`;
}

function renderList() {
  const list = $("list");
  list.className = "list " + (state.settings.view === "list" ? "list-view" : "");
  const arr = visible();
  if (!arr.length) {
    if (!state.items.length) {
      list.innerHTML = `<div class="empty">
        <div class="empty-emoji">✨</div>
        <h3>Your list is empty</h3>
        <p class="muted">Start with something you've always wanted to do, or tap an idea:</p>
        <div class="idea-chips">${IDEAS.map((t) => `<button class="chip" data-idea="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      </div>`;
    } else {
      list.innerHTML = `<div class="empty">Nothing matches these filters.</div>`;
    }
    return;
  }
  list.innerHTML = arr.map(card).join("");
}

function renderJournal() {
  const done = state.items.filter((i) => i.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  if (!done.length) {
    $("journal").innerHTML = `<div class="empty">Finish a dream and it lands here, with room for a memory.</div>`;
    return;
  }
  const groups = {};
  done.forEach((i) => {
    const k = monthLabel(i.completedAt || i.added);
    (groups[k] = groups[k] || []).push(i);
  });
  $("journal").innerHTML = Object.entries(groups).map(([label, arr]) => `
    <h3 class="month">${label}</h3>
    ${arr.map((i) => `
      <article class="card entry" data-id="${i.id}">
        <div class="dot">${EMOJI[i.category] || "⭐"}</div>
        <div>
          <div class="entry-top"><strong>${esc(i.title)}</strong><span class="muted">${i.completedAt ? fmtDay(i.completedAt) : ""}</span></div>
          ${i.memory ? `<p>${esc(i.memory)}</p>` : `<p class="muted"><button class="linkish" data-act="memory">+ Add a memory</button></p>`}
        </div>
      </article>`).join("")}
  `).join("");
}

function renderStats() {
  const items = state.items;
  const done = items.filter((i) => i.done);
  const total = items.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;
  const year = new Date().getFullYear();
  const doneYear = done.filter((i) => new Date(i.completedAt).getFullYear() === year).length;
  const durations = done.filter((i) => i.completedAt && i.added).map((i) => (i.completedAt - i.added) / 864e5);
  const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const cats = [...new Set([...CATS, ...items.map((i) => i.category)])]
    .map((c) => {
      const all = items.filter((i) => i.category === c);
      return { c, total: all.length, done: all.filter((i) => i.done).length };
    })
    .filter((x) => x.total);
  const maxCat = Math.max(1, ...cats.map((x) => x.total));

  const now = new Date();
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push({ label: d.toLocaleDateString(undefined, { month: "short" }), y: d.getFullYear(), m: d.getMonth(), n: 0 });
  }
  done.forEach((i) => {
    const d = new Date(i.completedAt);
    const mo = months.find((x) => x.y === d.getFullYear() && x.m === d.getMonth());
    if (mo) mo.n++;
  });
  const maxM = Math.max(1, ...months.map((m) => m.n));

  $("stats").innerHTML = `
    <div class="stat-grid">
      <div class="card kpi"><span>Completion</span><b>${pct}%</b></div>
      <div class="card kpi"><span>Done this year</span><b>${doneYear}</b></div>
      <div class="card kpi"><span>Avg. days to finish</span><b>${avg ?? "—"}</b></div>
      <div class="card kpi"><span>Total dreams</span><b>${total}</b></div>
    </div>
    <section class="card panel">
      <h3>Completed, last 6 months</h3>
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
      ${cats.length ? cats.map((x) => `
        <div class="hbar">
          <span>${EMOJI[x.c] || "⭐"} ${esc(x.c)}</span>
          <div class="hbar-wrap"><div class="hbar-total" style="width:${(x.total / maxCat) * 100}%"><div class="hbar-done" style="width:${(x.done / x.total) * 100}%"></div></div></div>
          <b>${x.done}/${x.total}</b>
        </div>`).join("") : `<p class="muted">No data yet.</p>`}
    </section>
    <section class="card panel">
      <h3>Milestones</h3>
      <div class="mile-grid">${MILESTONES.map(([n, e, name]) => `
        <div class="mile ${done.length >= n ? "on" : ""}">
          <span>${e}</span><b>${name}</b><small>${n} done</small>
        </div>`).join("")}
      </div>
    </section>`;
}

function render() {
  renderHeader();
  renderHero();
  renderCats();
  renderToolbar();
  renderList();
  renderJournal();
  renderStats();
}

/* ---------- Tabs ---------- */
function setTab(t) {
  currentTab = t;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hide", v.id !== "view-" + t));
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("fabAdd").onclick = () => openItem(null);

/* ---------- Quick add, filters ---------- */
$("quickForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = $("quick").value.trim();
  if (!title) return;
  const category = filter.cat !== "All" ? filter.cat : "Other";
  state.items.unshift(newItem({ title, category }));
  $("quick").value = "";
  save();
  render();
  toast("Dream added ✨");
});

$("cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]");
  if (!b) return;
  filter.cat = b.dataset.c;
  render();
});
$("status").addEventListener("click", (e) => {
  const b = e.target.closest("[data-s]");
  if (!b) return;
  filter.status = b.dataset.s;
  renderToolbar();
  renderList();
});
$("search").addEventListener("input", (e) => {
  filter.q = e.target.value.trim().toLowerCase();
  renderList();
});
$("sort").addEventListener("change", (e) => {
  filter.sort = e.target.value;
  renderList();
});
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  state.settings.view = b.dataset.view;
  save();
  render();
}));

/* ---------- Item actions ---------- */
function findItem(id) {
  return state.items.find((i) => i.id === id);
}

$("list").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const idea = e.target.closest("[data-idea]");
  if (idea) {
    state.items.unshift(newItem({ title: idea.dataset.idea, category: "Experiences" }));
    save();
    render();
    toast("Added from ideas ✨");
    return;
  }
  const cardEl = e.target.closest(".item");
  if (!cardEl) return;
  const item = findItem(cardEl.dataset.id);
  if (!item) return;
  const btn = e.target.closest("[data-act]");
  const act = btn?.dataset.act;
  if (act === "toggle") toggleDone(item);
  else if (act === "pin") { item.pinned = !item.pinned; save(); render(); }
  else if (act === "dup") duplicate(item);
  else if (act === "del") deleteItem(item);
  else if (!btn) openItem(item);
});

$("journal").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act='memory']");
  if (!b) return;
  const item = findItem(b.closest("[data-id]").dataset.id);
  if (item) openItem(item);
});

function toggleDone(item) {
  item.done = !item.done;
  item.completedAt = item.done ? Date.now() : 0;
  save();
  render();
  if (item.done) {
    confetti();
    toast("🎉 One more dream checked off!", { label: "Add memory", run: () => openItem(item) });
  }
}

function duplicate(item) {
  const copy = newItem({
    ...structuredClone(item),
    id: uid(), title: item.title + " (copy)", done: false, completedAt: 0, pinned: false,
    added: Date.now(), memory: "",
    steps: (item.steps || []).map((s) => ({ ...s, id: uid(), done: false }))
  });
  const idx = state.items.indexOf(item);
  state.items.splice(idx < 0 ? 0 : idx, 0, copy);
  save();
  render();
  toast("Duplicated");
}

function deleteItem(item) {
  const idx = state.items.indexOf(item);
  if (idx < 0) return;
  const [removed] = state.items.splice(idx, 1);
  save();
  render();
  toast(`Deleted “${removed.title}”`, {
    label: "Undo",
    run: () => { state.items.splice(idx, 0, removed); save(); render(); }
  });
}

/* ---------- Item dialog ---------- */
function renderPhotoPreview(src) {
  $("photoPrev").innerHTML = src ? `<img src="${esc(src)}" alt="">` : "No photo";
  $("removePhoto").classList.toggle("hide", !src);
}

function openItem(item) {
  editing = item || null;
  pendingPhoto = undefined;
  const f = $("itemForm");
  f.reset();
  $("itemTitle").textContent = item ? "Edit dream" : "New dream";
  if (item) {
    for (const k of ["title", "category", "priority", "date", "budget", "location", "url", "notes", "memory"]) {
      f.elements[k].value = item[k] || "";
    }
    f.elements.tags.value = (item.tags || []).join(", ");
    f.elements.steps.value = (item.steps || []).map((s) => s.text).join("\n");
  } else {
    f.elements.priority.value = "medium";
    f.elements.category.value = filter.cat !== "All" ? filter.cat : "Other";
  }
  renderPhotoPreview(item ? item.photo : "");
  $("deleteItemBtn").classList.toggle("hide", !item);
  $("dupItemBtn").classList.toggle("hide", !item);
  $("itemDlg").showModal();
  f.elements.title.focus();
}

$("itemDlg").addEventListener("close", () => { editing = null; pendingPhoto = undefined; });

$("itemForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const v = (k) => f.elements[k].value.trim();
  const url = cleanUrl(v("url"));
  if (url === null) {
    toast("That link doesn't look right");
    return;
  }
  const old = editing ? editing.steps || [] : [];
  const steps = v("steps").split("\n").map((s) => s.trim()).filter(Boolean).map((text) => {
    const prev = old.find((s) => s.text === text);
    return { id: prev ? prev.id : uid(), text, done: prev ? prev.done : false };
  });
  const data = {
    title: v("title"), category: v("category"), priority: v("priority"), date: v("date"),
    budget: v("budget"), location: v("location"), url, notes: v("notes"), memory: v("memory"),
    tags: v("tags").split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean).slice(0, 8),
    steps
  };
  if (pendingPhoto !== undefined) data.photo = pendingPhoto;

  const wasEdit = !!editing;
  if (editing) Object.assign(editing, data);
  else state.items.unshift(newItem(data));
  save();
  $("itemDlg").close();
  render();
  toast(wasEdit ? "Saved" : "Dream added ✨");
});

$("deleteItemBtn").onclick = () => {
  const it = editing;
  $("itemDlg").close();
  if (it) deleteItem(it);
};
$("dupItemBtn").onclick = () => {
  const it = editing;
  $("itemDlg").close();
  if (it) duplicate(it);
};
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close())
);

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
  f.elements.name.value = state.profile.name || "";
  f.elements.tagline.value = state.profile.tagline || "";
  profPhoto = undefined;
  renderProfPreview(state.profile.photo || "");
  $("profileDlg").showModal();
  f.elements.name.focus();
}
$("profileDlg").addEventListener("close", () => { profPhoto = undefined; });
$("who").addEventListener("click", openProfile);
$("avatar").addEventListener("click", openProfile);

$("profileForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  state.profile = {
    name: f.elements.name.value.trim() || "Your Name",
    tagline: f.elements.tagline.value.trim(),
    photo: profPhoto !== undefined ? profPhoto : state.profile.photo || ""
  };
  save();
  $("profileDlg").close();
  render();
});
$("profPhotoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    profPhoto = await compressImage(file);
    renderProfPreview(profPhoto);
  } catch {
    toast("Couldn't read that image");
  }
});
$("profRemove").onclick = () => { profPhoto = ""; renderProfPreview(""); };

/* ---------- Menu ---------- */
function renderSwatches() {
  $("swatches").innerHTML = ACCENTS.map((c, i) =>
    `<button class="swatch ${state.settings.accent === i ? "on" : ""}" data-accent="${i}" style="background:linear-gradient(135deg,${c[0]},${c[1]})" aria-label="Accent color ${i + 1}"></button>`
  ).join("");
}
$("swatches").addEventListener("click", (e) => {
  const b = e.target.closest("[data-accent]");
  if (!b) return;
  state.settings.accent = +b.dataset.accent;
  save();
  renderSwatches();
  applyAccent();
});

$("menuBtn").onclick = () => { renderSwatches(); $("menuDlg").showModal(); };
document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => runMenu(b.dataset.m)));

function runMenu(m) {
  $("menuDlg").close();
  if (m === "random") openRandom();
  if (m === "share") shareList();
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
  download(`bucket-list-${dateStamp()}.json`, "application/json", JSON.stringify(state, null, 2));
  toast("Backup exported");
}

function exportCSV() {
  const cols = ["title", "category", "priority", "date", "budget", "location", "url", "tags", "notes", "done", "completedAt", "memory", "steps"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = state.items.map((i) => cols.map((c) => {
    if (c === "steps") return (i.steps || []).map((s) => s.text).join("; ");
    if (c === "tags") return i.tags.join("; ");
    if (c === "done") return i.done ? "yes" : "no";
    if (c === "completedAt") return i.completedAt ? new Date(i.completedAt).toISOString() : "";
    return i[c];
  }).map(q).join(","));
  download(`bucket-list-${dateStamp()}.csv`, "text/csv", [cols.join(","), ...rows].join("\n"));
  toast("Spreadsheet exported");
}

async function shareList() {
  const p = state.profile;
  const done = state.items.filter((i) => i.done).length;
  const lines = state.items.map((i) => `${i.done ? "✅" : "⬜"} ${i.title}${i.date ? ` (${fmtDate(i.date)})` : ""}`);
  const text = `${p.name}'s bucket list: ${done}/${state.items.length} done\n\n${lines.join("\n")}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Bucket List", text });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("List copied to clipboard");
  } catch {
    toast("Sharing isn't available here");
  }
}

function eraseAll() {
  if (!confirm("Erase everything? This can't be undone unless you have a backup.")) return;
  state = normalize({ profile: { name: "Your Name", tagline: "", photo: "" }, settings: state.settings, items: [] });
  save();
  render();
  toast("Everything erased");
}

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.items)) throw new Error("bad file");
    if (!confirm("Replace your current list with this backup?")) return;
    state = normalize(data);
    save();
    render();
    toast("Backup imported ✨");
  } catch {
    toast("That file isn't a valid backup");
  }
});

/* ---------- Random dream ---------- */
function openRandom() {
  const open = state.items.filter((i) => !i.done);
  if (!open.length) {
    toast(state.items.length ? "Everything's done. Time to dream bigger 🚀" : "Add a dream first");
    return;
  }
  let pick = open[Math.floor(Math.random() * open.length)];
  if (open.length > 1 && randomId) {
    while (pick.id === randomId) pick = open[Math.floor(Math.random() * open.length)];
  }
  randomId = pick.id;
  $("randTitle").textContent = `${EMOJI[pick.category] || "⭐"} ${pick.title}`;
  $("randMeta").textContent = [pick.category, pick.location, countdown(pick.date)].filter(Boolean).join(" · ");
  if (!$("randDlg").open) $("randDlg").showModal();
}
$("randAgain").onclick = openRandom;
$("randOpen").onclick = () => {
  const item = findItem(randomId);
  $("randDlg").close();
  if (item) openItem(item);
};

/* ---------- Confetti & images ---------- */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#6366f1", "#a855f7", "#10b981", "#f59e0b", "#ec4899"];
  const box = document.createElement("div");
  box.className = "confetti";
  for (let n = 0; n < 60; n++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[n % colors.length];
    p.style.animationDelay = Math.random() * 0.3 + "s";
    p.style.setProperty("--x", (Math.random() - 0.5) * 200 + "px");
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2000);
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 640 / Math.max(img.width, img.height));
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

/* ---------- Theme ---------- */
function applyTheme(t) { document.documentElement.dataset.theme = t; }
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  applyTheme(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}
$("themeBtn").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(t);
  try { localStorage.setItem(THEME_KEY, t); } catch {}
};

/* ---------- Install ---------- */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
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
  if (document.querySelector("dialog[open]")) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "n") { e.preventDefault(); openItem(null); }
  else if (k === "/") { e.preventDefault(); setTab("dreams"); $("search").focus(); }
  else if (k === "r") openRandom();
  else if (k === "t") $("themeBtn").click();
  else if (k === "1") setTab("dreams");
  else if (k === "2") setTab("journal");
  else if (k === "3") setTab("stats");
});

/* ---------- Start ---------- */
function lockError(msg) { $("lockErr").textContent = msg || ""; }

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
    lockError(err.code === 401 ? "Wrong PIN" : err.message);
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && dirty) {
    clearTimeout(saveTimer);
    flush();
  }
});

initTheme();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
boot();
