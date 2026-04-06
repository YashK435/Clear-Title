// ── BLOCKCHAIN — provider, contract, data fetching ───────────

let provider, signer, contract;
let currentAccount = "";
let role = "citizen";

// FIX: Read-only provider using CORS-friendly endpoints
// rpc.sepolia.org blocks CORS — these alternatives work from browsers
function getReadProvider() {
  // Try MetaMask's provider first (no CORS issue, always preferred)
  if (window.ethereum) {
    return new ethers.providers.Web3Provider(window.ethereum);
  }
  // Fallback to CORS-friendly public endpoints
  for (const url of SEPOLIA_RPC_URLS) {
    try {
      return new ethers.providers.JsonRpcProvider(url);
    } catch(e) { continue; }
  }
  // Last resort
  return new ethers.providers.JsonRpcProvider(SEPOLIA_RPC_URLS[0]);
}

async function connectWallet() {
  if (!window.ethereum) {
    toast("MetaMask not detected. Please install MetaMask.", "error");
    return;
  }
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    // FIX: Use MetaMask's built-in provider — no CORS issues
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer   = provider.getSigner();
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    currentAccount = (await signer.getAddress()).toLowerCase();
    updateWalletUI();
    await detectRole();
    showDashboard();

    window.ethereum.on("accountsChanged", async (accounts) => {
      if (!accounts.length) { location.reload(); return; }
      currentAccount = accounts[0].toLowerCase();
      signer   = provider.getSigner();
      contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      updateWalletUI();
      await detectRole();
      showDashboard();
    });
  } catch(e) {
    toast(e.message || "Connection failed", "error");
  }
}

function updateWalletUI() {
  const lbl = document.getElementById("wallet-label");
  const btn = document.getElementById("connect-btn");
  if (lbl) lbl.textContent = `${currentAccount.slice(0,6)}...${currentAccount.slice(-4)}`;
  if (btn) btn.classList.add("connected");
}

async function detectRole() {
  try {
    const c = contract || new ethers.Contract(CONTRACT_ADDRESS, ABI, getReadProvider());
    const [adm, reg, surv, disp] = await Promise.all([
      c.admin(), c.registrar(), c.surveyor(), c.disputeOfficer()
    ]);
    if      (currentAccount === adm.toLowerCase())  role = "admin";
    else if (currentAccount === reg.toLowerCase())  role = "registrar";
    else if (currentAccount === surv.toLowerCase()) role = "surveyor";
    else if (currentAccount === disp.toLowerCase()) role = "dispute";
    else                                             role = "citizen";

    const badge = document.getElementById("role-badge");
    if (badge) {
      badge.style.display = "inline-flex";
      badge.className = `role-badge ${role}`;
      const labels = {admin:"⚡ Admin",citizen:"👤 Citizen",surveyor:"📐 Surveyor",registrar:"📋 Registrar",dispute:"⚖️ Dispute Officer"};
      badge.textContent = labels[role];
    }
  } catch(e) { console.error("detectRole error:", e); }
}

async function getAllProperties(useReadOnly = false) {
  const c = (useReadOnly || !contract)
    ? new ethers.Contract(CONTRACT_ADDRESS, ABI, getReadProvider())
    : contract;
  const count = (await c.propertyCount()).toNumber();
  const props = [];
  for (let i = 1; i <= count; i++) {
    const [c1, c2, m, tx] = await Promise.all([
      c.getPropertyCore1(i), c.getPropertyCore2(i),
      c.getPropertyMeta(i),  c.getTransfer(i)
    ]);
    props.push({
      id: c1[0].toNumber(), owner: c1[1].toLowerCase(),
      area: c1[2].toNumber(), declaredValue: c1[3].toNumber(),
      status: c1[4], isRegistered: c1[5], surveyorApproved: c1[6],
      registrarApproved: c2[0], disputeResult: c2[1],
      parentPropertyId: c2[2].toNumber(), resubmittedFrom: c2[3].toNumber(),
      location: m[0], unitIdentifier: m[1], ipfsHash: m[2],
      rejectionReason: m[3], disputeNotes: m[4],
      latitude: m[5].toNumber() / 1e6, longitude: m[6].toNumber() / 1e6,
      txBuyer: tx[0].toLowerCase(), txAgreedValue: tx[1].toNumber(),
      txExpiry: tx[2].toNumber(), txRegApproved: tx[3], txActive: tx[4],
    });
  }
  return props;
}

async function txWrapper(fn, successMsg, callback) {
  const t = toast("Sending transaction...", "info", 0);
  setSynced(false);
  try {
    const tx = await fn();
    t.remove();
    const t2 = toast("Waiting for confirmation...", "info", 0);
    await tx.wait();
    t2.remove();
    toast(successMsg, "success");
    setSynced(true);
    if (callback) callback();
  } catch(e) {
    try { t.remove(); } catch(_) {}
    setSynced(false);
    toast(e?.data?.message || e?.reason || e?.message || "Transaction failed", "error");
    console.error(e);
    setTimeout(async () => {
      try {
        if      (role === "citizen")   await loadCitizenData();
        else if (role === "surveyor")  await loadSurveyorData();
        else if (role === "registrar") await loadRegistrarData();
        else if (role === "dispute")   await loadDisputeData();
        else if (role === "admin")     await loadAdminData();
      } catch(_) {}
    }, 2000);
  }
}
