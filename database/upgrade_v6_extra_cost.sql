-- v6: ek ürün/hizmet maliyeti ve satış tarih indeksi.
-- Mevcut verileri silmez; birden fazla kez çalıştırılabilir.
-- Uygulamadan önce veritabanı yedeği alın.

BEGIN;

ALTER TABLE IF EXISTS "SaleExtras"
    ADD COLUMN IF NOT EXISTS "UnitCost" numeric(18,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "IX_Sales_TenantId_SaleDate"
    ON "Sales" ("TenantId", "SaleDate");

COMMIT;
