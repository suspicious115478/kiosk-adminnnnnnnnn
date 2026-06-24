//ye mera current version ahi

import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, doc, getDoc, getDocs, addDoc,
  query, orderBy, onSnapshot, where, updateDoc,
  Timestamp, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

await requireAuth();
document.getElementById("logoutBtn").addEventListener("click", handleLogout);

const restaurantId = await getRestaurantId();
const name         = await getRestaurantName();
document.getElementById("restaurantLabel").textContent = name || "My Restaurant";

if (!restaurantId) showToast("Restaurant not found", true);

// ── Logo / brand color sync ───────────────────────────────────────────────────
function showLogoPreview(src) {
  const preview = document.getElementById("logoPreview");
  const icon    = document.getElementById("logoIcon");
  preview.src = src; preview.style.display = "block"; icon.style.display = "none";
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
  } catch (err) { showToast("Failed to save logo: " + err.message, true); }
});
if (restaurantId) {
  onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.logo) showLogoPreview(data.logo);
  if (data.brandColor) {
    const dot = document.getElementById("colorDot");
    if (dot) dot.style.background = data.brandColor;
  }
  if (data.stockMode) stockMode = data.stockMode;
});
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentMode   = "live";
let unsubscribeFn = null;
let knownOrderIds = new Set();
let stockMode = "manual"; // default safe

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.getElementById("tabLive").addEventListener("click", () => {
  currentMode = "live";
  document.getElementById("tabLive").classList.add("active");
  document.getElementById("tabDate").classList.remove("active");
  document.getElementById("datePickerRow").style.display = "none";
  startLiveListener();
});

document.getElementById("tabDate").addEventListener("click", () => {
  currentMode = "date";
  document.getElementById("tabDate").classList.add("active");
  document.getElementById("tabLive").classList.remove("active");
  document.getElementById("datePickerRow").style.display = "flex";
  stopListener();
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("datePicker").value = today;
  loadByDate(today);
});

document.getElementById("loadDateBtn").addEventListener("click", () => {
  const val = document.getElementById("datePicker").value;
  if (val) loadByDate(val);
});
document.getElementById("datePicker").addEventListener("change", (e) => {
  if (e.target.value) loadByDate(e.target.value);
});

// ── Listener management ───────────────────────────────────────────────────────
function stopListener() {
  if (unsubscribeFn) { unsubscribeFn(); unsubscribeFn = null; }
}

function startLiveListener() {
  stopListener();
  if (!restaurantId) return;

  const q = query(
    collection(db, "restaurants", restaurantId, "orders"),
    orderBy("createdAt", "desc")
  );

  unsubscribeFn = onSnapshot(q, (snap) => {
    const orders  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const newIds  = new Set(orders.map(o => o.id));
    const freshIds = [...newIds].filter(id => !knownOrderIds.has(id) && knownOrderIds.size > 0);
    knownOrderIds  = newIds;
    renderOrders(orders, freshIds);
  }, (err) => {
    showToast("Realtime error: " + err.message, true);
  });
}

