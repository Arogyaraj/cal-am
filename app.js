/* Bucket List: app logic, no dependencies */
const KEY = "bucketlist-v2";
const THEME_KEY = "bucketlist-theme";
const CATS = ["Travel","Adventure","Learning","Health","Career","Creative","Food","Experiences","Other"];
const PRIO = { high: 0, medium: 1, low: 2 };
const RING = 2 * Math.PI * 52;

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayMs = () => new Date(new Date().toDateString()).getTime();
const dateStamp = () => new Date().toISOString().slice(0, 10);

const SAMPLE = {
  profile: { name: "Alex Morgan", tagline: "Things I want to do before I run out of time", photo: "" },
  items: [
    { title: "See the Northern Lights", category: "Travel", priority: "high", date: "", budget: "", location: "Tromsø, Norway", notes: "Go in winter, far from city lights.", done: false, steps: [{ id: uid(), text: "Check flight dates", done: true }, { id: uid(), text: "Book a cabin", done: false }] },
    { title: "Run a half marathon", category: "Health", priority: "medium", date: "", budget: "", location: "", notes: "", done: true, steps: [] },
    { title: "Learn to play piano", category: "Learning", priority: "medium", date: "", budget: "", location: "", notes: "", done: false, steps: [] }
  ]
};

function normalize(data) {
  const profile = { name: "Your Name", tagline: "", photo: "", ...(data.profile || {}) };
  const items = data.items.map((i) => ({
    id: i.id || uid(),
    title: String(i.title || "Untitled"),
    category: i.category || "Other",
    priority: PRIO[i.priority] !== undefined ? i.priority : "medium",
    date: i.date || "",
    budget: i.budget || "",
    location: i.location || "",
    notes: i.notes || "",
    photo: i.photo || "",
    done: !!i.done,
    added: i.added || Date.now(),
    completedAt: i.completedAt || 0,
    steps: (i.steps || []).map((s) => ({ id: s.id || uid(), text: String(s.text || ""), done: !!s.done }))
  }));
  return { profile, items };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.profile && Array.isArray(s.items)) return s;
  } catch {}
  return normalize({ ...structuredClone(SAMPLE), items: SAMPLE.items.map((i) => ({ ...structuredClone(i), added: Date.now() })) });
}

let state = load();
let filter = { cat: "All", status: "all", q: "", sort: "priority" };
let editing = null;     // item being edited, null when creating
let pendingPhoto;       // undefined = untouched, "" = removed, string = new data URL
let profPhoto;          // same, for the profile photo
let randomId = null;
let deferredPrompt = null;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    toast("Storage is full. Export a backup and remove some photos.");
    return false;
  }
}

let toastTimer;
function toast(msg, action) {
  $("toastMsg").textContent = msg;
  const b = $("toastAct");
  if (action) {
    b.textContent = action.label;
    b.classList.remove("hide");
    b.onclick = () => { action.run(); $("toast").classList.remove("show"); };
  } else {
    b.classList.add("hide");
    b.onclick = null;
  }
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), action ? 5000 : 2200);
}

