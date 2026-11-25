import { auth, db } from "./firebase.js?v=19";
import {
  GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut, sendEmailVerification
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
  try {
    if (mode === "create") { const cred = await createUserWithEmailAndPassword(auth, email, pw); await sendEmailVerification(cred.user).catch(() => {}); }
    else await signInWithEmailAndPassword(auth, email, pw);
  }
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

// "Client: AW (Aria)" shows as "Client: AW"
const shortLabel = (l) => String(l).replace(/\s*\([^)]*\)\s*$/, "");
// Supervisors first, then clients
const sortKey = (c) => (c.id === "SUP" ? "0" : "1" + c.id);
async function loadAccess(user) {
  me = { user, admin: false, clients: [] };
  // Only the admin may list everyone's access, so if this works, it's Adria.
  try { await getDocs(collection(db, "access")); me.admin = true; } catch (e) { me.admin = false; }
  if (me.admin) {
    const snap = await getDocs(collection(db, "clients"));
    me.clients = snap.docs.map((d) => ({ id: d.id, label: shortLabel(d.data().label || "Client: " + d.id) }));
  } else {
    const a = await getDoc(doc(db, "access", (user.email || "").toLowerCase())).catch(() => null);
    const ids = (a && a.exists() && a.data().clients) || [];
    me.supTab = (a && a.exists() && a.data().supTab) || null;
    for (const id of ids) {
      const c = await getDoc(doc(db, "clients", id)).catch(() => null);
      me.clients.push({ id, label: shortLabel((c && c.exists() && c.data().label) || "Client: " + id) });
    }
  }
  me.clients.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

// ---------------- Email check (for people who signed up with a password) ----------------
$("verify-done").onclick = async () => {
  await auth.currentUser.reload();
  if (auth.currentUser.emailVerified) { await auth.currentUser.getIdToken(true); me.user = auth.currentUser; await loadAccess(me.user); route(); }
  else { $("verify-msg").textContent = "Not confirmed yet. Check your email (and spam) for the link."; $("verify-msg").className = "small error"; }
};
$("verify-resend").onclick = async () => {
  try { await sendEmailVerification(auth.currentUser); $("verify-msg").textContent = "Sent. Check your email."; $("verify-msg").className = "small ok"; }
  catch (e) { $("verify-msg").textContent = "Couldn't send right now. Wait a minute and try again."; $("verify-msg").className = "small error"; }
};

// ---------------- Access (Adria only): who can see which client ----------------
async function drawAccess() {
  const list = $("access-list");
  let rows = [];
  try { rows = (await getDocs(collection(db, "access"))).docs.map((d) => ({ email: d.id, clients: d.data().clients || [], supTab: d.data().supTab || null })); }
  catch (e) { list.innerHTML = `<p class="error small">Couldn't load the access list.</p>`; return; }
  const label = (id) => (me.clients.find((c) => c.id === id) || { label: id }).label.replace(/^Client:\s*/, "");
  list.innerHTML = rows.length ? rows.map((r) => `<div class="access-row"><div><b>${esc(r.email)}</b><div class="muted small">${esc(r.clients.map(label).join(", ") || "Nothing")}${r.supTab ? " · edits " + esc((SUP_TABS.find((t) => t.id === r.supTab) || {}).name || r.supTab) : ""}</div></div><button class="link del" data-rm="${esc(r.email)}">Remove</button></div>`).join("")
    : `<p class="muted small">Only you, so far.</p>`;
  $("access-picks").innerHTML = me.clients.map((c) => `<label class="pick"><input type="checkbox" value="${esc(c.id)}"> ${esc(c.label.replace(/^Client:\s*/, ""))}</label>`).join("")
    + `<label for="access-tab">Their supervisor tab (the one they can change)</label><select id="access-tab"><option value="">None</option>${SUP_TABS.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>`;
  list.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.rm}? They won't be able to see anything.`)) return;
    await deleteDoc(doc(db, "access", b.dataset.rm)); drawAccess();
  }));
}
$("access-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("access-email").value.trim().toLowerCase();
  const clients = [...document.querySelectorAll("#access-picks input:checked")].map((x) => x.value);
  const msg = $("access-msg");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "That email doesn't look right."; msg.className = "small error"; return; }
  if (!clients.length) { msg.textContent = "Check at least one client."; msg.className = "small error"; return; }
  try {
    const supTab = $("access-tab").value || null;
    if (supTab && !clients.includes("SUP")) clients.push("SUP");
    await setDoc(doc(db, "access", email), { clients, supTab, updatedAt: serverTimestamp() });
    msg.textContent = `Done. ${email} can sign in at uniquelysoaring.com now.`; msg.className = "small ok";
    $("access-email").value = ""; drawAccess();
  } catch (err) { msg.textContent = "Didn't save. Try again."; msg.className = "small error"; }
};

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
  $("verify-box").hidden = !!me.user.emailVerified;
  $("access-box").hidden = !me.admin;
  if (me.admin) drawAccess();
  show("home");
}

function renderClient(client, page) {
  $("client-title").textContent = client.label;
  $("back-home").hidden = !me.admin && me.clients.length === 1;
  const pages = client.id === "SUP" ? SUP_TABS.map((t) => [t.id, t.name]) : PAGES;
  if (!pages.some(([k]) => k === page)) page = pages[0][0];
  $("page-tabs").innerHTML = pages.map(([k, l]) =>
    `<a href="#/c/${esc(client.id)}/${k}" class="tab" aria-current="${k === page}">${l}</a>`).join("");
  show("client");
  if (client.id === "SUP") return renderSupTab(client, SUP_TABS.find((t) => t.id === page));
  if (page === "todo") return renderTodo(client);
  if (page === "staffing") return renderStaffing(client);
  if (page === "schedule") return renderSchedule(client);
  if (page === "services") return renderServices(client);
  if (page === "goals") return renderGoals(client);
  $("page").innerHTML = `<div class="card"><p class="muted">Coming soon. We're building this page next.</p></div>`;
}

