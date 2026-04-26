// ── CARDS — shared card rendering ────────────────────────────

// ── Area display helper ───────────────────────────────────────
// Land parcels: stored as total Guntas on-chain  →  show "2A 20G"
// Flats/Units:  stored as sq ft on-chain          →  show "950 sq ft"
function formatArea(area, isUnit) {
  if (!area && area !== 0) return "—";
  if (isUnit) return `${Number(area).toLocaleString()} sq ft`;
  const acres  = Math.floor(area / 40);
  const guntas = area % 40;
  if (acres === 0) return `${guntas}G`;
  if (guntas === 0) return `${acres}A`;
  return `${acres}A ${guntas}G`;
}

// ── Ledger card (public / all-roles view) ─────────────────────
function buildLedgerCard(p) {
  const isUnit = !!p.unitIdentifier;
  return `<div class="ledger-card">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;min-width:0">
      <div style="min-width:0;flex:1">
        <div style="font-family:'Source Code Pro',monospace;font-size:.68rem;color:var(--text3);margin-bottom:4px">${formatRef(p.id)}</div>
        <div style="font-family:'Noto Serif',serif;font-size:.92rem;font-weight:700;color:var(--navy);word-break:break-word">${escHtml(p.location)}</div>
      </div>
      <div class="status-stamp stamp-verified" style="flex-shrink:0">✅ Verified</div>
    </div>
    <div class="card-meta">
      <div class="meta-item">
        <div class="meta-key">Area</div>
        <div class="meta-val">${formatArea(p.area, isUnit)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-key">Declared Value</div>
        <div class="meta-val">₹${p.declaredValue.toLocaleString("en-IN")}</div>
      </div>
    </div>
    ${p.latitude !== 0 || p.longitude !== 0
      ? `<div style="font-size:.68rem;color:var(--text3);font-family:'Source Code Pro',monospace">
           📍 ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}
         </div>`
      : ""}
    <div>
      <div class="meta-key" style="margin-bottom:5px">Ownership Chain</div>
      <div id="lchain-${p.id}">
        <div class="chain-item"><span class="chain-dot"></span><span style="color:var(--text3)">Loading...</span></div>
      </div>
    </div>
  </div>`;
}

// ── Registrar / Dispute Officer document panel ────────────────
function buildRegistrarDocPanel(p) {
  const panelId = "docpanel-" + p.id;
  setTimeout(() => fetchAndRenderManifest(p.id, p.ipfsHash, panelId), 0);
  return `<div>
    <div class="meta-key" style="margin-bottom:6px">📄 Submitted Documents</div>
    <div class="doc-review-grid" id="${panelId}">
      <div class="doc-review-card" style="grid-column:1/-1">
        <div class="doc-review-label">Loading documents...</div>
      </div>
    </div>
  </div>`;
}