async function loadByDate(dateStr) {
  if (!restaurantId) return;
  setLoadingState();
  try {
    const start = new Date(dateStr); start.setHours(0, 0, 0, 0);
    const end   = new Date(dateStr); end.setHours(23, 59, 59, 999);
    const q = query(
      collection(db, "restaurants", restaurantId, "orders"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<=", Timestamp.fromDate(end)),
      orderBy("createdAt", "desc")
    );
    const snap   = await getDocs(q);
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders(orders, []);
  } catch (e) {
    showToast("Failed to load orders: " + e.message, true);
    setEmptyState("No orders found for " + dateStr);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderOrders(orders, flashIds = []) {
  updateSummary(orders);

  const list = document.getElementById("ordersList");

  if (!orders.length) {
    list.innerHTML = `
      <div class="orders-empty">
        <span class="empty-icon">🧾</span>
        <div class="empty-title">${currentMode === "live" ? "No orders yet — waiting for new ones..." : "No orders on this date"}</div>
      </div>`;
    return;
  }

  const existingCards = new Map(
    [...list.querySelectorAll(".order-card[data-id]")].map(el => [el.dataset.id, el])
  );
  const incomingIds = new Set(orders.map(o => o.id));

  // Remove stale cards
  existingCards.forEach((el, id) => {
    if (!incomingIds.has(id)) {
      el.style.transition = "opacity 0.3s, transform 0.3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";
      setTimeout(() => el.remove(), 300);
    }
  });

  list.querySelector(".orders-empty")?.remove();

  orders.forEach((order, i) => {
    const isNew   = flashIds.includes(order.id);
    const newHtml = buildOrderCard(order, isNew, i);

    if (existingCards.has(order.id)) {
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const newCard = temp.firstElementChild;
      const oldCard = existingCards.get(order.id);

      if (oldCard.className !== newCard.className) {
        oldCard.className = newCard.className;
      }

      const oldHeader = oldCard.querySelector(".order-header");
      const newHeader = newCard.querySelector(".order-header");
      if (oldHeader && newHeader && oldHeader.innerHTML !== newHeader.innerHTML) {
        oldHeader.innerHTML = newHeader.innerHTML;
        bindSelectListeners(oldCard, order.id, order);
      }

      const oldFooter = oldCard.querySelector(".order-footer");
      const newFooter = newCard.querySelector(".order-footer");
      if (oldFooter && newFooter && oldFooter.innerHTML !== newFooter.innerHTML) {
        oldFooter.innerHTML = newFooter.innerHTML;
      }

      list.appendChild(oldCard);

    } else {
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const card = temp.firstElementChild;
      card.style.opacity = "0";
      card.style.transform = "translateY(12px)";
      list.appendChild(card);

      requestAnimationFrame(() => {
        card.style.transition = "opacity 0.35s ease, transform 0.35s ease";
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      });

      bindSelectListeners(card, order.id, order);
    }
  });
}

// ── Status select listeners ───────────────────────────────────────────────────
function bindSelectListeners(card, orderId, orderData) {
  card.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      const oldStatus = e.target.dataset.oldStatus;

      // Disable select during update
      sel.disabled = true;

      try {
        const updateData = { status: newStatus };
        if (newStatus === "COMPLETED") updateData.completedAt = Date.now();
        if (newStatus === "PREPARING") updateData.preparingAt = Date.now();

        await updateDoc(
          doc(db, "restaurants", restaurantId, "orders", orderId),
          updateData
        );

        // ── Inventory deduction on PREPARING (ya seedha COMPLETED, Preparing skip ho to) ──
// Only deduct once per order (guard: inventoryDeducted flag on order doc)
const alreadyPastPreparing =
  (oldStatus === "PREPARING" || oldStatus === "COMPLETED");

if (
  (newStatus === "PREPARING" || newStatus === "COMPLETED") &&
  !alreadyPastPreparing
) {

  // Prepared stock hamesha deduct hoga
  await deductPreparedStockForOrder(orderData);

  // Raw stock sirf auto mode me
  if (stockMode === "auto") {
    await deductInventoryForOrder(orderId, orderData);
  }
}

        showToast("Status updated ✅");
        e.target.dataset.oldStatus = newStatus;
      } catch (err) {
        showToast("Failed to update status: " + err.message, true);
        e.target.value = oldStatus;
      } finally {
        sel.disabled = false;
      }
    });
  });
}

// ── Inventory deduction logic ─────────────────────────────────────────────────
/**
 * For each item in the order:
 *   1. Recipe dhundhte hain name se (menuItemName field) — kyunki Android menuItemId save nahi karta
 *   2. For each ingredient: deduct (ingredient.qty * item.qty) from inventory_raw stock
 *   3. Write a stock_history entry
 *   4. Mark order as inventoryDeducted: true to prevent double-deduction
 */

// Recipes — realtime listener, kabhi stale nahi rahega
let recipesByName = {}; // menuItemName (lowercase) → recipe data

onSnapshot(
  collection(db, "restaurants", restaurantId, "recipes"),
  (snap) => {
    recipesByName = {};
    snap.forEach(d => {
      const data = d.data();
      if (data.menuItemName) {
        recipesByName[data.menuItemName.trim().toLowerCase()] = data;
      }
    });
    console.log("✅ Recipes loaded:", Object.keys(recipesByName));   // ADD
  },
  (err) => console.error("❌ Recipes listener error:", err)          // ADD
);

function findRecipeByName(itemName) {
  const key = (itemName || "").trim().toLowerCase();
  return recipesByName[key] || null;
}