function fmtDate(d) {
  return new Date(d + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function countdown(d) {
  if (!d) return "";
  const diff = Math.round((new Date(d + "T00:00") - todayMs()) / 864e5);
  if (diff < 0) return `Overdue by ${-diff}d`;
  if (diff === 0) return "Today!";
  return `${diff}d left`;
}

/* ---------- Rendering ---------- */
function renderProfile() {
  const p = state.profile;
  $("name").textContent = p.name || "Your Name";
  $("tagline").textContent = p.tagline || "";
  $("tagline").classList.toggle("hide", !p.tagline);
  const initials = (p.name || "?").trim().split(/\s+/).map((w) => w[0] || "").slice(0, 2).join("").toUpperCase() || "?";
  $("avatar").innerHTML = p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials);
  document.title = `${p.name || "My"}'s Bucket List`;
}

function renderCats() {
  const counts = {};
  state.items.forEach((i) => (counts[i.category] = (counts[i.category] || 0) + 1));
  if (filter.cat !== "All" && !counts[filter.cat]) filter.cat = "All";
  const cats = [...new Set([...CATS, ...Object.keys(counts)])].filter((c) => counts[c]);
  const chips = [["All", state.items.length], ...cats.map((c) => [c, counts[c]])];
  $("cats").innerHTML = chips
    .map(([c, n]) => `<button class="chip ${filter.cat === c ? "on" : ""}" data-c="${esc(c)}">${esc(c)} <span style="opacity:.6">${n}</span></button>`)
    .join("");
}

function renderStats() {
  const total = state.items.length;
  const done = state.items.filter((i) => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("sTotal").textContent = total;
  $("sDone").textContent = done;
  $("sLeft").textContent = total - done;
  $("ringPct").textContent = pct + "%";
  $("ringFill").style.strokeDasharray = RING;
  $("ringFill").style.strokeDashoffset = RING * (1 - pct / 100);
}

function visible() {
  const arr = state.items.filter((i) =>
    (filter.cat === "All" || i.category === filter.cat) &&
    (filter.status === "all" || (filter.status === "done") === i.done) &&
    (!filter.q || (i.title + " " + i.notes + " " + i.location + " " + i.category).toLowerCase().includes(filter.q))
  );
  arr.sort((a, b) => {
    if (filter.sort === "date") return (a.date || "9999").localeCompare(b.date || "9999");
    if (filter.sort === "added") return b.added - a.added;
    if (filter.sort === "name") return a.title.localeCompare(b.title);
    return (PRIO[a.priority] ?? 1) - (PRIO[b.priority] ?? 1);
  });
  return arr;
}

function card(i) {
  const steps = i.steps || [];
  const stepsDone = steps.filter((s) => s.done).length;
  const cd = i.done ? "" : countdown(i.date);
  return `
  <article class="card item ${i.done ? "done" : ""}" data-id="${i.id}">
    ${i.photo ? `<img class="thumb" src="${esc(i.photo)}" alt="" loading="lazy">` : ""}
    <div class="item-body">
      <div class="row1">
        <button class="check" data-act="toggle" aria-label="Mark as ${i.done ? "not done" : "done"}">${i.done ? "✓" : ""}</button>
        <h3 class="title">${esc(i.title)}</h3>
      </div>
      <div class="meta">
        <span class="tag-pill">${esc(i.category)}</span>
        <span class="prio-${esc(i.priority)}">● ${esc(i.priority)}</span>
        ${i.date ? `<span>📅 ${fmtDate(i.date)}</span>` : ""}
        ${cd ? `<span class="cd">${cd}</span>` : ""}
        ${i.location ? `<span>📍 ${esc(i.location)}</span>` : ""}
        ${i.budget ? `<span>💰 ${esc(i.budget)}</span>` : ""}
      </div>
      ${steps.length ? `<div class="steps-bar"><i style="width:${(stepsDone / steps.length) * 100}%"></i></div>
      <p class="muted steps-note">${stepsDone}/${steps.length} steps</p>` : ""}
      ${i.notes ? `<p class="notes">${esc(i.notes)}</p>` : ""}
    </div>
    <div class="item-actions">
      <button class="icon-btn sm" data-act="edit" aria-label="Edit">✎</button>
      <button class="icon-btn sm" data-act="del" aria-label="Delete">✕</button>
    </div>
  </article>`;
}

function renderList() {
  const arr = visible();
  if (!arr.length) {
    $("list").innerHTML = `<div class="empty">${state.items.length
      ? "Nothing matches these filters."
      : "Your list is empty. Add your first dream ✨"}</div>`;
    return;
  }
  $("list").innerHTML = arr.map(card).join("");
}

function render() {
  renderProfile();
  renderCats();
  renderStats();
  document.querySelectorAll("#status [data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === filter.status));
  renderList();
}

/* ---------- Filters ---------- */
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
  render();
});
$("search").addEventListener("input", (e) => {
  filter.q = e.target.value.trim().toLowerCase();
  renderList();
});
$("sort").addEventListener("change", (e) => {
  filter.sort = e.target.value;
  renderList();
});

/* ---------- Item actions ---------- */
$("list").addEventListener("click", (e) => {
  const cardEl = e.target.closest(".item");
  if (!cardEl) return;
  const item = state.items.find((i) => i.id === cardEl.dataset.id);
  if (!item) return;
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "toggle") toggleDone(item);
  else if (act === "edit") openItem(item);
  else if (act === "del") deleteItem(item);
  else if (!e.target.closest("button")) openItem(item);
});

function toggleDone(item) {
  item.done = !item.done;
  item.completedAt = item.done ? Date.now() : 0;
  if (!save()) return;
  render();
  if (item.done) {
    confetti();
    toast("🎉 One more dream checked off!");
  }
}

