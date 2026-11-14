namespace MotorcycleSales.Api.Models;

public class StockMovement : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int MotorcycleId { get; set; }
    public Motorcycle? Motorcycle { get; set; }
    public string MovementType { get; set; } = string.Empty; // PurchaseIn, ManualIn, ManualOut, SaleOut, SaleReturn
    public int Quantity { get; set; }
    public decimal UnitCost { get; set; }
    public string? Note { get; set; }
    public int? SaleId { get; set; }
    public int? DealerId { get; set; }
    public int? TransferId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
