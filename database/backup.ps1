$ErrorActionPreference = "Stop"
$backupDir = Join-Path (Get-Location) "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$file = Join-Path $backupDir "MotorcycleSalesAPP_$stamp.backup"
$pgDump = "pg_dump"
$knownPath = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
if (Test-Path $knownPath) { $pgDump = $knownPath }
Write-Host "PostgreSQL yedeklemesi başlıyor. Parola istenirse PostgreSQL parolanı gir."
& $pgDump -h localhost -p 5432 -U postgres -d MotorcycleSalesAPP -F c -f $file
if ($LASTEXITCODE -ne 0) { throw "pg_dump başarısız oldu. PostgreSQL 18 bin klasörünü kontrol et." }
Write-Host "Yedek oluşturuldu: $file"