async function deductInventoryForOrder(orderId, orderData) {
  // Re-fetch order — inventoryDeducted flag check (double-deduction guard)
  const orderRef  = doc(db, "restaurants", restaurantId, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) return;

  const freshOrder = orderSnap.data();
  if (freshOrder.inventoryDeducted) return; // pehle ho chuka hai

  const items = freshOrder.items || orderData?.items || [];
  if (!items.length) return;

  const deductions = [];

  // Har order item ke liye recipe dhundho — name se match
  for (const item of items) {
    const itemName = item.name || "";
    if (!itemName) continue;

    const recipe = await findRecipeByName(itemName);
    if (!recipe) continue; // is item ki recipe nahi bani — skip

    const orderQty     = item.qty ?? item.quantity ?? 1;
    const recipeYield  = recipe.yield || 1;
    // Servings this order item needs = orderQty / recipeYield
    const servings     = orderQty / recipeYield;

    for (const ing of (recipe.ingredients || [])) {
      const deductQty = ing.qty * servings;
      if (!ing.rawId || deductQty <= 0) continue;
      deductions.push({
        rawId:      ing.rawId,
        rawName:    ing.rawName,
        deductQty,
        unitSymbol: ing.unitSymbol || ing.unitName || "",
      });
    }
  }

  if (!deductions.length) {
  await updateDoc(orderRef, {
    inventoryDeducted: true,
    inventoryDeductedAt: Date.now()
  });
  return;
}

  // Merge deductions for same rawId (if same ingredient appears in multiple items)
  const merged = {};
  for (const d of deductions) {
    if (merged[d.rawId]) {
      merged[d.rawId].deductQty += d.deductQty;
    } else {
      merged[d.rawId] = { ...d };
    }
  }

  const shortOrderId = (freshOrder.orderId || orderId).slice(0, 6).toUpperCase();
  const insufficientItems = [];

  // Apply deductions using Firestore transactions (atomic per raw material)
  for (const [rawId, d] of Object.entries(merged)) {
    const rawRef = doc(db, "restaurants", restaurantId, "inventory_raw", rawId);
    try {
      await runTransaction(db, async (tx) => {
        const rawSnap = await tx.get(rawRef);
        if (!rawSnap.exists()) return; // Material deleted — skip

        const currentStock = typeof rawSnap.data().stock === "number"
          ? rawSnap.data().stock : 0;
        const newStock = Math.max(0, currentStock - d.deductQty);

        if (currentStock < d.deductQty) {
          insufficientItems.push(`${d.rawName} (need ${fmt(d.deductQty)}, have ${fmt(currentStock)})`);
        }

        tx.update(rawRef, { stock: newStock });

        // Write history — addDoc can't be inside a transaction,
        // so we queue it after the transaction
        d._prevStock = currentStock;
        d._newStock  = newStock;
      });

      // Write stock_history after transaction succeeds
      const histRef = collection(
        db, "restaurants", restaurantId, "inventory_raw", rawId, "stock_history"
      );
      await addDoc(histRef, {
        type:      "deduct",
        qty:       d.deductQty,
        prevQty:   d._prevStock,
        newQty:    d._newStock,
        note:      `Auto-deducted — Order #${shortOrderId}`,
        orderId:   orderId,
        createdAt: serverTimestamp(),
      });

    } catch (txErr) {
      console.warn(`Inventory deduction failed for ${d.rawName}:`, txErr.message);
    }
  }

 

  // Mark order as deducted
  await updateDoc(orderRef, {
    inventoryDeducted:    true,
    inventoryDeductedAt:  Date.now(),
  });

  // Notify about low/insufficient stock
  if (insufficientItems.length) {
    showToast(
      `⚠️ Low stock: ${insufficientItems.slice(0, 2).join(", ")}${insufficientItems.length > 2 ? " & more" : ""}`,
      true
    );
  } else {
    showToast("📦 Inventory updated");
  }
}

function fmt(n) {
  return Number.isInteger(n) ? n : parseFloat(n.toFixed(3));
}

// ── Prepared stock deduction ──────────────────────────────────────────────────
async function deductPreparedStockForOrder(orderData) {
  const items = orderData.items || [];
  if (!items.length) return;

  for (const item of items) {
    const itemName = (item.name || "").trim().toLowerCase();
    if (!itemName) continue;

    const orderQty = item.qty ?? item.quantity ?? 1;

    // prepared_stocks me name se match karo
    const prepSnap = await getDocs(
      query(
        collection(db, "restaurants", restaurantId, "prepared_stocks"),
        where("menuItemName", "==", item.name.trim())
      )
    );

    if (prepSnap.empty) continue;

    const prepDoc    = prepSnap.docs[0];
    const prepRef    = doc(db, "restaurants", restaurantId, "prepared_stocks", prepDoc.id);
    const currentQty = typeof prepDoc.data().stock === "number" ? prepDoc.data().stock : 0;
    const newQty     = Math.max(0, currentQty - orderQty);

    await updateDoc(prepRef, { stock: newQty });

    // History bhi likhte hain
    const histRef = collection(
      db, "restaurants", restaurantId, "prepared_stocks", prepDoc.id, "stock_history"
    );
    const shortOrderId = (orderData.orderId || "").slice(0, 6).toUpperCase();
    await addDoc(histRef, {
      type:      "deduct",
      qty:       orderQty,
      prevQty:   currentQty,
      newQty,
      note:      `Auto-deducted — Order #${shortOrderId}`,
      createdAt: serverTimestamp()
    });
  }
}

// ── Duration helper ───────────────────────────────────────────────────────────
function tsToMs(ts) {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  return null;
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const hours    = Math.floor(totalSec / 3600);
  const minutes  = Math.floor((totalSec % 3600) / 60);
  const seconds  = totalSec % 60;

  if (hours > 0)   return `${hours} hr ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} sec`;
}

