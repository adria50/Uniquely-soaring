import { auth, db } from "./firebase.js?v=5";
import {
  GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const show = (id) => ["loading", "signin", "home", "client"].forEach((s) => ($(s).hidden = s !== id));

// ---------------- Sign in ----------------
let mode = "signin";
function setMsg(text, isError = true) { const m = $("msg"); m.textContent = text || ""; m.dataset.kind = isError ? "error" : "ok"; }
function friendly(err) {
  const c = (err && err.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "That email and password don't match. Try again, or tap Forgot password.";
  if (c.includes("email-already-in-use")) return "There's already an account with that email. Tap Sign in instead.";
  if (c.includes("weak-password")) return "Please use at least 6 characters for your password.";
  if (c.includes("invalid-email")) return "That email doesn't look right.";
  if (c.includes("popup-closed")) return "";
  if (c.includes("popup-blocked")) return "Your browser blocked the Google window. Allow pop-ups and try again.";
  if (c.includes("unauthorized-domain")) return "This web address isn't allowed to sign in yet.";
  if (c.includes("network")) return "No connection. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}
function setMode(m) {
  mode = m;
  $("form-title").textContent = m === "create" ? "Create your account" : "Sign in with email";
  $("submit").textContent = m === "create" ? "Create account" : "Sign in";
  $("password").autocomplete = m === "create" ? "new-password" : "current-password";
  $("switch").innerHTML = m === "create"
    ? 'Already have an account? <button type="button" class="link" id="switch-btn">Sign in</button>'
    : 'New here? <button type="button" class="link" id="switch-btn">Create an account</button>';
  $("switch-btn").onclick = () => setMode(mode === "create" ? "signin" : "create");
  $("forgot").hidden = m === "create";
  setMsg("");
}
$("google").onclick = async () => { setMsg(""); try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { setMsg(friendly(e)); } };
$("email-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const email = $("email").value.trim(), pw = $("password").value;
  $("submit").disabled = true; setMsg("");
  try { if (mode === "create") await createUserWithEmailAndPassword(auth, email, pw); else await signInWithEmailAndPassword(auth, email, pw); }
  catch (e) { setMsg(friendly(e)); }
  $("submit").disabled = false;
};
$("forgot").onclick = async () => {
  const email = $("email").value.trim();
  if (!email) { setMsg("Type your email above first, then tap Forgot password."); return; }
  try { await sendPasswordResetEmail(auth, email); setMsg("Check your email for a link to reset your password.", false); } catch (e) { setMsg(friendly(e)); }
};
document.querySelectorAll("[data-signout]").forEach((b) => (b.onclick = () => signOut(auth)));
setMode("signin");

// ---------------- Who am I, and which clients can I see ----------------
let me = { user: null, admin: false, clients: [] }; // clients: [{id,label}]

async function loadAccess(user) {
  me = { user, admin: false, clients: [] };
  // Only the admin may list everyone's access, so if this works, it's Adria.
  try { await getDocs(collection(db, "access")); me.admin = true; } catch (e) { me.admin = false; }
  if (me.admin) {
    const snap = await getDocs(collection(db, "clients"));
    me.clients = snap.docs.map((d) => ({ id: d.id, label: d.data().label || "Client: " + d.id }));
  } else {
    const a = await getDoc(doc(db, "access", (user.email || "").toLowerCase())).catch(() => null);
    const ids = (a && a.exists() && a.data().clients) || [];
    for (const id of ids) {
      const c = await getDoc(doc(db, "clients", id)).catch(() => null);
      me.clients.push({ id, label: (c && c.exists() && c.data().label) || "Client: " + id });
    }
  }
  me.clients.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------- Pages ----------------
const PAGES = [
  ["todo", "To-do"],
  ["staffing", "Staffing"],
  ["schedule", "Schedule"],
  ["goals", "Goals & progress"],
  ["services", "Services"]
];
let unsub = null;
const stopLive = () => { if (unsub) { unsub(); unsub = null; } };

function route() {
  stopLive();
  if (!me.user) return;
  const m = location.hash.match(/^#\/c\/([A-Za-z]+)(?:\/([a-z]+))?/);
  const client = m && me.clients.find((c) => c.id === m[1]);
  if (!client) return renderHome();
  if (me.clients.length === 1 && !m) return (location.hash = "#/c/" + client.id + "/todo");
  renderClient(client, (m && m[2]) || "todo");
}
window.addEventListener("hashchange", route);

function renderHome() {
  if (me.clients.length === 1 && !me.admin) { location.hash = "#/c/" + me.clients[0].id + "/todo"; return; }
  $("who").textContent = me.user.displayName || me.user.email;
  $("who-email").textContent = me.user.email;
  $("client-list").innerHTML = me.clients.length
    ? me.clients.map((c) => `<a class="client-card" href="#/c/${esc(c.id)}/todo"><span>${esc(c.label)}</span><span aria-hidden="true">›</span></a>`).join("")
    : `<p class="muted">${me.admin ? "No clients yet. Tap Import to add one." : "Your access is being set up. Once it's ready, you'll see your client here."}</p>`;
  $("admin-tools").hidden = !me.admin;
  show("home");
}

function renderClient(client, page) {
  $("client-title").textContent = client.label;
  $("back-home").hidden = !me.admin && me.clients.length === 1;
  $("page-tabs").innerHTML = PAGES.map(([k, l]) =>
    `<a href="#/c/${esc(client.id)}/${k}" class="tab" aria-current="${k === page}">${l}</a>`).join("");
  show("client");
  if (page === "todo") return renderTodo(client);
  if (page === "staffing") return renderStaffing(client);
  if (page === "schedule") return renderSchedule(client);
  $("page").innerHTML = `<div class="card"><p class="muted">Coming soon. We're building this page next.</p></div>`;
}

// ---------------- Page 1: To-do ----------------
let todos = [], doneOpen = false;
const todayKey = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
function dueLabel(due) {
  if (!due) return "";
  const t = todayKey();
  const [y, m, d] = due.split("-").map(Number);
  const nice = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (due < t) return `<span class="chip late">Overdue · ${nice}</span>`;
  if (due === t) return `<span class="chip today">Due today</span>`;
  return `<span class="chip">Due ${nice}</span>`;
}
const byDue = (a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : 0;

function renderTodo(client) {
  $("page").innerHTML = `<div id="todo-wrap"><p class="muted">Loading…</p></div>`;
  const col = collection(db, "clients", client.id, "todos");
  unsub = onSnapshot(col, (snap) => {
    todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    drawTodo(client);
  }, () => { $("todo-wrap").innerHTML = `<div class="card"><p class="error">Couldn't load the to-do list. Check your connection.</p></div>`; });
}

function row(t, client) {
  const done = t.status === "done";
  return `<div class="todo-row" data-done="${done}">
    <button class="check" aria-label="${done ? "Mark not done" : "Mark done"}" data-act="toggle" data-id="${esc(t.id)}">${done ? "✓" : ""}</button>
    <div class="todo-text"><div>${esc(t.text)}</div>${done ? "" : dueLabel(t.due)}</div>
    <select aria-label="Move" data-act="move" data-id="${esc(t.id)}">
      <option value="">⋯</option>
      ${t.status !== "todo" ? '<option value="todo">Move to To-do</option>' : ""}
      ${t.status !== "pending" ? '<option value="pending">Move to Pending</option>' : ""}
      ${t.status !== "done" ? '<option value="done">Mark done</option>' : ""}
      <option value="due">Change due date</option>
      <option value="delete">Delete</option>
    </select></div>`;
}

function drawTodo(client) {
  const open = todos.filter((t) => t.status === "todo").sort(byDue);
  const pending = todos.filter((t) => t.status === "pending").sort(byDue);
  const done = todos.filter((t) => t.status === "done").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  $("todo-wrap").innerHTML = `
    <div class="card">
      <h2>To-do <span class="count">${open.length}</span></h2>
      ${open.length ? open.map((t) => row(t, client)).join("") : `<p class="muted">All caught up. 🎉</p>`}
      <form id="add-form" class="add">
        <input id="add-text" placeholder="Add a to-do" autocomplete="off" required>
        <div class="add-row"><label class="due-label">Due <input id="add-due" type="date"></label><button class="btn primary small" type="submit">Add</button></div>
      </form>
    </div>
    <div class="card">
      <h2>Pending <span class="count">${pending.length}</span></h2>
      <p class="hint">Waiting on someone else. Nothing to do yet.</p>
      ${pending.length ? pending.map((t) => row(t, client)).join("") : `<p class="muted">Nothing pending.</p>`}
    </div>
    <div class="card">
      <details ${doneOpen ? "open" : ""} id="done-box"><summary><h2>Completed <span class="count">${done.length}</span></h2></summary>
      ${done.map((t) => row(t, client)).join("") || `<p class="muted">Nothing completed yet.</p>`}</details>
    </div>`;
  $("done-box").ontoggle = (e) => (doneOpen = e.target.open);
  $("add-form").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("add-text").value.trim(); if (!text) return;
    const id = "u" + Date.now().toString(36);
    await setDoc(doc(db, "clients", client.id, "todos", id), { text, status: "todo", due: $("add-due").value || null, doneAt: null, createdAt: serverTimestamp(), createdBy: me.user.email });
  };
  $("todo-wrap").querySelectorAll("[data-act]").forEach((el) => {
    const ref = doc(db, "clients", client.id, "todos", el.dataset.id);
    const t = todos.find((x) => x.id === el.dataset.id);
    if (el.dataset.act === "toggle") el.onclick = () => updateDoc(ref, t.status === "done" ? { status: "todo", doneAt: null } : { status: "done", doneAt: Date.now() });
    else el.onchange = async () => {
      const v = el.value; el.value = "";
      if (v === "delete") { if (confirm("Delete this to-do?")) await deleteDoc(ref); }
      else if (v === "due") { const d = prompt("New due date (like 2026-12-04). Leave blank for none.", t.due || ""); if (d !== null) await updateDoc(ref, { due: /^\d{4}-\d{2}-\d{2}$/.test(d.trim()) ? d.trim() : null }); }
      else if (v === "done") await updateDoc(ref, { status: "done", doneAt: Date.now() });
      else if (v) await updateDoc(ref, { status: v, doneAt: null });
    };
  });
}

// ---------------- Schedule helpers (shared by Staffing and Schedule) ----------------
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const mins = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + (m || 0); };
const fmtHM = (hm) => { let [h, m] = String(hm).split(":").map(Number); if (h === 24) h = 0; const ap = h < 12 ? "am" : "pm"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const dateKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
// Which week of the month. A weekend counts from its Friday, so Sat/Sun belong to that Friday's weekend.
function weekOfMonth(date, it) {
  const d = new Date(date);
  if (it.wk === "weekend") d.setDate(d.getDate() - ((d.getDay() + 2) % 7));
  return Math.ceil(d.getDate() / 7);
}
const applies = (it, date) => (it.d || []).includes(date.getDay()) && (!it.w || it.w.includes(weekOfMonth(date, it)));
function pickNote(it, date) {
  if (it.sbByDay && it.sbByDay[date.getDay()]) return it.sbByDay[date.getDay()];
  if (it.sbRot) return it.sbRot[date.getMonth()];
  if (it.sbByWk) { const w = weekOfMonth(date, it); return it.sbByWk[w] || ""; }
  return it.sb || "";
}
function timeRange(it) { if (!it.s) return ""; if (it.s === "00:00" && it.e === "24:00") return "All day"; return fmtHM(it.s) + "–" + fmtHM(it.e); }
// Who covers a block, in plain words
function coverOf(it) {
  const c = it.cover || "";
  const you = (s) => s.replace(/^You\b/, "Adria");
  if (it.open) return { who: you(it.byWho || (c.includes("·") ? c.split("·")[1].trim() : c && c !== "Respite" ? c : "No one yet")), kind: "gap" };
  if (/^IHSS \(you\)$/i.test(c) || /^You\b/.test(c)) return { who: "Adria", kind: "you" };
  if (c.includes("·")) { const [svc, who] = c.split("·").map((x) => x.trim()); return { who, svc, kind: "staff" }; }
  if (c) return { who: c, kind: "staff" };
  return { who: it.t, kind: "program" };
}

let sched = { current: [], sdp: [], switchDate: null, staff: [] };
async function loadSchedule(client) {
  const [cur, sdp, top, staff] = await Promise.all([
    getDoc(doc(db, "clients", client.id, "schedule", "current")),
    getDoc(doc(db, "clients", client.id, "schedule", "sdp")),
    getDoc(doc(db, "clients", client.id)),
    getDocs(collection(db, "clients", client.id, "staff"))
  ]);
  sched = {
    current: cur.exists() ? cur.data().items || [] : [],
    sdp: sdp.exists() ? sdp.data().items || [] : [],
    switchDate: top.exists() ? top.data().switchDate || null : null,
    staff: staff.docs.map((d) => d.data())
  };
}
const planFor = (date) => (sched.switchDate && dateKey(date) >= sched.switchDate && sched.sdp.length ? "sdp" : "current");
function blocksFor(date) {
  const list = sched[planFor(date)].length ? sched[planFor(date)] : sched.current.length ? sched.current : sched.sdp;
  return list.filter((it) => applies(it, date)).sort((a, b) => (a.s ? mins(a.s) : -1) - (b.s ? mins(b.s) : -1));
}
// Blocks happening right now, including last night's overnight that runs past midnight
function blocksNow() {
  const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const hits = blocksFor(now).filter((it) => it.s && (mins(it.e) > mins(it.s) ? nm >= mins(it.s) && nm < mins(it.e) : nm >= mins(it.s)));
  blocksFor(y).forEach((it) => { if (it.s && mins(it.e) <= mins(it.s) && it.e !== "24:00" && nm < mins(it.e)) hits.push(it); });
  return hits;
}

// ---------------- Page 2: Staffing ----------------
let staffDay = 0; // days from today
async function renderStaffing(client) {
  $("page").innerHTML = `<p class="muted">Loading…</p>`;
  try { await loadSchedule(client); } catch (e) { $("page").innerHTML = `<div class="card"><p class="error">Couldn't load staffing. Check your connection.</p></div>`; return; }
  drawStaffing(client);
}
function whoChip(it) {
  const c = coverOf(it);
  const cls = c.kind === "gap" ? "gap" : c.kind === "you" ? "you" : c.kind === "program" ? "prog" : "staff";
  const label = c.kind === "gap" ? (c.who === "No one yet" ? "Not covered" : `Not covered · ${esc(c.who)} covers`) : esc(c.who);
  return `<span class="who ${cls}">${label}</span>`;
}
function drawStaffing(client) {
  if (!sched.current.length && !sched.sdp.length) {
    $("page").innerHTML = `<div class="card"><p class="muted">No schedule yet. ${me.admin ? "Ask Claude for this client's import." : ""}</p></div>`; return;
  }
  const now = blocksNow();
  const day = new Date(); day.setDate(day.getDate() + staffDay);
  const blocks = blocksFor(day);
  const plan = planFor(day);
  const sw = sched.switchDate ? new Date(sched.switchDate + "T00:00") : null;
  const swNice = sw ? sw.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";
  const dayBtns = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i);
    return `<button class="day" aria-pressed="${i === staffDay}" data-day="${i}">${i === 0 ? "Today" : DAYS[d.getDay()].slice(0, 3)}</button>`; }).join("");
  $("page").innerHTML = `
    <div class="card now-card">
      <h2>On right now</h2>
      ${now.length ? now.map((it) => `<div class="now-row"><div><b>${esc(it.t)}</b><div class="muted small">${timeRange(it)}</div></div>${whoChip(it)}</div>`).join("") : `<p class="muted">Nothing scheduled right now.</p>`}
    </div>
    <div class="card">
      <h2>Who's working</h2>
      <div class="days">${dayBtns}</div>
      <p class="hint">${DAYS[day.getDay()]}, ${day.toLocaleDateString(undefined, { month: "long", day: "numeric" })} · ${plan === "sdp" ? "SDP plan" : "Current schedule"}${sw ? (plan === "sdp" ? ` (since ${swNice})` : ` (SDP plan starts ${swNice})`) : ""}</p>
      ${blocks.map((it) => `<div class="block-row${coverOf(it).kind === "gap" ? " is-gap" : ""}">
        <div class="block-time">${timeRange(it) || "Any time"}</div>
        <div class="block-main"><div><b>${esc(it.t)}</b></div>${pickNote(it, day) ? `<div class="muted small">${esc(pickNote(it, day))}</div>` : ""}</div>
        ${whoChip(it)}</div>`).join("") || `<p class="muted">Nothing scheduled.</p>`}
    </div>
    <div class="card">
      <h2>Staff</h2>
      ${sched.staff.map((s) => `<div class="staff-row">
        <div><b>${esc(s.name)}</b>${s.agencies && s.agencies.length ? `<div class="muted small">Through ${esc(s.agencies.join(", "))}</div>` : ""}
        ${s.contact ? `<div class="small"><a href="mailto:${esc(s.contact)}">${esc(s.contact)}</a></div>` : ""}</div>
        <div class="staff-hours">${Object.entries(s.hours || {}).map(([k, v]) => `<div class="small"><span class="muted">${esc(k)}:</span> ${esc(v)}</div>`).join("")}
        ${s.target ? `<div class="small"><span class="muted">Goal:</span> ${esc(s.target)}</div>` : ""}
        ${s.offTime ? `<div class="small"><span class="muted">Off:</span> ${esc(s.offTime)}</div>` : ""}</div></div>`).join("") || `<p class="muted">No staff added yet.</p>`}
      <p class="hint" style="margin-top:12px">Rules: no one works more than 8 hours a day, 40 hours a week, or 7 days in a row.</p>
    </div>`;
  $("page").querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => { staffDay = +b.dataset.day; drawStaffing(client); }));
}

