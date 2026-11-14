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
| GET | `/api/customers/{id}/account` | Current account: limit, available credit, sales, service orders, payments |
| GET | `/api/reports/receivables-aging` | Receivables aging buckets and per-customer rows |
| GET/POST | `/api/stock-movements` | Stock ledger and stock adjustment |
| GET/POST | `/api/sales` | Sales history and new sale (cash/card split, installments, due date, credit limit, extras with unit cost, sale date) |
| PUT | `/api/sales/{id}` | Edit a sale and re-post stock/accounting consistently |
| POST | `/api/sales/{id}/cancel` | Cancel sale, return stock and reverse/remove linked payments |
| POST | `/api/sales/{id}/complete` | Invoice a reservation |
| GET/POST | `/api/payments` | Collections/payments; cancelled sales and overpayments reject new payments; service order collections supported |
| GET/POST | `/api/parts` | Parts catalogue (POST Admin-only) |
| PUT | `/api/parts/{id}` | Update part price/active state (Admin-only) |
| POST | `/api/parts/{id}/stock` | Manual part stock in/out (Admin-only) |
| GET | `/api/part-stock-movements` | Part stock ledger |
| GET/POST | `/api/service-orders` | Service work order list and create |
| GET/PUT | `/api/service-orders/{id}` | Service work order detail/update |
| POST | `/api/service-orders/{id}/start` | Open → In progress |
| POST | `/api/service-orders/{id}/ready` | In progress → Ready |
| POST | `/api/service-orders/{id}/cancel` | Cancel a non-invoiced order (Admin-only) |
| POST | `/api/service-orders/{id}/invoice` | Invoice a ready order (`Cash`, `Card` or `Credit`); deducts part stock and posts accounting |
| GET/POST/DELETE | `/api/expenses` | Expense management |
| GET | `/api/reports/profit?from=YYYY-MM-DD&to=YYYY-MM-DD` | Revenue, cost of goods (including extras cost), gross/net profit |
| GET | `/api/tenant/current` | Tenant profile, plan and subscription dates |
| POST | `/api/tenant/plan-request` | Admin plan-change request (works while subscription is blocked) |
| GET | `/api/health` | Public health check; reports database availability and returns 503 when the database is unreachable |

Stock movement types: `OpeningStock`, `OpeningBalance`, `PurchaseIn`, `ManualIn`, `ManualOut`, `SaleOut`, `SaleReturn`.

Part movement types: `OpeningStock`, `PurchaseIn`, `ManualIn`, `ManualOut`, `ServiceOut`.

### Idempotent writes

`POST /api/sales` and `POST /api/payments` accept an optional `Idempotency-Key` header (maximum 100 characters). Repeating the same key returns the previously created record instead of creating a duplicate. Keys are scoped per tenant.

### Credit limit and installments

`Customers.CreditLimit = 0` means unlimited. When a limit is set, the API locks the customer row inside the transaction and rejects a new due amount if open sales plus invoiced service orders would exceed the limit. Due sales generate `SaleInstallments`; payments are allocated oldest-due first. Invoiced credit service orders also count against the same limit.

### Session security

Tokens carry a `ver` claim matched against `AppUsers.TokenVersion`. Logout (`POST /api/auth/logout`), password change/reset and user deactivation increment the version and invalidate older tokens. Five failed logins lock the account for 15 minutes.

Roles: `Admin` can manage users, parts and service cancellations; `Staff` can use operational modules including sales, receivables, service work orders and parts reads. Disabled accounts are rejected on every protected API request. Passwords are PBKDF2-SHA256 hashes, never stored as plain text.

Subscription enforcement: when a trial or subscription is more than 3 days past its end date, or the tenant is suspended/cancelled, business endpoints return `402 Payment Required` with `{ code: "subscription_required" }`. Login, `/api/auth/me`, tenant profile, user/branch reads and plan requests stay available. Login is rate-limited to 10 attempts per minute per IP and returns `429` when exceeded.

Report date filters are interpreted in the tenant's configured time zone (`SaaS:TimeZone`, default `Europe/Istanbul`) before converting to UTC.
