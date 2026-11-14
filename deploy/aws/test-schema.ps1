param(
    [string]$Project = "src/MotorcycleSales.Api",
    [string]$Schema = "database/schema_current.sql"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$secretLines = & dotnet user-secrets list --project $Project 2>$null
$line = $secretLines | Where-Object { $_ -like "ConnectionStrings:DefaultConnection*" } | Select-Object -First 1
if (-not $line) { throw "ConnectionStrings:DefaultConnection is not configured." }
$connection = ($line -split "=", 2)[1].Trim()
$values = @{}
foreach ($part in $connection.Split(";")) {
    $pair = $part.Split("=", 2)
    if ($pair.Count -eq 2) { $values[$pair[0].Trim()] = $pair[1].Trim() }
}

$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
if (-not (Test-Path $psql)) { throw "psql.exe not found at $psql" }
$schemaPath = Join-Path $root $Schema
if (-not (Test-Path $schemaPath)) { throw "Schema file not found: $Schema" }

$dbName = "nexa_schema_test_" + (Get-Date -Format "yyyyMMddHHmmss")
$oldPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $values["Password"]
    & $psql --host $values["Host"] --port $(if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }) `
        --username $values["Username"] --dbname postgres --set ON_ERROR_STOP=1 `
        --command "CREATE DATABASE `"$dbName`";" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Test database creation failed." }

    & $psql --host $values["Host"] --port $(if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }) `
        --username $values["Username"] --dbname $dbName --set ON_ERROR_STOP=1 `
        --file $schemaPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Schema import failed." }

    $validate = @'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname
           FROM pg_constraint
           WHERE contype = 'f' AND NOT convalidated
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;
'@
    $validateFile = Join-Path $env:TEMP "nexa_validate_constraints.sql"
    Set-Content -Path $validateFile -Value $validate -Encoding UTF8
    & $psql --host $values["Host"] --port $(if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }) `
        --username $values["Username"] --dbname $dbName --set ON_ERROR_STOP=1 `
        --file $validateFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Constraint validation failed." }

    $tables = (& $psql -t -A --host $values["Host"] --port $(if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }) `
        --username $values["Username"] --dbname $dbName `
        --command "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';").Trim()
    $invalid = (& $psql -t -A --host $values["Host"] --port $(if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }) `
        --username $values["Username"] --dbname $dbName `
        --command "SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated;").Trim()
    Write-Host "Clean schema import: OK"
    Write-Host "Public tables: $tables; unvalidated foreign keys: $invalid"
}
finally {
    $env:PGPASSWORD = $oldPassword
    if ($values.ContainsKey("Password")) {
        $env:PGPASSWORD = $values["Password"]
        & $psql --host $values["Host"] --port $(if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }) `
            --username $values["Username"] --dbname postgres --set ON_ERROR_STOP=1 `
            --command "DROP DATABASE IF EXISTS `"$dbName`";" | Out-Null
        $env:PGPASSWORD = $oldPassword
    }
}
