param(
    [string]$Project = "src/MotorcycleSales.Api",
    [string]$Output = "database/schema_current.sql"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$secretLines = & dotnet user-secrets list --project $Project 2>$null
if ($LASTEXITCODE -ne 0) { throw "User secrets could not be read." }

$line = $secretLines | Where-Object { $_ -like "ConnectionStrings:DefaultConnection*" } | Select-Object -First 1
if (-not $line) { throw "ConnectionStrings:DefaultConnection is not configured." }

$connection = ($line -split "=", 2)[1].Trim()
$values = @{}
foreach ($part in $connection.Split(";")) {
    $pair = $part.Split("=", 2)
    if ($pair.Count -eq 2) { $values[$pair[0].Trim()] = $pair[1].Trim() }
}

foreach ($key in @("Host", "Database", "Username", "Password")) {
    if (-not $values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($values[$key])) {
        throw "Connection string is missing $key."
    }
}

$port = if ($values.ContainsKey("Port")) { $values["Port"] } else { "5432" }
$pgDump = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
if (-not (Test-Path $pgDump)) { throw "pg_dump.exe not found at $pgDump" }

$outputPath = Join-Path $root $Output
$outputDir = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$oldPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $values["Password"]
    & $pgDump `
        --host $values["Host"] `
        --port $port `
        --username $values["Username"] `
        --dbname $values["Database"] `
        --schema-only `
        --no-owner `
        --no-privileges `
        --file $outputPath
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE." }
}
finally {
    $env:PGPASSWORD = $oldPassword
}

$tables = (Select-String -Path $outputPath -Pattern '^CREATE TABLE ').Count
$sequences = (Select-String -Path $outputPath -Pattern '^CREATE SEQUENCE ').Count
$foreignKeys = (Select-String -Path $outputPath -Pattern '^ALTER TABLE .* ADD CONSTRAINT .* FOREIGN KEY').Count
$notValid = (Select-String -Path $outputPath -Pattern 'NOT VALID').Count
Write-Host "Schema exported: $Output"
Write-Host "Tables: $tables; sequences: $sequences; foreign keys: $foreignKeys; NOT VALID lines: $notValid"
