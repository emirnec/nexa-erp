using System.Text.Json.Serialization;

namespace MotorcycleSales.Api.Models;

public class Sale : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }

    public int MotorcycleId { get; set; }

    public int? CustomerId { get; set; }

    public decimal UnitCostAtSale { get; set; }

    public Motorcycle? Motorcycle { get; set; }

    public string CustomerName { get; set; } = string.Empty;

    public string? CustomerPhone { get; set; }

    public int Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    /// <summary>Satılan aksesuar/hizmet kalemlerinin toplamı (motosiklet hariç).</summary>
    public decimal ExtrasTotal { get; set; }

    public List<SaleExtra> Extras { get; set; } = [];

    public decimal TotalPrice => Quantity * UnitPrice + ExtrasTotal;

    public DateTime SaleDate { get; set; } = DateTime.UtcNow;

    public bool IsCancelled { get; set; } = false;

    public DateTime? CancelledAt { get; set; }

    public int? DealerId { get; set; }

    /// <summary>Reserved, Invoiced, Delivered, Cancelled</summary>
    public string Status { get; set; } = "Delivered";

    /// <summary>Retail, DealerRetail, Wholesale</summary>
    public string Channel { get; set; } = "Retail";

    /// <summary>Cash, Bank, Card, Credit, Mixed</summary>
    public string PaymentMethod { get; set; } = "Cash";

    /// <summary>Peşin/nakit tahsil edilen kısım.</summary>
    public decimal CashAmount { get; set; }

    /// <summary>Kredi/banka kartıyla tahsil edilen kısım.</summary>
    public decimal CardAmount { get; set; }

    /// <summary>Kart tutarının bölündüğü taksit sayısı (0 = kart kullanılmadı).</summary>
    public int CardInstallments { get; set; }

    public decimal PaidAmount { get; set; }

    public string? InvoiceNo { get; set; }

    /// <summary>Vadeli satışta ilk taksitin vadesi.</summary>
    public DateTime? DueDate { get; set; }

    /// <summary>Vadeli satışta taksit sayısı (0 = tek vadeli bakiye).</summary>
    public int InstallmentCount { get; set; }

    /// <summary>İstemci retry'larında aynı satışın iki kez oluşmasını önler.</summary>
    public string? IdempotencyKey { get; set; }

    public List<SaleInstallment> Installments { get; set; } = [];
}

/// <summary>Satışla birlikte verilen aksesuar, yükseltme veya hizmet kalemi.</summary>
public class SaleExtra : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int SaleId { get; set; }
    [JsonIgnore]
    public Sale? Sale { get; set; }

    /// <summary>Product, Service</summary>
    public string Kind { get; set; } = "Product";

    public string Description { get; set; } = string.Empty;

    public int Quantity { get; set; } = 1;

    public decimal UnitPrice { get; set; }

    /// <summary>Bu ek kalemin işletmeye birim maliyeti (kâr hesabı için).</summary>
    public decimal UnitCost { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
