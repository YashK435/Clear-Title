// ── SURVEYOR ──────────────────────────────────────────────────

async function loadSurveyorData() {
  try {
    const all     = await getAllProperties();
    const pending = all.filter(p => p.status === 0 && !p.surveyorApproved);
    document.getElementById("surveyor-queue").textContent = pending.length;
    document.getElementById("surveyor-cards").innerHTML = pending.length === 0
      ? `<div class="empty-state"><div class="empty-icon">📐</div><p>No properties pending survey.</p></div>`
      : pending.map(p => buildCard(p, "surveyor")).join("");
    setSynced(true);
  } catch(e) { toast("Error: " + (e.reason || e.message), "error"); setSynced(false); }
}

async function surveyorApprove(id) { await txWrapper(() => contract.approveBySurveyor(id), `Survey approved for ${formatRef(id)}.`, () => loadSurveyorData()); }

// ── REGISTRAR ─────────────────────────────────────────────────

async function loadRegistrarData() {
  try {
    const all       = await getAllProperties();
    const pending   = all.filter(p => p.status === 0 && p.surveyorApproved && !p.registrarApproved);
    const transfers = all.filter(p => p.txActive && !p.txRegApproved);
    document.getElementById("registrar-queue").textContent = pending.length + transfers.length;
    document.getElementById("registrar-cards").innerHTML = pending.length === 0
      ? `<div class="empty-state"><div class="empty-icon">📋</div><p>No pending registrations.</p></div>`
      : pending.map(p => buildCard(p, "registrar")).join("");
    document.getElementById("registrar-transfer-cards").innerHTML = transfers.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🔄</div><p>No pending transfers.</p></div>`
      : transfers.map(p => buildCard(p, "registrar-transfer")).join("");
    setSynced(true);
  } catch(e) { toast("Error: " + (e.reason || e.message), "error"); setSynced(false); }
}

async function registrarApprove(id) { await txWrapper(() => contract.approveByRegistrar(id), `${formatRef(id)} fully registered! ✅`, () => loadRegistrarData()); }
async function approveTransfer(id)  { await txWrapper(() => contract.approveTransferByRegistrar(id), "Transfer approved.", () => loadRegistrarData()); }
async function rejectTransfer(id)   { await txWrapper(() => contract.rejectTransferByRegistrar(id),  "Transfer rejected.",  () => loadRegistrarData()); }

// ── DISPUTE OFFICER ───────────────────────────────────────────

async function loadDisputeData() {
  try {
    const all      = await getAllProperties();
    const disputed = all.filter(p => p.status === 3 || p.status === 4);
    document.getElementById("dispute-queue").textContent = disputed.length;
    document.getElementById("dispute-cards").innerHTML = disputed.length === 0
      ? `<div class="empty-state"><div class="empty-icon">⚖️</div><p>No active disputes.</p></div>`
      : disputed.map(p => buildCard(p, "dispute")).join("");
    setSynced(true);
  } catch(e) { toast("Error: " + e.message, "error"); setSynced(false); }
}

// ── ADMIN ─────────────────────────────────────────────────────

async function loadAdminData() {
  try {
    const [reg, surv, disp, proposal] = await Promise.all([
      contract.registrar(), contract.surveyor(), contract.disputeOfficer(),
      contract.getPendingRoleProposal()
    ]);
    document.getElementById("admin-curr-registrar").textContent = reg;
    document.getElementById("admin-curr-surveyor").textContent  = surv;
    document.getElementById("admin-curr-dispute").textContent   = disp;

    const notice = document.getElementById("admin-timelock-notice");
    if (proposal[5]) {
      notice.style.display = "block";
      const execAfter = proposal[4].toNumber() * 1000;
      const upd = () => {
        const rem = execAfter - Date.now();
        if (rem <= 0) {
          document.getElementById("tl-countdown").textContent = "✅ Ready to confirm";
          document.getElementById("btn-confirm-roles").disabled = false;
        } else {
          const h = Math.floor(rem/3600000), m = Math.floor((rem%3600000)/60000);
          document.getElementById("tl-countdown").textContent = `⏳ ${h}h ${m}m remaining`;
          document.getElementById("btn-confirm-roles").disabled = true;
        }
      };
      upd(); setInterval(upd, 30000);
    } else { notice.style.display = "none"; }

    const all = await getAllProperties();
    document.getElementById("admin-cards").innerHTML = all.length === 0
      ? `<div class="empty-state"><div class="empty-icon">📊</div><p>No properties.</p></div>`
      : all.map(p => buildCard(p, "admin")).join("");
    setSynced(true);
  } catch(e) { toast("Error: " + e.message, "error"); setSynced(false); }
}

async function proposeRoles() {
  const r = document.getElementById("admin-registrar")?.value.trim();
  const s = document.getElementById("admin-surveyor")?.value.trim();
  const d = document.getElementById("admin-dispute")?.value.trim();
  if (!ethers.utils.isAddress(r) || !ethers.utils.isAddress(s) || !ethers.utils.isAddress(d)) {
    toast("All three must be valid Ethereum addresses.", "error"); return;
  }
  await txWrapper(() => contract.proposeRoles(r, s, d), "Role change proposed. Confirm after 48-hour timelock.", () => loadAdminData());
}
async function confirmRoles()       { await txWrapper(() => contract.confirmRoles(),       "Roles updated successfully. ✅", () => loadAdminData()); }
async function cancelRoleProposal() { await txWrapper(() => contract.cancelRoleProposal(), "Role proposal cancelled.",     () => loadAdminData()); }

// ── LEDGER (shared) ───────────────────────────────────────────

let allLedgerProps = [];

async function loadLedger(containerId = "ledger-cards") {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = `<div class="empty-state"><div class="spinner"></div><p style="margin-top:8px">Loading...</p></div>`;
  try {
    const all  = await getAllProperties();
    allLedgerProps = all.filter(p => p.status === 1);
    renderLedger(containerId);
    setSynced(true);
  } catch(e) { c.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error loading ledger.</p></div>`; }
}

