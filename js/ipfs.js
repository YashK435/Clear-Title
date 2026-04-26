// ── IPFS — upload & fetch ─────────────────────────────────────

const docHashes = {};

// Fetch with multiple gateway fallback
async function fetchFromIPFS(ipfsHash, timeoutMs = 8000) {
  const gateways = [
    `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
    `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
    `https://ipfs.io/ipfs/${ipfsHash}`
  ];
  for (const url of gateways) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.json();
    } catch(e) { continue; }
  }
  throw new Error("All IPFS gateways failed");
}

function triggerDocUpload(k) {
  document.getElementById("file-" + k).click();
}

async function handleDocUpload(k, input) {
  if (!input.files.length) return;
  const hash = await uploadFileToIPFS(input.files[0]);
  if (hash) {
    docHashes[k] = hash;
    document.getElementById("slot-" + k).classList.add("uploaded");
    const hEl = document.getElementById("hash-" + k);
    if (hEl) {
      hEl.style.display = "block";
      hEl.textContent = `✅ ${hash.slice(0,16)}...${hash.slice(-6)}`;
    }
    const labelMap = {
      satbara:     "7/12 Extract",
      aadhaarPan:  "Aadhaar/PAN",
      taxReceipt:  "Tax Receipt",
      encumbrance: "Encumbrance Cert.",
      mutation:    "Mutation Extract",
      oc:          "OC",
      noc:         "NOC"
    };
    toast(`✅ ${labelMap[k] || k} uploaded to IPFS`, "success");
  }
}

async function uploadFileToIPFS(file) {
  const prog    = document.getElementById("upload-progress");
  const bar     = document.getElementById("progress-bar");
  const labelEl = document.getElementById("progress-label");
  if (prog)    prog.style.display  = "block";
  if (bar)     bar.style.width     = "20%";
  if (labelEl) labelEl.textContent = `Uploading ${file.name}...`;

  try {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(PINATA_PROXY_URL, {
      method:  "POST",
      headers: { "x-wallet-address": currentAccount || "" },
      body:    fd
    });

    if (bar) bar.style.width = "90%";

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errData.error || res.statusText);
    }

    const data = await res.json();
    const hash = data.IpfsHash || data.hash;

    if (bar) bar.style.width = "100%";
    setTimeout(() => {
      if (prog) prog.style.display = "none";
      if (bar)  bar.style.width    = "0%";
    }, 500);

    return hash;
  } catch(e) {
    if (prog) prog.style.display = "none";
    if (bar)  bar.style.width    = "0%";
    toast("Upload failed: " + (e.message || "Cannot reach IPFS proxy"), "error");
    return null;
  }
}

