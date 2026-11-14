# MotorcycleSalesAPP — SaaS ERP delivery plan

## Product direction

MotorcycleSalesAPP is being evolved into a multi-tenant motorcycle-dealer ERP. A tenant is one independent business/company. A dealer is a branch or sales location inside that tenant. Every business record belongs to exactly one tenant; tenant data is never shared between companies.

The existing .NET 10 API, React/Vite frontend and PostgreSQL database remain the foundation. This plan extends the existing application rather than replacing it.

## Architecture rules

1. Every tenant-owned entity has a required `TenantId`.
2. The signed access token carries the tenant id (`tid`). The API loads the active tenant and user on every authenticated request.
3. EF Core global query filters fail closed when no tenant context is set.
4. New/modified records are stamped with the current tenant; attempts to change `TenantId` or write for another tenant are rejected.
5. Composite tenant-aware foreign keys prevent records from referencing another tenant's customer, motorcycle, branch, account or sale.
6. Branches (`Dealers`) are not tenants. A tenant can own multiple branches, subject to its plan limit.
7. Public catalog requests resolve the tenant using a URL slug, e.g. `/catalog?tenant=bayhas-motors`.
8. Platform subscription/billing administration is separate from a tenant's ordinary `Admin` role.

## Delivery status in this package

### SaaS foundation — implemented in source; requires database upgrade

- Tenant table and tenant profile fields.
- Tenant slug and tenant-aware login.
- Tenant id embedded in access tokens.
- Tenant context loaded by authentication middleware.
- Fail-closed EF Core tenant filters and write stamping.
- Tenant-aware composite foreign-key model and SQL constraints.
- Existing records migrated to the `bayhas-motors` tenant without deleting them.
- Per-tenant username, dealer-code and account-code uniqueness.
- Initial trial/legacy plan metadata and user/branch quota checks.
- Tenant profile and package-information screen.
- Tenant-aware public catalog API.
- Existing catalog-management and operational-workflow screens connected to application navigation.
- Missing `MapOperations()` registration added.

### Existing operational areas retained

- Motorcycle inventory and image URL support.
- Sales, customer records and sales history.
- Stock movements and branch stock.
- Dealer and inter-branch transfer management.
- Payments, expenses, accounting entries, balance and profitability reports.
- Shared workflow records for calendar, service, parts, purchasing, trade-in, CRM, finance and automation.

The shared workflow screens are a usable record/task foundation, not a substitute for dedicated production workflows. The following work remains before those modules can be called complete.

## Remaining module implementation

### 1. Platform administration and subscriptions

- Platform operator role and protected platform console.
- Tenant provisioning, suspension, reactivation and plan assignment.
- Trial lifecycle, plan changes, invoice history and payment-provider integration.
- Plan feature flags and quotas (users, branches, storage, catalogue items, monthly transactions).
- Billing webhooks, failed-payment grace period and cancellation workflow.
- Tenant onboarding, email verification and invitation flow.

### 2. Inventory and catalogue

- Serialized motorcycle/vehicle stock by chassis/VIN and engine number.
- Multi-image uploads to managed object storage, not only external URLs.
- Color/variant and branch availability.
- Product comparison, favorites, customer lead capture and catalogue analytics.
- Price history, campaign rules, discount approval and reservation expiry.

### 3. CRM and sales

- Lead source, pipeline stages, assignments, follow-up SLA and interaction timeline.
- Quotes, quote revisions, approval and PDF output.
- Reservation/deposit lifecycle, invoice documents and delivery checklist.
- Trade-in valuation linked to the replacement sale.
- Sales commissions and staff performance.

### 4. Purchasing and suppliers

- Supplier master data, purchase requests and purchase orders.
- Goods receipt, invoice matching, supplier balances and returns.
- Landed cost and weighted-average cost rules.

### 5. Service and spare parts

- Service appointment and check-in form.
- Work orders, labor operations, technician assignment and status board.
- Parts catalogue, compatible models, bin/location stock and reservations.
- Warranty claims, maintenance schedules and service history.
- Customer approval, invoice and delivery handover.

### 6. Finance

- Customer/supplier current accounts and installment schedules.
- Cash/bank accounts, transfers, reconciliations and period closing.
- Tax/VAT handling, document numbering and export formats appropriate to local accounting rules.
- Receivables aging, payables aging, cash-flow and branch profitability.

### 7. Automation and communication

- Provider-backed WhatsApp Business and email integrations.
- Consent, templates, opt-out and delivery status.
- Durable job queue, retries, dead-letter handling and audit trail.
- Reminder rules for appointments, service intervals, reservations and overdue balances.
- AI assistant with tenant-scoped data access and human approval for business actions.

### 8. Security and operations

- Password reset, forced password rotation, optional TOTP 2FA and recovery codes.
- Session/device list, token version invalidation, login throttling and lockout.
- Fine-grained role/permission matrix beyond Admin/Staff/Dealer.
- Immutable audit history for sensitive changes.
- Scheduled encrypted backups, restore drills, retention policy and monitoring.
- Automated API, UI, tenant-isolation, concurrency and migration tests.

## Acceptance tests before production

- Create two tenants with the same username and same branch code; both should work independently.
- Tenant A cannot read, update, delete or reference Tenant B's customer, motorcycle, sale, branch, account or workflow id.
- A token for tenant A cannot be reused with tenant B's slug or id.
- Public catalog for tenant A returns only tenant A's published items.
- Missing tenant context returns no tenant-owned data and cannot write tenant-owned rows.
- User and branch quotas are enforced server-side.
- Existing Bayhas Motors sales, inventory, customers and accounting records remain present after migration.
- Full restore from a fresh backup succeeds in a clean test database.

## Current known verification limits

The frontend TypeScript project and ESLint checks are run during package preparation. The Vite native bundler and .NET SDK are platform-specific and must also be run on the target Windows development machine. PostgreSQL migration and cross-tenant integration tests must be run against a disposable test database before any production rollout. This package is a development milestone, not a declaration of production certification.

## Tenant provisioning endpoint in this milestone

A platform operator can provision an additional trial tenant through `POST /api/platform/tenants/provision`. It is deliberately protected by a separate secret rather than a tenant administrator token. Configure the secret outside source control, for example in local development:

```powershell
dotnet user-secrets set "SaaS:ProvisioningKey" "USE_A_LONG_RANDOM_SECRET_VALUE" --project .\src\MotorcycleSales.Api
```

For a hosted environment use the secret manager/environment variable `SaaS__ProvisioningKey`. Send the same value in the `X-Provisioning-Key` header. The endpoint creates the tenant and its first Admin user, starts a 14-day trial and initializes its chart of accounts. Do not expose this key to the browser or customer-facing frontend. Online self-registration and billing are intentionally not enabled yet.
