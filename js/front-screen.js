import {
  db, requireAuth, getRestaurantId, showToast, compressImage
} from "./firebase.js";

import {
  doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();

const restaurantId = await getRestaurantId();
const heroInput         = document.getElementById("heroInput");
const heroPreview       = document.getElementById("heroPreview");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const changeHeroBtn     = document.getElementById("changeHeroBtn");
const ribbonInput       = document.getElementById("ribbonInput");
const saveBtn           = document.getElementById("saveFooterBtn");
const wordCountDisplay  = document.getElementById("wordCount");
const ribbonItemsEl     = document.getElementById("ribbonItems");

let currentHeroBase64 = null;  // ← yahan hero store hoga

// ── 1. Firestore se data load ──────────────────────────────────
if (restaurantId) {
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId));
    if (snap.exists()) {
      const data = snap.data();

      // Hero image
      if (data.item1) {
        currentHeroBase64 = data.item1;          // ← zaruri line
        heroPreview.src = data.item1;
        heroPreview.style.display = "block";
        uploadPlaceholder.style.display = "none";
        changeHeroBtn.style.display = "flex";
      }

      // Ribbon text
      if (data.item_names) {
        ribbonInput.value = data.item_names;
        updateRibbonPreview();
      }
    }
  } catch (err) {
    showToast("Data load failed: " + err.message, true);
  }
}

// ── 2. Hero image upload ───────────────────────────────────────
document.getElementById("heroDropZone").addEventListener("click", () => heroInput.click());
changeHeroBtn.addEventListener("click", (e) => { e.stopPropagation(); heroInput.click(); });

heroInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast("Compressing image...");
    const base64 = await compressImage(file, 800);
    currentHeroBase64 = base64;                  // ← yahan store hoga
    heroPreview.src = base64;
    heroPreview.style.display = "block";
    uploadPlaceholder.style.display = "none";
    changeHeroBtn.style.display = "flex";
    showToast("Image ready! Save karo.");
  } catch (err) {
    showToast("Image error: " + err.message, true);
  }
});

// Drag & drop
const heroDropZone = document.getElementById("heroDropZone");
heroDropZone.addEventListener("dragover", (e) => { e.preventDefault(); heroDropZone.classList.add("dragover"); });
heroDropZone.addEventListener("dragleave", () => heroDropZone.classList.remove("dragover"));
heroDropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  heroDropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    const dt = new DataTransfer();
    dt.items.add(file);
    heroInput.files = dt.files;
    heroInput.dispatchEvent(new Event("change"));
  }
});

// ── 3. Ribbon preview + word count ────────────────────────────
ribbonInput.addEventListener("input", updateRibbonPreview);

function updateRibbonPreview() {
  const items = ribbonInput.value.split(",").map(i => i.trim()).filter(Boolean);
  const count = items.length;

  wordCountDisplay.textContent = `${count} / 12 items`;
  wordCountDisplay.classList.toggle("over", count > 12);

  if (!items.length) {
    ribbonItemsEl.innerHTML = `<span class="ribbon-item"><span class="ribbon-sep">✦</span> Add items above to see preview</span>`;
    return;
  }
  const doubled = [...items, ...items];
  ribbonItemsEl.innerHTML = doubled
    .map(i => `<span class="ribbon-item"><span class="ribbon-sep">✦</span> ${i}</span>`)
    .join("");
}

// ── 4. Save ────────────────────────────────────────────────────
saveBtn.addEventListener("click", async () => {
  // Validation
  if (!currentHeroBase64) {
    showToast("Pehle hero image upload karo", true);
    return;
  }
  const items = ribbonInput.value.split(",").filter(i => i.trim() !== "");
  if (items.length > 12) {
    showToast("Max 12 items allowed", true);
    return;
  }
  if (!restaurantId) {
    showToast("Restaurant ID nahi mila, logout karke login karo", true);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    await updateDoc(doc(db, "restaurants", restaurantId), {
      item1: currentHeroBase64,
      item_names: ribbonInput.value.trim(),
      sync: true
    });
    showToast("Front Screen save ho gaya! ✅");
  } catch (err) {
    showToast("Save failed: " + err.message, true);
    console.error("Firestore save error:", err);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Everything`;
  }
});