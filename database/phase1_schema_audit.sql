-- MotorcycleSalesAPP - AŞAMA 1 ŞEMA DENETİMİ
-- YALNIZCA OKUMA yapar. CREATE / ALTER / DROP / INSERT / UPDATE / DELETE içermez.
-- pgAdmin > MotorcycleSalesAPP > Tools > Query Tool içinde tamamını çalıştır.

-- 1) Veritabanı ve PostgreSQL sürümü
SELECT current_database() AS database_name,
       current_user AS connected_user,
       version() AS postgresql_version;

-- 2) Uygulamanın beklediği ana tabloların varlığı
WITH expected(table_name) AS (
    VALUES ('AppUsers'), ('Motorcycles'), ('Customers'), ('Sales'),
           ('StockMovements'), ('Expenses'), ('Dealers'), ('DealerStocks'),
           ('StockTransfers'), ('Accounts'), ('JournalEntries'),
           ('JournalLines'), ('Payments'), ('__EFMigrationsHistory')
)
SELECT e.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = e.table_name
ORDER BY e.table_name;

-- 3) İlgili tablolardaki gerçek kolonlar ve veri tipleri
SELECT table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'AppUsers', 'Motorcycles', 'Customers', 'Sales', 'StockMovements',
      'Expenses', 'Dealers', 'DealerStocks', 'StockTransfers', 'Accounts',
      'JournalEntries', 'JournalLines', 'Payments', '__EFMigrationsHistory'
  )
ORDER BY table_name, ordinal_position;

-- 4) Foreign key ilişkileri
SELECT tc.table_name,
       kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name,
       rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.constraint_schema = kcu.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.constraint_schema = tc.constraint_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- 5) EF Core tarafından kaydedilmiş migration geçmişi
SELECT *
FROM public."__EFMigrationsHistory"
ORDER BY "MigrationId";

-- 6) Tablo başına yaklaşık satır sayısı (hızlı, yaklaşık istatistik)
SELECT relname AS table_name, n_live_tup AS estimated_rows
FROM pg_stat_user_tables
ORDER BY relname;

-- 7) Bayi / lokasyon verisi (varsa)
SELECT "Id", "Code", "Name", "IsHeadquarters", "IsActive"
FROM public."Dealers"
ORDER BY "Id";