// ---------------- Supervisors: one tab per supervisor ----------------
const SUP_TABS = [
  { id: "ujourni", name: "UJourni", supervises: "AW" },
  { id: "dlipscomb", name: "DLipscomb", supervises: "EzW" },
  { id: "third", name: "TSupervisor", supervises: "EdW" }
];
let supWeek = 0, supEdit = null, supForm = null; // supForm: null, or {i: index or -1}
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const wkText = (w) => !w || w.length === 5 ? "every week" : "week " + w.join(", ");
// Hours per day for each week of the month, to catch days over 8 hours
function overLimits(all) {
  const out = [];
  for (let w = 1; w <= 5; w++) DAY_ORDER.forEach((d) => {
    const m = all.filter((it) => (it.d || []).includes(d) && (!it.w || it.w.includes(w))).reduce((t, it) => t + mins(it.e) - mins(it.s), 0);
    if (m > 480) out.push(`${DAYS[d]} in week ${w}: ${Math.round(m / 6) / 10} hrs`);
  });
  return out;
}
function drawSupEditor(client, tab, all, flex) {
  const box = $("sup-sched");
  const sorted = all.map((it, i) => ({ it, i })).sort((a, b) => DAY_ORDER.indexOf(a.it.d[0]) - DAY_ORDER.indexOf(b.it.d[0]) || mins(a.it.s) - mins(b.it.s));
  const f = supForm ? (supForm.i >= 0 ? all[supForm.i] : { d: [], w: [1, 2, 3, 4, 5], s: "09:00", e: "10:00", t: "", sb: "" }) : null;
  const warn = overLimits(all);
  box.innerHTML = `
    <p class="hint">Changes save for everyone right away.</p>
    ${warn.length ? `<div class="notice small"><b>Over 8 hours:</b> ${esc(warn.join(" · "))}</div>` : ""}
    ${f ? `<form id="sup-form" class="edit-form">
        <h3>${supForm.i >= 0 ? "Change this block" : "Add a block"}</h3>
        <label for="sf-t">What</label><input id="sf-t" required value="${esc(f.t)}" placeholder="Observe morning PA">
        <label for="sf-sb">Notes (optional)</label><input id="sf-sb" value="${esc(f.sb || "")}">
        <label>Day</label><div class="checks">${DAY_ORDER.map((d) => `<label class="pick"><input type="checkbox" name="sf-d" value="${d}" ${(f.d || []).includes(d) ? "checked" : ""}> ${DAYS[d].slice(0, 3)}</label>`).join("")}</div>
        <div class="add-row"><label class="due-label">From <input id="sf-s" type="time" value="${esc(f.s)}" required></label><label class="due-label">To <input id="sf-e" type="time" value="${esc(f.e)}" required></label></div>
        <label>Which weeks of the month</label><div class="checks">${[1, 2, 3, 4, 5].map((w) => `<label class="pick"><input type="checkbox" name="sf-w" value="${w}" ${!f.w || f.w.includes(w) ? "checked" : ""}> Week ${w}</label>`).join("")}</div>
        <div class="add-row"><button class="btn" type="button" id="sf-cancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
        <div id="sf-msg" class="small error" role="status"></div>
      </form>` : `<button class="btn primary" id="sup-add" type="button">+ Add a block</button>`}
    <div class="edit-list">${sorted.map(({ it, i }) => `<div class="block-row"><div class="block-main"><b>${esc(it.t)}</b>
        <div class="muted small">${(it.d || []).map((d) => DAYS[d].slice(0, 3)).join(", ")} · ${fmtHM(it.s)}–${fmtHM(it.e)} · ${wkText(it.w)}</div></div>
        <button class="link" data-edit="${i}">Change</button><button class="link del" data-delb="${i}">Delete</button></div>`).join("") || `<p class="muted">No blocks yet.</p>`}</div>
    <form id="flex-form" class="edit-form">
      <h3>Hours they schedule themselves</h3>
      <div class="add-row"><label class="due-label">Hours a week <input id="fx-h" type="number" min="0" max="6" step="0.5" value="${esc(flex ? flex.hours : 0)}"></label></div>
      <label for="fx-sb">What they're for</label><input id="fx-sb" value="${esc(flex ? flex.sb || "" : "")}" placeholder="School observation, meetings…">
      <button class="btn" type="submit">Save hours</button><div id="fx-msg" class="small" role="status"></div>
    </form>
    <button class="btn primary" id="sup-done" type="button">Done editing</button>`;
  const ref = doc(db, "clients", "SUP", "people", tab.id);
  const redraw = () => renderSupTab(client, tab);
  $("sup-done").onclick = () => { supEdit = null; supForm = null; stopLive(); redraw(); };
  if ($("sup-add")) $("sup-add").onclick = () => { supForm = { i: -1 }; stopLive(); redraw(); };
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { supForm = { i: +b.dataset.edit }; stopLive(); redraw(); window.scrollTo({ top: box.offsetTop - 60, behavior: "smooth" }); }));
  box.querySelectorAll("[data-delb]").forEach((b) => (b.onclick = async () => {
    const it = all[+b.dataset.delb]; if (!confirm(`Delete "${it.t}"?`)) return;
    await setDoc(ref, { schedule: all.filter((_, j) => j !== +b.dataset.delb) }, { merge: true }); supForm = null; stopLive(); redraw();
  }));
  if (f) {
    $("sf-cancel").onclick = () => { supForm = null; stopLive(); redraw(); };
    $("sup-form").onsubmit = async (e) => {
      e.preventDefault();
      const d = [...box.querySelectorAll('input[name="sf-d"]:checked')].map((x) => +x.value);
      const w = [...box.querySelectorAll('input[name="sf-w"]:checked')].map((x) => +x.value);
      const st = $("sf-s").value, en = $("sf-e").value;
      if (!d.length) return ($("sf-msg").textContent = "Pick at least one day.");
      if (!w.length) return ($("sf-msg").textContent = "Pick at least one week.");
      if (mins(en) <= mins(st)) return ($("sf-msg").textContent = "The end time needs to be after the start time.");
      const item = { d, w, s: st, e: en, t: $("sf-t").value.trim(), sb: $("sf-sb").value.trim() };
      const next = all.slice(); if (supForm.i >= 0) next[supForm.i] = item; else next.push(item);
      try { await setDoc(ref, { schedule: next }, { merge: true }); supForm = null; stopLive(); redraw(); }
      catch (err) { $("sf-msg").textContent = "Didn't save. Check your connection."; }
    };
  }
  $("flex-form").onsubmit = async (e) => {
    e.preventDefault();
    const h = Math.max(0, Math.min(6, +$("fx-h").value || 0));
    try { await setDoc(ref, { flex: { hours: h, t: (flex && flex.t) || "They schedule", sb: $("fx-sb").value.trim() } }, { merge: true }); $("fx-msg").textContent = "Saved ✓"; $("fx-msg").className = "small ok"; }
    catch (err) { $("fx-msg").textContent = "Didn't save."; $("fx-msg").className = "small error"; }
  };
}
async function renderSupTab(client, tab) {
  $("page").innerHTML = `
    <div class="card"><h2>${esc(tab.name)}</h2>
      <p class="muted">${tab.supervises ? "Supervises Client: " + esc(tab.supervises) : "Not hired yet"}</p></div>
    <div class="card"><h2>Schedule</h2><div id="sup-sched"><p class="muted">Loading…</p></div></div>
    <div id="sup-todo"></div>`;
  // their to-do list (re-uses the To-do page, saved under this supervisor)
  $("sup-todo").innerHTML = `<div id="todo-wrap"><p class="muted">Loading…</p></div>`;
  const col = collection(db, "clients", "SUP", "people", tab.id, "todos");
  todoPath = ["clients", "SUP", "people", tab.id, "todos"];
  todoReadOnly = !(me.admin || me.supTab === tab.id);
  unsub = onSnapshot(col, (snap) => { todos = snap.docs.map((d) => ({ id: d.id, ...d.data() })); drawTodo(client); },
    () => { $("todo-wrap").innerHTML = `<div class="card"><p class="error">Couldn't load the to-do list.</p></div>`; });
  // their weekly schedule
  try {
    const sd = await getDoc(doc(db, "clients", "SUP", "people", tab.id));
    const all = (sd.exists() && sd.data().schedule) || [];
    const flex = (sd.exists() && sd.data().flex) || null; // hours they schedule themselves
    const mine = me.admin || me.supTab === tab.id;
    if (supEdit === tab.id && mine) return drawSupEditor(client, tab, all, flex);
    const rotates = all.some((it) => it.w);
    if (!supWeek) supWeek = Math.min(5, Math.ceil(new Date().getDate() / 7));
    const items = all.filter((it) => !it.w || it.w.includes(supWeek));
    const byDay = [1, 2, 3, 4, 5, 6, 0].map((d) => [d, items.filter((it) => (it.d || []).includes(d)).sort((a, b) => mins(a.s) - mins(b.s))]).filter(([, l]) => l.length);
    const total = items.reduce((m, it) => m + (it.d || []).length * (mins(it.e) - mins(it.s)), 0);
    const nowWk = Math.min(5, Math.ceil(new Date().getDate() / 7));
    const weekBtns = rotates ? `<div class="days">${[1, 2, 3, 4, 5].map((w) => `<button class="day" aria-pressed="${w === supWeek}" data-supwk="${w}">Week ${w}${w === nowWk ? " · now" : ""}</button>`).join("")}</div>` : "";
    const flexH = flex ? flex.hours || 0 : 0;
    const sumTxt = total ? `${Math.round(total / 6) / 10} hrs set${flexH ? ` + ${flexH} hrs they schedule = ${Math.round(total / 6) / 10 + flexH} hrs` : ""} ${rotates ? "in week " + supWeek + " of the month" : "a week"}` : "";
    const flexRow = flex ? `<div class="block-row flex-row"><div class="block-time">${flexH} hrs</div><div class="block-main"><b>${esc(flex.t || "Flexible")}</b>${flex.sb ? `<div class="muted small">${esc(flex.sb)}</div>` : ""}</div></div>` : "";
    $("sup-sched").innerHTML = weekBtns + (sumTxt ? `<p class="hint">${sumTxt}</p>` : "") + flexRow + (byDay.length ? byDay.map(([d, l]) => `<div class="block-row"><div class="block-time">${DAYS[d]}</div><div class="block-main">${l.map((it) => `<div><b>${fmtHM(it.s)}–${fmtHM(it.e)}</b> ${esc(it.t || "")}${it.sb ? `<div class="muted small">${esc(it.sb)}</div>` : ""}</div>`).join("")}</div></div>`).join("")
      : `<p class="muted">No hours set yet.</p>`);
    if (mine) $("sup-sched").insertAdjacentHTML("beforeend", `<button class="btn" id="sup-edit" type="button" style="margin-top:14px">✏️ Edit schedule</button>`);
    if (mine) $("sup-edit").onclick = () => { supEdit = tab.id; supForm = null; stopLive(); renderSupTab(client, tab); };
    $("sup-sched").querySelectorAll("[data-supwk]").forEach((b) => (b.onclick = () => { supWeek = +b.dataset.supwk; stopLive(); renderSupTab(client, tab); }));
  } catch (e) { $("sup-sched").innerHTML = `<p class="error small">Couldn't load the schedule.</p>`; }
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

let todoPath = [], todoReadOnly = false;
function renderTodo(client, path) {
  todoReadOnly = false;
  todoPath = path || ["clients", client.id, "todos"];
  $("page").innerHTML = `<div id="todo-wrap"><p class="muted">Loading…</p></div>`;
  const col = collection(db, ...todoPath);
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
      <option value="text">Change wording</option>
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
  if (todoReadOnly) {
    $("add-form").remove();
    $("todo-wrap").querySelectorAll("[data-act]").forEach((el) => (el.disabled = true));
    return;
  }
  $("add-form").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("add-text").value.trim(); if (!text) return;
    const id = "u" + Date.now().toString(36);
    await setDoc(doc(db, ...todoPath, id), { text, status: "todo", due: $("add-due").value || null, doneAt: null, createdAt: serverTimestamp(), createdBy: me.user.email });
  };
  $("todo-wrap").querySelectorAll("[data-act]").forEach((el) => {
    const ref = doc(db, ...todoPath, el.dataset.id);
    const t = todos.find((x) => x.id === el.dataset.id);
    if (el.dataset.act === "toggle") el.onclick = () => updateDoc(ref, t.status === "done" ? { status: "todo", doneAt: null } : { status: "done", doneAt: Date.now() });
    else el.onchange = async () => {
      const v = el.value; el.value = "";
      if (v === "delete") { if (confirm("Delete this to-do?")) await deleteDoc(ref); }
      else if (v === "text") { const t2 = prompt("Change the wording:", t.text); if (t2 !== null && t2.trim()) await updateDoc(ref, { text: t2.trim() }); }
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
  if (it.open) return { who: you(it.byWho || (c.includes("·") ? c.split("·")[1].trim() : /^You\b/.test(c) ? c : "No one yet")), kind: "gap" };
  if (it.who) return { who: it.who, kind: "staff" };
  if (/^IHSS \(you\)$/i.test(c) || /^You\b/.test(c)) return { who: "Adria", kind: "you" };
  if (c.includes("·")) { const [svc, who] = c.split("·").map((x) => x.trim()); return { who, svc, kind: "staff" }; }
  if (c) return { who: c, kind: "staff" };
  return { who: it.t, kind: "program" };
}

let sched = { current: [], sdp: [], switchDate: null, staff: [] }, plans = {};
// What a "Day Program" block holds on a given date (from the day program plans)
const PLAN_DAY = { 2: "tue", 3: "wed", 4: "thu", 5: "fri" };
function planOn(it, date) {
  const k = it.plan || (it.t === "Day Program" ? PLAN_DAY[date.getDay()] : null);
  const p = k && plans[k]; if (!p) return null;
  if (p.tasks) return { title: p.title, tasks: p.tasks };
  const v = p.by && p.by[Math.ceil(date.getDate() / 7) + "-" + date.getMonth()]; if (!v) return null;
  return { title: v[0], options: v[1].map((i) => p.opts[i]).filter(Boolean) };
}
function planHTML(pl) {
  if (!pl) return "";
  if (pl.tasks) return `<ul class="tasks">${pl.tasks.map((t) => `<li><span class="muted">${fmtHM(t.s)}–${fmtHM(t.e)}</span> ${esc(t.t)}${t.sb ? ` <span class="muted">· ${esc(t.sb)}</span>` : ""}</li>`).join("")}</ul>`;
  return `<ul class="tasks">${pl.options.length > 1 ? `<li class="muted">Pick one:</li>` : ""}${pl.options.map((o) => `<li>${esc(o.t)}${o.ad ? ` <span class="muted">· ${esc(o.ad)}</span>` : ""}${o.sb ? ` <span class="muted">· ${esc(o.sb)}</span>` : ""}</li>`).join("")}</ul>`;
}
const blockTitle = (it, date) => { const pl = planOn(it, date); return pl ? `${it.t}: ${pl.title}` : it.t; };
async function loadSchedule(client) {
  const [cur, sdp, top, staff, pa, pb] = await Promise.all([
    getDoc(doc(db, "clients", client.id, "schedule", "current")),
    getDoc(doc(db, "clients", client.id, "schedule", "sdp")),
    getDoc(doc(db, "clients", client.id)),
    getDocs(collection(db, "clients", client.id, "staff")),
    getDoc(doc(db, "clients", client.id, "info", "plans-a")).catch(() => null),
    getDoc(doc(db, "clients", client.id, "info", "plans-b")).catch(() => null)
  ]);
  const fixEnd = (list) => list.map((it) => it.tasks && it.tasks.length ? { ...it, e: it.tasks.reduce((m, t) => (mins(t.e) > mins(m) ? t.e : m), it.e) } : it);
  plans = {};
  [pa, pb].forEach((x) => { if (x && x.exists()) { const v = x.data(); Object.entries(v.plans || {}).forEach(([k, p]) => (plans[k] = { ...p, opts: v.opts || [] })); } });
  sched = {
    current: fixEnd(cur.exists() ? cur.data().items || [] : []),
    sdp: fixEnd(sdp.exists() ? sdp.data().items || [] : []),
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
    $("page").innerHTML = `<div class="card"><p class="muted">No schedule yet. Add one on the Schedule page.</p></div>` + editBtn("ed-staff", "Edit staff");
    $("ed-staff").onclick = () => { edStaff = null; staffEditor(client); }; return;
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
      ${now.length ? now.map((it) => `<div class="now-row"><div><b>${esc(blockTitle(it, new Date()))}</b><div class="muted small">${timeRange(it)}</div></div>${whoChip(it)}</div>`).join("") : `<p class="muted">Nothing scheduled right now.</p>`}
    </div>
    <div class="card">
      <h2>Who's working</h2>
      <div class="days">${dayBtns}</div>
      <p class="hint">${DAYS[day.getDay()]}, ${day.toLocaleDateString(undefined, { month: "long", day: "numeric" })} · ${plan === "sdp" ? "SDP plan" : "Current schedule"}${sw ? (plan === "sdp" ? ` (since ${swNice})` : ` (SDP plan starts ${swNice})`) : ""}</p>
      ${blocks.map((it) => `<div class="block-row${coverOf(it).kind === "gap" ? " is-gap" : ""}">
        <div class="block-time">${timeRange(it) || "Any time"}</div>
        <div class="block-main"><div><b>${esc(blockTitle(it, day))}</b></div>${pickNote(it, day) ? `<div class="muted small">${esc(pickNote(it, day))}</div>` : ""}</div>
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
  $("page").insertAdjacentHTML("beforeend", editBtn("ed-staff", "Edit staff"));
  $("ed-staff").onclick = () => { edStaff = null; staffEditor(client); };
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
  if (!sched.current.length && !sched.sdp.length) { $("page").innerHTML = `<div class="card"><p class="muted">No schedule yet.</p></div>` + editBtn("ed-sched", "Add a schedule"); $("ed-sched").onclick = () => { edPlan = "current"; edItem = -1; scheduleEditor(client); }; return; }
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
          <div class="block-main"><b>${esc(blockTitle(it, d))}</b>${pickNote(it, d) ? `<div class="muted small">${esc(pickNote(it, d))}</div>` : ""}${planHTML(planOn(it, d))}
          ${(it.tasks || []).length ? `<ul class="tasks">${it.tasks.map((t) => `<li><span class="muted">${fmtHM(t.s)}–${fmtHM(t.e)}</span> ${esc(t.t)}${t.sb ? ` <span class="muted">· ${esc(t.sb)}</span>` : ""}</li>`).join("")}</ul>` : ""}</div>
          ${whoChip(it)}</div>`).join("") || `<p class="muted">Nothing scheduled.</p>`}</div>`; }).join("")}`;
  $("page").insertAdjacentHTML("afterbegin", editBtn("ed-sched", "Edit schedule"));
  $("ed-sched").onclick = () => { edPlan = schedPlan === "auto" ? null : schedPlan; edItem = null; scheduleEditor(client); };
  $("page").querySelectorAll("[data-wk]").forEach((b) => (b.onclick = () => { schedWeek += +b.dataset.wk; drawSchedule(client); }));
  $("page").querySelectorAll("[data-plan]").forEach((b) => (b.onclick = () => { schedPlan = b.dataset.plan; drawSchedule(client); }));
  $("grid-box").ontoggle = (e) => { if (e.target.open !== gridOpen) { gridOpen = e.target.open; drawSchedule(client); } };
}

// ---------------- Page 4: Goals & progress ----------------
let LEVELS = [["own", "On his own"], ["help", "With help"], ["not", "Not today"]];
let goals = null, logs = [], draft = { date: null, ratings: {}, note: "" }, openSkill = null, logsOpen = false;
async function renderGoals(client) {
  $("page").innerHTML = `<p class="muted">Loading…</p>`;
  try { const g = await getDoc(doc(db, "clients", client.id, "info", "goals")); goals = g.exists() ? g.data() : null; }
  catch (e) { $("page").innerHTML = `<div class="card"><p class="error">Couldn't load goals. Check your connection.</p></div>`; return; }
  if (!goals) { $("page").innerHTML = `<div class="card"><p class="muted">No goals added yet.</p></div>` + editBtn("ed-goals", "Add goals and skills"); $("ed-goals").onclick = () => goalsEditor(client); return; }
  LEVELS = [["own", goals.ownLabel || "On his own"], ["help", "With help"], ["not", "Not today"]];
  draft = { date: dateKey(new Date()), ratings: {}, note: "" }; openSkill = null;
  unsub = onSnapshot(collection(db, "clients", client.id, "logs"), (snap) => {
    logs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.at || 0) - (a.at || 0));
    drawGoals(client);
  }, () => { logs = []; drawGoals(client); });
}
const allSkills = () => (goals.groups || []).flatMap((g) => g.items);
// Group title shown before the first skill of each group (only when there's more than one group)
function groupHead(id) { const gs = goals.groups || []; if (gs.length < 2) return ""; const g = gs.find((x) => x.items[0] && x.items[0].id === id); return g ? `<h3 class="grp">${esc(g.g)}</h3>` : ""; }
function trendFor(id) {
  const r = logs.filter((l) => l.ratings && l.ratings[id]).map((l) => ({ v: l.ratings[id], date: l.date })); // newest first
  const score = (v) => (v === "own" ? 2 : v === "help" ? 1 : 0);
  const last4 = r.slice(0, 4), prev4 = r.slice(4, 8);
  const avg = (a) => a.reduce((s, x) => s + score(x.v), 0) / (a.length || 1);
  let trend = "";
  if (last4.length && prev4.length) { const d = avg(last4) - avg(prev4); trend = d > 0.25 ? "up" : d < -0.25 ? "down" : "same"; }
  return { recent: r.slice(0, 8).reverse(), last: r[0], trend, count: r.length };
}
function drawGoals(client) {
  const skills = allSkills();
  const picked = Object.keys(draft.ratings).length;
  const nameOf = (id) => (skills.find((s) => s.id === id) || {}).t || id;
  const work = goals.work || {};
  $("page").innerHTML = `
    <div class="card focus-card">
      <h2>Focus</h2><p>${esc(goals.focus || "")}</p>
      ${work.goal ? `<h3>Work goal</h3><p>${esc(work.goal)}</p>${(work.places || []).length ? `<p class="muted small">Places to look: ${esc(work.places.join(" · "))}</p>` : ""}` : ""}
    </div>
    <div class="card">
      <h2>Log a shift</h2>
      <p class="hint">Tap each skill you worked on, then choose how it went.</p>
      <label class="due-label">Date <input id="log-date" type="date" value="${esc(draft.date)}"></label>
      <div class="skill-pick">
        ${skills.map((s) => { const v = draft.ratings[s.id]; const gh = groupHead(s.id);
          return `${gh}<div class="skill-item${v ? " rated" : ""}">
            <button class="skill-name" data-open="${s.id}"><span>${esc(s.t)}${s.note ? `<small class="skill-note">${esc(s.note)}</small>` : ""}</span>${v ? `<span class="lvl ${v}">${LEVELS.find((l) => l[0] === v)[1]}</span>` : ""}</button>
            ${openSkill === s.id ? `<div class="lvl-row">${LEVELS.map(([k, l]) => `<button class="lvl-btn ${k}" aria-pressed="${v === k}" data-rate="${s.id}" data-lvl="${k}">${l}</button>`).join("")}${v ? `<button class="link" data-clear="${s.id}">Clear</button>` : ""}</div>` : ""}
          </div>`; }).join("")}
      </div>
      <label for="log-note">Note (optional)</label>
      <textarea id="log-note" rows="3" placeholder="How did the shift go?">${esc(draft.note)}</textarea>
      <button id="log-save" class="btn primary" ${picked ? "" : "disabled"}>Save${picked ? ` (${picked} skill${picked > 1 ? "s" : ""})` : ""}</button>
      <div id="log-msg" class="small" role="status"></div>
    </div>
    <div class="card">
      <h2>Progress</h2>
      <p class="hint">Last 8 times each skill was logged. <span class="dot own"></span> on his own <span class="dot help"></span> with help <span class="dot not"></span> not today</p>
      ${skills.map((s) => { const t = trendFor(s.id);
        return `${groupHead(s.id)}<div class="prog-row"><div class="prog-name">${esc(s.t)}${t.last ? `<div class="muted small">Last: ${esc(t.last.date)}</div>` : ""}</div>
          <div class="prog-dots">${t.recent.map((x) => `<span class="dot ${x.v}" title="${esc(x.date)}"></span>`).join("") || `<span class="muted small">Not logged yet</span>`}</div>
          <div class="prog-trend">${t.trend === "up" ? "↑ Growing" : t.trend === "down" ? "↓ Slipping" : t.trend === "same" ? "→ Steady" : ""}</div></div>`; }).join("")}
    </div>
    <div class="card">
      <details ${logsOpen ? "open" : ""} id="logs-box"><summary><h2>Shift notes <span class="count">${logs.length}</span></h2></summary>
      ${logs.map((l) => `<div class="log-row"><div class="log-head"><b>${esc(l.date)}</b> <span class="muted small">· ${esc(l.byName || l.by || "")}</span>${me.admin ? `<button class="link del" data-del="${esc(l.id)}">Delete</button>` : ""}</div>
        <div class="small">${Object.entries(l.ratings || {}).map(([k, v]) => `<span class="lvl ${v}">${esc(nameOf(k))}: ${LEVELS.find((x) => x[0] === v)?.[1] || v}</span>`).join(" ")}</div>
        ${l.note ? `<p class="small">${esc(l.note)}</p>` : ""}</div>`).join("") || `<p class="muted">No shift notes yet.</p>`}</details>
    </div>`;
  const P = $("page");
  P.insertAdjacentHTML("beforeend", editBtn("ed-goals", "Edit goals and skills"));
  $("ed-goals").onclick = () => goalsEditor(client);
  $("log-date").onchange = (e) => (draft.date = e.target.value);
  $("log-note").oninput = (e) => (draft.note = e.target.value);
  P.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { openSkill = openSkill === b.dataset.open ? null : b.dataset.open; drawGoals(client); }));
  P.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = () => { draft.ratings[b.dataset.rate] = b.dataset.lvl; openSkill = null; drawGoals(client); }));
  P.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = () => { delete draft.ratings[b.dataset.clear]; drawGoals(client); }));
  P.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Delete this shift note?")) await deleteDoc(doc(db, "clients", client.id, "logs", b.dataset.del)); }));
  $("logs-box").ontoggle = (e) => (logsOpen = e.target.open);
  $("log-save").onclick = async () => {
    if (!Object.keys(draft.ratings).length) return;
    $("log-save").disabled = true;
    try {
      const id = "l" + Date.now().toString(36);
      await setDoc(doc(db, "clients", client.id, "logs", id), { date: draft.date || dateKey(new Date()), ratings: draft.ratings, note: draft.note.trim(), by: me.user.email, byName: me.user.displayName || me.user.email, at: Date.now() });
      draft = { date: dateKey(new Date()), ratings: {}, note: "" };
    } catch (e) { $("log-msg").textContent = "Didn't save. Check your connection and try again."; $("log-msg").className = "small error"; $("log-save").disabled = false; }
  };
}