// ── Main property card ────────────────────────────────────────
function buildCard(p, ctx) {
  const sLabel  = S_LABELS[p.status]  || "Unknown";
  const sCls    = S_STAMPS[p.status]  || "stamp-pending";
  const sIcon   = S_ICONS[p.status]   || "❓";
  const cardCls = S_CLASSES[p.status] || "";
  const isRejected = p.status === 2;
  const isUnit     = !!p.unitIdentifier;

  const survStep = `<div class="approval-step ${p.surveyorApproved ? "done" : "pending"}">
    <div class="step-label">Surveyor</div>
    <span class="step-icon">${p.surveyorApproved ? "✅" : "⏳"}</span>
  </div>`;
  const regStep = `<div class="approval-step ${p.registrarApproved ? "done" : "pending"}">
    <div class="step-label">Registrar</div>
    <span class="step-icon">${p.registrarApproved ? "✅" : "⏳"}</span>
  </div>`;

  let extra = "";

  // Rejection banner
  if (p.rejectionReason && (isRejected || ctx === "registrar")) {
    const resubBtn = ctx === "citizen"
      ? `<div class="rej-actions">
           <button class="btn-outline btn-sm" onclick="prefillResubmit(${p.id})">🔁 Resubmit with fixes</button>
         </div>`
      : "";
    extra += `<div class="rejection-banner">
      <div class="rej-label">${isRejected ? "Rejection Reason" : "Previous Rejection History"}</div>
      <div class="rej-reason">${escHtml(p.rejectionReason)}</div>
      ${resubBtn}
    </div>`;
  }

  // Unit identifier + parent link
  if (p.unitIdentifier) {
    extra += `<div style="font-size:.72rem;color:var(--text2);background:var(--bg2);padding:5px 9px;border-radius:3px;border:1px solid var(--border);word-break:break-word">
      🏢 Unit: ${escHtml(p.unitIdentifier)}${p.parentPropertyId ? ` | Parent ${formatRef(p.parentPropertyId)}` : ""}
    </div>`;
  }

  // Resubmission note
  if (p.resubmittedFrom > 0) {
    extra += `<div style="font-size:.72rem;color:var(--text2);background:var(--bg2);padding:5px 9px;border-radius:3px;border:1px solid var(--border)">
      🔁 Resubmission of ${formatRef(p.resubmittedFrom)}
    </div>`;
  }

  // Active transfer notice
  if (p.txActive) {
    const now     = Math.floor(Date.now() / 1000);
    const expired = p.txExpiry > 0 && now > p.txExpiry;
    extra += `<div class="${expired ? "expiry-warning" : "transfer-notice"}">
      ${expired ? "⚠️ Transfer EXPIRED" : "🔄 Transfer pending"} →
      <span style="font-family:'Source Code Pro',monospace;font-size:.72rem">
        ${p.txBuyer.slice(0,10)}…${p.txBuyer.slice(-4)}
      </span>
      | ${p.txRegApproved ? "✅ Registrar approved" : "⏳ Awaiting registrar"}
      ${p.txAgreedValue > 0 ? `| ₹${p.txAgreedValue.toLocaleString("en-IN")}` : ""}
    </div>`;
  }

  // Coordinates
  if (p.latitude !== 0 || p.longitude !== 0) {
    extra += `<div class="coords-pill">
      📍 ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}
    </div>`;
  }

  // Dispute notes
  if ((p.status === 3 || p.status === 4) && p.disputeNotes) {
    extra += `<div class="dispute-notes-box">⚖️ ${DR_LABELS[p.disputeResult]}: ${escHtml(p.disputeNotes)}</div>`;
  }

  // Who raised the dispute (useful context for dispute officer)
  if (ctx === "dispute" && p.status === 3) {
    extra += `<div style="font-size:.72rem;color:var(--text2);background:#f3e8ff;padding:5px 9px;border-radius:3px;border:1px solid #c4b5fd;word-break:break-word">
      ⚖️ Dispute raised — boundary &amp; ownership verification required
    </div>`;
  }

  // Document panel (Registrar + Dispute Officer)
  let docPanel = "";
  if ((ctx === "registrar" || ctx === "registrar-transfer" || ctx === "dispute") && p.ipfsHash) {
    docPanel = buildRegistrarDocPanel(p);
  }

  // Transfer value compare (Registrar transfer review)
  let valCompare = "";
  if (ctx === "registrar-transfer" && p.txActive) {
    const diff = p.declaredValue > 0
      ? Math.abs(p.txAgreedValue - p.declaredValue) / p.declaredValue * 100
      : 0;
    valCompare = `<div class="value-compare">
      <div class="val-box">
        <div class="val-box-label">Original declared</div>
        <div class="val-box-value">₹${p.declaredValue.toLocaleString("en-IN")}</div>
      </div>
      <div class="val-box ${diff > 20 ? "warn" : ""}">
        <div class="val-box-label">Agreed sale${diff > 20 ? " ⚠️" : ""}</div>
        <div class="val-box-value">₹${p.txAgreedValue.toLocaleString("en-IN")}</div>
      </div>
    </div>`;
  }

  // ── Action buttons per role/context ──────────────────────────
  let actions = "";

  if (ctx === "surveyor") {
    actions = `<div class="card-actions">
      <button class="btn-green"
        onclick="surveyorApprove(${p.id})">✅ Approve Survey</button>
      <button class="btn-red"
        onclick="openRejectModal(${p.id},'surveyor')">❌ Reject</button>
      <button class="btn-ghost"
        onclick="openSurveyorMap(${p.id},${p.latitude},${p.longitude},'${escAttr(p.location)}',${p.area},'${escAttr(p.ipfsHash)}')">🗺️ View Map</button>
    </div>`;

  } else if (ctx === "registrar") {
    actions = `<div class="card-actions">
      <button class="btn-green"
        onclick="registrarApprove(${p.id})">✅ Approve & Register</button>
      <button class="btn-red"
        onclick="openRejectModal(${p.id},'registrar')">❌ Reject</button>
      <button class="btn-ghost"
        onclick="showHistory(${p.id})">📜 History</button>
    </div>`;

  } else if (ctx === "registrar-transfer") {
    actions = `<div class="card-actions">
      <button class="btn-cyan"
        onclick="approveTransfer(${p.id})">✅ Approve Transfer</button>
      <button class="btn-red"
        onclick="rejectTransfer(${p.id})">❌ Reject Transfer</button>
    </div>`;

  } else if (ctx === "incoming") {
    actions = `<div class="card-actions">
      <button class="btn-cyan"
        onclick="acceptTransfer(${p.id})">🤝 Accept Transfer</button>
    </div>`;

  } else if (ctx === "citizen") {
    let btns = "";
    if (p.status === 1 && !p.txActive)
      btns += `<button class="btn-orange" onclick="raiseDispute(${p.id})">⚠️ Raise Dispute</button>`;
    if (p.txActive && p.owner === currentAccount)
      btns += `<button class="btn-red" onclick="cancelTransfer(${p.id})">✖ Cancel Transfer</button>`;
    if (p.txExpiry > 0 && Math.floor(Date.now() / 1000) > p.txExpiry)
      btns += `<button class="btn-ghost" onclick="expireTransfer(${p.id})">🧹 Clean Expired</button>`;
    if (btns) actions = `<div class="card-actions">${btns}</div>`;

  } else if (ctx === "dispute") {
    // Dispute Officer: full map view (all verified properties) + resolve + history
    // Pass `true` as the 7th arg to openSurveyorMap to skip proximity filter
    actions = `<div class="card-actions">
      <button class="btn-purple"
        onclick="openDisputeModal(${p.id})">⚖️ Resolve Dispute</button>
      <button class="btn-ghost"
        onclick="openSurveyorMap(${p.id},${p.latitude},${p.longitude},'${escAttr(p.location)}',${p.area},'${escAttr(p.ipfsHash)}',true)">🗺️ View Map</button>
      <button class="btn-outline btn-sm"
        onclick="showHistory(${p.id})">📜 History</button>
    </div>`;
  }

  // ── IPFS manifest link ────────────────────────────────────────
  const ipfsDisplay = p.ipfsHash
    ? `<a class="ipfs-link"
          href="https://gateway.pinata.cloud/ipfs/${p.ipfsHash}"
          target="_blank"
          title="${p.ipfsHash}">
         ${p.ipfsHash.slice(0,14)}...${p.ipfsHash.slice(-6)}
       </a>`
    : '<span style="color:var(--text3);font-size:.72rem">None</span>';

  return `<div class="prop-card ${cardCls}">
    <div class="card-head">
      <div class="card-head-left">
        <div class="card-ref">${formatRef(p.id)}</div>
        <div class="card-location">${escHtml(p.location)}</div>
      </div>
      <div class="status-stamp ${sCls}" style="flex-shrink:0">${sIcon} ${sLabel}</div>
    </div>

    <div class="card-meta">
      <div class="meta-item">
        <div class="meta-key">Area</div>
        <div class="meta-val">${formatArea(p.area, isUnit)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-key">Owner</div>
        <div class="meta-val" title="${p.owner}">${p.owner.slice(0,8)}...${p.owner.slice(-4)}</div>
      </div>
      ${p.declaredValue > 0
        ? `<div class="meta-item">
             <div class="meta-key">Declared Value</div>
             <div class="meta-val">₹${p.declaredValue.toLocaleString("en-IN")}</div>
           </div>`
        : ""}
      <div class="meta-item" style="grid-column:1/-1">
        <div class="meta-key">IPFS Manifest</div>
        <div class="meta-val">${ipfsDisplay}</div>
      </div>
    </div>

    <div>
      <div class="meta-key" style="margin-bottom:5px">Approval Track</div>
      <div class="approval-track">
        ${survStep}
        <div class="step-arrow">→</div>
        ${regStep}
      </div>
    </div>

    ${docPanel}${valCompare}${extra}${actions}
  </div>`;
}