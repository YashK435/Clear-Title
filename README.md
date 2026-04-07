# ClearTitle — Blockchain-Based Land & Property Registry

> **Official Digital Land Registry Portal · Government of Maharashtra**
> Tamper-proof · Decentralised · IPFS-backed · Smart Contract powered

---

## 📸 Screenshots

### Home Page / Landing
<!-- INSERT SCREENSHOT: Home page hero section with Maharashtra govt branding -->
![Home Page](./screenshots/home.png)

### Citizen Dashboard
<!-- INSERT SCREENSHOT: Citizen overview tab showing property cards and stats -->
![Citizen Dashboard](./screenshots/citizen-dashboard.png)

### Property Registration Form
<!-- INSERT SCREENSHOT: Register property tab with map polygon drawing -->
![Property Registration](./screenshots/register-property.png)

### Map — Polygon Drawing
<!-- INSERT SCREENSHOT: Leaflet map with drawn polygon and area auto-calculation -->
![Map Drawing](./screenshots/map-polygon.png)

### Surveyor Dashboard
<!-- INSERT SCREENSHOT: Surveyor queue with pending property cards -->
![Surveyor Dashboard](./screenshots/surveyor-dashboard.png)

### Surveyor Map — Overlap Detection
<!-- INSERT SCREENSHOT: Boundary verification modal with conflict detection -->
![Overlap Detection](./screenshots/surveyor-map-overlap.png)

### Registrar Dashboard
<!-- INSERT SCREENSHOT: Registrar queue with document review panel -->
![Registrar Dashboard](./screenshots/registrar-dashboard.png)

### Dispute Officer Dashboard
<!-- INSERT SCREENSHOT: Active disputes with resolution modal -->
![Dispute Dashboard](./screenshots/dispute-dashboard.png)

### Admin Panel — Role Management
<!-- INSERT SCREENSHOT: Admin role proposal with timelock countdown -->
![Admin Panel](./screenshots/admin-roles.png)

### Public Blockchain Ledger
<!-- INSERT SCREENSHOT: Public verified property ledger with search -->
![Public Ledger](./screenshots/public-ledger.png)

---

## 🏛️ Project Overview

**ClearTitle** addresses the fundamental weaknesses of traditional land registry systems — fraud, tampering, opacity, and manual bottlenecks — by moving property records onto a permissioned blockchain backed by IPFS document storage.

| Problem | ClearTitle Solution |
|---|---|
| Centralised DB, easy to tamper | Immutable on-chain records |
| Paper-based documents | IPFS hash-anchored document manifests |
| Single authority, corruption risk | Multi-role verification pipeline |
| No boundary verification | Leaflet polygon + Turf.js overlap detection |
| Dispute deadlocks | Dedicated Dispute Officer role with on-chain notes |

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Ethereum (Sepolia testnet) |
| Smart Contract | Solidity ^0.8.0 |
| Frontend | Vanilla HTML/CSS/JS |
| Wallet Integration | MetaMask + ethers.js v5 |
| Maps | Leaflet.js + Turf.js (polygon area & overlap) |
| Document Storage | IPFS via Pinata |
| IPFS Proxy | Node.js + Express |

---

## 🗂️ Project Structure

