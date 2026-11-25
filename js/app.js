import { auth, db } from "./firebase.js";
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

// ---------------- Import (Adria only) ----------------
$("import-file").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const out = $("import-msg");
  try {
    const data = JSON.parse(await f.text());
    if (data.kind !== "uniquely-soaring-import" || !/^[A-Za-z]+$/.test(data.client || "")) throw new Error("not ours");
    const batch = writeBatch(db);
    batch.set(doc(db, "clients", data.client), { label: data.label || "Client: " + data.client, updatedAt: serverTimestamp() }, { merge: true });
    (data.todos || []).forEach((t) => batch.set(doc(db, "clients", data.client, "todos", t.id), { text: t.text, status: t.status, due: t.due || null, doneAt: t.doneAt || null }));
    await batch.commit();
    out.textContent = `Imported ${data.label || data.client}: ${(data.todos || []).length} to-dos. ✓`;
    out.dataset.kind = "ok";
    await loadAccess(me.user); renderHome();
  } catch (err) {
    out.textContent = "That file didn't import. Make sure it's the file from Claude.";
    out.dataset.kind = "error";
  }
};

// ---------------- Start ----------------
onAuthStateChanged(auth, async (user) => {
  stopLive();
  if (!user) { me = { user: null, admin: false, clients: [] }; show("signin"); return; }
  show("loading");
  await loadAccess(user);
  route();
});
