#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  echo "Example: sudo NEXA_HOST=203.0.113.10.sslip.io bash server-setup.sh" >&2
  exit 1
fi

NEXA_HOST="${NEXA_HOST:-}"
if [[ -z "$NEXA_HOST" ]]; then
  echo "NEXA_HOST is required (hostname only, no https://)." >&2
  echo "Example: sudo NEXA_HOST=203.0.113.10.sslip.io bash server-setup.sh" >&2
  exit 1
fi
if [[ ! "$NEXA_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "NEXA_HOST contains invalid characters." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for required in \
  "api/MotorcycleSales.Api" \
  "web/index.html" \
  "database/schema_current.sql" \
  "deploy/Caddyfile.template" \
  "deploy/nexa-api.service" \
  "deploy/backup-db.sh" \
  "deploy/nexa-backup.service" \
  "deploy/nexa-backup.timer"; do
  if [[ ! -e "$SCRIPT_DIR/$required" ]]; then
    echo "Missing deployment file: $required" >&2
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release openssl ufw

# PostgreSQL 18 (the schema dump was created with version 18).
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y postgresql-18
systemctl enable --now postgresql

# Caddy provides automatic HTTPS for the demo hostname.
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

if ! id -u nexa >/dev/null 2>&1; then
  useradd --system --home-dir /opt/nexa --create-home --shell /usr/sbin/nologin nexa
fi
install -d -o nexa -g nexa -m 750 /opt/nexa/api
install -d -o root -g root -m 755 /var/www/nexa
install -d -o root -g nexa -m 750 /etc/nexa

DB_PASS="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 64)"
PROVISIONING_KEY="$(openssl rand -hex 32)"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='nexa'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE nexa LOGIN PASSWORD '$DB_PASS';"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE nexa PASSWORD '$DB_PASS';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='nexa'" | grep -q 1; then
  sudo -u postgres createdb --owner=nexa nexa
fi

if ! PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U nexa -d nexa -tAc "SELECT to_regclass('public.\"Tenants\"')" | grep -q Tenants; then
  echo "Importing a clean NEXA schema..."
  PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U nexa -d nexa -v ON_ERROR_STOP=1 -1 \
    -f "$SCRIPT_DIR/database/schema_current.sql"
fi

# Tenant-aware foreign keys were exported as NOT VALID from the old database.
# On the new empty database they must be validated before the demo starts.
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U nexa -d nexa -v ON_ERROR_STOP=1 <<'SQL'
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
SQL

umask 077
cat > /etc/nexa/nexa.env <<EOF
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5000
ASPNETCORE_FORWARDEDHEADERS_ENABLED=true
ConnectionStrings__DefaultConnection=Host=127.0.0.1;Port=5432;Database=nexa;Username=nexa;Password=$DB_PASS
Jwt__Secret=$JWT_SECRET
SaaS__ProvisioningKey=$PROVISIONING_KEY
Cors__AllowedOrigins__0=https://$NEXA_HOST
AllowedHosts=$NEXA_HOST;127.0.0.1;localhost
Logging__LogLevel__Default=Information
Logging__LogLevel__Microsoft=Warning
EOF
chown root:nexa /etc/nexa/nexa.env
chmod 640 /etc/nexa/nexa.env
umask 022

rm -rf /opt/nexa/api/*
cp -a "$SCRIPT_DIR/api/." /opt/nexa/api/
chown -R nexa:nexa /opt/nexa/api
chmod +x /opt/nexa/api/MotorcycleSales.Api

rm -rf /var/www/nexa/*
cp -a "$SCRIPT_DIR/web/." /var/www/nexa/
find /var/www/nexa -type d -exec chmod 755 {} +
find /var/www/nexa -type f -exec chmod 644 {} +

install -m 644 "$SCRIPT_DIR/deploy/nexa-api.service" /etc/systemd/system/nexa-api.service

# Günlük PostgreSQL yedeği (30 gün saklama).
install -m 750 "$SCRIPT_DIR/deploy/backup-db.sh" /usr/local/bin/nexa-backup
install -m 644 "$SCRIPT_DIR/deploy/nexa-backup.service" /etc/systemd/system/nexa-backup.service
install -m 644 "$SCRIPT_DIR/deploy/nexa-backup.timer" /etc/systemd/system/nexa-backup.timer
install -d -o postgres -g postgres -m 750 /var/backups/nexa

systemctl daemon-reload
systemctl enable nexa-api
systemctl restart nexa-api
systemctl enable --now nexa-backup.timer

sed "s|__NEXA_HOST__|$NEXA_HOST|g" "$SCRIPT_DIR/deploy/Caddyfile.template" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

ready=0
for _ in $(seq 1 30); do
  if curl -fsS -H "Host: $NEXA_HOST" http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "API did not become healthy. Last log lines:" >&2
  journalctl -u nexa-api -n 80 --no-pager >&2 || true
  exit 1
fi

echo
echo "NEXA API is healthy on the server."
echo "Public URL: https://$NEXA_HOST"
echo "Provisioning key: /etc/nexa/nexa.env (root-only; never share it)."
echo
echo "Daily database backups: systemctl list-timers nexa-backup.timer"
echo "Next: provision the first demo tenant with the curl command in README-AWS.md,"
echo "then remove SaaS__ProvisioningKey from /etc/nexa/nexa.env and restart nexa-api."
