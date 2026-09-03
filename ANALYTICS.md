# Analytics — gold-khata-book-backend

This repo doesn't run any analytics SDK itself. Its role in the analytics
picture is purely as a **federation target**: Nexus (the internal admin
platform at `C:\RN\nexus`) calls specific routes here to power its
Gold Khata Book dashboard. If you change any of the routes/shapes below, Nexus's
`GoldKhataBookDashboard.tsx` (`nexus-frontend/src/pages/GoldKhataBookDashboard.tsx`)
breaks silently (wrong/missing numbers, not a crash) — update both sides
together.

## Routes Nexus depends on

All under `src/modules/dukandar/dukandar.routes.ts`, admin-gated
(`authMiddleware` + `requireAdmin`):

| Route | Backing service | What Nexus does with it |
|---|---|---|
| `GET /dukandar/stats` | `DukandarService.getAllDukandarsWithStats` | Per-shopkeeper business data (phone, shopName, totalInvoices, totalSalesValue, customersCount, registrationDate, lastActivity, contactCount, deviceInfo). Drives the Users table, and summed client-side for "Total bills (all time)" / "Total sales". Also configured as `App.backendUsersPath` (`/api/dukandar/stats`) so Nexus's generic Leads/Engagement pages can resolve pseudonymous ids to real phone/name. |
| `GET /dukandar/analytics` | `DukandarService.getAdminAnalytics` | The "Users overview" tiles (new this week/month, churned, active, never-active), "Last registered user" card, "Platform invoices" tiles, and the device platform/model breakdown. Gold Khata Book's own churn definition (no invoice/order in 30 days) is used here, not Nexus's generic app-open-based one — deliberately, since it's the more meaningful signal for a billing app. |
| `GET /dukandar/deleted-log` | `DukandarService.getDeletedUserLogs` | The Deleted tab. |
| `DELETE /dukandar/:id` | `DukandarService.deleteDukandar` → `hardDeleteWithCascade` | What Nexus's Bulk Cleanup actually calls, once per selected user (configured as `App.backendDeleteUserPath` = `/api/dukandar`). Nexus does **not** use `POST /dukandar/bulk-delete` — it loops single-deletes itself so there's one audit trail (Nexus's `AuditLog`) instead of two divergent ones. |

Response envelope for all of the above: `{ success: true, data: <payload> }`
— Nexus's proxy reads `response.data.data`, not `response.data` directly.

## Auth Nexus needs

`authMiddleware` (`src/common/middlewares/auth.middleware.ts`) requires a
real JWT: HS256, issuer `gold-khata-book-api`, audience `gold-khata-book-client`, and
`requireAdmin` additionally requires `role === 'admin'` in the token payload.
Nexus's `App.backendServiceToken` for this app has to be exactly that kind of
token (a long-lived admin JWT this backend's `JWT_PRIVATE_KEY`/
`JWT_PUBLIC_KEY` will verify), not an arbitrary API key — this backend has no
separate machine-to-machine credential type. If that token ever expires or
the signing key rotates, every federated call from Nexus for this app starts
failing with 401, silently (Nexus's federation proxy degrades to empty
dashboard sections, not an error page).

## What's deliberately not here

Business/financial data (bills, sales, invoices) and the deleted-user log
stay in this backend and are never mirrored into Nexus's own database —
Nexus only ever reads them live through the routes above. Usage-behavior
telemetry (screen views, sessions, retention) isn't tracked here at all —
that's Firebase Analytics, live in `gold-khata-book-frontend` (see its own
`ANALYTICS.md`), not this backend.
