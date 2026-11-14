namespace MotorcycleSales.Api.Models;

public class Dealer : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? TaxNumber { get; set; }
    public string? Address { get; set; }
    public decimal CommissionPercent { get; set; }
    public decimal CreditLimit { get; set; }
    public bool IsHeadquarters { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class DealerStock : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public int MotorcycleId { get; set; }
    public Motorcycle? Motorcycle { get; set; }
    public int Quantity { get; set; }
}

public class StockTransfer : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int MotorcycleId { get; set; }
    public Motorcycle? Motorcycle { get; set; }
    public int FromDealerId { get; set; }
    public Dealer? FromDealer { get; set; }
    public int ToDealerId { get; set; }
    public Dealer? ToDealer { get; set; }
    public int Quantity { get; set; }
    public decimal UnitCost { get; set; }
    /// <summary>Consignment = stok yer değişir, mülkiyet merkezde kalır. Wholesale = bayiye toptan satış.</summary>
    public string TransferType { get; set; } = "Consignment";
    /// <summary>Draft, Shipped, Received, Cancelled</summary>
    public string Status { get; set; } = "Draft";
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ShippedAt { get; set; }
    public DateTime? ReceivedAt { get; set; }
}

public class Account : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    /// <summary>Asset, Liability, Equity, Income, Expense</summary>
    public string Type { get; set; } = "Asset";
    public bool IsSystem { get; set; } = true;
    public bool IsActive { get; set; } = true;
}

public class JournalEntry : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public DateTime EntryDate { get; set; } = DateTime.UtcNow;
    public string Description { get; set; } = string.Empty;
    public string Source { get; set; } = "Manual";
    public int? SourceId { get; set; }
    public bool IsReversed { get; set; }
    public int? ReversesEntryId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<JournalLine> Lines { get; set; } = [];
}

public class JournalLine : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int JournalEntryId { get; set; }
    public JournalEntry? JournalEntry { get; set; }
    public int AccountId { get; set; }
    public Account? Account { get; set; }
    public decimal Debit { get; set; }
    public decimal Credit { get; set; }
    public string? Memo { get; set; }
}

public class Payment : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public DateTime PaymentDate { get; set; } = DateTime.UtcNow;
    /// <summary>In = tahsilat, Out = tediye</summary>
    public string Direction { get; set; } = "In";
    /// <summary>Cash, Bank, Card</summary>
    public string Method { get; set; } = "Cash";
    public decimal Amount { get; set; }
    public int? SaleId { get; set; }
    public int? DealerId { get; set; }
    public int? CustomerId { get; set; }
    public string? Counterparty { get; set; }
    public string? Note { get; set; }
    public int? ServiceOrderId { get; set; }
    public string? IdempotencyKey { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
