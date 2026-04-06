// ══════════════════════════════════════════════════════════════
//  ClearTitle — IPFS Upload Proxy Server
//  Keeps Pinata JWT off the frontend completely.
//
//  Setup:
//    npm install
//    cp .env.example .env   → fill in PINATA_JWT
//    node server.js
//
//  Frontend sets:  const PINATA_PROXY_URL = "http://localhost:3001/api/ipfs-upload";
// ══════════════════════════════════════════════════════════════

const express    = require("express");
const multer     = require("multer");
const fetch      = require("node-fetch");
const FormData   = require("form-data");
const rateLimit  = require("express-rate-limit");
const cors       = require("cors");
require("dotenv").config();

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB max

// ── CORS ──────────────────────────────────────────────────────
// Allow your frontend origin. Change "*" to your deployed domain in production.
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || "*",
  methods: ["POST", "OPTIONS"],
}));

app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────
// 20 uploads per wallet address per hour
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req) => {
    // Rate-limit by wallet address sent in header, fall back to IP
    const wallet = req.headers["x-wallet-address"];
    if (wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return wallet.toLowerCase();
    }
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

// ── IPFS Upload endpoint ──────────────────────────────────────
app.post(
  "/api/ipfs-upload",
  uploadLimiter,
  upload.single("file"),
  async (req, res) => {
    // Validate JWT is configured
    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
      console.error("PINATA_JWT not set in environment");
      return res.status(500).json({ error: "IPFS service not configured on server." });
    }

    // Validate file was sent
    if (!req.file) {
      return res.status(400).json({ error: "No file provided. Send file as multipart/form-data field named 'file'." });
    }

    // Validate wallet address header (optional but logged)
    const wallet = req.headers["x-wallet-address"] || "unknown";
    console.log(`[${new Date().toISOString()}] Upload from wallet: ${wallet} | file: ${req.file.originalname} | size: ${req.file.size}`);

    // Validate file type — only PDF and images
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(req.file.mimetype)) {
      return res.status(400).json({ error: `File type '${req.file.mimetype}' not allowed. Use PDF or image files.` });
    }

    try {
      // Build multipart form for Pinata
      const pinataForm = new FormData();
      pinataForm.append("file", req.file.buffer, {
        filename:    req.file.originalname,
        contentType: req.file.mimetype,
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

      // Call Pinata
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
        hash:    data.IpfsHash,
        url:     `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
        size:    data.PinSize,
        gateway: `https://ipfs.io/ipfs/${data.IpfsHash}`,
      });

    } catch (err) {
      console.error("Proxy error:", err);
      return res.status(500).json({ error: "Internal server error during upload." });
    }
  }
);

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ClearTitle IPFS Proxy running on http://localhost:${PORT}`);
  console.log(`PINATA_JWT: ${process.env.PINATA_JWT ? "✅ SET" : "❌ NOT SET — set it in .env"}`);
});

module.exports = app;