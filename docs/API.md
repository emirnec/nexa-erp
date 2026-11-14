# API quick reference

Base URL: `http://localhost:5172`. All routes except health, bootstrap and login require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/bootstrap` | Create the first Admin (only when no users exist) |
| POST | `/api/auth/login` | Login and receive an 8-hour token |
| GET | `/api/auth/me` | Current token identity |
| GET/POST/PATCH | `/api/users` | Admin-only user list/create and active-state changes |
| GET/POST/PUT/DELETE | `/api/motorcycles` | Inventory CRUD |
| GET/POST/PUT | `/api/customers` | Customer cards |
| GET | `/api/customers/{id}/sales` | Customer sales history |
| GET/POST | `/api/stock-movements` | Stock ledger and stock adjustment |
| GET/POST | `/api/sales` | Sales history and new sale (cash/card split, installments, extras with unit cost, sale date) |
| PUT | `/api/sales/{id}` | Edit a sale and re-post stock/accounting consistently |
| POST | `/api/sales/{id}/cancel` | Cancel sale, return stock and reverse/remove linked payments |
| POST | `/api/sales/{id}/complete` | Invoice a reservation |
| GET/POST | `/api/payments` | Collections/payments; cancelled sales reject new payments |
| GET/POST/DELETE | `/api/expenses` | Expense management |
| GET | `/api/reports/profit?from=YYYY-MM-DD&to=YYYY-MM-DD` | Revenue, cost of goods (including extras cost), gross/net profit |
| GET | `/api/tenant/current` | Tenant profile, plan and subscription dates |
| POST | `/api/tenant/plan-request` | Admin plan-change request (works while subscription is blocked) |
| GET | `/api/health` | Public health check; reports database availability and returns 503 when the database is unreachable |

Stock movement types: `OpeningStock`, `OpeningBalance`, `PurchaseIn`, `ManualIn`, `ManualOut`, `SaleOut`, `SaleReturn`.

Roles: `Admin` can manage users; `Staff` can use operational modules. Disabled accounts are rejected on every protected API request. Passwords are PBKDF2-SHA256 hashes, never stored as plain text.

Subscription enforcement: when a trial or subscription is more than 3 days past its end date, or the tenant is suspended/cancelled, business endpoints return `402 Payment Required` with `{ code: "subscription_required" }`. Login, `/api/auth/me`, tenant profile, user/branch reads and plan requests stay available. Login is rate-limited to 10 attempts per minute per IP and returns `429` when exceeded.

Report date filters are interpreted in the tenant's configured time zone (`SaaS:TimeZone`, default `Europe/Istanbul`) before converting to UTC.
