# Gold Khata Book Backend - RESTful API Service

> **Forked from [sonebill-backend](https://github.com/codeimplants/sonebill-backend) on 3 Sep 2026.**
> Same codebase, re-pointed at a new product aimed at wholesale users. What
> deliberately differs from SoneBill:
>
> | Area | Change |
> | --- | --- |
> | Database | Self-hosted MongoDB everywhere. The Atlas `mongodb+srv://` URIs are gone; dev, preprod and prod all use `mongodb://`. |
> | Ports | 7100 / 7101 / 7102 (prod / dev / preprod) so this can run beside SoneBill's 7000-7002 on the same box. |
> | OTP | Dev no longer bypasses 2Factor. One OTP path in every environment, so a dev login exercises the same code prod does — **dev sends real SMS**. |
> | SMS account | Shares SoneBill's 2Factor key, by decision. |
> | JWT | Freshly generated secrets, and issuer/audience `gold-khata-book-api` / `gold-khata-book-client`. SoneBill's tokens are not valid here. |
> | ImageKit | Not yet provisioned — `IMAGEKIT_*` are placeholders. Image upload stays broken until a Gold Khata Book ImageKit account is set up. |
>
> Domain language is still SoneBill's retail-jeweller vocabulary (`dukandar`,
> `invoice`, `advance order`). Renaming it for wholesale is not done here.


The Gold Khata Book Backend is the core engine of the jewelry billing ecosystem. It's built with Node.js, Express, and MongoDB, and provides a stable, secure, and transactional API for all client components.

## 🚀 Key Technical Features

### Transactional Order Flow
- **Unified Completion**: Implements a high-integrity `unifiedCompleteAdvanceOrder` service that uses Mongoose sessions to ensure that adding a final payment, creating an invoice, and updating the order status all happen atomically. This prevents data inconsistency if a network failure occurs mid-operation.

### Secure Authentication
- **OTP-based Verification**: Integrated with **2Factor.in** for mobile-first user authentication.
- **Hashing**: Uses `crypto` HMAC (SHA256) for secure session storage and verification to prevent replay attacks.
- **JWT**: Stateless session management with roles (`admin`, `dukandar`, `customer`).

### Image Optimization Pipelines
- Uses the `sharp` library for high-performance server-side image processing.
- Automatically optimizes and converts all uploaded shop and product assets to **WebP** for cellular-friendly bandwidth savings.
- Integrates with **ImageKit** for globally distributed cloud storage.

---

## 🔑 Environment Configuration Guide

The backend relies on the following variables. See [.env.example](.env.example) for a template.

| Category | Key | Description |
| --- | --- | --- |
| **Server** | `PORT` | Listening port (default 7100). |
| **Server** | `NODE_ENV` | `dev`, `preprod`, or `prod`. |
| **Database** | `DEV_DB_URL` | Local MongoDB URI for development. |
| **Database** | `PROD_DB_URL` | Self-hosted MongoDB URI for production (`mongodb://…`, not Atlas). |
| **Auth** | `JWT_PRIVATE_KEY` | Secret for HMAC-SHA256 JWT signatures. |
| **Auth** | `HASH_KEY` | Salt for OTP hashing. |
| **ImageKit** | `IMAGEKIT_...` | Public/Private keys for the ImageKit API. |
| **Messaging** | `TWOFACTOR_API_KEY` | Key from 2Factor.in. |

---

## 🏃 Installation & Running

### 📦 Installation
```bash
npm install
```

### 🛠️ Development
```bash
# Hot-reloading development server
npm run dev
```

### 🏭 Production Build
```bash
# Compile TypeScript to JavaScript
npm run build

# Start the compiled server
npm run start:prod
```

---

## 🚢 Deploying

Double-click **`scripts\deploy.cmd`**, pick an environment, done. No terminal or flags needed.

```bash
bash scripts/deploy.sh --inspect      # read-only: what is each server running?
bash scripts/deploy.sh --env dev      # deploy dev
```

Three isolated environments on the VPS, each with its own checkout, `.env` and database:

| Env | Port | Notes |
|---|---|---|
| dev | 7101 | Safe to break |
| preprod | 7102 | Final rehearsal |
| prod | 7100 | **Real shops** |

Deploys are gated on a health check against a real endpoint, so nothing reports success until the
port actually answers.

📖 **[dev-help/deploying-the-backend.md](dev-help/deploying-the-backend.md)** — full guide: first-time
SSH setup, deploying a feature branch to dev, reading failures, rolling back.
🤖 **[dev-help/ai/script-based-deployment.md](dev-help/ai/script-based-deployment.md)** — the same
system for AI agents, plus how to judge whether a change is safe for prod.

---

## 📁 Detailed Project Structure

```
gold-khata-book-backend/
├── src/
│   ├── modules/
│   │   ├── auth/           # Login, OTP verification, and JWT generation
│   │   ├── order/          # Advance payment, order tracking, and completion
│   │   ├── invoice/        # Professional billing and GST calculation
│   │   ├── sales/          # Reporting and historical data analysis
│   │   ├── shopDetail/     # Configuration for shop floor details
│   │   └── customer/       # CRM services for jewelry buyers
│   ├── common/             # Global error handlers, middlewares, and types
│   ├── config/             # DB connection hooks and app config
│   └── server.ts           # Main entry - CORS, Middleware, and Routing
├── .env.example
├── tsconfig.json
├── package.json
└── README.md
```

## 📜 Authors & Copyright
- **Creators**: Code Implants Software Technologies Pvt. Ltd.
- **Contact**: codeimplants@gmail.com

© 2026 Gold Khata Book. All rights reserved.
