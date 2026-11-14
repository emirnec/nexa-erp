# Build and validation status

Son doğrulama: 14 Kasım 2026, Windows geliştirme makinesi.

## Sonuçlar

| Kontrol | Komut | Sonuç |
|---|---|---|
| API derlemesi | `dotnet build src/MotorcycleSales.Api` | 0 hata, 0 uyarı |
| API entegrasyon testleri | `dotnet test tests/MotorcycleSales.Api.Tests` | 4/4 başarılı |
| Frontend tip kontrolü + bundle | `npm run build` (frontend) | Başarılı |
| Frontend lint | `npm run lint` (frontend) | 0 hata, 1 uyarı (`OperationalModules.tsx` exhaustive-deps) |
| v6 migration | `database/upgrade_v6_extra_cost.sql` | Yerel veritabanına uygulandı, `SaleExtras.UnitCost` doğrulandı |

Entegrasyon testleri gerçek PostgreSQL üzerinde geçici bir veritabanı oluşturur,
`database/schema_current.sql` şemasını yükler, testleri çalıştırır ve veritabanını siler.
Kapsanan senaryolar:

- `/api/health` veritabanı bağlantısını raporlar.
- Ek kalem maliyeti kâr raporuna ve muhasebe maliyetine yansır.
- Satış iptalinde stok geri gelir, bağlı tahsilatlar ve yevmiye ters kaydı temizlenir;
  iptal edilmiş satışa yeni tahsilat eklenemez.
- Bir tenant başka tenant'ın kaydını okuyamaz veya güncelleyemez.
- Deneme süresi dolan tenant iş verisine 402 ile engellenir; profil ve plan talebi çalışır.

## Kapsam dışı / sonraki adımlar

- Online ödeme sağlayıcısı, webhook ve otomatik abonelik yenileme.
- E-posta/WhatsApp gönderimi, 2FA, parola sıfırlama e-postası.
- S3/nesne depolama üzerinden görsel yükleme.
- Servis iş emri, yedek parça, satın alma ve cari/taksit modüllerinin özel iş akışları.
- PDF fatura/teklif ve Excel çıktısı.
- Çoklu sunucu yük dengeleme ve okuma replikaları.

## Sunucu dağıtımı

`deploy/aws/README-AWS.md` içindeki güncelleme adımlarını izle. Sırasıyla
`upgrade_v5_sale_payments.sql` ve `upgrade_v6_extra_cost.sql` uygulanmalı, ardından
API ve web dosyaları değiştirilmelidir. Günlük yedekleme zamanlayıcısı
`nexa-backup.timer` olarak kurulur.
