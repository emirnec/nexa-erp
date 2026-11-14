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
$dbName = "nexa_api_test_" + (Get-Date -Format "yyyyMMddHHmmss")
$apiPort = 5180
$base = "http://127.0.0.1:$apiPort"
$outLog = Join-Path $env:TEMP "nexa_api_test.out.log"
$errLog = Join-Path $env:TEMP "nexa_api_test.err.log"
$api = $null
$oldPassword = $env:PGPASSWORD

function Invoke-Status([string]$Method, [string]$Url, [object]$Body = $null, [hashtable]$Headers = @{}) {
    try {
        $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; UseBasicParsing = $true }
        if ($null -ne $Body) {
            $params.ContentType = "application/json"
            $params.Body = ($Body | ConvertTo-Json -Compress)
        }
        $response = Invoke-WebRequest @params
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Content = $response.Content }
    }
    catch {
        $status = 0
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        return [pscustomobject]@{ Status = $status; Content = "" }
    }
}

try {
    $env:PGPASSWORD = $values["Password"]
    & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname postgres --set ON_ERROR_STOP=1 `
        --command "CREATE DATABASE `"$dbName`";" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Test database creation failed." }
    & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname $dbName --set ON_ERROR_STOP=1 `
        --file $schemaPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Schema import failed." }

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
    $validateFile = Join-Path $env:TEMP "nexa_validate_constraints.sql"
    Set-Content -Path $validateFile -Value $validate -Encoding UTF8
    & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname $dbName --set ON_ERROR_STOP=1 `
        --file $validateFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Constraint validation failed." }

    $dbConnection = [regex]::Replace($connection, "(?i)(Database=)[^;]*", "`${1}$dbName")
    $oldEnv = @{
        ASPNETCORE_ENVIRONMENT = $env:ASPNETCORE_ENVIRONMENT
        ASPNETCORE_URLS = $env:ASPNETCORE_URLS
        ConnectionStrings__DefaultConnection = $env:ConnectionStrings__DefaultConnection
        Jwt__Secret = $env:Jwt__Secret
        SaaS__ProvisioningKey = $env:SaaS__ProvisioningKey
    }
    $env:ASPNETCORE_ENVIRONMENT = "Production"
    $env:ASPNETCORE_URLS = $base
    $env:ConnectionStrings__DefaultConnection = $dbConnection
    $env:Jwt__Secret = "test-only-" + ([guid]::NewGuid().ToString("N")) + ([guid]::NewGuid().ToString("N"))
    $env:SaaS__ProvisioningKey = "test-provisioning-key-" + ([guid]::NewGuid().ToString("N"))

    $dll = Join-Path $root "src/MotorcycleSales.Api/bin/Debug/net10.0/MotorcycleSales.Api.dll"
    if (-not (Test-Path $dll)) { throw "Build the API first: dotnet build src/MotorcycleSales.Api" }
    Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue
    $api = Start-Process -FilePath "dotnet" -ArgumentList @("exec", $dll) -WorkingDirectory $root `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        $health = Invoke-Status "GET" "$base/api/health"
        if ($health.Status -eq 200) { $ready = $true; break }
        if ($api.HasExited) { break }
    }
    if (-not $ready) {
        $err = if (Test-Path $errLog) { Get-Content $errLog -Tail 30 | Out-String } else { "" }
        throw "API did not become ready. $err"
    }

    $unauth = Invoke-Status "GET" "$base/api/motorcycles"
    if ($unauth.Status -ne 401) { throw "Expected 401 without a token, got $($unauth.Status)." }

    $provisionBody = @{
        tenantName = "Demo Motors"
        tenantSlug = "demo-motors"
        ownerUsername = "demo-admin"
        ownerPassword = "DemoPass!23456"
    }
    $provision = Invoke-Status "POST" "$base/api/platform/tenants/provision" $provisionBody @{ "X-Provisioning-Key" = $env:SaaS__ProvisioningKey }
    if ($provision.Status -ne 201) { throw "Provision failed with $($provision.Status)." }

    $loginBody = @{ username = "demo-admin"; password = "DemoPass!23456"; tenantSlug = "demo-motors" }
    $login = Invoke-Status "POST" "$base/api/auth/login" $loginBody
    if ($login.Status -ne 200) { throw "Login failed with $($login.Status)." }
    $token = ($login.Content | ConvertFrom-Json).token
    if ([string]::IsNullOrWhiteSpace($token)) { throw "Login response has no token." }

    $tenant = Invoke-Status "GET" "$base/api/tenant/current" $null @{ Authorization = "Bearer $token" }
    if ($tenant.Status -ne 200) { throw "Authenticated tenant request failed with $($tenant.Status)." }
    $catalog = Invoke-Status "GET" "$base/api/public/catalog?tenant=demo-motors"
    if ($catalog.Status -ne 200) { throw "Public catalog failed with $($catalog.Status)." }

    Write-Host "Clean-schema API test: OK"
    Write-Host "Health: 200; unauthenticated API: 401; provision: 201; login: 200; tenant: 200; public catalog: 200"
}
finally {
    if ($api -and -not $api.HasExited) {
        Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    if (Test-Path $outLog) { Remove-Item $outLog -Force -ErrorAction SilentlyContinue }
    if (Test-Path $errLog) { Remove-Item $errLog -Force -ErrorAction SilentlyContinue }
    if ($values.ContainsKey("Password")) {
        $env:PGPASSWORD = $values["Password"]
        & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname postgres --set ON_ERROR_STOP=1 `
            --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$dbName' AND pid <> pg_backend_pid();" | Out-Null
        & $psql --host $values["Host"] --port $port --username $values["Username"] --dbname postgres --set ON_ERROR_STOP=1 `
            --command "DROP DATABASE IF EXISTS `"$dbName`";" | Out-Null
    }
    $env:PGPASSWORD = $oldPassword
}
