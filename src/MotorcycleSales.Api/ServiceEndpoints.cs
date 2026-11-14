using Microsoft.EntityFrameworkCore;
using MotorcycleSales.Api.Data;
using MotorcycleSales.Api.Models;

namespace MotorcycleSales.Api;

public static class ServiceEndpoints
{
    public static void MapService(this WebApplication app)
    {
        app.MapGet("/api/parts", async (bool? includeInactive, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var query = db.Parts.AsNoTracking();
            if (includeInactive != true) query = query.Where(p => p.IsActive);
            return Results.Ok(await query.OrderBy(p => p.Code).ToListAsync());
        });

        app.MapPost("/api/parts", async (PartRequest request, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (string.IsNullOrWhiteSpace(request.Code) || string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest("Parça kodu ve adı zorunludur.");
            if (request.StockQuantity < 0 || request.PurchaseCost < 0 || request.SalePrice < 0)
                return Results.BadRequest("Stok ve fiyatlar negatif olamaz.");
            var code = request.Code.Trim().ToUpperInvariant();
            if (await db.Parts.AnyAsync(p => p.Code == code)) return Results.Conflict("Bu parça kodu kullanılıyor.");
            var part = new Part
            {
                Code = code, Name = request.Name.Trim(), StockQuantity = request.StockQuantity,
                PurchaseCost = decimal.Round(request.PurchaseCost, 2), SalePrice = decimal.Round(request.SalePrice, 2),
                IsActive = request.IsActive,
            };
            db.Parts.Add(part);
            await db.SaveChangesAsync();
            if (part.StockQuantity > 0)
            {
                db.PartStockMovements.Add(new PartStockMovement
                {
                    PartId = part.Id, MovementType = "OpeningStock", Quantity = part.StockQuantity,
                    UnitCost = part.PurchaseCost, Note = "Açılış stoğu",
                });
                await db.SaveChangesAsync();
            }
            return Results.Created($"/api/parts/{part.Id}", part);
        });

        app.MapPut("/api/parts/{id:int}", async (int id, PartRequest request, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var part = await db.Parts.FirstOrDefaultAsync(p => p.Id == id);
            if (part is null) return Results.NotFound("Parça bulunamadı.");
            if (string.IsNullOrWhiteSpace(request.Name)) return Results.BadRequest("Parça adı zorunludur.");
            if (request.PurchaseCost < 0 || request.SalePrice < 0) return Results.BadRequest("Fiyatlar negatif olamaz.");
            part.Name = request.Name.Trim();
            part.PurchaseCost = decimal.Round(request.PurchaseCost, 2);
            part.SalePrice = decimal.Round(request.SalePrice, 2);
            part.IsActive = request.IsActive;
            await db.SaveChangesAsync();
            return Results.Ok(part);
        });

        app.MapPost("/api/parts/{id:int}/stock", async (int id, PartStockRequest request, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (request.Quantity <= 0 || request.UnitCost < 0) return Results.BadRequest("Miktar pozitif, maliyet sıfır veya pozitif olmalıdır.");
            if (request.MovementType is not ("PurchaseIn" or "ManualIn" or "ManualOut"))
                return Results.BadRequest("Geçersiz parça hareket türü.");
            var part = await db.Parts.FirstOrDefaultAsync(p => p.Id == id);
            if (part is null) return Results.NotFound("Parça bulunamadı.");
            if (request.MovementType == "ManualOut" && part.StockQuantity < request.Quantity)
                return Results.BadRequest("Yetersiz parça stoğu.");
            var oldQty = part.StockQuantity;
            if (request.MovementType == "ManualOut") part.StockQuantity -= request.Quantity;
            else
            {
                part.StockQuantity += request.Quantity;
                if (request.UnitCost > 0)
                    part.PurchaseCost = oldQty == 0 ? request.UnitCost
                        : decimal.Round(((part.PurchaseCost * oldQty) + (request.UnitCost * request.Quantity)) / (oldQty + request.Quantity), 2);
            }
            db.PartStockMovements.Add(new PartStockMovement
            {
                PartId = part.Id, MovementType = request.MovementType, Quantity = request.Quantity,
                UnitCost = request.UnitCost, Note = Clean(request.Note),
            });
            await db.SaveChangesAsync();
            return Results.Ok(new { part.Id, part.StockQuantity, part.PurchaseCost });
        });

        app.MapGet("/api/part-stock-movements", async (HttpContext ctx, AppDbContext db) =>
        {
            if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var rows = await db.PartStockMovements.AsNoTracking().Include(x => x.Part)
                .OrderByDescending(x => x.CreatedAt).Take(500).ToListAsync();
            return Results.Ok(rows.Select(x => new
            {
                x.Id, x.PartId, part = x.Part is null ? null : $"{x.Part.Code} · {x.Part.Name}",
                x.MovementType, x.Quantity, x.UnitCost, x.ServiceOrderId, x.Note, x.CreatedAt,
            }));
        });

        app.MapGet("/api/service-orders", async (string? status, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var query = db.ServiceOrders.AsNoTracking().Include(x => x.Customer).Include(x => x.Motorcycle).Include(x => x.Items).AsQueryable();
            if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
            var rows = await query.OrderByDescending(x => x.OpenedAt).Take(500).ToListAsync();
            return Results.Ok(rows.Select(Dto));
        });

        app.MapGet("/api/service-orders/{id:int}", async (int id, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var order = await db.ServiceOrders.AsNoTracking().Include(x => x.Customer).Include(x => x.Motorcycle).Include(x => x.Items)
                .FirstOrDefaultAsync(x => x.Id == id);
            return order is null ? Results.NotFound("Servis iş emri bulunamadı.") : Results.Ok(Dto(order));
        });

        app.MapPost("/api/service-orders", async (ServiceOrderRequest request, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var validation = await ValidateAsync(request, db);
            if (validation is not null) return Results.BadRequest(validation);
            var order = new ServiceOrder
            {
                CustomerId = request.CustomerId, MotorcycleId = request.MotorcycleId,
                Complaint = Clean(request.Complaint), Diagnosis = Clean(request.Diagnosis), Notes = Clean(request.Notes),
                DueDate = request.DueDate?.ToUniversalTime(), Status = "Open",
            };
            ApplyItems(order, request.Items);
            Recalculate(order);
            db.ServiceOrders.Add(order);
            await db.SaveChangesAsync();
            order.OrderNo = $"SRV-{order.Id:D6}";
            await db.SaveChangesAsync();
            await db.Entry(order).Reference(x => x.Customer).LoadAsync();
            await db.Entry(order).Reference(x => x.Motorcycle).LoadAsync();
            return Results.Created($"/api/service-orders/{order.Id}", Dto(order));
        });

        app.MapPut("/api/service-orders/{id:int}", async (int id, ServiceOrderRequest request, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var order = await db.ServiceOrders.Include(x => x.Items).Include(x => x.Customer).Include(x => x.Motorcycle)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (order is null) return Results.NotFound("Servis iş emri bulunamadı.");
            if (order.Status is "Invoiced" or "Cancelled") return Results.Conflict("Faturalanmış veya iptal edilmiş iş emri düzenlenemez.");
            var validation = await ValidateAsync(request, db);
            if (validation is not null) return Results.BadRequest(validation);
            order.CustomerId = request.CustomerId;
            order.MotorcycleId = request.MotorcycleId;
            order.Complaint = Clean(request.Complaint);
            order.Diagnosis = Clean(request.Diagnosis);
            order.Notes = Clean(request.Notes);
            order.DueDate = request.DueDate?.ToUniversalTime();
            db.ServiceOrderItems.RemoveRange(order.Items);
            order.Items.Clear();
            ApplyItems(order, request.Items);
            Recalculate(order);
            await db.SaveChangesAsync();
            return Results.Ok(Dto(order));
        });

        app.MapPost("/api/service-orders/{id:int}/start", (int id, HttpContext ctx, AppDbContext db) => ChangeStatus(id, "InProgress", ctx, db));
        app.MapPost("/api/service-orders/{id:int}/ready", (int id, HttpContext ctx, AppDbContext db) => ChangeStatus(id, "Ready", ctx, db));

        app.MapPost("/api/service-orders/{id:int}/cancel", async (int id, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var order = await db.ServiceOrders.FirstOrDefaultAsync(x => x.Id == id);
            if (order is null) return Results.NotFound("Servis iş emri bulunamadı.");
            if (order.Status == "Invoiced") return Results.Conflict("Faturalanmış iş emri iptal edilemez; ters kayıt gerekir.");
            order.Status = "Cancelled";
            await db.SaveChangesAsync();
            return Results.Ok(new { order.Id, order.Status });
        });

        app.MapPost("/api/service-orders/{id:int}/invoice", async (int id, ServiceInvoiceRequest request, HttpContext ctx, AppDbContext db, AccountingService acc) =>
        {
            if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (request.PaymentMethod is not ("Cash" or "Card" or "Credit")) return Results.BadRequest("Geçersiz ödeme yöntemi.");
            var order = await db.ServiceOrders.Include(x => x.Items).ThenInclude(x => x.Part).Include(x => x.Customer)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (order is null) return Results.NotFound("Servis iş emri bulunamadı.");
            if (order.Status == "Invoiced") return Results.Conflict("Bu iş emri zaten faturalanmış.");
            if (order.Status == "Cancelled") return Results.Conflict("İptal edilmiş iş emri faturalanamaz.");
            if (order.Status != "Ready") return Results.Conflict("Fatura kesmek için iş emri Hazır durumunda olmalıdır.");
            if (request.PaymentMethod == "Credit" && order.CustomerId is null) return Results.BadRequest("Vadeli servis faturası için müşteri seçilmelidir.");
            if (order.Items.Count == 0) return Results.BadRequest("İş emrinde kalem yok.");

            await using var tx = await db.Database.BeginTransactionAsync();
            if (request.PaymentMethod == "Credit" && order.CustomerId is int creditCustomerId)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Customers\" WHERE \"Id\" = {creditCustomerId} FOR UPDATE");
                var customer = await db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == creditCustomerId);
                if (customer is { CreditLimit: > 0 })
                {
                    var saleOpen = await db.Sales.AsNoTracking()
                        .Where(s => s.CustomerId == creditCustomerId && !s.IsCancelled)
                        .SumAsync(s => (decimal?)(s.Quantity * s.UnitPrice + s.ExtrasTotal - s.PaidAmount)) ?? 0m;
                    var serviceOpen = await db.ServiceOrders.AsNoTracking()
                        .Where(o => o.CustomerId == creditCustomerId && o.Id != order.Id && o.Status == "Invoiced")
                        .SumAsync(o => (decimal?)(o.Total - o.PaidAmount)) ?? 0m;
                    if (saleOpen + serviceOpen + order.Total > customer.CreditLimit)
                        return Results.BadRequest(new { code = "credit_limit", message = $"Müşteri kredi limiti aşıldı. Açık bakiye {saleOpen + serviceOpen:N2} TL, bu servis {order.Total:N2} TL, limit {customer.CreditLimit:N2} TL." });
                }
            }
            foreach (var item in order.Items)
            {
                if (item.Kind != "Part" || item.PartId is null) continue;
                var part = item.Part ?? await db.Parts.FirstOrDefaultAsync(x => x.Id == item.PartId);
                if (part is null) return Results.BadRequest("İş emrindeki parça bulunamadı.");
                if (part.StockQuantity < item.Quantity) return Results.BadRequest($"{part.Code} için yetersiz stok. Mevcut: {part.StockQuantity}.");
                part.StockQuantity -= item.Quantity;
                item.UnitCost = part.PurchaseCost;
                if (item.UnitPrice <= 0) item.UnitPrice = part.SalePrice;
                db.PartStockMovements.Add(new PartStockMovement
                {
                    PartId = part.Id, MovementType = "ServiceOut", Quantity = item.Quantity,
                    UnitCost = part.PurchaseCost, ServiceOrderId = order.Id, Note = $"Servis #{order.OrderNo}",
                });
            }
            order.TotalLabor = decimal.Round(order.Items.Where(x => x.Kind == "Labor").Sum(x => x.Quantity * x.UnitPrice), 2);
            order.TotalParts = decimal.Round(order.Items.Where(x => x.Kind == "Part").Sum(x => x.Quantity * x.UnitPrice), 2);
            order.Total = order.TotalLabor + order.TotalParts;
            var cost = decimal.Round(order.Items.Sum(x => x.Quantity * x.UnitCost), 2);
            order.Status = "Invoiced";
            order.InvoiceNo = $"SRV-{order.Id:D6}";
            order.InvoicedAt = DateTime.UtcNow;
            order.PaymentMethod = request.PaymentMethod;
            order.PaidAmount = request.PaymentMethod == "Credit" ? 0 : order.Total;
            if (request.PaymentMethod == "Credit") order.DueDate = DateTime.UtcNow.AddDays(30);
            else db.Payments.Add(new Payment
            {
                Direction = "In", Method = request.PaymentMethod == "Card" ? "Card" : "Cash", Amount = order.Total,
                CustomerId = order.CustomerId, ServiceOrderId = order.Id, Counterparty = order.Customer?.FullName,
                Note = order.InvoiceNo, PaymentDate = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
            if (order.Total > 0) await acc.PostServiceOrderAsync(order, cost);
            await tx.CommitAsync();
            return Results.Ok(Dto(order));
        });
    }

