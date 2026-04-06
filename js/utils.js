// ── UTILS — shared helper functions ──────────────────────────

function escHtml(s)  { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escAttr(s)  { return String(s||"").replace(/'/g,"\\'").replace(/"/g,'\\"').slice(0,80); }

function formatRef(id) {
  return `MH/KLY/${new Date().getFullYear()}/${String(id).padStart(5,"0")}`;
}

function toast(msg, type="info", duration=4000) {
  const icons = {success:"✅",error:"❌",info:"ℹ️"};
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${escHtml(String(msg))}</span>`;
  document.getElementById("toast-container").appendChild(el);
  if (duration > 0) setTimeout(() => el.remove(), duration);
  return el;
}

function setSynced(ok) {
  const dot   = document.getElementById("sync-dot");
  const label = document.getElementById("sync-label");
  if (!dot || !label) return;
  dot.className   = `sync-dot${ok ? "" : " stale"}`;
  label.textContent = ok ? "Synced" : "Refresh needed";
}

// Status label helpers
const S_CLASSES = ["status-pending","status-verified","status-rejected","status-disputed","status-underreview"];
const S_STAMPS  = ["stamp-pending","stamp-verified","stamp-rejected","stamp-disputed","stamp-underreview"];
const S_LABELS  = ["Pending","Verified","Rejected","Disputed","Under Review"];
const S_ICONS   = ["⏳","✅","❌","⚠️","🔍"];
const DR_LABELS = ["—","Approved ✅","Rejected ❌","Partial Fix ⚠️"];