function deleteItem(item) {
  const idx = state.items.indexOf(item);
  if (idx < 0) return;
  const [removed] = state.items.splice(idx, 1);
  save();
  render();
  toast(`Deleted "${removed.title}"`, {
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
    for (const k of ["title", "category", "priority", "date", "budget", "location", "notes"]) {
      f.elements[k].value = item[k] || "";
    }
    f.elements.steps.value = (item.steps || []).map((s) => s.text).join("\n");
  } else {
    f.elements.priority.value = "medium";
  }
  renderPhotoPreview(item ? item.photo : "");
  $("deleteItemBtn").classList.toggle("hide", !item);
  $("itemDlg").showModal();
  f.elements.title.focus();
}

$("itemDlg").addEventListener("close", () => { editing = null; pendingPhoto = undefined; });

$("itemForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const v = (k) => f.elements[k].value.trim();
  const old = editing ? editing.steps || [] : [];
  const steps = v("steps").split("\n").map((s) => s.trim()).filter(Boolean).map((text) => {
    const prev = old.find((s) => s.text === text);
    return { id: prev ? prev.id : uid(), text, done: prev ? prev.done : false };
  });
  const data = {
    title: v("title"), category: v("category"), priority: v("priority"), date: v("date"),
    budget: v("budget"), location: v("location"), notes: v("notes"), steps
  };
  if (pendingPhoto !== undefined) data.photo = pendingPhoto;

  if (editing) {
    Object.assign(editing, data);
  } else {
    state.items.unshift({ id: uid(), done: false, completedAt: 0, added: Date.now(), photo: "", ...data });
  }
  if (!save()) return;
  const wasEdit = !!editing;
  $("itemDlg").close();
  render();
  toast(wasEdit ? "Saved" : "Dream added ✨");
});

$("deleteItemBtn").onclick = () => {
  const it = editing;
  $("itemDlg").close();
  if (it) deleteItem(it);
};
$("addBtn").onclick = () => openItem(null);

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

/* ---------- Profile dialog ---------- */
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
document.querySelector(".who").addEventListener("click", openProfile);
$("avatar").addEventListener("click", openProfile);

$("profileForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  state.profile = {
    name: f.elements.name.value.trim() || "Your Name",
    tagline: f.elements.tagline.value.trim(),
    photo: profPhoto !== undefined ? profPhoto : state.profile.photo || ""
  };
  if (!save()) return;
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
$("menuBtn").onclick = () => $("menuDlg").showModal();
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
  const cols = ["title", "category", "priority", "date", "budget", "location", "notes", "done", "steps"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = state.items.map((i) =>
    cols.map((c) => {
      if (c === "steps") return (i.steps || []).map((s) => s.text).join("; ");
      if (c === "done") return i.done ? "yes" : "no";
      return i[c];
    }).map(q).join(",")
  );
  download(`bucket-list-${dateStamp()}.csv`, "text/csv", [cols.join(","), ...rows].join("\n"));
  toast("Spreadsheet exported");
}

async function shareList() {
  const p = state.profile;
  const lines = state.items.map((i) => `${i.done ? "✅" : "⬜"} ${i.title}${i.date ? ` (${fmtDate(i.date)})` : ""}`);
  const done = state.items.filter((i) => i.done).length;
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
  state = { profile: { name: "Your Name", tagline: "", photo: "" }, items: [] };
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
  $("randTitle").textContent = pick.title;
  $("randMeta").textContent = [pick.category, pick.location, countdown(pick.date)].filter(Boolean).join(" · ");
  if (!$("randDlg").open) $("randDlg").showModal();
}
$("randAgain").onclick = openRandom;
$("randOpen").onclick = () => {
  const item = state.items.find((i) => i.id === randomId);
  $("randDlg").close();
  if (item) openItem(item);
};

/* ---------- Confetti ---------- */
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899"];
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

/* ---------- Images ---------- */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
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
  if (document.querySelector("dialog[open]")) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "n") { e.preventDefault(); openItem(null); }
  else if (k === "/") { e.preventDefault(); $("search").focus(); }
  else if (k === "r") openRandom();
  else if (k === "t") $("themeBtn").click();
});

document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close())
);

/* ---------- Init ---------- */
initTheme();
render();
if (new URLSearchParams(location.search).has("new")) {
  history.replaceState(null, "", location.pathname);
  openItem(null);
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