// ── Order card builder ────────────────────────────────────────────────────────
function buildOrderCard(order, isNew, index) {
  const status    = order.status || "NEW";
  const orderType = order.orderType || "KIOSK";
  const items     = order.items || [];
  const total     = order.totalPrice || 0;
  const shortId   = (order.orderId || order.id || "").slice(0, 6).toUpperCase();
  const timeStr   = formatTime(order.createdAt);
  const payStatus = order.paymentStatus || null;

  const typeLabel     = { DINE_IN: "Dine In", TAKEAWAY: "Takeaway", KIOSK: "Kiosk" }[orderType] || orderType;
  const statusOptions = ["NEW", "PREPARING", "COMPLETED"];

  // Completion time badge
  let completionBadgeHtml = "";
  if (status === "COMPLETED") {
    const createdMs   = tsToMs(order.createdAt);
    const completedMs = tsToMs(order.completedAt);
    if (createdMs && completedMs && completedMs > createdMs) {
      const duration = formatDuration(completedMs - createdMs);
      if (duration) {
        completionBadgeHtml = `
          <span class="completion-time-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            in ${duration}
          </span>`;
      }
    }
  }

  // Inventory deducted badge
  const invBadgeHtml = order.inventoryDeducted
    ? `<span class="inv-deducted-badge" title="Inventory deducted for this order">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        Stock Updated
      </span>`
    : "";

  const itemsHtml = items.map(item => `
    <div class="order-item-row">
      <span class="order-item-qty">×${item.qty ?? item.quantity ?? 1}</span>
      <span class="order-item-name">${item.name}</span>
      <span class="order-item-price">₹${((item.price ?? 0) * (item.qty ?? item.quantity ?? 1)).toFixed(2)}</span>
    </div>
  `).join("");

  const statusOptsHtml = statusOptions.map(s =>
    `<option value="${s}" ${s === status ? "selected" : ""}>${statusLabel(s)}</option>`
  ).join("");

  return `
  <div class="order-card status-${status} ${isNew ? "new-flash" : ""}" data-id="${order.id}" style="animation-delay:${index * 40}ms">
    <div class="order-header">
      <div class="order-id">#${shortId}<span>${timeStr}</span></div>
      <span class="order-type-badge type-${orderType}">${typeLabel}</span>
      <span class="status-badge-pill s-${status}">
        ${statusDot(status)} ${statusLabel(status)}
      </span>
      ${completionBadgeHtml}
      ${invBadgeHtml}
      ${payStatus ? `<span class="payment-badge ps-${payStatus.toLowerCase()}">${{"PENDING":"🟡 Pending","SUCCESS":"🟢 Paid","FAILED":"🔴 Failed","CANCELLED":"⚫ Cancelled"}[payStatus]||payStatus}</span>` : ""}
      <select class="status-select" data-order-id="${order.id}" data-old-status="${status}">
        ${statusOptsHtml}
      </select>
    </div>
    <div class="order-body">
      <div class="order-items-list">
        ${itemsHtml || '<div style="color:var(--muted); font-size:0.82rem;">No items found</div>'}
      </div>
    </div>
    <div class="order-footer">
      <span class="order-total">₹${(total).toFixed(2)}</span>
    </div>
  </div>`;
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function updateSummary(orders) {
  document.getElementById("sumTotal").textContent    = orders.length;
  document.getElementById("sumRevenue").textContent  =
    "₹" + orders.reduce((s, o) => s + (o.totalPrice || 0), 0).toFixed(2);
  document.getElementById("sumNew").textContent      = orders.filter(o => o.status === "NEW").length;
  document.getElementById("sumPrep").textContent     = orders.filter(o => o.status === "PREPARING").length;
  document.getElementById("sumDone").textContent     = orders.filter(o => o.status === "COMPLETED").length;
}

function setLoadingState() {
  document.getElementById("ordersList").innerHTML =
    `<div class="orders-empty"><span class="empty-icon">⏳</span><p>Loading orders...</p></div>`;
}

function setEmptyState(msg) {
  document.getElementById("ordersList").innerHTML =
    `<div class="orders-empty"><span class="empty-icon">🧾</span><div class="empty-title">${msg}</div></div>`;
  updateSummary([]);
}

// ── Util ──────────────────────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  } catch (_) { return "—"; }
}

function statusLabel(s) {
  return { NEW: "New", PREPARING: "Preparing", COMPLETED: "Completed" }[s] || s;
}

function statusDot(s) {
  return { NEW: "🟠", PREPARING: "🔵", COMPLETED: "🟢" }[s] || "⚪";
}

startLiveListener();