import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  doc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────────────────────
await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

// ── Restaurant info ───────────────────────────────────────────────────────────
const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

// ── Logo (sidebar chip) ───────────────────────────────────────────────────────
function showLogoPreview(src) {
  const preview = document.getElementById("logoPreview");
  const icon    = document.getElementById("logoIcon");
  preview.src           = src;
  preview.style.display = "block";
  icon.style.display    = "none";
}

document.getElementById("logoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !restaurantId) return;
  showToast("Uploading logo...");
  try {
    const base64 = await compressImage(file, 300);
    await updateDoc(doc(db, "restaurants", restaurantId), { logo: base64 });
    showLogoPreview(base64);
    showToast("Logo saved! ✅");
  } catch (err) {
    showToast("Failed to save logo: " + err.message, true);
  }
});

// ── State ─────────────────────────────────────────────────────────────────────
let selectedFile = null;

// ── File input & drag-drop ────────────────────────────────────────────────────
const bannerInput      = document.getElementById("bannerInput");
const bannerDrop       = document.getElementById("bannerDrop");
const bannerPreviewWrap= document.getElementById("bannerPreviewWrap");
const bannerPreviewImg = document.getElementById("bannerPreviewImg");
const bannerRemoveBtn  = document.getElementById("bannerRemoveBtn");
const uploadBtn        = document.getElementById("uploadBannerBtn");
const removeCurrBtn    = document.getElementById("removeBannerBtn");

bannerInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  handleFileSelect(file);
});

bannerDrop.addEventListener("dragover",  (e) => { e.preventDefault(); bannerDrop.classList.add("dragover"); });
bannerDrop.addEventListener("dragleave", ()  => bannerDrop.classList.remove("dragover"));
bannerDrop.addEventListener("drop", (e) => {
  e.preventDefault(); bannerDrop.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) handleFileSelect(file);
});

function handleFileSelect(file) {
  // 5 MB raw file limit
  if (file.size > 5 * 1024 * 1024) {
    showToast("Image too large. Please use a file under 5MB.", true);
    bannerInput.value = "";
    return;
  }
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    bannerPreviewImg.src       = ev.target.result;
    bannerPreviewWrap.style.display = "block";
    bannerDrop.style.display        = "none";
    uploadBtn.disabled              = false;
  };
  reader.readAsDataURL(file);
}

// Remove selected (before upload)
bannerRemoveBtn.addEventListener("click", () => {
  selectedFile               = null;
  bannerInput.value          = "";
  bannerPreviewImg.src       = "";
  bannerPreviewWrap.style.display = "none";
  bannerDrop.style.display        = "flex";
  uploadBtn.disabled              = true;
});

// ── Upload banner ─────────────────────────────────────────────────────────────
uploadBtn.addEventListener("click", async () => {
  if (!selectedFile || !restaurantId) return;

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = `<span class="spinner"></span> Uploading...`;

  try {
    // Compress to 800px — keeps banner sharp but fits Firestore's 1MB doc limit
    const base64 = await compressImage(selectedFile, 300);

    // Firestore document max ~1MB — base64 string must stay under ~900KB
    const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
    if (sizeKB > 900) {
      showToast("Image is still too large after compression. Please use a smaller image.", true);
      return;
    }

    await updateDoc(doc(db, "restaurants", restaurantId), { adBanner: base64 });
    showToast("Ad banner uploaded! 🎉");

    // Reset form
    selectedFile               = null;
    bannerInput.value          = "";
    bannerPreviewImg.src       = "";
    bannerPreviewWrap.style.display = "none";
    bannerDrop.style.display        = "flex";
    uploadBtn.disabled              = true;

  } catch (err) {
    showToast("Upload failed: " + err.message, true);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      Upload Banner`;
  }
});

// ── Remove current banner from Firebase ──────────────────────────────────────
removeCurrBtn.addEventListener("click", async () => {
  if (!restaurantId) return;
  if (!confirm("Are you sure you want to remove the current ad banner?")) return;

  removeCurrBtn.disabled = true;
  removeCurrBtn.innerHTML = `<span class="spinner" style="border-color:rgba(220,38,38,0.3);border-top-color:#DC2626"></span> Removing...`;

  try {
    await updateDoc(doc(db, "restaurants", restaurantId), { adBanner: "" });
    showToast("Banner removed.");
  } catch (err) {
    showToast("Failed to remove: " + err.message, true);
  } finally {
    removeCurrBtn.disabled = false;
    removeCurrBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      Remove Current Banner`;
  }
});

// ── Realtime listener — restaurant doc ───────────────────────────────────────
if (restaurantId) {
  onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    // Logo
    if (data.logo) showLogoPreview(data.logo);

    // Brand color dot
    if (data.brandColor) {
      const dot = document.getElementById("colorDot");
      if (dot) dot.style.background = data.brandColor;
    }

    // Ad banner — show in right panel
    const currentWrap  = document.getElementById("currentBannerWrap");
    const noBannerState= document.getElementById("noBannerState");
    const statusEl     = document.getElementById("bannerStatus");

    if (data.adBanner) {
      // Show the current banner image
      let img = document.getElementById("currentBannerImg");
      if (!img) {
        img = document.createElement("img");
        img.id = "currentBannerImg";
        currentWrap.innerHTML = "";
        currentWrap.appendChild(img);
      }
      img.src = data.adBanner;

      // Status pill
      statusEl.innerHTML = `<span class="status-dot status-live"></span> Banner active`;

      // Show remove button
      removeCurrBtn.style.display = "flex";
    } else {
      // No banner
      currentWrap.innerHTML = `
        <div class="empty-state" id="noBannerState">
          <span class="empty-icon">🖼️</span>
          <span class="empty-title">No banner uploaded yet</span>
          <span class="empty-hint">Upload a promotional image using the form on the left</span>
        </div>`;
      statusEl.innerHTML = `<span class="status-dot status-none"></span> No banner set`;
      removeCurrBtn.style.display = "none";
    }
  });
}