// ---------------- Page 3: Schedule ----------------
let schedWeek = 0, schedPlan = "auto", gridOpen = false;
function weekStart(offset) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); return d; }
function itemsOn(date) {
  if (schedPlan === "auto") return blocksFor(date);
  const list = sched[schedPlan] || [];
  return list.filter((it) => applies(it, date)).sort((a, b) => (a.s ? mins(a.s) : -1) - (b.s ? mins(b.s) : -1));
}
async function renderSchedule(client) {
  $("page").innerHTML = `<p class="muted">Loading…</p>`;
  try { await loadSchedule(client); } catch (e) { $("page").innerHTML = `<div class="card"><p class="error">Couldn't load the schedule. Check your connection.</p></div>`; return; }
  drawSchedule(client);
}
function gridHTML(days) {
  const H = 22; // px per hour
  const hours = Array.from({ length: 25 }, (_, h) => `<div class="g-line" style="top:${h * H}px"></div>${h < 24 ? `<div class="g-hr" style="top:${h * H}px">${(h % 12) || 12}${h < 12 ? "a" : "p"}</div>` : ""}`).join("");
  const cols = days.map((d, i) => {
    const pieces = [];
    itemsOn(d).forEach((it) => {
      if (!it.s) return;
      const s = mins(it.s), e = it.e === "24:00" ? 1440 : mins(it.e);
      if (e > s) pieces.push([s, e, it]); else { pieces.push([s, 1440, it]); }
    });
    // overnight blocks from the day before that run past midnight
    const prev = new Date(d); prev.setDate(prev.getDate() - 1);
    itemsOn(prev).forEach((it) => { if (it.s && it.e !== "24:00" && mins(it.e) <= mins(it.s) && mins(it.e) > 0) pieces.push([0, mins(it.e), it]); });
    const bl = pieces.map(([s, e, it]) => { const k = coverOf(it).kind;
      return `<div class="g-block ${k}" style="top:${s / 60 * H}px;height:${Math.max(14, (e - s) / 60 * H - 2)}px" title="${esc(it.t)} · ${esc(coverOf(it).who)}"><b>${esc(it.t)}</b>${(e - s) >= 90 ? `<span>${esc(coverOf(it).who)}</span>` : ""}</div>`; }).join("");
    return `<div class="g-col"><div class="g-head">${DAYS[d.getDay()].slice(0, 3)}<small>${d.getMonth() + 1}/${d.getDate()}</small></div><div class="g-body" style="height:${24 * H}px">${bl}</div></div>`;
  }).join("");
  return `<div class="grid-wrap"><div class="g-hours"><div class="g-head"></div><div class="g-body" style="height:${24 * H}px">${hours}</div></div>${cols}</div>
    <div class="legend"><span class="who staff">Staff</span><span class="who you">Adria</span><span class="who prog">Program</span><span class="who gap">Not covered</span></div>`;
}
function drawSchedule(client) {
  if (!sched.current.length && !sched.sdp.length) { $("page").innerHTML = `<div class="card"><p class="muted">No schedule yet.</p></div>`; return; }
  const ws = weekStart(schedWeek);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d; });
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sw = sched.switchDate ? new Date(sched.switchDate + "T00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";
  const planBtns = [["auto", "By date"], ["current", "Current"], ["sdp", "SDP plan"]].filter(([k]) => k !== "sdp" || sched.sdp.length)
    .map(([k, l]) => `<button class="day" aria-pressed="${schedPlan === k}" data-plan="${k}">${l}</button>`).join("");
  const today = dateKey(new Date());
  $("page").innerHTML = `
    <div class="card">
      <div class="week-nav"><button class="day" data-wk="-1" aria-label="Previous week">‹</button><h2>${fmt(days[0])} – ${fmt(days[6])}</h2><button class="day" data-wk="1" aria-label="Next week">›</button></div>
      <div class="days">${planBtns}</div>
      <p class="hint">${schedPlan === "auto" ? (sw ? `Current schedule until ${sw}, then the SDP plan.` : "Current schedule.") : schedPlan === "sdp" ? "Showing the SDP plan for every day." : "Showing the current schedule for every day."}</p>
      <details class="grid-box" ${gridOpen ? "open" : ""} id="grid-box"><summary><span>📅 Week grid</span><span class="muted small">tap to ${gridOpen ? "close" : "open"}</span></summary>${gridOpen ? gridHTML(days) : ""}</details>
    </div>
    ${days.map((d) => { const items = itemsOn(d);
      return `<div class="card day-card${dateKey(d) === today ? " is-today" : ""}"><h2>${DAYS[d.getDay()]} <span class="muted small">${fmt(d)}${dateKey(d) === today ? " · today" : ""}</span></h2>
        ${items.map((it) => `<div class="block-row${coverOf(it).kind === "gap" ? " is-gap" : ""}"><div class="block-time">${timeRange(it) || "Any time"}</div>
          <div class="block-main"><b>${esc(it.t)}</b>${pickNote(it, d) ? `<div class="muted small">${esc(pickNote(it, d))}</div>` : ""}
          ${(it.tasks || []).length ? `<ul class="tasks">${it.tasks.map((t) => `<li><span class="muted">${fmtHM(t.s)}–${fmtHM(t.e)}</span> ${esc(t.t)}${t.sb ? ` <span class="muted">· ${esc(t.sb)}</span>` : ""}</li>`).join("")}</ul>` : ""}</div>
          ${whoChip(it)}</div>`).join("") || `<p class="muted">Nothing scheduled.</p>`}</div>`; }).join("")}`;
  $("page").querySelectorAll("[data-wk]").forEach((b) => (b.onclick = () => { schedWeek += +b.dataset.wk; drawSchedule(client); }));
  $("page").querySelectorAll("[data-plan]").forEach((b) => (b.onclick = () => { schedPlan = b.dataset.plan; drawSchedule(client); }));
  $("grid-box").ontoggle = (e) => { if (e.target.open !== gridOpen) { gridOpen = e.target.open; drawSchedule(client); } };
}