function filterLedger(containerId = "ledger-cards", searchId = "ledger-search-input") {
  renderLedger(containerId, searchId);
}

function renderLedger(containerId = "ledger-cards", searchId = "ledger-search-input") {
  const c = document.getElementById(containerId);
  if (!c) return;
  const q = (document.getElementById(searchId) || {value:""}).value.toLowerCase();
  const filtered = allLedgerProps.filter(p => !q || String(p.id).includes(q) || p.location.toLowerCase().includes(q));
  c.innerHTML = filtered.length === 0
    ? `<div class="empty-state"><div class="empty-icon">🔍</div><p>No verified properties found.</p></div>`
    : filtered.map(p => buildLedgerCard(p)).join("");
}

// ── MODAL — REJECT ────────────────────────────────────────────

let rejectModalPropId = null, rejectModalRole = null;

function openRejectModal(id, r) {
  rejectModalPropId = id;
  rejectModalRole   = r;
  document.getElementById("reject-modal-id").textContent = formatRef(id);
  document.getElementById("reject-reason-input").value   = "";
  document.getElementById("reject-modal").style.display  = "flex";
}
function closeRejectModal() { document.getElementById("reject-modal").style.display = "none"; }
async function submitRejection() {
  const reason = document.getElementById("reject-reason-input")?.value.trim();
  if (!reason) { toast("Rejection reason is required.", "error"); return; }
  closeRejectModal();
  if (rejectModalRole === "surveyor") {
    await txWrapper(() => contract.rejectBySurveyor(rejectModalPropId, reason),  `${formatRef(rejectModalPropId)} rejected by Surveyor.`,  () => loadSurveyorData());
  } else {
    await txWrapper(() => contract.rejectByRegistrar(rejectModalPropId, reason), `${formatRef(rejectModalPropId)} rejected by Registrar.`, () => loadRegistrarData());
  }
}

// ── MODAL — DISPUTE ───────────────────────────────────────────

let disputeModalPropId = null;

function openDisputeModal(id) {
  disputeModalPropId = id;
  document.getElementById("dispute-modal-id").textContent  = formatRef(id);
  document.getElementById("dispute-decision").value        = "";
  document.getElementById("dispute-notes-input").value     = "";
  document.getElementById("dispute-modal").style.display   = "flex";
}
function closeDisputeModal() { document.getElementById("dispute-modal").style.display = "none"; }
async function submitDisputeResolution() {
  const decision = parseInt(document.getElementById("dispute-decision")?.value);
  const notes    = document.getElementById("dispute-notes-input")?.value.trim();
  if (!decision) { toast("Please select a decision.", "error"); return; }
  if (!notes)    { toast("Resolution notes are required.", "error"); return; }
  closeDisputeModal();
  await txWrapper(
    () => contract.resolveDispute(disputeModalPropId, decision, notes),
    `Dispute for ${formatRef(disputeModalPropId)} resolved.`,
    () => loadDisputeData()
  );
}

// ── MODAL — HISTORY ───────────────────────────────────────────

async function showHistory(id) {
  document.getElementById("history-modal-id").textContent   = formatRef(id);
  document.getElementById("history-modal-content").innerHTML = `<div style="text-align:center;padding:1rem;color:var(--text3)"><span class="spinner"></span></div>`;
  document.getElementById("history-modal").style.display    = "flex";
  try {
    const history = await contract.getOwnershipHistory(id);
    if (!history.length) { document.getElementById("history-modal-content").innerHTML = `<p style="color:var(--text3)">No history found.</p>`; return; }
    document.getElementById("history-modal-content").innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px">
        ${history.map((addr, i) => `<div class="history-item">
          <div class="history-dot" style="${i===0?"background:var(--gold)":i===history.length-1?"background:var(--green-gov)":""}"></div>
          <div class="history-addr">${addr}</div>
          <div class="history-badge">${i===0?"Original Owner":i===history.length-1?"Current Owner":`Transfer #${i}`}</div>
        </div>`).join("")}
      </div>
      <p style="font-size:.72rem;color:var(--text3);margin-top:10px">Total transfers: ${history.length - 1}</p>`;
  } catch(e) {
    document.getElementById("history-modal-content").innerHTML = `<p style="color:var(--red-gov)">Error: ${e.message}</p>`;
  }
}
function closeHistoryModal() { document.getElementById("history-modal").style.display = "none"; }
