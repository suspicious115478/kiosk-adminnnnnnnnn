import {
  db, requireAuth, getRestaurantId, getRestaurantName,
  handleLogout, showToast, compressImage
} from "./firebase.js";

import {
  collection, query, orderBy, onSnapshot,
  getDocs, where, doc, updateDoc, Timestamp
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
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentMode   = "live";
let unsubscribeFn = null;
let knownOrderIds = new Set();

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

  // ── Smart DOM diff — sirf changed/new cards update karo ──
  const existingCards = new Map(
    [...list.querySelectorAll(".order-card[data-id]")].map(el => [el.dataset.id, el])
  );
  const incomingIds = new Set(orders.map(o => o.id));

  // Remove cards jo ab nahi hain
  existingCards.forEach((el, id) => {
    if (!incomingIds.has(id)) {
      el.style.transition = "opacity 0.3s, transform 0.3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";
      setTimeout(() => el.remove(), 300);
    }
  });

  // Empty state hata do
  list.querySelector(".orders-empty")?.remove();

  // Orders render karo — existing update, naye add karo
  orders.forEach((order, i) => {
    const isNew   = flashIds.includes(order.id);
    const newHtml = buildOrderCard(order, isNew, i);

    if (existingCards.has(order.id)) {
      // Existing card — sirf content update karo, flicker nahi
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const newCard = temp.firstElementChild;
      const oldCard = existingCards.get(order.id);

      // Sirf status change hua ho toh class update karo
      if (oldCard.className !== newCard.className) {
        oldCard.className = newCard.className;
      }

      // Header aur footer quietly update karo
      const oldHeader = oldCard.querySelector(".order-header");
      const newHeader = newCard.querySelector(".order-header");
      if (oldHeader && newHeader && oldHeader.innerHTML !== newHeader.innerHTML) {
        oldHeader.innerHTML = newHeader.innerHTML;
        bindSelectListeners(oldCard, order.id);
      }

      const oldFooter = oldCard.querySelector(".order-footer");
      const newFooter = newCard.querySelector(".order-footer");
      if (oldFooter && newFooter && oldFooter.innerHTML !== newFooter.innerHTML) {
        oldFooter.innerHTML = newFooter.innerHTML;
      }

    } else {
      // Naya card — fade in ke saath add karo
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const card = temp.firstElementChild;
      card.style.opacity = "0";
      card.style.transform = "translateY(12px)";

      // Pehle existing cards se pehle insert karo (newest first)
      const firstCard = list.querySelector(".order-card");
      if (firstCard) {
        list.insertBefore(card, firstCard);
      } else {
        list.appendChild(card);
      }

      // Smooth fade in
      requestAnimationFrame(() => {
        card.style.transition = "opacity 0.35s ease, transform 0.35s ease";
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      });

      bindSelectListeners(card, order.id);
    }
  });
}

// ── Select listeners alag function mein ──
function bindSelectListeners(card, orderId) {
  card.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      try {
        const updateData = { status: newStatus };
        if (newStatus === "COMPLETED") updateData.completedAt = Date.now();
        if (newStatus === "PREPARING") updateData.preparingAt = Date.now();
        await updateDoc(
          doc(db, "restaurants", restaurantId, "orders", orderId),
          updateData
        );
        showToast("Status updated ✅");
      } catch (err) {
        showToast("Failed to update status: " + err.message, true);
        e.target.value = e.target.dataset.oldStatus;
      }
      e.target.dataset.oldStatus = newStatus;
    });
  });
}
// ── Duration helper ───────────────────────────────────────────────────────────
/**
 * Firestore timestamp ya plain millis dono handle karta hai.
 * Returns milliseconds as Number, or null if invalid.
 */
function tsToMs(ts) {
  if (!ts) return null;
  if (typeof ts === "number") return ts;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  return null;
}

/**
 * Milliseconds ko "X min" ya "X hr Y min" format mein return karta hai.
 */
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

  // ── Completion time badge ──────────────────────────────────────────────────
  // Show only when status is COMPLETED and timestamps are available.
  // We use createdAt → completedAt for total time.
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