// ---------------- Import (Adria only) ----------------
$("import-file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (f) await importText(await f.text());
};
$("import-go").onclick = async () => {
  const t = $("import-text").value.trim();
  if (t && await importText(t)) $("import-text").value = "";
};
async function importText(text) {
  const out = $("import-msg");
  try {
    const data = JSON.parse(text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
    if (data.kind !== "uniquely-soaring-import" || !/^[A-Za-z]+$/.test(data.client || "")) throw new Error("not ours");
    const batch = writeBatch(db);
    const top = { label: data.label || "Client: " + data.client, updatedAt: serverTimestamp() };
    if (data.switchDate) top.switchDate = data.switchDate;
    batch.set(doc(db, "clients", data.client), top, { merge: true });
    (data.todos || []).forEach((t) => batch.set(doc(db, "clients", data.client, "todos", t.id), { text: t.text, status: t.status, due: t.due || null, doneAt: t.doneAt || null }));
    Object.entries(data.schedules || {}).forEach(([k, items]) => batch.set(doc(db, "clients", data.client, "schedule", k), { items }));
    (data.staff || []).forEach((s) => batch.set(doc(db, "clients", data.client, "staff", s.id), s));
    if (data.services) batch.set(doc(db, "clients", data.client, "info", "services"), { list: data.services });
    await batch.commit();
    const parts = [];
    if (data.todos) parts.push(data.todos.length + " to-dos");
    if (data.schedules) parts.push("schedule");
    if (data.staff) parts.push(data.staff.length + " staff");
    if (data.services) parts.push("services");
    out.textContent = `Imported ${top.label}: ${parts.join(", ")}. ✓`;
    out.dataset.kind = "ok";
    await loadAccess(me.user);
    if (!me.clients.some((c) => c.id === data.client)) me.clients.push({ id: data.client, label: top.label });
    location.hash = "#/c/" + data.client + "/" + (data.todos ? "todo" : "staffing");
    route();
    return true;
  } catch (err) {
    out.textContent = "That didn't import. Make sure you pasted the whole box from Claude.";
    out.dataset.kind = "error";
    return false;
  }
}

// ---------------- Start ----------------
onAuthStateChanged(auth, async (user) => {
  stopLive();
  if (!user) { me = { user: null, admin: false, clients: [] }; show("signin"); return; }
  show("loading");
  await loadAccess(user);
  route();
});
