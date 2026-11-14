using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MotorcycleSales.Api.Data;
using MotorcycleSales.Api.Models;

namespace MotorcycleSales.Api;

public static class OperationsEndpoints
{
    private static readonly HashSet<string> Modules = new(StringComparer.OrdinalIgnoreCase)
    { "calendar", "service", "parts", "purchasing", "tradein", "crm", "finance", "automation" };

    public static void MapOperations(this WebApplication app)
    {
        // Public catalog is tenant-aware. When several businesses exist, a slug is mandatory.
        app.MapGet("/api/public/catalog", async Task<IResult> (string? search, string? brand, int? minCc, int? maxCc, string? tenant, AppDbContext db) =>
        {
            var selectedTenant = await ResolvePublicTenant(db, tenant);
            if (selectedTenant is null) return Results.BadRequest("Katalog için geçerli bir işletme kısa adı (tenant) gereklidir.");
            db.CurrentTenantId = selectedTenant.Id;
            var q = from listing in db.CatalogListings.AsNoTracking()
                    join moto in db.Motorcycles.AsNoTracking() on listing.MotorcycleId equals moto.Id
                    where listing.IsPublished
                    select new { listing.Id, listing.PublicDescription, listing.ImageUrls, listing.UpdatedAt, motorcycle = moto };
            if (!string.IsNullOrWhiteSpace(search)) q = q.Where(x => (x.motorcycle.Brand + " " + x.motorcycle.Model).ToLower().Contains(search.Trim().ToLower()));
            if (!string.IsNullOrWhiteSpace(brand)) q = q.Where(x => x.motorcycle.Brand.ToLower() == brand.Trim().ToLower());
            if (minCc.HasValue) q = q.Where(x => x.motorcycle.EngineCapacityCc >= minCc.Value);
            if (maxCc.HasValue) q = q.Where(x => x.motorcycle.EngineCapacityCc <= maxCc.Value);
            var result = await q.OrderBy(x => x.motorcycle.Brand).ThenBy(x => x.motorcycle.Model).Take(200)
                .Select(x => new { x.Id, x.motorcycle.Brand, x.motorcycle.Model, x.motorcycle.EngineCapacityCc, x.motorcycle.Price, x.motorcycle.Color, x.motorcycle.StockQuantity, x.PublicDescription, x.ImageUrls, x.UpdatedAt }).ToListAsync();
            return Results.Ok(result);
        });
        app.MapGet("/api/public/catalog/brands", async Task<IResult> (string? tenant, AppDbContext db) =>
        {
            var selectedTenant = await ResolvePublicTenant(db, tenant);
            if (selectedTenant is null) return Results.BadRequest("Katalog için işletme kısa adı gereklidir.");
            db.CurrentTenantId = selectedTenant.Id;
            var brands = await (from l in db.CatalogListings.AsNoTracking()
                join m in db.Motorcycles.AsNoTracking() on l.MotorcycleId equals m.Id
                where l.IsPublished select m.Brand).Distinct().OrderBy(x => x).ToListAsync();
            return Results.Ok(brands);
        });

        app.MapGet("/api/public/catalog/branding", async Task<IResult> (string? tenant, AppDbContext db) =>
        {
            var selectedTenant = await ResolvePublicTenant(db, tenant);
            if (selectedTenant is null) return Results.BadRequest("Katalog için geçerli bir işletme kısa adı gereklidir.");
            return Results.Ok(new { selectedTenant.Name, selectedTenant.Slug });
        });

        app.MapGet("/api/catalog", async (AppDbContext db) => Results.Ok(await db.CatalogListings.AsNoTracking()
            .Join(db.Motorcycles.AsNoTracking(), l => l.MotorcycleId, m => m.Id, (l, m) => new { listing = l, motorcycle = m })
            .OrderBy(x => x.motorcycle.Brand).ThenBy(x => x.motorcycle.Model).Select(x => new { x.listing.Id, x.listing.MotorcycleId, x.listing.PublicDescription, x.listing.ImageUrls, x.listing.IsPublished, x.motorcycle.Brand, x.motorcycle.Model, x.motorcycle.Price, x.motorcycle.StockQuantity }).ToListAsync()));
        app.MapPut("/api/catalog/{id:int}", async (int id, CatalogRequest req, HttpContext ctx, AppDbContext db) =>
        {
            if (ctx.Items["role"]?.ToString() != "Admin") return Results.StatusCode(403);
            if (!await db.Motorcycles.AnyAsync(m => m.Id == req.MotorcycleId)) return Results.NotFound("Motosiklet bulunamadı.");
            if (!ValidJsonArray(req.ImageUrls)) return Results.BadRequest("ImageUrls geçerli bir JSON dizisi olmalıdır.");
            var item = await db.CatalogListings.FirstOrDefaultAsync(x => x.Id == id);
            if (item is null) return Results.NotFound();
            item.MotorcycleId = req.MotorcycleId; item.PublicDescription = Clean(req.PublicDescription); item.ImageUrls = string.IsNullOrWhiteSpace(req.ImageUrls) ? "[]" : req.ImageUrls; item.IsPublished = req.IsPublished; item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(); await Audit(db, ctx, "update", "CatalogListing", id.ToString(), $"Published={item.IsPublished}");
            return Results.Ok(item);
        });
        app.MapPost("/api/catalog", async (CatalogRequest req, HttpContext ctx, AppDbContext db) =>
        {
            if (ctx.Items["role"]?.ToString() != "Admin") return Results.StatusCode(403);
            if (!await db.Motorcycles.AnyAsync(m => m.Id == req.MotorcycleId)) return Results.NotFound("Motosiklet bulunamadı.");
            if (!ValidJsonArray(req.ImageUrls)) return Results.BadRequest("ImageUrls geçerli bir JSON dizisi olmalıdır.");
            var item = await db.CatalogListings.FirstOrDefaultAsync(x => x.MotorcycleId == req.MotorcycleId);
            if (item is null) { item = new CatalogListing { MotorcycleId = req.MotorcycleId }; db.CatalogListings.Add(item); }
            item.PublicDescription = Clean(req.PublicDescription); item.ImageUrls = string.IsNullOrWhiteSpace(req.ImageUrls) ? "[]" : req.ImageUrls; item.IsPublished = req.IsPublished; item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(); await Audit(db, ctx, "upsert", "CatalogListing", item.Id.ToString(), $"Published={item.IsPublished}");
            return Results.Ok(item);
        });

        app.MapDelete("/api/catalog/{id:int}", async (int id, HttpContext ctx, AppDbContext db) =>
        {
            if (ctx.Items["role"]?.ToString() != "Admin") return Results.StatusCode(403);
            var item = await db.CatalogListings.FirstOrDefaultAsync(x => x.Id == id);
            if (item is null) return Results.NotFound();
            var label = $"{item.MotorcycleId}";
            db.CatalogListings.Remove(item); await db.SaveChangesAsync();
            await Audit(db, ctx, "delete", "CatalogListing", id.ToString(), label);
            return Results.NoContent();
        });

        app.MapGet("/api/workflows/{module}", async (string module, HttpContext ctx, AppDbContext db) =>
        {
            if (!Modules.Contains(module)) return Results.NotFound();
            var query = db.WorkflowRecords.AsNoTracking().Where(x => x.Module == module.ToLower());
            if (ctx.Items["role"]?.ToString() == "Dealer")
            {
                if (ctx.Items["dealerId"] is not int ownDealer) return Results.StatusCode(403);
                query = query.Where(x => x.DealerId == ownDealer);
            }
            return Results.Ok(await query.OrderByDescending(x => x.UpdatedAt).Take(500).ToListAsync());
        });
        app.MapPost("/api/workflows", async (WorkflowRequest req, HttpContext ctx, AppDbContext db) =>
        {
            var module = (req.Module ?? "").Trim().ToLowerInvariant();
            if (!Modules.Contains(module)) return Results.BadRequest("Geçersiz modül.");
            if (ctx.Items["role"]?.ToString() != "Admin" && module is not ("calendar" or "service" or "crm")) return Results.StatusCode(403);
            if (string.IsNullOrWhiteSpace(req.Title)) return Results.BadRequest("Başlık zorunludur.");
            if (!ValidJsonObject(req.Payload)) return Results.BadRequest("Payload geçerli bir JSON nesnesi olmalıdır.");
            var linkError = await ValidateLinks(db, req);
            if (linkError is not null) return Results.BadRequest(linkError);
            if (ctx.Items["role"]?.ToString() == "Dealer" && (ctx.Items["dealerId"] is not int ownDealer || (req.DealerId.HasValue && req.DealerId.Value != ownDealer))) return Results.StatusCode(403);
            var row = new WorkflowRecord { Module = module, Title = req.Title.Trim(), Status = Clean(req.Status) ?? "Open", Description = Clean(req.Description), ReferenceNo = Clean(req.ReferenceNo), CustomerId = req.CustomerId, MotorcycleId = req.MotorcycleId, DealerId = req.DealerId ?? (ctx.Items["dealerId"] as int?), Amount = req.Amount, Quantity = req.Quantity, DueAt = req.DueAt, Payload = string.IsNullOrWhiteSpace(req.Payload) ? "{}" : req.Payload, CreatedBy = ctx.Items["username"]?.ToString() ?? "system" };
            db.WorkflowRecords.Add(row); await db.SaveChangesAsync(); await Audit(db, ctx, "create", module, row.Id.ToString(), row.Title);
            return Results.Created($"/api/workflows/{module}/{row.Id}", row);
        });
        app.MapPut("/api/workflows/{module}/{id:int}", async (string module, int id, WorkflowRequest req, HttpContext ctx, AppDbContext db) =>
        {
            module = module.ToLowerInvariant(); if (!Modules.Contains(module)) return Results.NotFound();
            if (ctx.Items["role"]?.ToString() != "Admin" && module is not ("calendar" or "service" or "crm")) return Results.StatusCode(403);
            var row = await db.WorkflowRecords.FirstOrDefaultAsync(x => x.Id == id && x.Module == module); if (row is null) return Results.NotFound();
            if (ctx.Items["role"]?.ToString() == "Dealer" && (ctx.Items["dealerId"] is not int ownDealer || row.DealerId != ownDealer)) return Results.StatusCode(403);
            if (ctx.Items["role"]?.ToString() == "Dealer" && req.DealerId.HasValue && req.DealerId.Value != row.DealerId) return Results.StatusCode(403);
            if (!ValidJsonObject(req.Payload)) return Results.BadRequest("Payload geçerli bir JSON nesnesi olmalıdır.");
            var linkError = await ValidateLinks(db, req);
            if (linkError is not null) return Results.BadRequest(linkError);
            row.Title = string.IsNullOrWhiteSpace(req.Title) ? row.Title : req.Title.Trim(); row.Status = Clean(req.Status) ?? row.Status; row.Description = Clean(req.Description); row.ReferenceNo = Clean(req.ReferenceNo); row.CustomerId = req.CustomerId; row.MotorcycleId = req.MotorcycleId; if (ctx.Items["role"]?.ToString() == "Admin") row.DealerId = req.DealerId; row.Amount = req.Amount; row.Quantity = req.Quantity; row.DueAt = req.DueAt; row.Payload = string.IsNullOrWhiteSpace(req.Payload) ? "{}" : req.Payload; row.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(); await Audit(db, ctx, "update", module, id.ToString(), row.Title); return Results.Ok(row);
        });
        app.MapDelete("/api/workflows/{module}/{id:int}", async (string module, int id, HttpContext ctx, AppDbContext db) =>
        {
            if (ctx.Items["role"]?.ToString() != "Admin") return Results.StatusCode(403);
            var row = await db.WorkflowRecords.FirstOrDefaultAsync(x => x.Id == id && x.Module == module.ToLowerInvariant()); if (row is null) return Results.NotFound();
            db.WorkflowRecords.Remove(row); await db.SaveChangesAsync(); await Audit(db, ctx, "delete", module, id.ToString(), row.Title); return Results.NoContent();
        });
        app.MapGet("/api/audit", async (HttpContext ctx, AppDbContext db) =>
        {
            if (ctx.Items["role"]?.ToString() != "Admin") return Results.StatusCode(403);
            return Results.Ok(await db.AuditLogs.AsNoTracking().OrderByDescending(x => x.CreatedAt).Take(500).ToListAsync());
        });
    }

