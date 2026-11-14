# NEXA ERP — AWS Lightsail pilot

Bu paket, NEXA ERP'yi **tek bir Ubuntu sunucusunda** çalıştırır:

- React frontend: Caddy tarafından statik olarak sunulur.
- API: `systemd` altında yalnızca `127.0.0.1:5000` üzerinde çalışır.
- PostgreSQL 18: yalnızca sunucu içinden erişilir.
- HTTPS: Caddy + Let's Encrypt.
- Frontend `/api` çağrıları aynı alan adı üzerinden API'ye proxy'lenir; CORS sorunu oluşmaz.

> Bu bir **pilot/demo** kurulumudur. Ödeme, abonelik zorlaması, 2FA, login rate limit ve otomatik yedekleme yoktur. Gerçek müşteri verisi koymayın.

## 1. Lightsail sunucusu

AWS Console → Lightsail → **Create instance**:

- Region: size en yakın bölge (örn. Frankfurt)
- Platform: **Linux/Unix**
- Blueprint: **Ubuntu 24.04 LTS**
- Plan: **2 GB RAM, 1 vCPU** (demo için yeterli)
- Instance name: `nexa-demo`

Oluşturduktan sonra:

1. **Networking → Create static IP** ile statik IP oluştur ve instance'a bağla.
2. **Networking → IPv4 Firewall**:
   - SSH `22`: yalnızca kendi IP'niz
   - HTTP `80`: `0.0.0.0/0` (Let's Encrypt doğrulaması için)
   - HTTPS `443`: `0.0.0.0/0`

Statik IP'yi not al. Örnek: `203.0.113.10`.

## 2. Paketi Windows'ta üret

Proje kökünde PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\aws\publish.ps1
```

Çıktı:

```text
artifacts/nexa-aws.tar.gz
```

Script frontend'i `VITE_API_BASE=/api` ile derler, API'yi Linux x64 için self-contained yayınlar ve SHA256 üretir. `localhost:5172` kalırsa script hata verir.

## 3. Sunucuya yükle

Lightsail'de instance → **Connect → SSH** ile açılan tarayıcı terminalini kullanabilirsiniz. Dosya yüklemek için kendi bilgisayarınızdan:

```powershell
scp -i C:\path\to\LightsailDefaultKey.pem .\artifacts\nexa-aws.tar.gz ubuntu@203.0.113.10:/tmp/
```

SSH:

```powershell
ssh -i C:\path\to\LightsailDefaultKey.pem ubuntu@203.0.113.10
```

Sunucuda:

```bash
sudo rm -rf /tmp/nexa-deploy
sudo mkdir -p /tmp/nexa-deploy
sudo tar -xzf /tmp/nexa-aws.tar.gz -C /tmp/nexa-deploy
cd /tmp/nexa-deploy
```

## 4. Kurulumu çalıştır

Statik IP `203.0.113.10` ise ücretsiz `sslip.io` alan adı:

```text
203.0.113.10.sslip.io
```

Kurulum:

```bash
sudo env NEXA_HOST=203.0.113.10.sslip.io bash server-setup.sh
```

Kendi alan adınız varsa DNS'te A kaydını statik IP'ye yönlendirin ve `NEXA_HOST=erp.ornek.com` kullanın. `https://` yazmayın; yalnızca hostname.

Script şunları yapar:

- PostgreSQL 18 ve Caddy kurar.
- `nexa` veritabanını ve kullanıcısını oluşturur.
- Temiz şemayı yükler ve tenant foreign key'lerini doğrular.
- Rastgele DB parolası, JWT anahtarı ve provisioning anahtarı üretir.
- API'yi `systemd` servisi olarak başlatır.
- Caddy ile HTTPS'i etkinleştirir.
- UFW'de yalnızca SSH/80/443 açar.

Sırlar `/etc/nexa/nexa.env` içinde, yalnızca root tarafından okunabilir. Bu dosyayı sohbete, ekran görüntüsüne veya Git'e koymayın.

## 5. İlk demo tenant'ını oluştur

Sunucuda:

```bash
PROV_KEY="$(sudo awk -F= '/^SaaS__ProvisioningKey=/{print $2}' /etc/nexa/nexa.env)"

curl -fsS -X POST "https://203.0.113.10.sslip.io/api/platform/tenants/provision" \
  -H "Content-Type: application/json" \
  -H "X-Provisioning-Key: $PROV_KEY" \
  -d '{
    "tenantName": "Demo Motors",
    "tenantSlug": "demo-motors",
    "ownerUsername": "admin",
    "ownerPassword": "GucluBirDemoParolasi!2026",
    "contactEmail": "demo@example.com"
  }'
```

Başarılı yanıt `201` ve tenant bilgilerini döndürür.

> Parolayı demo için değiştirin. `Production` ortamında `/api/auth/bootstrap` kapalıdır; ilk kullanıcı bu provisioning endpoint'i ile oluşturulur.

## 6. Provisioning anahtarını kapat

Demo tenant oluşturulduktan sonra bu public endpoint'i kapatın:

```bash
sudo sed -i '/^SaaS__ProvisioningKey=/d' /etc/nexa/nexa.env
sudo systemctl restart nexa-api
```

Artık endpoint `503` döndürür. Yeni tenant gerektiğinde anahtarı geçici olarak geri ekleyip aynı işlemi yapabilirsiniz.

## 7. Giriş ve kontrol

Tarayıcı:

```text
https://203.0.113.10.sslip.io
```

- İşletme kısa adı: `demo-motors`
- Kullanıcı adı: `admin`
- Parola: provisioning sırasında belirlediğiniz parola

Kontroller:

```bash
curl -fsS https://203.0.113.10.sslip.io/api/health
sudo systemctl status nexa-api caddy postgresql
sudo journalctl -u nexa-api -n 50 --no-pager
sudo journalctl -u caddy -n 50 --no-pager
```

Public katalog:

```text
https://203.0.113.10.sslip.io/catalog?tenant=demo-motors
```

Katalogda yalnızca **yayınlanmış** ürünler görünür. Vitrinde ürün göstermek için Katalog Yönetimi'nden bir ürünü yayınlayın.

## 8. Demo verisi

Giriş yaptıktan sonra:

1. Envanter → 2–3 motosiklet ekleyin; alış maliyeti ve stok girin.
2. Müşteriler → bir müşteri ekleyin.
3. Satışlar → satış oluşturun; stok ve muhasebe kaydını gösterin.
4. Satışı iptal edin; stoğun geri geldiğini gösterin.
5. Katalog Yönetimi → ürünü yayınlayın; public katalog bağlantısını açın.
6. İşletme / Paket ekranında plan ve limitleri gösterin.

Gerçek müşteri adı/telefonu/e-postası kullanmayın.

## 9. Demo sonrası

- Lightsail instance'ı **Stop** edin.
- Statik IP'yi instance'a bağlı tutun; yeniden başlatınca IP değişmez.
- Instance'ı silmeden önce gerekliyse veritabanı yedeği alın.
- Provisioning anahtarının kapalı olduğunu doğrulayın.

## 10. Mevcut sunucuyu yeni sürüme güncelleme

Sunucuda eski NEXA sürümü zaten çalışıyorsa `server-setup.sh` dosyasını **tekrar çalıştırma** (DB parolası, JWT anahtarı ve provisioning anahtarı yeniden üretilir). Bunun yerine yeni paketi yükle ve yalnızca dosyaları + migration'ı güncelle.

**Windows'ta yeni paketi üret:**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\aws\publish.ps1
```

**Paketi sunucuya gönder:**

```powershell
scp -i C:\path\to\LightsailDefaultKey.pem .\artifacts\nexa-aws.tar.gz ubuntu@203.0.113.10:/tmp/
ssh -i C:\path\to\LightsailDefaultKey.pem ubuntu@203.0.113.10
```

**Sunucuda paketi aç ve yedek al:**

```bash
sudo rm -rf /tmp/nexa-deploy && sudo mkdir -p /tmp/nexa-deploy
sudo tar -xzf /tmp/nexa-aws.tar.gz -C /tmp/nexa-deploy

sudo mkdir -p /var/backups/nexa
sudo -u postgres pg_dump nexa | gzip | sudo tee "/var/backups/nexa/nexa-$(date +%F-%H%M).sql.gz" >/dev/null
```

**Veritabanı migration'ını uygula** (yalnızca bir kez; script tekrar çalıştırılabilir):

```bash
sudo -u postgres psql -d nexa -v ON_ERROR_STOP=1 \
  -f /tmp/nexa-deploy/database/upgrade_v5_sale_payments.sql
sudo -u postgres psql -d nexa -v ON_ERROR_STOP=1 \
  -f /tmp/nexa-deploy/database/upgrade_v6_extra_cost.sql
```

v5 adımı `Sales` tablosuna nakit/kart/taksit kolonlarını ekler, `SaleExtras` tablosunu oluşturur ve eski satışların ödeme alanlarını doldurur. v6 adımı `SaleExtras` tablosuna ek kalem maliyeti (`UnitCost`) ve satış tarih indeksini ekler. Veriler silinmez. Migration `postgres` kullanıcısıyla çalıştırılsa bile yeni tablonun sahipliğini otomatik olarak `Sales` tablosunun sahibine (uygulama kullanıcısı `nexa`) devreder.

> Daha eski bir paketteki migration'ı çalıştırdıysan ve API logunda `permission denied for table SaleExtras` görüyorsan şu iki komutu bir kez çalıştır:
>
> ```bash
> sudo -u postgres psql -d nexa -c 'ALTER TABLE "SaleExtras" OWNER TO nexa;'
> sudo -u postgres psql -d nexa -c 'ALTER SEQUENCE "SaleExtras_Id_seq" OWNER TO nexa;'
> ```

**API ve frontend dosyalarını değiştir:**

```bash
sudo systemctl stop nexa-api

sudo rm -rf /opt/nexa/api/*
sudo cp -a /tmp/nexa-deploy/api/. /opt/nexa/api/
sudo chown -R nexa:nexa /opt/nexa/api
sudo chmod +x /opt/nexa/api/MotorcycleSales.Api

sudo rm -rf /var/www/nexa/*
sudo cp -a /tmp/nexa-deploy/web/. /var/www/nexa/
sudo find /var/www/nexa -type d -exec chmod 755 {} +
sudo find /var/www/nexa -type f -exec chmod 644 {} +

sudo systemctl start nexa-api
```

`/etc/nexa/nexa.env` dosyasına **dokunma**; veritabanı parolası, JWT anahtarı ve alan adı ayarları orada korunur.

**Otomatik yedeklemeyi kur** (paketteki `deploy/` klasöründe):

```bash
sudo install -m 750 /tmp/nexa-deploy/deploy/backup-db.sh /usr/local/bin/nexa-backup
sudo install -m 644 /tmp/nexa-deploy/deploy/nexa-backup.service /etc/systemd/system/nexa-backup.service
sudo install -m 644 /tmp/nexa-deploy/deploy/nexa-backup.timer /etc/systemd/system/nexa-backup.timer
sudo install -d -o postgres -g postgres -m 750 /var/backups/nexa
sudo systemctl daemon-reload
sudo systemctl enable --now nexa-backup.timer
sudo systemctl start nexa-backup.service
systemctl list-timers nexa-backup.timer --no-pager
```

Yedekler `/var/backups/nexa/nexa-YYYYMMDDTHHMMSSZ.dump` olarak tutulur, 30 gün sonra silinir. Geri yükleme denemesi için boş bir test veritabanı kullan:

```bash
sudo -u postgres createdb nexa_restore_test
sudo -u postgres pg_restore --dbname=nexa_restore_test --no-owner /var/backups/nexa/nexa-EN-SON.dump
sudo -u postgres psql -d nexa_restore_test -c 'SELECT count(*) FROM "Sales";'
sudo -u postgres dropdb nexa_restore_test
```

**Kontrol:**

```bash
curl -fsS https://203.0.113.10.sslip.io/api/health
sudo systemctl status nexa-api --no-pager
sudo systemctl status nexa-backup.timer --no-pager
sudo journalctl -u nexa-api -n 50 --no-pager
```

Tarayıcıda Satışlar sayfasını yenile: nakit/kart/taksit alanları, satış tarihi, düzenle butonu ve ek ürün satırları görünmelidir. Tarayıcı eski JS dosyasını önbellekte tutuyorsa **Ctrl+F5** ile sert yenileme yap.

> İlk kez kurulum yapıyorsan bu bölümü atla; `server-setup.sh` paketteki `database/schema_current.sql` dosyasını yükler ve o dosya v5 değişikliklerini zaten içerir.

## Sorun giderme

**502 / API'ye ulaşılamıyor**

```bash
sudo systemctl status nexa-api
sudo journalctl -u nexa-api -n 100 --no-pager
```

**HTTPS sertifikası alınamıyor**

- `NEXA_HOST` doğru mu?
- Statik IP gerçekten instance'a bağlı mı?
- Lightsail firewall'da 80 ve 443 açık mı?
- `sslip.io` yerine kendi alan adınızı kullanıyorsanız A kaydı doğru mu?

```bash
sudo journalctl -u caddy -n 100 --no-pager
```

**Giriş çalışmıyor**

- İşletme kısa adı `demo-motors` mu?
- İlk kullanıcı provisioning ile oluşturuldu mu? (`Production` ortamında bootstrap kapalıdır.)
- API logunda hata var mı?

**Frontend açılıyor ama giriş isteği localhost'a gidiyor**

`publish.ps1` ile yeniden paketleyin. Frontend `VITE_API_BASE=/api` olmadan derlenmişse tarayıcı kendi bilgisayarındaki `localhost:5172` adresine bağlanmaya çalışır.

## Kapsam dışı

Bu pilotta online ödeme/abonelik sağlayıcısı, 2FA, e-posta/WhatsApp gönderimi, S3 görsel yükleme ve çoklu sunucu yük dengeleme yoktur. Giriş hız sınırı, deneme/abonelik süresi zorlaması, satış iptalinde tahsilat temizliği ve günlük otomatik yedekleme bu sürümde eklenmiştir. Abonelik satışına geçmeden önce ödeme sağlayıcısı ve e-posta akışı tamamlanmalıdır.