```
cleartitle/
├── index.html              # Single-page application (all roles)
├── LandRegistry.sol        # Solidity smart contract v3.0
├── css/
│   └── styles.css          # Government-themed design system
├── js/
│   ├── config.js           # Contract address, ABI, RPC endpoints
│   ├── blockchain.js       # Provider, wallet connect, getAllProperties()
│   ├── app.js              # Navigation, dashboard routing, public ledger
│   ├── citizen.js          # Registration, transfer, dispute actions
│   ├── roles.js            # Surveyor, Registrar, Dispute Officer, Admin
│   ├── cards.js            # Property card & ledger card builders
│   ├── map.js              # Leaflet polygon drawing, surveyor map modal
│   ├── ipfs.js             # File uploads, manifest builder, gateway fetch
│   └── utils.js            # escHtml, toast, formatRef, setSynced
└── backend/
    ├── server.js           # Express IPFS proxy (Pinata JWT kept server-side)
    ├── package.json
    └── env.example         # Copy to .env and add PINATA_JWT
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MetaMask browser extension
- A Pinata account (free tier works)

### 1 · Clone & Install Backend

```bash
git clone https://github.com/your-repo/cleartitle.git
cd cleartitle/backend
npm install
cp env.example .env
# Edit .env — add your PINATA_JWT
```

### 2 · Start the IPFS Proxy

```bash
npm run dev
# Runs on http://localhost:3001
```

### 3 · Open the Frontend

Open `index.html` in a browser (use Live Server or any static file server). MetaMask will auto-detect.

### 4 · Connect Wallet

Click **Connect Digital ID** → MetaMask prompt → your role is detected automatically against the deployed contract.

---

## 🔐 Smart Contract

**Network:** Ethereum Sepolia Testnet  
**Address:** `0x2285cCcF9E08A4531CC8E3155E3656fB2F241a3e`

### Deployment (Hardhat / Remix)

```bash
# Remix IDE — easiest
# 1. Paste LandRegistry.sol
# 2. Compile with Solidity 0.8.x
# 3. Deploy to Injected Provider (MetaMask → Sepolia)
# 4. Copy deployed address into js/config.js → CONTRACT_ADDRESS
```

### Role Setup (Admin only, after deploy)

```
1. Open Admin tab
2. Enter Registrar, Surveyor, Dispute Officer wallet addresses
3. Click "Propose Role Change"
4. Wait for ROLE_TIMELOCK (1 min on testnet, 48h on mainnet)
5. Click "Confirm Role Change"
```

---

## 👥 System Roles

| Role | Wallet | Capabilities |
|---|---|---|
| **Citizen** | Any connected wallet | Register property, initiate/accept transfers, raise disputes |
| **Surveyor** | Assigned by Admin | Approve/reject boundary, view overlap map |
| **Registrar** | Assigned by Admin | Final registration approval, transfer approval/rejection |
| **Dispute Officer** | Assigned by Admin | Resolve disputes with binding on-chain decision |
| **Admin** | Contract deployer | Propose and confirm role assignments (timelocked) |

---

## 🔄 Core Flows

### Property Registration
```
Citizen submits docs + polygon → IPFS manifest uploaded
→ Surveyor approves boundary → Registrar approves ownership
→ Smart contract records permanently on blockchain
```

### Property Transfer
```
Seller initiates transfer (buyer address + sale price)
→ Registrar approves → Buyer accepts
→ Smart contract transfers ownership atomically
```

### Dispute
```
Any wallet raises dispute on verified property
→ Active transfer automatically cancelled
→ Dispute Officer reviews → Approve / Reject / Partial Fix
→ Resolution notes stored permanently on-chain
```

---

## 📄 Environment Variables

```env
# backend/.env
PINATA_JWT=your_pinata_jwt_here
PORT=3001
ALLOWED_ORIGIN=*   # Set your domain in production
```

---

## 🔒 Security Features

- **Reentrancy guard** on `acceptTransfer()`
- **Role timelock** — 1-minute delay on testnet (configurable to 48h)
- **Transfer expiry** — 30-day validity window, publicly cleanable
- **Dispute auto-lock** — raises on verified property cancel any pending transfer atomically
- **IPFS proxy** — Pinata JWT never exposed to the browser
- **Rate limiting** — 20 uploads/hour per wallet on the proxy

---

## 📡 IPFS Document Manifest Structure

Each property's IPFS hash points to a JSON manifest:

```json
{
  "saleDeed":       "QmHash...",
  "idProof":        "QmHash...",
  "taxReceipt":     "QmHash...",
  "encumbrance":    "QmHash...",
  "surveyMap":      "QmHash...",
  "oc":             "QmHash...",
  "noc":            "QmHash...",
  "polygonPoints":  [[lat, lng], [lat, lng], ...],
  "calculatedArea": 1200,
  "witnesses": {
    "w1name": "John Doe", "w1addr": "0x...",
    "w2name": "Jane Doe", "w2addr": "0x..."
  },
  "createdAt": "2025-04-07T00:00:00.000Z"
}
```

---

## 🤝 Contributing

Pull requests are welcome. For major changes, open an issue first.

---

## 📜 License

MIT — © 2025 ClearTitle Project
