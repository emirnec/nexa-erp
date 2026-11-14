param(
    [string]$Output = "artifacts/nexa-aws"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$outputPath = Join-Path $root $Output
$archiveRel = ("$Output.tar.gz" -replace '\\', '/')
$sourceRel = ($Output -replace '\\', '/')
$archivePath = Join-Path $root $archiveRel
$zipPath = "$outputPath.zip"
if (Test-Path $outputPath) { Remove-Item $outputPath -Recurse -Force }
if (Test-Path $archivePath) { Remove-Item $archivePath -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) { throw "npm bulunamadı." }

Write-Host "Frontend derleniyor (VITE_API_BASE=/api)..."
$oldApiBase = $env:VITE_API_BASE
try {
    $env:VITE_API_BASE = "/api"
    Push-Location (Join-Path $root "frontend")
    try {
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend derlemesi başarısız." }
    }
    finally {
        Pop-Location
    }
}
finally {
    $env:VITE_API_BASE = $oldApiBase
}

$webOut = Join-Path $outputPath "web"
New-Item -ItemType Directory -Force -Path $webOut | Out-Null
Copy-Item -Path (Join-Path $root "frontend/dist/*") -Destination $webOut -Recurse -Force

$jsFiles = Get-ChildItem -Path (Join-Path $webOut "assets") -Filter "*.js" -ErrorAction SilentlyContinue
if ($jsFiles) {
    $bad = Select-String -Path $jsFiles.FullName -Pattern "localhost:5172" -SimpleMatch -ErrorAction SilentlyContinue
    if ($bad) { throw "Frontend hâlâ localhost:5172 API adresini içeriyor." }
}

Write-Host "API Linux x64 için yayınlanıyor..."
$apiProject = Join-Path $root "src/MotorcycleSales.Api"
$apiOut = Join-Path $outputPath "api"
& dotnet publish $apiProject -c Release -r linux-x64 --self-contained true `
    -p:DebugType=None -p:DebugSymbols=false -o $apiOut --nologo
if ($LASTEXITCODE -ne 0) { throw "API yayını başarısız." }

$exe = Join-Path $apiOut "MotorcycleSales.Api"
if (-not (Test-Path $exe)) { throw "Linux API çalıştırılabilir dosyası bulunamadı." }

$dbOut = Join-Path $outputPath "database"
New-Item -ItemType Directory -Force -Path $dbOut | Out-Null
Copy-Item (Join-Path $root "database/schema_current.sql") $dbOut -Force
# Mevcut bir sunucuyu güncellerken gereken artımlı migration'lar da pakete girer.
Copy-Item (Join-Path $root "database/upgrade_*.sql") $dbOut -Force
Copy-Item (Join-Path $root "deploy/aws/server-setup.sh") $outputPath -Force
New-Item -ItemType Directory -Force -Path (Join-Path $outputPath "deploy") | Out-Null
Copy-Item (Join-Path $root "deploy/aws/Caddyfile.template") (Join-Path $outputPath "deploy") -Force
Copy-Item (Join-Path $root "deploy/aws/nexa-api.service") (Join-Path $outputPath "deploy") -Force
Copy-Item (Join-Path $root "deploy/aws/nexa.env.example") (Join-Path $outputPath "deploy") -Force
Copy-Item (Join-Path $root "deploy/aws/backup-db.sh") (Join-Path $outputPath "deploy") -Force
Copy-Item (Join-Path $root "deploy/aws/nexa-backup.service") (Join-Path $outputPath "deploy") -Force
Copy-Item (Join-Path $root "deploy/aws/nexa-backup.timer") (Join-Path $outputPath "deploy") -Force
Copy-Item (Join-Path $root "deploy/aws/README-AWS.md") $outputPath -Force

@"
NEXA ERP AWS deployment
Built: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss K")
Frontend API base: /api
API target: linux-x64, self-contained
"@ | Set-Content -Path (Join-Path $outputPath "build-info.txt") -Encoding UTF8

Write-Host "Paket sıkıştırılıyor (POSIX yolları ile tar.gz)..."
& tar.exe -czf $archiveRel -C $sourceRel .
if ($LASTEXITCODE -ne 0) { throw "tar.gz paketleme başarısız." }
$hash = (Get-FileHash $archivePath -Algorithm SHA256).Hash
$sizeMb = [math]::Round((Get-Item $archivePath).Length / 1MB, 1)
Write-Host "Hazır: $archivePath"
Write-Host "Boyut: $sizeMb MB"
Write-Host "SHA256: $hash"
