// ── CITIZEN ───────────────────────────────────────────────────

let citizenFilter   = "all";
let allCitizenProps = [];

// ── Load citizen dashboard data ───────────────────────────────
async function loadCitizenData() {
  document.getElementById("citizen-addr").textContent = currentAccount;
  try {
    const all = await getAllProperties();
    allCitizenProps = all.filter(p => p.owner === currentAccount);

    // Incoming transfers where this wallet is buyer AND registrar has approved
    const incoming = all.filter(p =>
      p.txActive &&
      p.txBuyer === currentAccount &&
      p.txRegApproved
    );

    document.getElementById("citizen-count").textContent    = allCitizenProps.length;
    document.getElementById("citizen-verified").textContent = allCitizenProps.filter(p => p.status === 1).length;
    document.getElementById("citizen-pending").textContent  = allCitizenProps.filter(p => p.status === 0).length;

    // Notice board
    const pending  = allCitizenProps.filter(p => p.status === 0);
    const rejected = allCitizenProps.filter(p => p.status === 2);
    const notices  = [];
    pending.forEach(p => {
      const step = p.surveyorApproved
        ? "Awaiting Registrar approval"
        : "Awaiting Surveyor verification";
      notices.push(`Ref ${formatRef(p.id)} — ${step}`);
    });
    rejected.forEach(p =>
      notices.push(`Ref ${formatRef(p.id)} — Rejected. Reason: ${p.rejectionReason.slice(0,60)}...`)
    );
    const nb = document.getElementById("citizen-notice-board");
    if (notices.length) {
      nb.style.display = "block";
      document.getElementById("citizen-notices").innerHTML = notices
        .map(n => `<div class="notice-item"><div class="notice-dot"></div>${n}</div>`)
        .join("");
    } else {
      nb.style.display = "none";
    }

    // Incoming transfers section
    const incSec = document.getElementById("incoming-section");
    if (incoming.length) {
      incSec.style.display = "block";
      document.getElementById("incoming-cards").innerHTML = incoming
        .map(p => buildCard(p, "incoming")).join("");
    } else {
      incSec.style.display = "none";
    }

    renderCitizenCards();
    setSynced(true);
  } catch(e) {
    toast("Error loading data: " + (e.reason || e.message), "error");
    setSynced(false);
  }
}

// ── Filter buttons ────────────────────────────────────────────
function setCitizenFilter(f, btn) {
  citizenFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderCitizenCards();
}

function renderCitizenCards() {
  const fm = { all: null, verified: 1, pending: 0, rejected: 2, disputed: 3 };
  const filtered = citizenFilter === "all"
    ? allCitizenProps
    : allCitizenProps.filter(p => p.status === fm[citizenFilter]);

  const c = document.getElementById("citizen-cards");
  c.innerHTML = filtered.length === 0
    ? `<div class="empty-state">
         <div class="empty-icon">🏡</div>
         <p>No ${citizenFilter === "all" ? "properties" : citizenFilter + " properties"} found.</p>
       </div>`
    : filtered.map(p => buildCard(p, "citizen")).join("");
}

// ── Transfer dropdown ─────────────────────────────────────────
async function populateTransferDropdown() {
  const sel = document.getElementById("tx-property-select");
  sel.innerHTML = '<option value="">— loading —</option>';
  try {
    const all  = await getAllProperties();
    const mine = all.filter(p =>
      p.owner === currentAccount && p.status === 1 && !p.txActive
    );
    sel.innerHTML = mine.length === 0
      ? '<option value="">— no verified properties available —</option>'
      : '<option value="">— select a verified property —</option>' +
        mine.map(p =>
          `<option value="${p.id}" data-declared="${p.declaredValue}">
             ${formatRef(p.id)} — ${p.location.slice(0,60)}
           </option>`
        ).join("");
    sel.onchange = updateTransferValueCompare;
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading</option>';
  }
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
    document.getElementById("tx-new-value").textContent =
      saleVal > 0 ? "₹" + saleVal.toLocaleString("en-IN") : "—";
  } else {
    box.style.display = "none";
  }
}

