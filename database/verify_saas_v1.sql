-- Run after upgrade_saas_v1.sql to verify tenant assignment and basic row counts.
SELECT "Id", "Name", "Slug", "PlanKey", "SubscriptionStatus", "MaxUsers", "MaxBranches"
FROM "Tenants"
ORDER BY "Id";

SELECT 'AppUsers' AS "Table", count(*) AS "Rows", count(*) FILTER (WHERE "TenantId" IS NULL) AS "MissingTenantId" FROM "AppUsers"
UNION ALL SELECT 'Motorcycles', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "Motorcycles"
UNION ALL SELECT 'Sales', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "Sales"
UNION ALL SELECT 'Customers', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "Customers"
UNION ALL SELECT 'StockMovements', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "StockMovements"
UNION ALL SELECT 'Expenses', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "Expenses"
UNION ALL SELECT 'Dealers', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "Dealers"
UNION ALL SELECT 'DealerStocks', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "DealerStocks"
UNION ALL SELECT 'StockTransfers', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "StockTransfers"
UNION ALL SELECT 'Accounts', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "Accounts"
UNION ALL SELECT 'JournalEntries', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "JournalEntries"
UNION ALL SELECT 'JournalLines', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "JournalLines"
UNION ALL SELECT 'Payments', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "Payments"
UNION ALL SELECT 'WorkflowRecords', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "WorkflowRecords"
UNION ALL SELECT 'CatalogListings', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "CatalogListings"
UNION ALL SELECT 'AuditLogs', count(*), count(*) FILTER (WHERE "TenantId" IS NULL) FROM "AuditLogs"
ORDER BY "Table";
