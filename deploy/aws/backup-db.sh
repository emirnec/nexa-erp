#!/usr/bin/env bash
# NEXA PostgreSQL günlük yedeği. systemd timer ile root olarak çalışır.
# Elle: sudo /usr/local/bin/nexa-backup
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

BACKUP_DIR="${NEXA_BACKUP_DIR:-/var/backups/nexa}"
DB_NAME="${NEXA_DB_NAME:-nexa}"
RETENTION_DAYS="${NEXA_BACKUP_RETENTION_DAYS:-30}"

install -d -o postgres -g postgres -m 750 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/nexa-$stamp.dump"

# Özel format: pg_restore ile seçmeli geri yükleme ve doğrulama yapılabilir.
sudo -u postgres pg_dump --format=custom --no-owner --dbname="$DB_NAME" > "$file"
sudo -u postgres pg_restore --list "$file" > /dev/null
sha256sum "$file" > "$file.sha256"
chown postgres:postgres "$file" "$file.sha256"
chmod 640 "$file" "$file.sha256"

# Saklama süresini aşan yedekleri (ve özetlerini) temizle.
find "$BACKUP_DIR" -type f \( -name 'nexa-*.dump' -o -name 'nexa-*.dump.sha256' \) -mtime "+$RETENTION_DAYS" -delete

echo "Backup complete: $file ($(du -h "$file" | cut -f1))"
