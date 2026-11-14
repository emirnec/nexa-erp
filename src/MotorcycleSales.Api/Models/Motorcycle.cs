
namespace MotorcycleSales.Api.Models;

public class Motorcycle : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }

    public string Brand { get; set; } = string.Empty;

    public string Model { get; set; } = string.Empty;

    public int EngineCapacityCc { get; set; }

    public decimal Price { get; set; }

    public decimal PurchaseCost { get; set; }

    public string Color { get; set; } = string.Empty;

    public string? ImageUrl { get; set; }

    public int StockQuantity { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