// ── Register property ─────────────────────────────────────────
async function registerProperty() {
  const loc      = document.getElementById("reg-location")?.value.trim();
  const surveyNo = document.getElementById("reg-survey-no")?.value.trim();
  const district = document.getElementById("reg-district")?.value.trim();
  const taluka   = document.getElementById("reg-taluka")?.value.trim();
  const village  = document.getElementById("reg-village")?.value.trim();
  const unitId   = document.getElementById("reg-unit-id")?.value.trim();
  const lat      = parseFloat(document.getElementById("reg-lat")?.value)   || 0;
  const lng      = parseFloat(document.getElementById("reg-lng")?.value)   || 0;
  const value    = parseInt(document.getElementById("reg-value")?.value)   || 0;
  const type     = document.getElementById("reg-type")?.value;
  const parentId = type === "unit"
    ? (parseInt(document.getElementById("reg-parent-id")?.value) || 0)
    : 0;
  const resubFrom = parseInt(document.getElementById("reg-resubmit-from")?.value) || 0;

  // ── Read area: Acres+Guntas for land, sq ft for units ─────────
  let area = 0;
  if (type === "unit") {
    area = parseInt(document.getElementById("reg-area-sqft")?.value) || 0;
  } else {
    const acres  = parseInt(document.getElementById("reg-area-acres")?.value)  || 0;
    const guntas = parseInt(document.getElementById("reg-area-guntas")?.value) || 0;
    area = (acres * 40) + guntas;   // store total guntas on-chain
  }

  // ── Validation ────────────────────────────────────────────────
  if (!loc)             { toast("Location / address is required.", "error"); return; }
  if (!area || area<=0) { toast(type==="unit" ? "Area (sq ft) must be > 0." : "Area (Acres/Guntas) must be > 0.", "error"); return; }
  if (!value || value<=0) { toast("Declared value is required.", "error"); return; }
  if (type === "unit" && !unitId)  { toast("Unit identifier required for flat/unit.", "error"); return; }
  if (type === "unit" && !parentId){ toast("Please select a parent property.", "error"); return; }
  if (!surveyNo)        { toast("Survey No / CTS No is required.", "error"); return; }
  if (!district)        { toast("Please select a district.", "error"); return; }

  // Area mismatch guard (>10% deviation from polygon)
  if (calculatedArea && Math.abs(area - calculatedArea) / calculatedArea * 100 > 10) {
    toast("Area entered differs too much from drawn polygon. Please reconcile.", "error");
    return;
  }

  // ── Build structured full location string ─────────────────────
  const parts = [loc];
  if (surveyNo) parts.push(`Survey/CTS: ${surveyNo}`);
  if (village)  parts.push(village);
  if (taluka)   parts.push(taluka);
  if (district) parts.push(district);
  const fullLoc = parts.join(", ");

  // ── Upload IPFS manifest ──────────────────────────────────────
  const manifestHash = await buildAndUploadManifest();
  if (!manifestHash) return;

  await txWrapper(
    () => contract.registerProperty(
      fullLoc, unitId, area, manifestHash,
      Math.round(lat * 1e6), Math.round(lng * 1e6),
      parentId, resubFrom, value
    ),
    "Property registration submitted! Awaiting Surveyor verification.",
    () => { clearRegForm(); loadCitizenData(); }
  );
}

