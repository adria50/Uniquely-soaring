import { auth } from "./firebase.js";
import {
  GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $ = (id) => document.getElementById(id);
const show = (id) => {
  ["loading", "signin", "home"].forEach((s) => ($(s).hidden = s !== id));
};
let mode = "signin"; // or "create"

function setMsg(text, isError = true) {
  const m = $("msg");
  m.textContent = text || "";
  m.dataset.kind = isError ? "error" : "ok";
}

function friendly(err) {
  const c = (err && err.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "That email and password don't match. Try again, or tap Forgot password.";
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

$("google").onclick = async () => {
  setMsg("");
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { setMsg(friendly(e)); }
};

$("email-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const email = $("email").value.trim(), pw = $("password").value;
  $("submit").disabled = true;
  setMsg("");
  try {
    if (mode === "create") await createUserWithEmailAndPassword(auth, email, pw);
    else await signInWithEmailAndPassword(auth, email, pw);
  } catch (e) { setMsg(friendly(e)); }
  $("submit").disabled = false;
};

$("forgot").onclick = async () => {
  const email = $("email").value.trim();
  if (!email) { setMsg("Type your email above first, then tap Forgot password."); return; }
  try { await sendPasswordResetEmail(auth, email); setMsg("Check your email for a link to reset your password.", false); }
  catch (e) { setMsg(friendly(e)); }
};

$("signout").onclick = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
  if (!user) { show("signin"); return; }
  $("who").textContent = user.displayName || user.email;
  $("who-email").textContent = user.email;
  show("home");
});

setMode("signin");
