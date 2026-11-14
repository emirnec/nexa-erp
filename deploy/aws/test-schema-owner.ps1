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
$port = if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$schemaPath = Join-Path $root $Schema
$role = "nexa_owner_test"
$dbName = "nexa_owner_test_db"
$rolePassword = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
$oldPassword = $env:PGPASSWORD

function Invoke-Psql([string]$Db, [string]$Sql) {
    & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname $Db --set ON_ERROR_STOP=1 --command $Sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "psql command failed." }
}

try {
    $env:PGPASSWORD = $values["Password"]
    Invoke-Psql "postgres" "DROP DATABASE IF EXISTS `"$dbName`";"
    Invoke-Psql "postgres" "DROP ROLE IF EXISTS `"$role`";"
    Invoke-Psql "postgres" "CREATE ROLE `"$role`" LOGIN PASSWORD '$rolePassword';"
    Invoke-Psql "postgres" "CREATE DATABASE `"$dbName`" OWNER `"$role`";"

    $env:PGPASSWORD = $rolePassword
    & $psql --host $values["Host"] --port $port --username $role --dbname $dbName --set ON_ERROR_STOP=1 -1 --file $schemaPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Schema import as database owner failed." }

    $validate = @'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
           WHERE contype = 'f' AND NOT convalidated
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;
'@
    $validateFile = Join-Path $env:TEMP "nexa_validate_owner.sql"
    Set-Content -Path $validateFile -Value $validate -Encoding UTF8
    & $psql --host $values["Host"] --port $port --username $role --dbname $dbName --set ON_ERROR_STOP=1 --file $validateFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Constraint validation as database owner failed." }

    $tables = (& $psql -t -A --host $values["Host"] --port $port --username $role --dbname $dbName `
        --command "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';").Trim()
    Write-Host "Non-superuser schema import: OK"
    Write-Host "Public tables: $tables"
}
finally {
    $env:PGPASSWORD = $values["Password"]
    Invoke-Psql "postgres" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$dbName' AND pid <> pg_backend_pid();"
    Invoke-Psql "postgres" "DROP DATABASE IF EXISTS `"$dbName`";"
    Invoke-Psql "postgres" "DROP ROLE IF EXISTS `"$role`";"
    $env:PGPASSWORD = $oldPassword
}
