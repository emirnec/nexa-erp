namespace MotorcycleSales.Api.Models;

public class Customer : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Notes { get; set; }
    /// <summary>0 = limit yok. Vadeli satışlarda açık bakiye bu limiti aşamaz.</summary>
    public decimal CreditLimit { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
