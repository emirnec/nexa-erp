-- Eksik bayi kolonlarini mevcut verileri silmeden tamamlar.
-- MotorcycleSalesAPP veritabaninda bir kez veya guvenle tekrar calistirilabilir.

ALTER TABLE IF EXISTS "AppUsers"
    ADD COLUMN IF NOT EXISTS "DealerId" integer NULL;

ALTER TABLE IF EXISTS "Sales"
    ADD COLUMN IF NOT EXISTS "DealerId" integer NULL;

ALTER TABLE IF EXISTS "StockMovements"
    ADD COLUMN IF NOT EXISTS "DealerId" integer NULL;

ALTER TABLE IF EXISTS "StockMovements"
    ADD COLUMN IF NOT EXISTS "TransferId" integer NULL;

DO $$
BEGIN
    IF to_regclass('"Dealers"') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_AppUsers_Dealers_DealerId'
             AND conrelid = '"AppUsers"'::regclass
       ) THEN
        ALTER TABLE "AppUsers"
            ADD CONSTRAINT "FK_AppUsers_Dealers_DealerId"
            FOREIGN KEY ("DealerId") REFERENCES "Dealers"("Id")
            ON DELETE SET NULL;
    END IF;

    IF to_regclass('"Dealers"') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_Sales_Dealers_DealerId'
             AND conrelid = '"Sales"'::regclass
       ) THEN
        ALTER TABLE "Sales"
            ADD CONSTRAINT "FK_Sales_Dealers_DealerId"
            FOREIGN KEY ("DealerId") REFERENCES "Dealers"("Id")
            ON DELETE SET NULL;
    END IF;
END $$;

SELECT
    table_name,
    column_name
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name IN ('AppUsers', 'Sales', 'StockMovements')
  AND column_name IN ('DealerId', 'TransferId')
ORDER BY table_name, column_name;
