// ── APP — navigation, dashboard, public ledger ────────────────

let publicLedgerProps = [];

// ── DASHBOARD ─────────────────────────────────────────────────

function showDashboard() {
  document.getElementById("home-page").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  const syncEl = document.getElementById("sync-indicator");
  if (syncEl) syncEl.style.display = "flex";

  ["citizen","surveyor","registrar","dispute","admin"].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = "none";
  });
  const view = document.getElementById(`view-${role}`);
  if (view) view.style.display = "block";

  if      (role === "citizen")   loadCitizenData();
  else if (role === "surveyor")  loadSurveyorData();
  else if (role === "registrar") loadRegistrarData();
  else if (role === "dispute")   loadDisputeData();
  else if (role === "admin")     loadAdminData();
}

function goHome() {
  document.getElementById("home-page").style.display  = "block";
  document.getElementById("dashboard").style.display  = "none";
  const syncEl = document.getElementById("sync-indicator");
  if (syncEl) syncEl.style.display = "none";
}

function scrollToLedger() {
  document.getElementById("public-ledger-section")?.scrollIntoView({ behavior: "smooth" });
}

// ── PUBLIC LEDGER (no wallet) ─────────────────────────────────

async function loadPublicLedger() {
  const c = document.getElementById("public-ledger-cards");
  if (!c) return;
  c.innerHTML = `<div class="empty-state"><div class="spinner"></div><p style="margin-top:8px">Loading blockchain records...</p></div>`;
  try {
    const all = await getAllProperties(true);
    publicLedgerProps = all.filter(p => p.status === 1);
    renderPublicLedger();
  } catch(e) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not load blockchain records. Check network.</p></div>`;
  }
}

function filterPublicLedger() { renderPublicLedger(); }

function renderPublicLedger() {
  const c = document.getElementById("public-ledger-cards");
  const q = document.getElementById("public-ledger-search")?.value.toLowerCase() || "";
  const filtered = publicLedgerProps.filter(p => !q || String(p.id).includes(q) || p.location.toLowerCase().includes(q));
  if (!filtered.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No verified properties found.</p></div>`;
    return;
  }
  c.innerHTML = filtered.map(p => buildLedgerCard(p)).join("");
}

// ── TAB SWITCHERS ─────────────────────────────────────────────

function switchCitizenTab(tab, btn) {
  ["overview","register","transfer","ledger"].forEach(t => {
    const el = document.getElementById("ctab-"+t);
    if (el) el.style.display = "none";
  });
  const tabEl = document.getElementById("ctab-"+tab);
  if (tabEl) tabEl.style.display = "block";
  document.querySelectorAll("#view-citizen .nav-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const crumb = document.getElementById("citizen-breadcrumb");
  if (crumb) crumb.textContent = {overview:"Dashboard",register:"Register Property",transfer:"Transfer Property",ledger:"Public Ledger"}[tab];

  if (tab === "ledger")   loadLedger("ledger-cards");
  if (tab === "transfer") populateTransferDropdown();
  if (tab === "register") {
    if (!leafletMap) { setTimeout(initRegMap, 150); }
    else { setTimeout(() => leafletMap.invalidateSize(), 100); }
  }
}

function switchSurveyorTab(tab, btn) {
  ["queue","ledger"].forEach(t => {
    const el = document.getElementById("stab-"+t);
    if (el) el.style.display = "none";
  });
  const tabEl = document.getElementById("stab-"+tab);
  if (tabEl) tabEl.style.display = "block";
  document.querySelectorAll("#view-surveyor .nav-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (tab === "ledger") loadLedger("surveyor-ledger-cards");
}

function switchRegistrarTab(tab, btn) {
  ["registrations","transfers","ledger"].forEach(t => {
    const el = document.getElementById("rtab-"+t);
    if (el) el.style.display = "none";
  });
  const tabEl = document.getElementById("rtab-"+tab);
  if (tabEl) tabEl.style.display = "block";
  document.querySelectorAll("#view-registrar .nav-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (tab === "ledger") loadLedger("registrar-ledger-cards");
}

function switchDisputeTab(tab, btn) {
  ["disputes","ledger"].forEach(t => {
    const el = document.getElementById("dtab-"+t);
    if (el) el.style.display = "none";
  });
  const tabEl = document.getElementById("dtab-"+tab);
  if (tabEl) tabEl.style.display = "block";
  document.querySelectorAll("#view-dispute .nav-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (tab === "ledger") loadLedger("dispute-ledger-cards");
}

function switchAdminTab(tab, btn) {
  ["roles","all","ledger"].forEach(t => {
    const el = document.getElementById("atab-"+t);
    if (el) el.style.display = "none";
  });
  const tabEl = document.getElementById("atab-"+tab);
  if (tabEl) tabEl.style.display = "block";
  document.querySelectorAll("#view-admin .nav-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (tab === "ledger") loadLedger("admin-ledger-cards");
  if (tab === "all")    loadAdminData();
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener("load", () => {
  loadPublicLedger();
});
