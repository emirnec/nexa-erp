namespace MotorcycleSales.Api.Models;

/// <summary>Vadeli satışlarda müşteriye gösterilen taksit/vade planı.</summary>
public class SaleInstallment : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int SaleId { get; set; }
    public Sale? Sale { get; set; }
    public int Sequence { get; set; }
    public DateTime DueDate { get; set; }
    public decimal Amount { get; set; }
}

/// <summary>Servislerde kullanılan yedek parça stoğu.</summary>
public class Part : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int StockQuantity { get; set; }
    public decimal PurchaseCost { get; set; }
    public decimal SalePrice { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class PartStockMovement : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int PartId { get; set; }
    public Part? Part { get; set; }
    public string MovementType { get; set; } = "ManualIn";
    public int Quantity { get; set; }
    public decimal UnitCost { get; set; }
    public int? ServiceOrderId { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Servis kabulünden faturalamaya kadar takip edilen iş emri.</summary>
public class ServiceOrder : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public string OrderNo { get; set; } = string.Empty;
    public int? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public int? MotorcycleId { get; set; }
    public Motorcycle? Motorcycle { get; set; }
    /// <summary>Open, InProgress, Ready, Invoiced, Cancelled</summary>
    public string Status { get; set; } = "Open";
    public string? Complaint { get; set; }
    public string? Diagnosis { get; set; }
    public string? Notes { get; set; }
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DueDate { get; set; }
    public DateTime? InvoicedAt { get; set; }
    public string? InvoiceNo { get; set; }
    public decimal TotalLabor { get; set; }
    public decimal TotalParts { get; set; }
    public decimal Total { get; set; }
    public decimal PaidAmount { get; set; }
    /// <summary>Cash, Card, Credit</summary>
    public string PaymentMethod { get; set; } = "Cash";
    public List<ServiceOrderItem> Items { get; set; } = [];
}

public class ServiceOrderItem : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int ServiceOrderId { get; set; }
    public ServiceOrder? ServiceOrder { get; set; }
    /// <summary>Labor, Part</summary>
    public string Kind { get; set; } = "Labor";
    public string Description { get; set; } = string.Empty;
    public int Quantity { get; set; } = 1;
    public decimal UnitPrice { get; set; }
    public decimal UnitCost { get; set; }
    public int? PartId { get; set; }
    public Part? Part { get; set; }
}

public record PartRequest(string Code, string Name, int StockQuantity, decimal PurchaseCost, decimal SalePrice, bool IsActive = true);
public record PartStockRequest(int Quantity, decimal UnitCost, string? Note, string MovementType = "ManualIn");
public record ServiceOrderItemRequest(string Kind, string Description, int Quantity, decimal UnitPrice, decimal UnitCost, int? PartId);
public record ServiceOrderRequest(int? CustomerId, int? MotorcycleId, string? Complaint, string? Diagnosis, string? Notes, DateTime? DueDate, List<ServiceOrderItemRequest> Items);
public record ServiceInvoiceRequest(string PaymentMethod = "Cash");