    private static async Task<string?> ValidateLinks(AppDbContext db, WorkflowRequest request)
    {
        if (request.CustomerId.HasValue && !await db.Customers.AnyAsync(x => x.Id == request.CustomerId.Value)) return "Seçilen müşteri bu işletmeye ait değil.";
        if (request.MotorcycleId.HasValue && !await db.Motorcycles.AnyAsync(x => x.Id == request.MotorcycleId.Value)) return "Seçilen motosiklet bu işletmeye ait değil.";
        if (request.DealerId.HasValue && !await db.Dealers.AnyAsync(x => x.Id == request.DealerId.Value)) return "Seçilen bayi bu işletmeye ait değil.";
        if ((request.Amount.HasValue && request.Amount.Value < 0) || (request.Quantity.HasValue && request.Quantity.Value < 0)) return "Tutar ve adet negatif olamaz.";
        return null;
    }

    private static async Task<Tenant?> ResolvePublicTenant(AppDbContext db, string? slug)
    {
        if (!string.IsNullOrWhiteSpace(slug))
            return await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == slug.Trim().ToLowerInvariant() && t.IsActive);
        var tenants = await db.Tenants.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.Id).Take(2).ToListAsync();
        return tenants.Count == 1 ? tenants[0] : null;
    }

    private static async Task Audit(AppDbContext db, HttpContext ctx, string action, string entity, string id, string? details)
    { db.AuditLogs.Add(new AuditLog { Username = ctx.Items["username"]?.ToString() ?? "system", Action = action, Entity = entity, EntityId = id, Details = details }); await db.SaveChangesAsync(); }
    private static bool ValidJsonObject(string? value) { if (string.IsNullOrWhiteSpace(value)) return true; try { return JsonDocument.Parse(value).RootElement.ValueKind == JsonValueKind.Object; } catch { return false; } }
    private static bool ValidJsonArray(string? value) { if (string.IsNullOrWhiteSpace(value)) return true; try { return JsonDocument.Parse(value).RootElement.ValueKind == JsonValueKind.Array; } catch { return false; } }
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
