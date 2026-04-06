// ── MAP — Leaflet polygon drawing & surveyor map ──────────────

let leafletMap = null;
let drawingPoints = [];
let polygonLayer  = null;
let pinMarker     = null;
let mapMode       = "draw";
let calculatedArea = null;
let surveyorMapInst = null;

function initRegMap() {
  if (leafletMap) { leafletMap.invalidateSize(); return; }
  leafletMap = L.map("property-map").setView([18.9712, 72.8955], 13);
  // FIX: Use https tile URL to avoid mixed-content and ERR_NAME_NOT_RESOLVED errors
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(leafletMap);
  leafletMap.on("click", onMapClick);
  setTimeout(() => leafletMap.invalidateSize(), 200);
}

function onMapClick(e) {
  if (mapMode === "pin") {
    if (pinMarker) leafletMap.removeLayer(pinMarker);
    pinMarker = L.marker(e.latlng).addTo(leafletMap);
    const latEl = document.getElementById("reg-lat");
    const lngEl = document.getElementById("reg-lng");
    if (latEl) latEl.value = e.latlng.lat.toFixed(6);
    if (lngEl) lngEl.value = e.latlng.lng.toFixed(6);
    document.getElementById("map-info").textContent = `📍 Pin: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    return;
  }
  drawingPoints.push([e.latlng.lat, e.latlng.lng]);
  refreshPolygon();
  if (drawingPoints.length === 1) {
    const latEl = document.getElementById("reg-lat");
    const lngEl = document.getElementById("reg-lng");
    if (latEl) latEl.value = e.latlng.lat.toFixed(6);
    if (lngEl) lngEl.value = e.latlng.lng.toFixed(6);
  }
}

function refreshPolygon() {
  if (polygonLayer) leafletMap.removeLayer(polygonLayer);
  if (drawingPoints.length < 2) return;
  polygonLayer = L.polygon(drawingPoints, {
    color:"#0d3b8e", fillColor:"#0d3b8e", fillOpacity:.15, weight:2
  }).addTo(leafletMap);
  if (drawingPoints.length >= 3) {
    const coords = drawingPoints.map(p => [p[1], p[0]]);
    coords.push(coords[0]);
    try {
      const poly    = turf.polygon([coords]);
      const areaSqFt = Math.round(turf.area(poly) * 10.7639);
      calculatedArea = areaSqFt;
      const areaEl  = document.getElementById("reg-area");
      if (areaEl) areaEl.value = areaSqFt;
      const noteEl  = document.getElementById("calc-area-note");
      if (noteEl) noteEl.textContent = `(auto: ${areaSqFt.toLocaleString()} sq ft)`;
      document.getElementById("map-info").textContent = `✅ Polygon: ${areaSqFt.toLocaleString()} sq ft — ${drawingPoints.length} points`;
      checkAreaMismatch();
    } catch(_) {}
  }
}

function checkAreaMismatch() {
  const warn = document.getElementById("area-mismatch-warn");
  if (!warn || !calculatedArea) { if (warn) warn.style.display = "none"; return; }
  const userVal = parseInt(document.getElementById("reg-area")?.value);
  if (!userVal) { warn.style.display = "none"; return; }
  const diff = Math.abs(userVal - calculatedArea) / calculatedArea * 100;
  if (diff > 10) {
    document.getElementById("mismatch-user").textContent = userVal.toLocaleString();
    document.getElementById("mismatch-calc").textContent = calculatedArea.toLocaleString();
    document.getElementById("mismatch-pct").textContent  = diff.toFixed(1);
    warn.style.display = "block";
  } else { warn.style.display = "none"; }
}

function setMapMode(mode) {
  mapMode = mode;
  document.getElementById("btn-draw")?.classList.toggle("active", mode === "draw");
  document.getElementById("btn-pin")?.classList.toggle("active",  mode === "pin");
  document.getElementById("map-info").textContent = mode === "draw"
    ? "Click on map to draw boundary polygon."
    : "Click on map to drop a location pin.";
}

function clearMapDrawing() {
  drawingPoints = [];
  if (polygonLayer) { leafletMap.removeLayer(polygonLayer); polygonLayer = null; }
  if (pinMarker)    { leafletMap.removeLayer(pinMarker); pinMarker = null; }
  calculatedArea = null;
  const noteEl = document.getElementById("calc-area-note");
  const warnEl = document.getElementById("area-mismatch-warn");
  if (noteEl) noteEl.textContent = "";
  if (warnEl) warnEl.style.display = "none";
  document.getElementById("map-info").textContent = "Drawing cleared.";
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

// Surveyor boundary verification map modal
async function openSurveyorMap(id, lat, lng, loc, area, ipfsHash) {
  document.getElementById("map-modal-id").textContent = id;
  document.getElementById("map-modal-info").textContent = `📍 ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)} | ${loc} | ${Number(area).toLocaleString()} sq ft`;
  document.getElementById("overlap-alert").style.display  = "none";
  document.getElementById("conflict-list").innerHTML = "";
  document.getElementById("map-modal").style.display = "flex";

  await new Promise(r => setTimeout(r, 100));
  if (surveyorMapInst) { surveyorMapInst.remove(); surveyorMapInst = null; }

  const centre = (lat !== 0 || lng !== 0) ? [lat, lng] : [18.9712, 72.8955];
  surveyorMapInst = L.map("surveyor-map").setView(centre, 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:"© OpenStreetMap contributors", maxZoom:19
  }).addTo(surveyorMapInst);

  let subjectTurf = null;
  if (ipfsHash && ipfsHash.length > 10) {
    try {
      const manifest = await fetchFromIPFS(ipfsHash, 6000);
      if (manifest.polygonPoints && manifest.polygonPoints.length >= 3) {
        const pts = manifest.polygonPoints;
        L.polygon(pts, {color:"#0d3b8e",fillColor:"#0d3b8e",fillOpacity:.2,weight:2.5})
          .addTo(surveyorMapInst).bindPopup(`<b>Ref ${formatRef(id)}</b> — Application`);
        surveyorMapInst.fitBounds(L.polygon(pts).getBounds(), {padding:[30,30]});
        try { const c = pts.map(p=>[p[1],p[0]]); c.push(c[0]); subjectTurf = turf.polygon([c]); } catch(_) {}
      }
    } catch(_) {}
  }
  if (!subjectTurf && (lat !== 0 || lng !== 0)) {
    L.marker([lat, lng]).addTo(surveyorMapInst).bindPopup(`<b>${formatRef(id)}</b>`).openPopup();
  }

  const conflicts = [];
  try {
    const all = await getAllProperties();
    for (const vp of all.filter(p => p.status === 1 && p.id !== id && (Math.abs(p.latitude - lat) < 0.05 || Math.abs(p.longitude - lng) < 0.05))) {
      let vpTurf = null, vpPts = null;
      if (vp.ipfsHash && vp.ipfsHash.length > 10) {
        try { const m2 = await fetchFromIPFS(vp.ipfsHash, 5000); if (m2.polygonPoints?.length >= 3) { vpPts = m2.polygonPoints; try { const vc = vpPts.map(p=>[p[1],p[0]]); vc.push(vc[0]); vpTurf = turf.polygon([vc]); } catch(_) {} } } catch(_) {}
      }
      let intersects = false, overlapSqFt = 0;
      if (subjectTurf && vpTurf) {
        try { const inter = turf.intersect(subjectTurf, vpTurf); if (inter) { intersects = true; overlapSqFt = Math.round(turf.area(inter) * 10.7639); } } catch(_) {}
      } else if (vp.latitude !== 0 || vp.longitude !== 0) {
        if (Math.sqrt(Math.pow(vp.latitude - lat, 2) + Math.pow(vp.longitude - lng, 2)) < 0.002) intersects = true;
      }
      const color = intersects ? "#b91c1c" : "#1b7a34";
      if (vpPts?.length >= 3) {
        L.polygon(vpPts, {color,fillColor:color,fillOpacity:.15,weight:2})
          .addTo(surveyorMapInst)
          .bindPopup(`<b>${formatRef(vp.id)}</b>${intersects?`<br><b style="color:red">⚠️ Overlap: ~${overlapSqFt.toLocaleString()} sq ft</b>`:""}`);
        if (intersects && subjectTurf && vpTurf) {
          try { const inter = turf.intersect(subjectTurf, vpTurf); if (inter) { const oc = inter.geometry.coordinates[0].map(c=>[c[1],c[0]]); L.polygon(oc, {color:"#e8611a",fillColor:"#e8611a",fillOpacity:.5,weight:1.5,dashArray:"4 4"}).addTo(surveyorMapInst); } } catch(_) {}
        }
      } else if (vp.latitude !== 0 || vp.longitude !== 0) {
        L.circleMarker([vp.latitude,vp.longitude],{color,radius:10,fillColor:color,fillOpacity:.3,weight:2})
          .addTo(surveyorMapInst).bindPopup(`<b>${formatRef(vp.id)}</b>`);
      }
      if (intersects) conflicts.push({id:vp.id, location:vp.location, owner:vp.owner, overlapSqFt});
    }
  } catch(_) {}

  if (conflicts.length) {
    const al = document.getElementById("overlap-alert");
    al.style.display = "block";
    al.textContent = `⚠️ ${conflicts.length} boundary conflict${conflicts.length > 1 ? "s" : ""} detected with existing verified properties.`;
    document.getElementById("conflict-list").innerHTML = conflicts.map(c =>
      `<div class="conflict-row">⚠️ Conflict with ${formatRef(c.id)} — ${escHtml(c.location.slice(0,50))}${c.overlapSqFt > 0 ? ` | Overlap: ~${c.overlapSqFt.toLocaleString()} sq ft` : ""}<br><span style="font-family:'Source Code Pro',monospace;font-size:.65rem;color:var(--text3)">Owner: ${c.owner}</span></div>`
    ).join("");
  }
  surveyorMapInst.invalidateSize();
}

function closeMapModal() {
  document.getElementById("map-modal").style.display = "none";
  if (surveyorMapInst) { surveyorMapInst.remove(); surveyorMapInst = null; }
}
