// ── CITIZEN ───────────────────────────────────────────────────

let citizenFilter = "all";
let allCitizenProps = [];

async function loadCitizenData() {
  document.getElementById("citizen-addr").textContent = currentAccount;
  try {
    const all = await getAllProperties();
    allCitizenProps = all.filter(p => p.owner === currentAccount);
    const incoming = all.filter(p => p.txActive && p.txBuyer === currentAccount && p.txRegApproved);

    document.getElementById("citizen-count").textContent    = allCitizenProps.length;
    document.getElementById("citizen-verified").textContent = allCitizenProps.filter(p => p.status === 1).length;
    document.getElementById("citizen-pending").textContent  = allCitizenProps.filter(p => p.status === 0).length;

    // Notice board
    const pending  = allCitizenProps.filter(p => p.status === 0);
    const rejected = allCitizenProps.filter(p => p.status === 2);
    let notices = [];
    pending.forEach(p => {
      const step = p.surveyorApproved ? "Awaiting Registrar approval" : "Awaiting Surveyor verification";
      notices.push(`Ref ${formatRef(p.id)} — ${step}`);
    });
    rejected.forEach(p => notices.push(`Ref ${formatRef(p.id)} — Rejected. Reason: ${p.rejectionReason.slice(0,60)}...`));
    const nb = document.getElementById("citizen-notice-board");
    if (notices.length) {
      nb.style.display = "block";
      document.getElementById("citizen-notices").innerHTML = notices.map(n =>
        `<div class="notice-item"><div class="notice-dot"></div>${n}</div>`).join("");
    } else { nb.style.display = "none"; }

    const incSec = document.getElementById("incoming-section");
    if (incoming.length) {
      incSec.style.display = "block";
      document.getElementById("incoming-cards").innerHTML = incoming.map(p => buildCard(p, "incoming")).join("");
    } else { incSec.style.display = "none"; }

    renderCitizenCards();
    setSynced(true);
  } catch(e) { toast("Error loading data: " + (e.reason || e.message), "error"); setSynced(false); }
}

function setCitizenFilter(f, btn) {
  citizenFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderCitizenCards();
}

function renderCitizenCards() {
  const fm = {all:null, verified:1, pending:0, rejected:2, disputed:3};
  const filtered = citizenFilter === "all"
    ? allCitizenProps
    : allCitizenProps.filter(p => p.status === fm[citizenFilter]);
  const c = document.getElementById("citizen-cards");
  c.innerHTML = filtered.length === 0
    ? `<div class="empty-state"><div class="empty-icon">🏡</div><p>No ${citizenFilter === "all" ? "properties" : citizenFilter + " properties"} found.</p></div>`
    : filtered.map(p => buildCard(p, "citizen")).join("");
}

async function populateTransferDropdown() {
  const sel = document.getElementById("tx-property-select");
  sel.innerHTML = '<option value="">— loading —</option>';
  try {
    const all  = await getAllProperties();
    const mine = all.filter(p => p.owner === currentAccount && p.status === 1 && !p.txActive);
    sel.innerHTML = mine.length === 0
      ? '<option value="">— no verified properties available —</option>'
      : '<option value="">— select a verified property —</option>' +
        mine.map(p => `<option value="${p.id}" data-declared="${p.declaredValue}">${formatRef(p.id)} — ${p.location.slice(0,60)}</option>`).join("");
    sel.onchange = updateTransferValueCompare;
  } catch(e) { sel.innerHTML = '<option value="">Error loading</option>'; }
}

function updateTransferValueCompare() {
  const sel      = document.getElementById("tx-property-select");
  const opt      = sel.selectedOptions[0];
  const declared = opt ? parseInt(opt.dataset.declared || 0) : 0;
  const saleVal  = parseInt(document.getElementById("tx-sale-value")?.value) || 0;
  const box      = document.getElementById("tx-value-compare");
  if (declared > 0) {
    box.style.display = "block";
    document.getElementById("tx-orig-value").textContent = "₹" + declared.toLocaleString("en-IN");
    const nv   = document.getElementById("tx-new-val-box");
    const diff = saleVal > 0 ? Math.abs(saleVal - declared) / declared * 100 : 0;
    nv.className = diff > 20 ? "val-box warn" : "val-box";
    document.getElementById("tx-new-value").textContent = saleVal > 0 ? "₹" + saleVal.toLocaleString("en-IN") : "—";
  } else { box.style.display = "none"; }
}

// ── CITIZEN CONTRACT ACTIONS ──────────────────────────────────

