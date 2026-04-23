import {
  auth, db, rtdb,
  redirectIfLoggedIn, showToast
} from "./firebase.js";

import { doc, setDoc } from 
"https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  ref, set
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Redirect if already logged in
await redirectIfLoggedIn();


// ── Tab switching ─────────────────────────────────────────────
document.querySelectorAll(".auth-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const panel = btn.dataset.panel;

    document.querySelectorAll(".auth-tab")
      .forEach(b => b.classList.remove("active"));

    document.querySelectorAll(".auth-panel")
      .forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    document.getElementById("panel-" + panel)
      .classList.add("active");
  });
});


// ── LOGIN ─────────────────────────────────────────────────────
document.getElementById("loginBtn").addEventListener("click", async () => {

  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password)
    return showToast("Email aur password daalo", true);

  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Logging in...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    showToast("Login ho gaya! ✅");
    window.location.href = "./dashboard.html";

  } catch (e) {
    showToast(e.message, true);
    btn.disabled = false;
    btn.innerHTML = "Login →";
  }

});


// ── SIGNUP ────────────────────────────────────────────────────
document.getElementById("signupBtn").addEventListener("click", async () => {

  const name     = document.getElementById("signupName").value.trim();
  const email    = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  if (!email || !password)
    return showToast("Email aur password zaroori hai", true);

  if (password.length < 6)
    return showToast("Password kam se kam 6 characters ka hona chahiye", true);

  const btn = document.getElementById("signupBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account...';

  try {

    const userCred = await createUserWithEmailAndPassword(auth, email, password);

    const uid = userCred.user.uid;

    // ✅ restaurant doc = UID
    await setDoc(doc(db, "restaurants", uid), {
      name: name || email.split("@")[0],
      ownerId: uid,
      createdAt: Date.now()
    });

    // realtime mapping
    await set(ref(rtdb, "users/" + uid), {
      email: email,
      restaurantId: uid
    });

    showToast("Account ban gaya! Welcome 🎉");
    window.location.href = "./dashboard.html";

  } catch (e) {
    showToast(e.message, true);
    btn.disabled = false;
    btn.innerHTML = "Create Account →";
  }

});