param([string]$Project = "src/MotorcycleSales.Api")

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
$oldPassword = $env:PGPASSWORD
$count = 0
try {
    $env:PGPASSWORD = $values["Password"]
    $names = & $psql -t -A --host $values["Host"] --port $port --username $values["Username"] --dbname postgres `
        --command "SELECT datname FROM pg_database WHERE datname LIKE 'nexa_api_test_%' OR datname LIKE 'nexa_schema_test_%';"
    foreach ($name in $names) {
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname postgres `
            --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$name' AND pid <> pg_backend_pid();" | Out-Null
        & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname postgres `
            --command "DROP DATABASE IF EXISTS `"$name`";" | Out-Null
        $count++
    }
    Write-Host "Temporary test databases removed: $count"
}
finally {
    $env:PGPASSWORD = $oldPassword
}
