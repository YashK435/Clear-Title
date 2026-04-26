// ── MAP — Leaflet polygon drawing & boundary verification ─────

let leafletMap      = null;
let drawingPoints   = [];
let polygonLayer    = null;
let pinMarker       = null;
let mapMode         = "draw";
let calculatedArea  = null;   // total guntas (land) or sq ft (unit) from polygon
let surveyorMapInst = null;

// Parent polygon overlay state
let parentPolygonLayer = null;
let parentTurfPolygon  = null;
let parentPropertyData = null;

// ── Init registration map ─────────────────────────────────────
function initRegMap() {
  if (leafletMap) { leafletMap.invalidateSize(); return; }
  leafletMap = L.map("property-map").setView([18.9712, 72.8955], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(leafletMap);
  leafletMap.on("click", onMapClick);
  setTimeout(() => leafletMap.invalidateSize(), 200);
}

// ── Map click handler ─────────────────────────────────────────
function onMapClick(e) {
  if (mapMode === "pin") {
    if (pinMarker) leafletMap.removeLayer(pinMarker);
    pinMarker = L.marker(e.latlng).addTo(leafletMap);
    const latEl = document.getElementById("reg-lat");
    const lngEl = document.getElementById("reg-lng");
    if (latEl) latEl.value = e.latlng.lat.toFixed(6);
    if (lngEl) lngEl.value = e.latlng.lng.toFixed(6);
    document.getElementById("map-info").textContent =
      `📍 Pin: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    return;
  }
  // Draw mode
  drawingPoints.push([e.latlng.lat, e.latlng.lng]);
  refreshPolygon();
  if (drawingPoints.length === 1) {
    const latEl = document.getElementById("reg-lat");
    const lngEl = document.getElementById("reg-lng");
    if (latEl) latEl.value = e.latlng.lat.toFixed(6);
    if (lngEl) lngEl.value = e.latlng.lng.toFixed(6);
  }
}

// ── Redraw polygon and auto-calculate area ────────────────────
function refreshPolygon() {
  if (polygonLayer) leafletMap.removeLayer(polygonLayer);
  if (drawingPoints.length < 2) return;

  polygonLayer = L.polygon(drawingPoints, {
    color: "#0d3b8e", fillColor: "#0d3b8e", fillOpacity: .15, weight: 2
  }).addTo(leafletMap);

  if (drawingPoints.length >= 3) {
    const coords = drawingPoints.map(p => [p[1], p[0]]);
    coords.push(coords[0]);
    try {
      const poly   = turf.polygon([coords]);
      const areaSqM = turf.area(poly);   // square metres

      const isUnit = document.getElementById("reg-type")?.value === "unit";

      if (isUnit) {
        // ── Flat / Unit: display in sq ft ─────────────────────
        const sqft   = Math.round(areaSqM * 10.7639);
        calculatedArea = sqft;
        const areaEl = document.getElementById("reg-area-sqft");
        if (areaEl) areaEl.value = sqft;
        const noteEl = document.getElementById("calc-area-note");
        if (noteEl) noteEl.textContent = `(auto: ${sqft.toLocaleString()} sq ft)`;
        document.getElementById("map-info").textContent =
          `✅ Polygon: ${sqft.toLocaleString()} sq ft — ${drawingPoints.length} points`;

      } else {
        // ── Land parcel: display in Acres + Guntas ────────────
        // 1 Gunta = 101.171 sq m  (standard Maharashtra survey unit)
        const totalGuntas = Math.round(areaSqM / 101.171);
        calculatedArea = totalGuntas;
        const acres  = Math.floor(totalGuntas / 40);
        const guntas = totalGuntas % 40;

        const acEl = document.getElementById("reg-area-acres");
        const guEl = document.getElementById("reg-area-guntas");
        if (acEl) acEl.value = acres;
        if (guEl) guEl.value = guntas;

        const noteEl = document.getElementById("calc-area-note");
        if (noteEl) noteEl.textContent = `(auto: ${acres}A ${guntas}G)`;
        document.getElementById("map-info").textContent =
          `✅ Polygon: ${acres}A ${guntas}G (${totalGuntas} guntas) — ${drawingPoints.length} points`;
      }

      checkAreaMismatch();
      checkSubplotContainment();

    } catch(_) {}
  }
}

// ── Area mismatch warning ─────────────────────────────────────
function checkAreaMismatch() {
  const warn = document.getElementById("area-mismatch-warn");
  if (!warn || !calculatedArea) { if (warn) warn.style.display = "none"; return; }

  const isUnit   = document.getElementById("reg-type")?.value === "unit";
  let   userArea = 0;
  if (isUnit) {
    userArea = parseInt(document.getElementById("reg-area-sqft")?.value) || 0;
  } else {
    const acres  = parseInt(document.getElementById("reg-area-acres")?.value)  || 0;
    const guntas = parseInt(document.getElementById("reg-area-guntas")?.value) || 0;
    userArea = (acres * 40) + guntas;
  }

  if (!userArea) { warn.style.display = "none"; return; }
  const diff = Math.abs(userArea - calculatedArea) / calculatedArea * 100;
  if (diff > 10) {
    warn.style.display = "block";
    const mu = document.getElementById("mismatch-user");
    const mc = document.getElementById("mismatch-calc");
    const mp = document.getElementById("mismatch-pct");
    if (mu) mu.textContent = isUnit
      ? `${userArea.toLocaleString()} sq ft`
      : `${Math.floor(userArea/40)}A ${userArea%40}G`;
    if (mc) mc.textContent = isUnit
      ? `${calculatedArea.toLocaleString()} sq ft`
      : `${Math.floor(calculatedArea/40)}A ${calculatedArea%40}G`;
    if (mp) mp.textContent = diff.toFixed(1);
  } else {
    warn.style.display = "none";
  }
}

// ── Map mode controls ─────────────────────────────────────────
function setMapMode(mode) {
  mapMode = mode;
  document.getElementById("btn-draw")?.classList.toggle("active", mode === "draw");
  document.getElementById("btn-pin")?.classList.toggle("active",  mode === "pin");
  document.getElementById("map-info").textContent = mode === "draw"
    ? "Click on map to draw property boundary polygon."
    : "Click on map to drop a location pin.";
}

function clearMapDrawing() {
  drawingPoints = [];
  if (polygonLayer) { leafletMap.removeLayer(polygonLayer); polygonLayer = null; }
  if (pinMarker)    { leafletMap.removeLayer(pinMarker);    pinMarker    = null; }
  calculatedArea = null;

  const noteEl = document.getElementById("calc-area-note");
  const warnEl = document.getElementById("area-mismatch-warn");
  const oob    = document.getElementById("out-of-bounds-warn");
  if (noteEl) noteEl.textContent     = "";
  if (warnEl) warnEl.style.display   = "none";
  if (oob)    oob.classList.remove("visible");

  document.getElementById("map-info").textContent = "Drawing cleared. Click to start again.";
}

function locateMe() {
  if (!navigator.geolocation) { toast("Geolocation not supported", "error"); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    leafletMap.setView([pos.coords.latitude, pos.coords.longitude], 16);
    const latEl = document.getElementById("reg-lat");
    const lngEl = document.getElementById("reg-lng");
    if (latEl) latEl.value = pos.coords.latitude.toFixed(6);
    if (lngEl) lngEl.value = pos.coords.longitude.toFixed(6);
    toast("📍 Centred to your location", "info");
  }, () => toast("Could not get location", "error"));
}

// ── Parent property polygon overlay ──────────────────────────
async function onParentPropertySelected() {
  clearParentPolygon();
  const sel = document.getElementById("reg-parent-id");
  const opt = sel?.selectedOptions[0];
  if (!opt || !opt.value) return;

  const ipfsHash = opt.dataset.ipfs;
  const area     = opt.dataset.area;
  const location = opt.dataset.location;
  const badge    = document.getElementById("parent-loading-badge");

  if (!ipfsHash || ipfsHash.length < 10) return;

  if (badge) badge.textContent = "⏳ Loading boundary…";
  try {
    const manifest = await fetchFromIPFS(ipfsHash, 8000);
    if (manifest.polygonPoints && manifest.polygonPoints.length >= 3) {
      const pts = manifest.polygonPoints;
      if (!leafletMap) await new Promise(r => setTimeout(r, 300));

      parentPolygonLayer = L.polygon(pts, {
        color: "#e8611a", fillColor: "#e8611a", fillOpacity: .1,
        weight: 2.5, dashArray: "7 5",
        interactive: false
      }).addTo(leafletMap);

      parentPolygonLayer.bindPopup(
        `<b>Parent: ${formatRef(parseInt(opt.value))}</b><br>${escHtml(location)}`
      );
      leafletMap.fitBounds(L.polygon(pts).getBounds(), { padding: [35, 35] });

      try {
        const coords = pts.map(p => [p[1], p[0]]);
        coords.push(coords[0]);
        parentTurfPolygon = turf.polygon([coords]);
      } catch(_) { parentTurfPolygon = null; }

      parentPropertyData = { id: parseInt(opt.value), location, area, pts };

      const info = document.getElementById("parent-polygon-info");
      const txt  = document.getElementById("parent-polygon-text");
      if (txt) txt.innerHTML =
        `<strong>${formatRef(parseInt(opt.value))}</strong> — ${escHtml(location.slice(0,50))}. ` +
        `Draw your sub-plot <strong>inside</strong> the orange dashed boundary.`;
      if (info) info.classList.add("visible");
      document.getElementById("map-legend")?.classList.add("visible");

      if (badge) badge.textContent = "✅ Boundary loaded";
      setTimeout(() => { if (badge) badge.textContent = ""; }, 2500);
    } else {
      if (badge) badge.textContent = "";
      toast("Parent has no saved polygon. Proceeding without overlay.", "info");
    }
  } catch(e) {
    if (badge) badge.textContent = "⚠️ Could not load boundary";
    toast("Could not load parent boundary: " + e.message, "error");
  }
}

function clearParentPolygon() {
  if (parentPolygonLayer && leafletMap) {
    leafletMap.removeLayer(parentPolygonLayer);
    parentPolygonLayer = null;
  }
  parentTurfPolygon  = null;
  parentPropertyData = null;
  document.getElementById("parent-polygon-info")?.classList.remove("visible");
  document.getElementById("out-of-bounds-warn")?.classList.remove("visible");
  document.getElementById("map-legend")?.classList.remove("visible");
}

function checkSubplotContainment() {
  const warn = document.getElementById("out-of-bounds-warn");
  if (!warn || !parentTurfPolygon || drawingPoints.length < 3) {
    warn?.classList.remove("visible");
    return;
  }
  try {
    const coords = drawingPoints.map(p => [p[1], p[0]]);
    coords.push(coords[0]);
    const drawn = turf.polygon([coords]);
    turf.booleanWithin(drawn, parentTurfPolygon)
      ? warn.classList.remove("visible")
      : warn.classList.add("visible");
  } catch(_) {
    warn.classList.remove("visible");
  }
}

// ── Parent dropdown population ────────────────────────────────
async function populateParentDropdown() {
  const sel   = document.getElementById("reg-parent-id");
  const badge = document.getElementById("parent-loading-badge");
  if (!sel) return;
  sel.innerHTML = '<option value="">— loading verified properties… —</option>';
  if (badge) badge.textContent = "⏳ Loading…";
  try {
    const all     = await getAllProperties(false);
    const parents = all.filter(p => p.status === 1 && p.parentPropertyId === 0);
    if (badge) badge.textContent = "";
    if (!parents.length) {
      sel.innerHTML = '<option value="">— no verified parent properties found —</option>';
      return;
    }
    sel.innerHTML =
      '<option value="">— select parent property —</option>' +
      parents.map(p =>
        `<option value="${p.id}"
           data-area="${p.area}"
           data-location="${escAttr(p.location)}"
           data-ipfs="${escAttr(p.ipfsHash)}">
           ${formatRef(p.id)} — ${p.location.slice(0,55)}${p.location.length > 55 ? "…" : ""}
         </option>`
      ).join("");
  } catch(e) {
    if (badge) badge.textContent = "⚠️ Error";
    sel.innerHTML = '<option value="">— error loading properties —</option>';
    toast("Could not load parent properties: " + e.message, "error");
  }
}

// ── Surveyor / Dispute Officer boundary verification modal ────
// showAll = true  → used by Dispute Officer: scans ALL verified properties
//                   regardless of geographic proximity (disputes may have
//                   coordinates at 0,0 or be in a different area entirely)
// showAll = false → used by Surveyor: only scans nearby verified properties
//                   (within ~5 km lat/lng delta) for performance
async function openSurveyorMap(id, lat, lng, loc, area, ipfsHash, showAll = false) {
  document.getElementById("map-modal-id").textContent  = id;

  // Modal title: differentiate dispute vs survey review
  const modalTitle = document.querySelector("#map-modal .modal-title");
  if (modalTitle) {
    modalTitle.textContent = showAll
      ? `⚖️ Dispute Boundary Review — Ref #${id}`
      : `🗺️ Boundary Verification — Ref #${id}`;
  }

  document.getElementById("map-modal-info").textContent =
    `📍 ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)} | ${loc} | Area: ${area}`;
  document.getElementById("overlap-alert").style.display = "none";
  document.getElementById("conflict-list").innerHTML     = "";
  document.getElementById("map-modal").style.display     = "flex";

  await new Promise(r => setTimeout(r, 100));
  if (surveyorMapInst) { surveyorMapInst.remove(); surveyorMapInst = null; }

  const centre = (lat !== 0 || lng !== 0) ? [lat, lng] : [18.9712, 72.8955];
  surveyorMapInst = L.map("surveyor-map").setView(centre, showAll ? 12 : 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 19
  }).addTo(surveyorMapInst);

  let subjectTurf = null;

  // Plot subject property polygon
  if (ipfsHash && ipfsHash.length > 10) {
    try {
      const manifest = await fetchFromIPFS(ipfsHash, 6000);
      if (manifest.polygonPoints && manifest.polygonPoints.length >= 3) {
        const pts = manifest.polygonPoints;
        // Use purple border for disputed properties, navy for pending survey
        const colour = showAll ? "#7c3aed" : "#0d3b8e";
        L.polygon(pts, { color: colour, fillColor: colour, fillOpacity: .2, weight: 2.5 })
          .addTo(surveyorMapInst)
          .bindPopup(`<b>Ref ${formatRef(id)}</b> — ${showAll ? "Disputed Property" : "Application"}`);
        surveyorMapInst.fitBounds(L.polygon(pts).getBounds(), { padding: [30, 30] });
        try {
          const c = pts.map(p => [p[1], p[0]]);
          c.push(c[0]);
          subjectTurf = turf.polygon([c]);
        } catch(_) {}
      }
    } catch(_) {}
  }

  if (!subjectTurf && (lat !== 0 || lng !== 0)) {
    const colour = showAll ? "#7c3aed" : "#0d3b8e";
    L.marker([lat, lng]).addTo(surveyorMapInst)
      .bindPopup(`<b>${formatRef(id)}</b>`).openPopup();
  }

  // ── Scan verified properties for overlap ─────────────────────
  // Dispute Officer (showAll=true):  fetch ALL verified properties — no proximity filter.
  // Surveyor        (showAll=false): only fetch properties within ~5 km delta for speed.
  const conflicts = [];
  try {
    const all = await getAllProperties();
    const candidates = all.filter(p => {
      if (p.status !== 1) return false;  // only verified
      if (p.id === id)    return false;  // skip self
      if (showAll)        return true;   // dispute officer: no filter
      // Surveyor: nearby only (roughly ≤ 5 km via lat/lng delta ≈ 0.05°)
      return (Math.abs(p.latitude - lat) < 0.05 || Math.abs(p.longitude - lng) < 0.05);
    });

    for (const vp of candidates) {
      let vpTurf = null, vpPts = null;
      if (vp.ipfsHash && vp.ipfsHash.length > 10) {
        try {
          const m2 = await fetchFromIPFS(vp.ipfsHash, 5000);
          if (m2.polygonPoints?.length >= 3) {
            vpPts = m2.polygonPoints;
            try {
              const vc = vpPts.map(p => [p[1], p[0]]);
              vc.push(vc[0]);
              vpTurf = turf.polygon([vc]);
            } catch(_) {}
          }
        } catch(_) {}
      }

      let intersects = false, overlapSqFt = 0;
      if (subjectTurf && vpTurf) {
        try {
          const inter = turf.intersect(subjectTurf, vpTurf);
          if (inter) {
            intersects  = true;
            overlapSqFt = Math.round(turf.area(inter) * 10.7639);
          }
        } catch(_) {}
      } else if (vp.latitude !== 0 || vp.longitude !== 0) {
        // Fallback: point proximity check
        if (Math.sqrt(Math.pow(vp.latitude - lat, 2) + Math.pow(vp.longitude - lng, 2)) < 0.002)
          intersects = true;
      }

      const color = intersects ? "#b91c1c" : "#1b7a34";

      if (vpPts?.length >= 3) {
        L.polygon(vpPts, { color, fillColor: color, fillOpacity: .15, weight: 2 })
          .addTo(surveyorMapInst)
          .bindPopup(`<b>${formatRef(vp.id)}</b>${
            intersects
              ? `<br><b style="color:red">⚠️ Overlap: ~${overlapSqFt.toLocaleString()} sq ft</b>`
              : ""}`);

        // Draw overlap zone in orange
        if (intersects && subjectTurf && vpTurf) {
          try {
            const inter = turf.intersect(subjectTurf, vpTurf);
            if (inter) {
              const oc = inter.geometry.coordinates[0].map(c => [c[1], c[0]]);
              L.polygon(oc, {
                color: "#e8611a", fillColor: "#e8611a",
                fillOpacity: .5, weight: 1.5, dashArray: "4 4"
              }).addTo(surveyorMapInst);
            }
          } catch(_) {}
        }
      } else if (vp.latitude !== 0 || vp.longitude !== 0) {
        L.circleMarker([vp.latitude, vp.longitude], {
          color, radius: 10, fillColor: color, fillOpacity: .3, weight: 2
        }).addTo(surveyorMapInst).bindPopup(`<b>${formatRef(vp.id)}</b>`);
      }

      if (intersects) conflicts.push({ id: vp.id, location: vp.location, owner: vp.owner, overlapSqFt });
    }
  } catch(_) {}

  if (conflicts.length) {
    const al = document.getElementById("overlap-alert");
    al.style.display = "block";
    al.textContent =
      `⚠️ ${conflicts.length} boundary conflict${conflicts.length > 1 ? "s" : ""} detected with existing verified properties.`;
    document.getElementById("conflict-list").innerHTML = conflicts.map(c =>
      `<div class="conflict-row">
         ⚠️ Conflict with ${formatRef(c.id)} — ${escHtml(c.location.slice(0,50))}
         ${c.overlapSqFt > 0 ? ` | Overlap: ~${c.overlapSqFt.toLocaleString()} sq ft` : ""}
         <br>
         <span style="font-family:'Source Code Pro',monospace;font-size:.65rem;color:var(--text3)">
           Owner: ${c.owner}
         </span>
       </div>`
    ).join("");
  } else if (showAll) {
    // Reassure dispute officer when no conflicts are found
    const cl = document.getElementById("conflict-list");
    cl.innerHTML = `<div style="font-size:.78rem;color:var(--green-gov);padding:7px 11px;background:var(--green-pale);border:1px solid #16a34a;border-radius:4px;margin-top:6px">
      ✅ No boundary conflicts detected against any verified property.
    </div>`;
  }

  surveyorMapInst.invalidateSize();
}

function closeMapModal() {
  document.getElementById("map-modal").style.display = "none";
  if (surveyorMapInst) { surveyorMapInst.remove(); surveyorMapInst = null; }
}