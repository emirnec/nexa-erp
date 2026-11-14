namespace MotorcycleSales.Api.Models;

public interface ITenantEntity
{
    int TenantId { get; set; }
}

/// <summary>Customer organization using the SaaS platform. A dealer is a branch inside a tenant.</summary>
public class Tenant
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? LegalName { get; set; }
    public string? ContactEmail { get; set; }
    public string? Phone { get; set; }
    public string PlanKey { get; set; } = "Trial";
    public string SubscriptionStatus { get; set; } = "Trial";
    public DateTime? TrialEndsAt { get; set; }
    public DateTime? SubscriptionEndsAt { get; set; }
    public int MaxUsers { get; set; } = 5;
    public int MaxBranches { get; set; } = 1;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
