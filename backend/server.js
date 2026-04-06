// ══════════════════════════════════════════════════════════════
//  ClearTitle — IPFS Upload Proxy Server
//  FIX: Accept application/octet-stream as fallback for PDFs
//       (some browsers send this for .pdf files)
// ══════════════════════════════════════════════════════════════

const express    = require("express");
const multer     = require("multer");
const fetch      = require("node-fetch");
const FormData   = require("form-data");
const rateLimit  = require("express-rate-limit");
const cors       = require("cors");
const path       = require("path");
require("dotenv").config();

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*",
  methods: ["POST", "OPTIONS", "GET"],
}));

app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => {
    const wallet = req.headers["x-wallet-address"];
    if (wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)) return wallet.toLowerCase();
    return req.ip;
  },
  message: { error: "Too many uploads from this wallet. Try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Health check ──────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ClearTitle IPFS Proxy" });
});

// ── FIX: Detect actual file type from extension + buffer ──────
function resolveMediaType(file) {
  const name = (file.originalname || "").toLowerCase();
  const ext  = path.extname(name);

  const allowed = [
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
    "application/json",   // ← ADD THIS
    "text/plain"          // ← ADD THIS (safety net)
  ];
  if (allowed.includes(file.mimetype)) return file.mimetype;

  const extMap = {
    ".pdf":  "application/pdf",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".json": "application/json",   // ← ADD THIS
  };
  if (extMap[ext]) return extMap[ext];

  if (file.buffer && file.buffer.slice(0, 4).toString() === "%PDF") {
    return "application/pdf";
  }

  return null;
}

// ── IPFS Upload endpoint ──────────────────────────────────────
app.post(
  "/api/ipfs-upload",
  uploadLimiter,
  upload.single("file"),
  async (req, res) => {
    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
      console.error("PINATA_JWT not set in environment");
      return res.status(500).json({ error: "IPFS service not configured on server." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file provided." });
    }

    const wallet = req.headers["x-wallet-address"] || "unknown";

    // FIX: resolve actual MIME type
    const resolvedType = resolveMediaType(req.file);
    if (!resolvedType) {
      console.warn(`Rejected file: ${req.file.originalname} | reported type: ${req.file.mimetype}`);
      return res.status(400).json({
        error: `File type '${req.file.mimetype}' not allowed. Use PDF or image files. (Detected from: ${req.file.originalname})`
      });
    }

    console.log(`[${new Date().toISOString()}] Upload | wallet: ${wallet} | file: ${req.file.originalname} | type: ${resolvedType} | size: ${req.file.size}`);

    try {
      const pinataForm = new FormData();
      pinataForm.append("file", req.file.buffer, {
        filename:    req.file.originalname,
        contentType: resolvedType,
      });
      pinataForm.append("pinataMetadata", JSON.stringify({
        name: req.file.originalname,
        keyvalues: {
          uploadedBy: wallet,
          uploadedAt: new Date().toISOString(),
          project:    "ClearTitle",
        },
      }));
      pinataForm.append("pinataOptions", JSON.stringify({ cidVersion: 0 }));

      const pinataRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method:  "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          ...pinataForm.getHeaders(),
        },
        body: pinataForm,
      });

      if (!pinataRes.ok) {
        const errText = await pinataRes.text();
        console.error("Pinata error:", pinataRes.status, errText);
        return res.status(502).json({ error: "IPFS upload failed. Try again." });
      }

      const data = await pinataRes.json();
      console.log(`[${new Date().toISOString()}] Pinned: ${data.IpfsHash}`);

      return res.json({
        IpfsHash: data.IpfsHash,  // keep original key for compatibility
        hash:     data.IpfsHash,
        url:      `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
        size:     data.PinSize,
        gateway:  `https://ipfs.io/ipfs/${data.IpfsHash}`,
      });

    } catch (err) {
      console.error("Proxy error:", err);
      return res.status(500).json({ error: "Internal server error during upload." });
    }
  }
);

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ClearTitle IPFS Proxy running on http://localhost:${PORT}`);
  console.log(`PINATA_JWT: ${process.env.PINATA_JWT ? "✅ SET" : "❌ NOT SET — set it in .env"}`);
});

module.exports = app;