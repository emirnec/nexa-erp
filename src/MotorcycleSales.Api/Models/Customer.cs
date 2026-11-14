namespace MotorcycleSales.Api.Models;

public class Customer : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