// ── Clear registration form ───────────────────────────────────
function clearRegForm() {
  [
    "reg-location", "reg-survey-no", "reg-taluka", "reg-village",
    "reg-area-acres", "reg-area-guntas", "reg-area-sqft",
    "reg-lat", "reg-lng", "reg-value",
    "reg-unit-id", "reg-resubmit-from",
    "wit1-name", "wit1-addr", "wit2-name", "wit2-addr"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Reset selects
  const distEl = document.getElementById("reg-district");
  if (distEl) distEl.value = "";

  // Clear IPFS hashes and slot states
  Object.keys(docHashes).forEach(k => delete docHashes[k]);
  ["satbara","aadhaarPan","taxReceipt","encumbrance","mutation","oc","noc"].forEach(k => {
    const s = document.getElementById("slot-" + k);
    const h = document.getElementById("hash-" + k);
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

// ── Resubmit helpers ─────────────────────────────────────────
function enableResubmitMode() {
  const rfEl = document.getElementById("resubmit-field");
  if (rfEl) rfEl.style.display = "block";
}

function prefillResubmit(rejectedId) {
  // Switch to Register tab
  document.querySelectorAll("#view-citizen .nav-tab")
    .forEach((b, i) => b.classList.toggle("active", i === 1));
  ["overview","register","transfer","ledger"].forEach((t, i) => {
    const el = document.getElementById("ctab-" + t);
    if (el) el.style.display = i === 1 ? "block" : "none";
  });
  enableResubmitMode();
  const rfFrom = document.getElementById("reg-resubmit-from");
  if (rfFrom) rfFrom.value = rejectedId;
  if (!leafletMap) { setTimeout(initRegMap, 150); }
  else             { setTimeout(() => leafletMap.invalidateSize(), 100); }
  toast(`Pre-filling resubmission for ${formatRef(rejectedId)}`, "info");
}

// ── Unit / land toggle ────────────────────────────────────────
function toggleUnitFields() {
  const isUnit = document.getElementById("reg-type")?.value === "unit";

  const uf  = document.getElementById("unit-id-field");
  const pf  = document.getElementById("parent-id-field");
  const alf = document.getElementById("area-fields-land");   // Acres + Guntas row
  const auf = document.getElementById("area-fields-unit");   // Sq ft field

  if (uf)  uf.style.display  = isUnit ? "block" : "none";
  if (pf)  pf.style.display  = isUnit ? "block" : "none";
  if (alf) alf.style.display = isUnit ? "none"  : "flex";
  if (auf) auf.style.display = isUnit ? "block" : "none";

  if (isUnit) populateParentDropdown();
}

// ── Transfer actions ──────────────────────────────────────────
async function initiateTransfer() {
  const id    = parseInt(document.getElementById("tx-property-select")?.value);
  const buyer = document.getElementById("tx-buyer")?.value.trim();
  const saleV = parseInt(document.getElementById("tx-sale-value")?.value) || 0;

  if (!id)   { toast("Please select a property.", "error"); return; }
  if (!buyer || !ethers.utils.isAddress(buyer))
    { toast("Valid buyer wallet address required.", "error"); return; }
  if (!saleV || saleV <= 0)
    { toast("Agreed sale value is required.", "error"); return; }
  if (buyer.toLowerCase() === currentAccount)
    { toast("Cannot transfer to yourself.", "error"); return; }

  await txWrapper(
    () => contract.initiateTransfer(id, buyer, saleV),
    "Transfer initiated! Awaiting Registrar approval.",
    () => {
      document.getElementById("tx-property-select").value = "";
      document.getElementById("tx-buyer").value           = "";
      document.getElementById("tx-sale-value").value      = "";
      loadCitizenData();
    }
  );
}

async function cancelTransfer(id) {
  await txWrapper(
    () => contract.cancelTransfer(id),
    "Transfer cancelled.",
    () => loadCitizenData()
  );
}

async function expireTransfer(id) {
  await txWrapper(
    () => contract.expireTransfer(id),
    "Expired transfer cleaned up.",
    () => loadCitizenData()
  );
}

async function acceptTransfer(id) {
  await txWrapper(
    () => contract.acceptTransfer(id),
    "Transfer accepted! You are now the owner. 🎉",
    () => loadCitizenData()
  );
}

async function raiseDispute(id) {
  await txWrapper(
    () => contract.raiseDispute(id),
    `Dispute raised for ${formatRef(id)}.`,
    () => loadCitizenData()
  );
}