namespace MotorcycleSales.Api.Models;

/// <summary>Shared operational record for calendar, service, parts, purchasing, trade-in, CRM and automation workflows.</summary>
public class WorkflowRecord : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = "Open";
    public string? Description { get; set; }
    public string? ReferenceNo { get; set; }
    public int? CustomerId { get; set; }
    public int? MotorcycleId { get; set; }
    public int? DealerId { get; set; }
    public decimal? Amount { get; set; }
    public int? Quantity { get; set; }
    public DateTime? DueAt { get; set; }
    public string Payload { get; set; } = "{}";
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class CatalogListing : ITenantEntity
{
    public int TenantId { get; set; }
    public int Id { get; set; }
    public int MotorcycleId { get; set; }
    public string? PublicDescription { get; set; }
    public string? ImageUrls { get; set; } = "[]";
    public bool IsPublished { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class AuditLog : ITenantEntity
{
    public int TenantId { get; set; }
    public long Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string Entity { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;
    public string? Details { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public record WorkflowRequest(string Module, string Title, string? Status, string? Description, string? ReferenceNo, int? CustomerId, int? MotorcycleId, int? DealerId, decimal? Amount, int? Quantity, DateTime? DueAt, string? Payload);
public record CatalogRequest(int MotorcycleId, string? PublicDescription, string? ImageUrls, bool IsPublished);