async function registerProperty() {
  const loc      = document.getElementById("reg-location")?.value.trim();
  const unitId   = document.getElementById("reg-unit-id")?.value.trim();
  const area     = parseInt(document.getElementById("reg-area")?.value);
  const lat      = parseFloat(document.getElementById("reg-lat")?.value) || 0;
  const lng      = parseFloat(document.getElementById("reg-lng")?.value) || 0;
  const value    = parseInt(document.getElementById("reg-value")?.value) || 0;
  const type     = document.getElementById("reg-type")?.value;
  const parentId = type === "unit" ? (parseInt(document.getElementById("reg-parent-id")?.value) || 0) : 0;
  const resubFrom = parseInt(document.getElementById("reg-resubmit-from")?.value) || 0;

  if (!loc)            { toast("Location is required.", "error"); return; }
  if (!area || area <= 0) { toast("Area must be greater than 0.", "error"); return; }
  if (!value || value <= 0) { toast("Declared value is required.", "error"); return; }
  if (type === "unit" && !unitId) { toast("Unit identifier required for flat/unit.", "error"); return; }
  if (calculatedArea && Math.abs(area - calculatedArea) / calculatedArea * 100 > 10) {
    toast("Area mismatch too large. Reconcile before submitting.", "error"); return;
  }

  const manifestHash = await buildAndUploadManifest();
  if (!manifestHash) return;

  await txWrapper(
    () => contract.registerProperty(loc, unitId, area, manifestHash, Math.round(lat*1e6), Math.round(lng*1e6), parentId, resubFrom, value),
    "Property registration submitted! Awaiting Surveyor verification.",
    () => { clearRegForm(); loadCitizenData(); }
  );
}

function clearRegForm() {
  ["reg-location","reg-area","reg-lat","reg-lng","reg-value","reg-unit-id","reg-parent-id","reg-resubmit-from","wit1-name","wit1-addr","wit2-name","wit2-addr"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  Object.keys(docHashes).forEach(k => delete docHashes[k]);
  ["saleDeed","idProof","taxReceipt","encumbrance","surveyMap","oc","noc"].forEach(k => {
    const s = document.getElementById("slot-"+k);
    const h = document.getElementById("hash-"+k);
    if (s) s.classList.remove("uploaded");
    if (h) { h.style.display = "none"; h.textContent = ""; }
  });
  const noteEl = document.getElementById("calc-area-note");
  const rfEl   = document.getElementById("resubmit-field");
  if (noteEl) noteEl.textContent = "";
  if (rfEl)   rfEl.style.display = "none";
  const typeEl = document.getElementById("reg-type");
  if (typeEl) typeEl.value = "land";
  toggleUnitFields();
  clearMapDrawing();
}

function enableResubmitMode() {
  const rfEl = document.getElementById("resubmit-field");
  if (rfEl) rfEl.style.display = "block";
}

function prefillResubmit(rejectedId) {
  // Switch to register tab
  document.querySelectorAll("#view-citizen .nav-tab").forEach((b, i) => b.classList.toggle("active", i === 1));
  ["overview","register","transfer","ledger"].forEach((t, i) => {
    const el = document.getElementById("ctab-"+t);
    if (el) el.style.display = i === 1 ? "block" : "none";
  });
  enableResubmitMode();
  const rfFrom = document.getElementById("reg-resubmit-from");
  if (rfFrom) rfFrom.value = rejectedId;
  if (!leafletMap) { setTimeout(initRegMap, 150); } else { setTimeout(() => leafletMap.invalidateSize(), 100); }
  toast(`Pre-filling resubmission for ${formatRef(rejectedId)}`, "info");
}

function toggleUnitFields() {
  const isUnit = document.getElementById("reg-type")?.value === "unit";
  const uf = document.getElementById("unit-id-field");
  const pf = document.getElementById("parent-id-field");
  if (uf) uf.style.display = isUnit ? "block" : "none";
  if (pf) pf.style.display = isUnit ? "block" : "none";
}

async function initiateTransfer() {
  const id    = parseInt(document.getElementById("tx-property-select")?.value);
  const buyer = document.getElementById("tx-buyer")?.value.trim();
  const saleV = parseInt(document.getElementById("tx-sale-value")?.value) || 0;
  if (!id)   { toast("Please select a property.", "error"); return; }
  if (!buyer || !ethers.utils.isAddress(buyer)) { toast("Valid buyer wallet address required.", "error"); return; }
  if (!saleV || saleV <= 0) { toast("Agreed sale value is required.", "error"); return; }
  if (buyer.toLowerCase() === currentAccount) { toast("Cannot transfer to yourself.", "error"); return; }
  await txWrapper(
    () => contract.initiateTransfer(id, buyer, saleV),
    "Transfer initiated! Awaiting Registrar approval.",
    () => {
      document.getElementById("tx-property-select").value = "";
      document.getElementById("tx-buyer").value = "";
      document.getElementById("tx-sale-value").value = "";
      loadCitizenData();
    }
  );
}

async function cancelTransfer(id)  { await txWrapper(() => contract.cancelTransfer(id),  "Transfer cancelled.", () => loadCitizenData()); }
async function expireTransfer(id)  { await txWrapper(() => contract.expireTransfer(id),  "Expired transfer cleaned up.", () => loadCitizenData()); }
async function acceptTransfer(id)  { await txWrapper(() => contract.acceptTransfer(id),  "Transfer accepted! You are now the owner. 🎉", () => loadCitizenData()); }
async function raiseDispute(id)    { await txWrapper(() => contract.raiseDispute(id),    `Dispute raised for ${formatRef(id)}.`, () => loadCitizenData()); }
