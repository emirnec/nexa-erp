# Build and validation status

Son doğrulama: 14 Kasım 2026, Windows geliştirme makinesi.

## Sonuçlar

| Kontrol | Komut | Sonuç |
|---|---|---|
| API derlemesi | `dotnet build src/MotorcycleSales.Api` | 0 hata, 0 uyarı |
| API entegrasyon testleri | `dotnet test tests/MotorcycleSales.Api.Tests` | 11/11 başarılı |
| Frontend tip kontrolü + bundle | `npm run build` (frontend) | Başarılı |
| Frontend lint | `npm run lint` (frontend) | 0 hata, 1 uyarı (`OperationalModules.tsx` exhaustive-deps) |
| v7 migration | `database/upgrade_v7_crm_service.sql` | `schema_current.sql` ve yerel test veritabanında doğrulandı (`SaleInstallments`, `Parts`, `ServiceOrders`, `AppUsers.TokenVersion`) |

Entegrasyon testleri gerçek PostgreSQL üzerinde geçici bir veritabanı oluşturur,
`database/schema_current.sql` şemasını yükler, testleri çalıştırır ve veritabanını siler.
Kapsanan senaryolar:

- `/api/health` veritabanı bağlantısını raporlar.
- Ek kalem maliyeti kâr raporuna ve muhasebe maliyetine yansır.
- Satış iptalinde stok geri gelir, bağlı tahsilatlar ve yevmiye ters kaydı temizlenir;
  iptal edilmiş satışa yeni tahsilat eklenemez.
- Eşzamanlı iki satış aynı stoktan fazla satamaz (xmin iyimser kilit).
- Aynı `Idempotency-Key` ile tekrarlanan satış ikinci kayıt oluşturmaz.
- Müşteri kredi limitini aşan vadeli satış reddedilir.
- Servis faturası parça stoğunu düşürür, muhasebe kaydı atar ve cari yaşlandırmada görünür.
- Parola değişimi, çıkış ve yönetici sıfırlaması eski token'ları geçersiz kılar.
- `Staff` rolü parça/servis/cari uçlarını okuyabilir; parça yönetimi yöneticide kalır.
- Bir tenant başka tenant'ın kaydını okuyamaz veya güncelleyemez.
- Deneme süresi dolan tenant iş verisine 402 ile engellenir; profil ve plan talebi çalışır.

## Kapsam dışı / sonraki adımlar

- Online ödeme sağlayıcısı, webhook ve otomatik abonelik yenileme.
- E-posta/WhatsApp gönderimi, 2FA, parola sıfırlama e-postası.
- S3/nesne depolama üzerinden görsel yükleme.
- Satın alma/sipariş, tedarikçi cari ve takas değerleme iş akışları.
- Servis randevu/teknisyen atama ve garanti süreçleri.
- PDF fatura/teklif ve Excel çıktısı.
- Çoklu sunucu yük dengeleme ve okuma replikaları.

## Sunucu dağıtımı

`deploy/aws/README-AWS.md` içindeki güncelleme adımlarını izle. Sırasıyla
`upgrade_v5_sale_payments.sql`, `upgrade_v6_extra_cost.sql` ve
`upgrade_v7_crm_service.sql` uygulanmalı, **ardından** API ve web dosyaları
değiştirilmelidir. v7 uygulanmadan yeni sürüm API başlatılırsa cari/servis uçları
şema hatası verir. Günlük yedekleme zamanlayıcısı
`nexa-backup.timer` olarak kurulur.
