import {
  db, requireAuth, getRestaurantId, showToast, compressImage
} from "./firebase.js";

import {
  doc, updateDoc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();

const restaurantId = await getRestaurantId();
const heroInput = document.getElementById("heroInput");
const heroPreview = document.getElementById("heroPreview");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const ribbonInput = document.getElementById("ribbonInput");
const saveBtn = document.getElementById("saveAllBtn");
const wordCountDisplay = document.getElementById("wordCount");

let currentHeroBase64 = null;

// ── 1. Data Load Karo (Realtime) ──
if (restaurantId) {
  const restRef = doc(db, "restaurants", restaurantId);
  const snap = await getDoc(restRef);
  
  if (snap.exists()) {
    const data = snap.data();
    if (data.item1) {
      heroPreview.src = data.item1;
      heroPreview.style.display = "block";
      uploadPlaceholder.style.display = "none";
      currentHeroBase64 = data.item1;
    }
    if (data.item_names) {
      ribbonInput.value = data.item_names;
      updateWordCount();
    }
  }
}

// ── 2. Image Handling ──
document.getElementById("heroDropZone").addEventListener("click", () => heroInput.click());

heroInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showToast("Compressing image...");
    const base64 = await compressImage(file, 800); // 800px quality for hero
    heroPreview.src = base64;
    heroPreview.style.display = "block";
    uploadPlaceholder.style.display = "none";
    currentHeroBase64 = base64;
    showToast("Image ready to save!");
  } catch (err) {
    showToast("Error processing image", true);
  }
});

// ── 3. Ribbon Text Limit ──
ribbonInput.addEventListener("input", updateWordCount);

function updateWordCount() {
  const items = ribbonInput.value.split(",").filter(i => i.trim() !== "");
  wordCountDisplay.textContent = `${items.length} / 12 items`;
  
  if (items.length > 12) {
    wordCountDisplay.style.color = "var(--red)";
  } else {
    wordCountDisplay.style.color = "var(--muted)";
  }
}

// ── 4. Save Everything ──
saveBtn.addEventListener("click", async () => {
  const items = ribbonInput.value.split(",").filter(i => i.trim() !== "");
  
  if (items.length > 12) {
    showToast("Please limit to 12 items", true);
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    await updateDoc(doc(db, "restaurants", restaurantId), {
      item1: currentHeroBase64,
      item_names: ribbonInput.value,
      sync: true // Auto sync kiosk after save
    });
    
    showToast("Front Screen updated successfully! ✅");
  } catch (err) {
    showToast("Save failed: " + err.message, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Everything";
  }
});