async function buildAndUploadManifest() {
  // satbara, aadhaarPan, taxReceipt are mandatory
  const missing = ["satbara", "aadhaarPan", "taxReceipt"].filter(k => !docHashes[k]);
  if (missing.length) {
    const labelMap = { satbara:"7/12 Extract (Satbara)", aadhaarPan:"Aadhaar/PAN Card", taxReceipt:"Property Tax Receipt" };
    toast(`Missing required documents: ${missing.map(k => labelMap[k]).join(", ")}`, "error");
    return null;
  }

  const manifest = {
    // ── Core documents ────────────────────────────────────────
    satbara:        docHashes.satbara      || null,   // 7/12 Extract (Satbara Utara)
    aadhaarPan:     docHashes.aadhaarPan   || null,   // Aadhaar / PAN Card
    taxReceipt:     docHashes.taxReceipt   || null,   // Property Tax Receipt
    // ── Optional documents ────────────────────────────────────
    encumbrance:    docHashes.encumbrance  || null,   // Encumbrance Certificate (EC)
    mutation:       docHashes.mutation     || null,   // Mutation Extract (फेरफार उतारा)
    oc:             docHashes.oc           || null,   // Occupancy Certificate
    noc:            docHashes.noc          || null,   // NOC from Society / Gram Panchayat
    // ── Spatial data ──────────────────────────────────────────
    polygonPoints:  drawingPoints.length >= 3 ? drawingPoints : null,
    calculatedArea: calculatedArea || null,
    // ── Witnesses ─────────────────────────────────────────────
    witnesses: {
      w1name: document.getElementById("wit1-name")?.value.trim() || "",
      w1addr: document.getElementById("wit1-addr")?.value.trim() || "",
      w2name: document.getElementById("wit2-name")?.value.trim() || "",
      w2addr: document.getElementById("wit2-addr")?.value.trim() || "",
    },
    createdAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
  toast("Uploading document manifest to IPFS...", "info", 2000);
  return await uploadFileToIPFS(new File([blob], "cleartitle-manifest.json"));
}

// ── Fetch and render document panel for Registrar / Dispute Officer ──
async function fetchAndRenderManifest(propId, ipfsHash, panelId) {
  const el = document.getElementById(panelId);
  if (!el || !ipfsHash || ipfsHash.length < 10) return;

  try {
    const manifest = await fetchFromIPFS(ipfsHash);

    const slots = [
      { key:"satbara",     label:"7/12 Extract (Satbara)",      req:true  },
      { key:"aadhaarPan",  label:"Aadhaar / PAN Card",           req:true  },
      { key:"taxReceipt",  label:"Property Tax Receipt",         req:true  },
      { key:"encumbrance", label:"Encumbrance Certificate (EC)", req:false },
      { key:"mutation",    label:"Mutation Extract (फेरफार)",    req:false },
      { key:"oc",          label:"Occupancy Certificate (OC)",   req:false },
      { key:"noc",         label:"NOC from Society / GP",        req:false },
    ];

    let html = slots.map(s => {
      const hash = manifest[s.key];
      const reqStar = s.req ? ' <span style="color:var(--red-gov)">★</span>' : "";
      return hash
        ? `<div class="doc-review-card has-doc">
            <div class="doc-review-label">${s.label}${reqStar}</div>
            <a class="doc-review-link"
               href="https://gateway.pinata.cloud/ipfs/${hash}"
               target="_blank"
               title="${hash}">
              ${hash.slice(0,14)}...${hash.slice(-6)}
            </a>
          </div>`
        : `<div class="doc-review-card no-doc">
            <div class="doc-review-label">${s.label}${reqStar}</div>
            <div class="doc-review-missing">${s.req ? "Missing — required" : "Not provided"}</div>
          </div>`;
    }).join("");

    // Witnesses block
    if (manifest.witnesses) {
      const w = manifest.witnesses;
      html += `<div class="doc-review-card has-doc" style="grid-column:1/-1">
        <div class="doc-review-label">Witnesses</div>
        <div style="font-size:.72rem;color:var(--text2);line-height:1.7">
          ${w.w1name
            ? `<strong>W1:</strong> ${escHtml(w.w1name)} — <span style="font-family:'Source Code Pro',monospace;font-size:.65rem">${w.w1addr || "—"}</span>`
            : "Witness 1: not provided"}
          <br>
          ${w.w2name
            ? `<strong>W2:</strong> ${escHtml(w.w2name)} — <span style="font-family:'Source Code Pro',monospace;font-size:.65rem">${w.w2addr || "—"}</span>`
            : "Witness 2: not provided"}
        </div>
      </div>`;
    }

    el.innerHTML = html;

  } catch(_) {
    el.innerHTML = `<div class="doc-review-card" style="grid-column:1/-1">
      <div class="doc-review-label">Manifest unavailable — view raw</div>
      <a class="doc-review-link"
         href="https://gateway.pinata.cloud/ipfs/${ipfsHash}"
         target="_blank"
         title="${ipfsHash}">
        ${ipfsHash.slice(0,20)}...${ipfsHash.slice(-8)}
      </a>
    </div>`;
  }
}     