    static async Task<IResult> ChangeStatus(int id, string next, HttpContext ctx, AppDbContext db)
    {
        if (!IsStaff(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
        var order = await db.ServiceOrders.Include(x => x.Items).Include(x => x.Customer).Include(x => x.Motorcycle)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (order is null) return Results.NotFound("Servis iş emri bulunamadı.");
        if (next == "InProgress" && order.Status != "Open") return Results.Conflict("Yalnızca açık iş emri başlatılabilir.");
        if (next == "Ready" && order.Status != "InProgress") return Results.Conflict("Yalnızca devam eden iş emri hazır işaretlenebilir.");
        order.Status = next;
        await db.SaveChangesAsync();
        return Results.Ok(Dto(order));
    }

    static async Task<string?> ValidateAsync(ServiceOrderRequest request, AppDbContext db)
    {
        if (request.CustomerId is int customerId && !await db.Customers.AnyAsync(c => c.Id == customerId))
            return "Müşteri bulunamadı.";
        if (request.MotorcycleId is int motorcycleId && !await db.Motorcycles.AnyAsync(m => m.Id == motorcycleId))
            return "Motosiklet bulunamadı.";
        if (request.Items is null || request.Items.Count == 0 || request.Items.Count > 50)
            return "İş emrinde 1 ile 50 arasında kalem olmalıdır.";
        foreach (var item in request.Items)
        {
            if (item.Kind is not ("Labor" or "Part")) return "Kalem türü İşçilik veya Parça olmalıdır.";
            if (string.IsNullOrWhiteSpace(item.Description) || item.Description.Trim().Length > 200) return "Kalem açıklaması 1-200 karakter olmalıdır.";
            if (item.Quantity <= 0 || item.UnitPrice < 0 || item.UnitCost < 0) return "Kalem miktarı pozitif, fiyat ve maliyet negatif olmamalıdır.";
            if (item.PartId is int partId && !await db.Parts.AnyAsync(p => p.Id == partId)) return "Seçilen parça bulunamadı.";
        }
        return null;
    }

    static void Recalculate(ServiceOrder order)
    {
        order.TotalLabor = decimal.Round(order.Items.Where(x => x.Kind == "Labor").Sum(x => x.Quantity * x.UnitPrice), 2);
        order.TotalParts = decimal.Round(order.Items.Where(x => x.Kind == "Part").Sum(x => x.Quantity * x.UnitPrice), 2);
        order.Total = order.TotalLabor + order.TotalParts;
    }

    static void ApplyItems(ServiceOrder order, List<ServiceOrderItemRequest> items)
    {
        foreach (var item in items)
        {
            order.Items.Add(new ServiceOrderItem
            {
                Kind = item.Kind, Description = item.Description.Trim(), Quantity = item.Quantity,
                UnitPrice = decimal.Round(item.UnitPrice, 2), UnitCost = decimal.Round(item.UnitCost, 2),
                PartId = item.Kind == "Part" ? item.PartId : null,
            });
        }
    }

    static object Dto(ServiceOrder order) => new
    {
        order.Id, order.OrderNo, order.Status, order.Complaint, order.Diagnosis, order.Notes,
        order.OpenedAt, order.DueDate, order.InvoicedAt, order.InvoiceNo,
        order.TotalLabor, order.TotalParts, order.Total, order.PaidAmount, order.PaymentMethod,
        customerId = order.CustomerId, customer = order.Customer?.FullName,
        motorcycleId = order.MotorcycleId,
        motorcycle = order.Motorcycle is null ? null : $"{order.Motorcycle.Brand} {order.Motorcycle.Model}",
        items = order.Items.Select(x => new { x.Id, x.Kind, x.Description, x.Quantity, x.UnitPrice, x.UnitCost, x.PartId, total = x.Quantity * x.UnitPrice }),
        outstanding = Math.Max(0, order.Total - order.PaidAmount),
    };

    static bool IsAdmin(HttpContext ctx) => ctx.Items["role"]?.ToString() == "Admin";
    static bool IsStaff(HttpContext ctx) => ctx.Items["role"]?.ToString() is "Admin" or "Staff";
    static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