// ---------------- Page 5: Services ----------------
async function renderServices(client) {
  $("page").innerHTML = `<p class="muted">Loading…</p>`;
  let list = {};
  try { const s = await getDoc(doc(db, "clients", client.id, "info", "services")); list = s.exists() ? s.data().list || {} : {}; }
  catch (e) { $("page").innerHTML = `<div class="card"><p class="error">Couldn't load services. Check your connection.</p></div>`; return; }
  // Group blocks that share the same service (like Respite and Overnight respite)
  const groups = new Map();
  Object.entries(list).forEach(([block, s]) => {
    if (!s.service) return;
    const key = s.service + "|" + (s.vendor || "") + "|" + (s.through && s.through.name || "");
    if (!groups.has(key)) groups.set(key, { ...s, blocks: [] });
    groups.get(key).blocks.push(block);
  });
  const who = (o) => o && typeof o === "object" ? `<div><b>${esc(o.name)}</b></div>${o.sub ? `<div class="muted small">${linkify(o.sub)}</div>` : ""}` : "";
  const cards = [...groups.values()].sort((a, b) => a.service.localeCompare(b.service)).map((s) => {
    const authorized = s.auth && !/^Not authorized/i.test(s.auth);
    const people = (s.staff || []).map((x) => x.n === "Adria" ? "Adria" : x.n).join(", ");
    return `<div class="card svc-card">
      <div class="svc-top"><h2>${esc(s.service)}</h2><span class="who ${authorized ? "staff" : "gap"}">${authorized ? "Authorized" : "Not yet"}</span></div>
      <div class="svc-grid">
        <div class="lab">Hours</div><div>${esc(s.auth || "—")}</div>
        ${s.by ? `<div class="lab">Paid by</div><div>${who(s.by)}</div>` : ""}
        <div class="lab">Through</div><div>${s.through && typeof s.through === "object" ? who(s.through) : s.through === "none" ? "No agency" : "Not chosen yet"}</div>
        ${s.vendor ? `<div class="lab">Vendor #</div><div>${esc(s.vendor)}</div>` : ""}
        ${people ? `<div class="lab">Provider</div><div>${esc(people)}</div>` : ""}
        <div class="lab">Used for</div><div class="muted">${esc(s.blocks.join(", "))}</div>
      </div></div>`;
  }).join("");
  $("page").innerHTML = editBtn("ed-svc", "Edit services") + (cards || `<div class="card"><p class="muted">No services added yet.</p></div>`);
  $("ed-svc").onclick = () => { edSvc = null; servicesEditor(client); };
}
// Turn emails and phone numbers into tappable links
function linkify(text) {
  return esc(text)
    .replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1">$1</a>')
    .replace(/(\(?\d{3}\)?[\s-]\d{3}-\d{4})/g, (m) => `<a href="tel:${m.replace(/\D/g, "")}">${m}</a>`);
}


// =====================================================================
// Editing (Adria, and each supervisor for their own client)
// =====================================================================
const editBtn = (id, label) => `<button class="btn edit-btn" id="${id}" type="button">✏️ ${label}</button>`;
const val = (id) => ($(id) ? $(id).value.trim() : "");
const lines = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function backBar(title, onDone) {
  return `<div class="card edit-head"><h2>${esc(title)}</h2><p class="hint">Changes save right away for everyone.</p><button class="btn primary" id="ed-done" type="button">Done editing</button></div>`;
}
function wireDone(onDone) { $("ed-done").onclick = onDone; }
function dayChecks(name, sel) { return `<div class="checks">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="pick"><input type="checkbox" name="${name}" value="${d}" ${(sel || []).includes(d) ? "checked" : ""}> ${DAYS[d].slice(0, 3)}</label>`).join("")}</div>`; }
function weekChecks(name, sel) { return `<div class="checks">${[1, 2, 3, 4, 5].map((w) => `<label class="pick"><input type="checkbox" name="${name}" value="${w}" ${!sel || sel.includes(w) ? "checked" : ""}> Week ${w}</label>`).join("")}</div>`; }
const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => +x.value);

// ---------- Schedule editor ----------
let edPlan = null, edItem = null; // edItem: null or index (-1 = new)
async function scheduleEditor(client) {
  stopLive();
  if (!edPlan) edPlan = planFor(new Date());
  const ref = doc(db, "clients", client.id, "schedule", edPlan);
  const snap = await getDoc(ref); const items = (snap.exists() && snap.data().items) || [];
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => order.indexOf((a.it.d || [0])[0]) - order.indexOf((b.it.d || [0])[0]) || (a.it.s ? mins(a.it.s) : -1) - (b.it.s ? mins(b.it.s) : -1));
  const f = edItem === null ? null : edItem >= 0 ? items[edItem] : { d: [], s: "09:00", e: "10:00", t: "", sb: "", cover: "" };
  const coverWho = f ? (String(f.cover || "").includes("·") ? f.cover.split("·")[1].trim() : f.byWho || f.who || "") : "";
  const coverSvc = f ? (String(f.cover || "").includes("·") ? f.cover.split("·")[0].trim() : f.cover || "") : "";
  $("page").innerHTML = backBar("Edit schedule") + `
    <div class="card">
      <div class="days">${[["current", "Current"], ["sdp", "SDP plan"]].map(([k, l]) => `<button class="day" aria-pressed="${edPlan === k}" data-edplan="${k}">${l}</button>`).join("")}</div>
      <form id="sw-form" class="add-row"><label class="due-label">SDP plan starts <input id="sw-date" type="date" value="${esc(sched.switchDate || "")}"></label><button class="btn small" type="submit">Save</button></form>
      <div id="sw-msg" class="small" role="status"></div>
    </div>
    <div class="card">
      ${f ? `<form id="it-form" class="edit-form">
        <h3>${edItem >= 0 ? "Change this block" : "Add a block"}</h3>
        <label for="it-t">What</label><input id="it-t" required value="${esc(f.t)}" placeholder="Personal assistance">
        <label for="it-sb">Notes (optional)</label><input id="it-sb" value="${esc(f.sb || "")}">
        <label>Day</label>${dayChecks("it-d", f.d)}
        <div class="add-row"><label class="due-label">From <input id="it-s" type="time" value="${esc(f.s || "")}"></label><label class="due-label">To <input id="it-e" type="time" value="${esc(f.e === "24:00" ? "23:59" : f.e || "")}"></label></div>
        <p class="hint">An overnight block can end the next morning (like 11pm to 7am).</p>
        <label>Which weeks of the month</label>${weekChecks("it-w", f.w)}
        <label for="it-svc">Service (optional)</label><input id="it-svc" value="${esc(coverSvc)}" placeholder="PA, ILS, Respite…">
        <label for="it-who">Who covers it</label><input id="it-who" value="${esc(coverWho)}" placeholder="Loren, Jay, Adria…">
        <label class="pick" style="margin-top:10px"><input type="checkbox" id="it-open" ${f.open ? "checked" : ""}> Not covered yet (show it in red)</label>
        <div class="add-row"><button class="btn" type="button" id="it-cancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
        <div id="it-msg" class="small error" role="status"></div>
      </form>` : `<button class="btn primary" id="it-add" type="button">+ Add a block</button>`}
      <div class="edit-list">${sorted.map(({ it, i }) => `<div class="block-row${it.open ? " is-gap" : ""}"><div class="block-main"><b>${esc(it.t)}</b>
        <div class="muted small">${(it.d || []).map((d) => DAYS[d].slice(0, 3)).join(", ")} · ${timeRange(it) || "any time"}${it.w ? " · week " + it.w.join(", ") : ""}${it.cover ? " · " + esc(it.cover) : ""}</div></div>
        <button class="link" data-ed="${i}">Change</button><button class="link del" data-edel="${i}">Delete</button></div>`).join("")}</div>
    </div>`;
  const again = () => scheduleEditor(client);
  wireDone(() => { edPlan = null; edItem = null; renderSchedule(client); });
  $("page").querySelectorAll("[data-edplan]").forEach((b) => (b.onclick = () => { edPlan = b.dataset.edplan; edItem = null; again(); }));
  $("sw-form").onsubmit = async (e) => { e.preventDefault(); await setDoc(doc(db, "clients", client.id), { switchDate: $("sw-date").value || null }, { merge: true }); sched.switchDate = $("sw-date").value || null; $("sw-msg").textContent = "Saved ✓"; $("sw-msg").className = "small ok"; };
  if ($("it-add")) $("it-add").onclick = () => { edItem = -1; again(); };
  $("page").querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => { edItem = +b.dataset.ed; again(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  $("page").querySelectorAll("[data-edel]").forEach((b) => (b.onclick = async () => { const it = items[+b.dataset.edel]; if (!confirm(`Delete "${it.t}"?`)) return; await setDoc(ref, { items: items.filter((_, j) => j !== +b.dataset.edel) }); edItem = null; again(); }));
  if (f) {
    $("it-cancel").onclick = () => { edItem = null; again(); };
    $("it-form").onsubmit = async (e) => {
      e.preventDefault();
      const d = checked("it-d"), w = checked("it-w");
      if (!d.length) return ($("it-msg").textContent = "Pick at least one day.");
      if (!w.length) return ($("it-msg").textContent = "Pick at least one week.");
      const st = val("it-s"), en0 = val("it-e"), en = en0 === "23:59" ? "24:00" : en0;
      const svc = val("it-svc"), who = val("it-who"), open = $("it-open").checked;
      const item = { ...f, d, t: val("it-t"), sb: val("it-sb"), s: st, e: en, open };
      delete item.byWho; delete item.who;
      item.cover = svc && who ? `${svc} · ${who}` : svc || who || "";
      if (open && who) item.byWho = who;
      if (w.length === 5) { delete item.w; delete item.wk; } else { item.w = w; if (d.some((x) => [0, 5, 6].includes(x))) item.wk = "weekend"; }
      if (!item.sb) delete item.sb;
      const next = items.slice(); if (edItem >= 0) next[edItem] = item; else next.push(item);
      try { await setDoc(ref, { items: next }); edItem = null; again(); } catch (err) { $("it-msg").textContent = "Didn't save. Check your connection."; }
    };
  }
}

// ---------- Staff editor ----------
let edStaff = null; // null, id, or "new"
async function staffEditor(client) {
  stopLive();
  const snap = await getDocs(collection(db, "clients", client.id, "staff"));
  const staff = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const f = edStaff === null ? null : edStaff === "new" ? { name: "", contact: "", agencies: [], hours: {}, target: "", offTime: "" } : staff.find((s) => s.id === edStaff);
  $("page").innerHTML = backBar("Edit staff") + `<div class="card">
    ${f ? `<form id="st-form" class="edit-form"><h3>${edStaff === "new" ? "Add someone" : "Change " + esc(f.name)}</h3>
      <label for="st-name">Name</label><input id="st-name" required value="${esc(f.name)}">
      <label for="st-contact">Email or phone</label><input id="st-contact" value="${esc(f.contact || "")}">
      <label for="st-ag">Agency (who they work through)</label><input id="st-ag" value="${esc((f.agencies || []).join(", "))}" placeholder="Wood Quality Care">
      <label for="st-hours">Hours, one per line (like "Personal assistance: 7pm–11pm Mon–Fri")</label>
      <textarea id="st-hours" rows="4">${esc(Object.entries(f.hours || {}).map(([k, v]) => k + ": " + v).join("\n"))}</textarea>
      <label for="st-target">Hours goal (optional)</label><input id="st-target" value="${esc(f.target || "")}" placeholder="24 hrs a week">
      <label for="st-off">When they're off (optional)</label><input id="st-off" value="${esc(f.offTime || "")}">
      <div class="add-row"><button class="btn" type="button" id="st-cancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
    </form>` : `<button class="btn primary" id="st-add" type="button">+ Add someone</button>`}
    <div class="edit-list">${staff.map((s) => `<div class="block-row"><div class="block-main"><b>${esc(s.name)}</b><div class="muted small">${esc((s.agencies || []).join(", "))}</div></div>
      <button class="link" data-st="${esc(s.id)}">Change</button><button class="link del" data-stdel="${esc(s.id)}">Remove</button></div>`).join("") || `<p class="muted">No staff yet.</p>`}</div></div>`;
  const again = () => staffEditor(client);
  wireDone(() => { edStaff = null; renderStaffing(client); });
  if ($("st-add")) $("st-add").onclick = () => { edStaff = "new"; again(); };
  $("page").querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => { edStaff = b.dataset.st; again(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  $("page").querySelectorAll("[data-stdel]").forEach((b) => (b.onclick = async () => { const s = staff.find((x) => x.id === b.dataset.stdel); if (!confirm(`Remove ${s.name}?`)) return; await deleteDoc(doc(db, "clients", client.id, "staff", s.id)); again(); }));
  if (f) {
    $("st-cancel").onclick = () => { edStaff = null; again(); };
    $("st-form").onsubmit = async (e) => {
      e.preventDefault();
      const hours = {}; lines($("st-hours").value).forEach((l) => { const i = l.indexOf(":"); if (i > 0) hours[l.slice(0, i).trim()] = l.slice(i + 1).trim(); else hours["Hours"] = l; });
      const id = edStaff === "new" ? newId("s") : edStaff;
      await setDoc(doc(db, "clients", client.id, "staff", id), { id, name: val("st-name"), contact: val("st-contact"), agencies: val("st-ag").split(",").map((x) => x.trim()).filter(Boolean), hours, target: val("st-target"), offTime: val("st-off") });
      edStaff = null; again();
    };
  }
}

// ---------- Goals editor ----------
async function goalsEditor(client) {
  stopLive();
  const ref = doc(db, "clients", client.id, "info", "goals");
  const snap = await getDoc(ref); const g = snap.exists() ? snap.data() : { focus: "", groups: [{ g: "Skills", items: [] }] };
  const groups = (g.groups || []).map((x) => ({ ...x, items: (x.items || []).slice() }));
  $("page").innerHTML = backBar("Edit goals") + `<form id="g-form">
    <div class="card"><label for="g-focus">Focus</label><textarea id="g-focus" rows="3">${esc(g.focus || "")}</textarea>
      <label for="g-work">Work goal (optional)</label><textarea id="g-work" rows="3">${esc((g.work && g.work.goal) || "")}</textarea>
      <label for="g-places">Places to look, one per line (optional)</label><textarea id="g-places" rows="3">${esc(((g.work && g.work.places) || []).join("\n"))}</textarea>
      <label for="g-own">Wording for doing it alone</label><input id="g-own" value="${esc(g.ownLabel || "On his own")}"></div>
    ${groups.map((grp, gi) => `<div class="card"><label for="gg-${gi}">Section name</label><input id="gg-${gi}" value="${esc(grp.g)}">
      ${grp.items.map((it, ii) => `<div class="skill-edit"><input data-sk="${gi}-${ii}" value="${esc(it.t)}" aria-label="Skill"><input data-skn="${gi}-${ii}" value="${esc(it.note || "")}" placeholder="Note (optional)" aria-label="Note"><label class="pick small"><input type="checkbox" data-skdel="${gi}-${ii}"> Remove</label></div>`).join("")}
      <label for="gadd-${gi}">Add skills, one per line</label><textarea id="gadd-${gi}" rows="2"></textarea></div>`).join("")}
    <div class="card"><label for="g-newgroup">Add a new section (optional)</label><input id="g-newgroup" placeholder="Section name"></div>
    <button class="btn primary" type="submit">Save goals</button><div id="g-msg" class="small" role="status"></div></form>`;
  wireDone(() => renderGoals(client));
  $("g-form").onsubmit = async (e) => {
    e.preventDefault();
    const out = groups.map((grp, gi) => {
      const items = grp.items.map((it, ii) => ({ ...it, t: document.querySelector(`[data-sk="${gi}-${ii}"]`).value.trim(), note: document.querySelector(`[data-skn="${gi}-${ii}"]`).value.trim(), _del: document.querySelector(`[data-skdel="${gi}-${ii}"]`).checked }))
        .filter((it) => !it._del && it.t).map(({ _del, ...it }) => it);
      lines($("gadd-" + gi).value).forEach((t) => items.push({ id: newId("k"), t }));
      return { ...grp, g: val("gg-" + gi) || grp.g, items };
    });
    if (val("g-newgroup")) out.push({ g: val("g-newgroup"), items: [] });
    const work = val("g-work") || lines($("g-places").value).length ? { goal: val("g-work"), places: lines($("g-places").value) } : null;
    const next = { ...g, focus: val("g-focus"), groups: out, ownLabel: val("g-own") || "On his own" };
    if (work) next.work = work; else delete next.work;
    try { await setDoc(ref, next); $("g-msg").textContent = "Saved ✓"; $("g-msg").className = "small ok"; goalsEditor(client); }
    catch (err) { $("g-msg").textContent = "Didn't save. Check your connection."; $("g-msg").className = "small error"; }
  };
}

// ---------- Services editor ----------
let edSvc = null; // null, key, or "\u0000new"
async function servicesEditor(client) {
  stopLive();
  const ref = doc(db, "clients", client.id, "info", "services");
  const snap = await getDoc(ref); const list = (snap.exists() && snap.data().list) || {};
  const isNew = edSvc === "\u0000new", f = edSvc === null ? null : isNew ? { service: "", by: null, through: null, vendor: "", auth: "", staff: [] } : list[edSvc];
  const o = (x) => (x && typeof x === "object" ? x : { name: "", sub: "" });
  $("page").innerHTML = backBar("Edit services") + `<div class="card">
    ${f ? `<form id="sv-form" class="edit-form"><h3>${isNew ? "Add a service" : "Change " + esc(edSvc)}</h3>
      <label for="sv-key">Schedule block it covers</label><input id="sv-key" required value="${esc(isNew ? "" : edSvc)}" placeholder="Personal assistance">
      <label for="sv-service">Service</label><input id="sv-service" required value="${esc(f.service || "")}" placeholder="Personal Assistance (PA)">
      <label for="sv-auth">Authorized hours (leave blank if not authorized yet)</label><input id="sv-auth" value="${esc(f.auth || "")}" placeholder="56 hrs/month">
      <label for="sv-by">Paid by</label><input id="sv-by" value="${esc(o(f.by).name)}" placeholder="North LA County Regional Center">
      <label for="sv-bysub">Their contact (optional)</label><input id="sv-bysub" value="${esc(o(f.by).sub || "")}">
      <label for="sv-th">Through (agency)</label><input id="sv-th" value="${esc(f.through === "none" ? "none" : o(f.through).name)}" placeholder="Wood Quality Care, or none">
      <label for="sv-thsub">Agency contact (optional)</label><input id="sv-thsub" value="${esc(o(f.through).sub || "")}">
      <label for="sv-vendor">Vendor # (optional)</label><input id="sv-vendor" value="${esc(f.vendor || "")}">
      <label for="sv-staff">Provider(s), comma between (optional)</label><input id="sv-staff" value="${esc((f.staff || []).map((x) => x.n).join(", "))}">
      <div class="add-row"><button class="btn" type="button" id="sv-cancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
    </form>` : `<button class="btn primary" id="sv-add" type="button">+ Add a service</button>`}
    <div class="edit-list">${Object.entries(list).map(([k, s]) => `<div class="block-row"><div class="block-main"><b>${esc(k)}</b><div class="muted small">${esc(s.service || "")}${s.auth ? " · " + esc(s.auth) : ""}</div></div>
      <button class="link" data-sv="${esc(k)}">Change</button><button class="link del" data-svdel="${esc(k)}">Delete</button></div>`).join("") || `<p class="muted">No services yet.</p>`}</div></div>`;
  const again = () => servicesEditor(client);
  wireDone(() => { edSvc = null; renderServices(client); });
  if ($("sv-add")) $("sv-add").onclick = () => { edSvc = "\u0000new"; again(); };
  $("page").querySelectorAll("[data-sv]").forEach((b) => (b.onclick = () => { edSvc = b.dataset.sv; again(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  $("page").querySelectorAll("[data-svdel]").forEach((b) => (b.onclick = async () => { if (!confirm(`Delete "${b.dataset.svdel}"?`)) return; const n = { ...list }; delete n[b.dataset.svdel]; await setDoc(ref, { list: n }); again(); }));
  if (f) {
    $("sv-cancel").onclick = () => { edSvc = null; again(); };
    $("sv-form").onsubmit = async (e) => {
      e.preventDefault();
      const th = val("sv-th");
      const item = { service: val("sv-service"), auth: val("sv-auth") || "Not authorized yet",
        by: val("sv-by") ? { name: val("sv-by"), sub: val("sv-bysub") } : null,
        through: /^none$/i.test(th) ? "none" : th ? { name: th, sub: val("sv-thsub") } : null,
        staff: val("sv-staff").split(",").map((x) => x.trim()).filter(Boolean).map((n) => ({ n })) };
      if (val("sv-vendor")) item.vendor = val("sv-vendor");
      const n = { ...list }; if (!isNew && edSvc !== val("sv-key")) delete n[edSvc]; n[val("sv-key")] = item;
      await setDoc(ref, { list: n }); edSvc = null; again();
    };
  }
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
    let data;
    try { data = JSON.parse(text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")); }
    catch (e) { out.textContent = `That looks cut off (I got ${text.length.toLocaleString()} characters). Ask Claude to split it into smaller pieces.`; out.dataset.kind = "error"; return false; }
    if (data.kind !== "uniquely-soaring-import" || !/^[A-Za-z]+$/.test(data.client || "")) throw new Error("not ours");
    const batch = writeBatch(db);
    const top = { label: data.label || "Client: " + data.client, updatedAt: serverTimestamp() };
    if (data.switchDate) top.switchDate = data.switchDate;
    batch.set(doc(db, "clients", data.client), top, { merge: true });
    (data.todos || []).forEach((t) => batch.set(doc(db, "clients", data.client, "todos", t.id), { text: t.text, status: t.status, due: t.due || null, doneAt: t.doneAt || null }));
    Object.entries(data.schedules || {}).forEach(([k, items]) => batch.set(doc(db, "clients", data.client, "schedule", k), { items }));
    (data.staff || []).forEach((s) => batch.set(doc(db, "clients", data.client, "staff", s.id), s));
    if (data.services) batch.set(doc(db, "clients", data.client, "info", "services"), { list: data.services });
    if (data.goals) batch.set(doc(db, "clients", data.client, "info", "goals"), data.goals);
    if (data.plans) batch.set(doc(db, "clients", data.client, "info", "plans-a"), data.plans);
    if (data.plans2) batch.set(doc(db, "clients", data.client, "info", "plans-b"), data.plans2);
    Object.entries(data.people || {}).forEach(([pid, v]) => batch.set(doc(db, "clients", data.client, "people", pid), v, { merge: true }));
    await batch.commit();
    const parts = [];
    if (data.todos) parts.push(data.todos.length + " to-dos");
    if (data.schedules) parts.push("schedule");
    if (data.staff) parts.push(data.staff.length + " staff");
    if (data.services) parts.push("services");
    if (data.goals) parts.push("goals");
    if (data.plans || data.plans2) parts.push("day program plans");
    if (data.people) parts.push("schedule");
    out.textContent = `Imported ${top.label}: ${parts.join(", ")}. ✓`;
    out.dataset.kind = "ok";
    await loadAccess(me.user);
    if (!me.clients.some((c) => c.id === data.client)) me.clients.push({ id: data.client, label: top.label });
    location.hash = "#/c/" + data.client + "/" + (data.client === "SUP" ? (Object.keys(data.people || {})[0] || "") : data.todos ? "todo" : data.goals ? "goals" : (data.plans || data.plans2) ? "schedule" : "staffing");
    route();
    return true;
  } catch (err) {
    out.textContent = "That didn't save" + (err && err.code ? ` (${err.code})` : "") + ". Tell Claude what this says.";
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
