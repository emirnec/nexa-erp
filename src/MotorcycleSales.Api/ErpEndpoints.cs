using Microsoft.EntityFrameworkCore;
using MotorcycleSales.Api.Data;
using MotorcycleSales.Api.Models;

namespace MotorcycleSales.Api;

public static class ErpEndpoints
{
    public static void MapErp(this WebApplication app)
    {
        app.MapGet("/api/dealers", async (HttpContext ctx, AppDbContext db) =>
        {
            var q = db.Dealers.AsNoTracking().OrderByDescending(d => d.IsHeadquarters).ThenBy(d => d.Name);
            var scoped = ScopeDealer(ctx);
            var list = scoped is null ? await q.ToListAsync() : await q.Where(d => d.Id == scoped).ToListAsync();
            return Results.Ok(list);
        });
        app.MapPost("/api/dealers", async (DealerRequest request, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Code))
                return Results.BadRequest("Bayi kodu ve adı zorunludur.");
            var tenant = await db.Tenants.FirstAsync(t => t.Id == (int)ctx.Items["tenantId"]!);
            if (await db.Dealers.CountAsync(d => !d.IsHeadquarters) >= tenant.MaxBranches)
                return Results.Conflict($"Mevcut paket en fazla {tenant.MaxBranches} bayi/şubeye izin veriyor.");
            var code = request.Code.Trim().ToUpperInvariant();
            if (await db.Dealers.AnyAsync(d => d.Code == code)) return Results.Conflict("Bu bayi kodu kullanılıyor.");
            var dealer = new Dealer
            {
                Code = code,
                Name = request.Name.Trim(),
                City = (request.City ?? "").Trim(),
                Phone = Clean(request.Phone),
                TaxNumber = Clean(request.TaxNumber),
                Address = Clean(request.Address),
                CommissionPercent = Math.Clamp(request.CommissionPercent, 0, 100),
                CreditLimit = Math.Max(0, request.CreditLimit),
            };
            db.Dealers.Add(dealer);
            await db.SaveChangesAsync();
            return Results.Created($"/api/dealers/{dealer.Id}", dealer);
        });
        app.MapPut("/api/dealers/{id:int}", async (int id, DealerRequest request, HttpContext ctx, AppDbContext db) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var dealer = await db.Dealers.FirstOrDefaultAsync(x => x.Id == id);
            if (dealer is null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(request.Name)) return Results.BadRequest("Bayi adı zorunludur.");
            dealer.Name = request.Name.Trim();
            dealer.City = (request.City ?? "").Trim();
            dealer.Phone = Clean(request.Phone);
            dealer.TaxNumber = Clean(request.TaxNumber);
            dealer.Address = Clean(request.Address);
            dealer.CommissionPercent = Math.Clamp(request.CommissionPercent, 0, 100);
            dealer.CreditLimit = Math.Max(0, request.CreditLimit);
            dealer.IsActive = request.IsActive;
            if (dealer.IsHeadquarters) dealer.IsActive = true;
            await db.SaveChangesAsync();
            return Results.Ok(dealer);
        });

        app.MapGet("/api/inventory", async (HttpContext ctx, AppDbContext db, AccountingService acc) =>
        {
            await acc.EnsureReadyAsync();
            var dealers = await db.Dealers.AsNoTracking().Where(d => d.IsActive).ToListAsync();
            var motos = await db.Motorcycles.AsNoTracking().OrderBy(m => m.Brand).ThenBy(m => m.Model).ToListAsync();
            var stocks = await db.DealerStocks.AsNoTracking().ToListAsync();
            var scoped = ScopeDealer(ctx);
            var locations = dealers.Where(d => scoped is null || d.Id == scoped).Select(d => new
            {
                dealerId = d.Id,
                dealer = d.Name,
                isHeadquarters = d.IsHeadquarters,
                items = motos.Select(m =>
                {
                    var qty = d.IsHeadquarters ? m.StockQuantity : stocks.FirstOrDefault(s => s.DealerId == d.Id && s.MotorcycleId == m.Id)?.Quantity ?? 0;
                    return new { motorcycleId = m.Id, brand = m.Brand, model = m.Model, color = m.Color, quantity = qty, unitCost = m.PurchaseCost, value = qty * m.PurchaseCost };
                }).Where(i => scoped is null || i.quantity > 0).ToList(),
            });
            return Results.Ok(locations);
        });

        app.MapGet("/api/stock-transfers", async (HttpContext ctx, AppDbContext db) =>
        {
            var q = db.StockTransfers.AsNoTracking().Include(t => t.Motorcycle).Include(t => t.FromDealer).Include(t => t.ToDealer).OrderByDescending(t => t.CreatedAt);
            var scoped = ScopeDealer(ctx);
            var list = scoped is null
                ? await q.Take(500).ToListAsync()
                : await q.Where(t => t.FromDealerId == scoped || t.ToDealerId == scoped).Take(500).ToListAsync();
            return Results.Ok(list.Select(Tdto));
        });
        app.MapPost("/api/stock-transfers", async (TransferRequest request, HttpContext ctx, AppDbContext db, AccountingService acc) =>
        {
            await acc.EnsureReadyAsync();
            if (request.Quantity <= 0 || request.FromDealerId == request.ToDealerId)
                return Results.BadRequest("Kaynak/hedef bayi ve miktarı kontrol edin.");
            if (request.TransferType is not ("Consignment" or "Wholesale"))
                return Results.BadRequest("Sevk türü Konsinye veya Toptan olmalıdır.");
            var scoped = ScopeDealer(ctx);
            if (scoped is not null && request.FromDealerId != scoped) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var from = await db.Dealers.FirstOrDefaultAsync(x => x.Id == request.FromDealerId);
            var to = await db.Dealers.FirstOrDefaultAsync(x => x.Id == request.ToDealerId);
            var moto = await db.Motorcycles.FirstOrDefaultAsync(x => x.Id == request.MotorcycleId);
            if (from is null || to is null || moto is null) return Results.NotFound("Bayi veya motosiklet bulunamadı.");
            var available = await acc.GetDealerStockAsync(from.Id, moto.Id);
            if (available < request.Quantity) return Results.BadRequest("Kaynak lokasyonda yetersiz stok.");
            var transfer = new StockTransfer
            {
                MotorcycleId = moto.Id,
                FromDealerId = from.Id,
                ToDealerId = to.Id,
                Quantity = request.Quantity,
                UnitCost = moto.PurchaseCost,
                TransferType = request.TransferType,
                Status = "Draft",
                Note = Clean(request.Note),
            };
            db.StockTransfers.Add(transfer);
            await db.SaveChangesAsync();
            return Results.Created($"/api/stock-transfers/{transfer.Id}", Tdto(transfer));
        });
        app.MapPost("/api/stock-transfers/{id:int}/ship", async (int id, HttpContext ctx, AppDbContext db, AccountingService acc) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            var t = await db.StockTransfers.FirstOrDefaultAsync(x => x.Id == id);
            if (t is null) return Results.NotFound();
            if (t.Status != "Draft") return Results.Conflict("Yalnızca taslak sevkler gönderilebilir.");
            var scoped = ScopeDealer(ctx);
            if (scoped is not null && t.FromDealerId != scoped) return Results.StatusCode(StatusCodes.Status403Forbidden);
            try { await acc.AdjustLocationStockAsync(t.FromDealerId, t.MotorcycleId, -t.Quantity); }
            catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
            t.Status = "Shipped";
            t.ShippedAt = DateTime.UtcNow;
            db.StockMovements.Add(new StockMovement
            {
                MotorcycleId = t.MotorcycleId, MovementType = "TransferOut", Quantity = t.Quantity,
                UnitCost = t.UnitCost, DealerId = t.FromDealerId, TransferId = t.Id, Note = $"Sevk #{t.Id}",
            });
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.Ok(Tdto(t));
        });
        app.MapPost("/api/stock-transfers/{id:int}/receive", async (int id, HttpContext ctx, AppDbContext db, AccountingService acc) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            var t = await db.StockTransfers.Include(x => x.ToDealer).FirstOrDefaultAsync(x => x.Id == id);
            if (t is null) return Results.NotFound();
            if (t.Status != "Shipped") return Results.Conflict("Yalnızca yoldaki sevkler teslim alınabilir.");
            var scoped = ScopeDealer(ctx);
            if (scoped is not null && t.ToDealerId != scoped) return Results.StatusCode(StatusCodes.Status403Forbidden);
            await acc.AdjustLocationStockAsync(t.ToDealerId, t.MotorcycleId, t.Quantity);
            t.Status = "Received";
            t.ReceivedAt = DateTime.UtcNow;
            db.StockMovements.Add(new StockMovement
            {
                MotorcycleId = t.MotorcycleId, MovementType = "TransferIn", Quantity = t.Quantity,
                UnitCost = t.UnitCost, DealerId = t.ToDealerId, TransferId = t.Id, Note = $"Sevk teslim #{t.Id}",
            });
            await db.SaveChangesAsync();
            if (t.TransferType == "Wholesale") await acc.PostWholesaleTransferAsync(t);
            await tx.CommitAsync();
            return Results.Ok(Tdto(t));
        });
        app.MapPost("/api/stock-transfers/{id:int}/cancel", async (int id, HttpContext ctx, AppDbContext db, AccountingService acc) =>
        {
            if (!IsAdmin(ctx) && ScopeDealer(ctx) is not null) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var t = await db.StockTransfers.FirstOrDefaultAsync(x => x.Id == id);
            if (t is null) return Results.NotFound();
            if (t.Status == "Received") return Results.Conflict("Teslim alınmış sevk iptal edilemez.");
            if (t.Status == "Shipped") await acc.AdjustLocationStockAsync(t.FromDealerId, t.MotorcycleId, t.Quantity);
            t.Status = "Cancelled";
            await db.SaveChangesAsync();
            return Results.Ok(Tdto(t));
        });

        app.MapGet("/api/accounts", async (AppDbContext db) =>
            Results.Ok(await db.Accounts.AsNoTracking().OrderBy(a => a.Code).ToListAsync()));
        app.MapGet("/api/journals", async (DateTime? from, DateTime? to, AppDbContext db) =>
        {
            var q = db.JournalEntries.AsNoTracking().Include(j => j.Lines).ThenInclude(l => l.Account).AsQueryable();
            if (from.HasValue) q = q.Where(j => j.EntryDate >= from.Value.ToUniversalTime());
            if (to.HasValue) q = q.Where(j => j.EntryDate < to.Value.Date.AddDays(1).ToUniversalTime());
            var list = await q.OrderByDescending(j => j.EntryDate).Take(400).ToListAsync();
            return Results.Ok(list.Select(j => new
            {
                j.Id, j.EntryDate, j.Description, j.Source, j.SourceId, j.IsReversed, j.ReversesEntryId,
                debit = j.Lines.Sum(l => l.Debit),
                credit = j.Lines.Sum(l => l.Credit),
                lines = j.Lines.Select(l => new { l.AccountId, code = l.Account?.Code, name = l.Account?.Name, l.Debit, l.Credit, l.Memo }),
            }));
        });
        app.MapPost("/api/journals", async (ManualJournalRequest request, HttpContext ctx, AccountingService acc) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (string.IsNullOrWhiteSpace(request.Description) || request.Lines.Count < 2)
                return Results.BadRequest("Açıklama ve en az iki satır gereklidir.");
            try
            {
                var entry = await acc.PostAsync("Manual", null, request.Description.Trim(), request.EntryDate ?? DateTime.UtcNow,
                    request.Lines.Select(l => (l.Code, l.Debit, l.Credit, l.Memo)).ToList());
                return Results.Created($"/api/journals/{entry.Id}", new { entry.Id });
            }
            catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
        });

        app.MapGet("/api/payments", async (HttpContext ctx, AppDbContext db) =>
        {
            var q = db.Payments.AsNoTracking().OrderByDescending(p => p.PaymentDate);
            var scoped = ScopeDealer(ctx);
            var list = scoped is null ? await q.Take(500).ToListAsync() : await q.Where(p => p.DealerId == scoped).Take(500).ToListAsync();
            return Results.Ok(list);
        });
        app.MapPost("/api/payments", async (PaymentRequest request, HttpContext ctx, AppDbContext db, AccountingService acc) =>
        {
            var idempotencyKey = ReadIdempotencyKey(ctx);
            if (idempotencyKey is not null)
            {
                if (idempotencyKey.Length > 100) return Results.BadRequest("Idempotency-Key en fazla 100 karakter olabilir.");
                var existing = await db.Payments.AsNoTracking().FirstOrDefaultAsync(p => p.IdempotencyKey == idempotencyKey);
                if (existing is not null) return Results.Ok(existing);
            }
            if (request.Amount <= 0 || request.Direction is not ("In" or "Out") || request.Method is not ("Cash" or "Bank" or "Card"))
                return Results.BadRequest("Yön, yöntem ve tutarı kontrol edin.");
            // Bayi kullanıcısı yalnızca kendi şubesinin satışına tahsilat bağlayabilir.
            var paymentScope = ScopeDealer(ctx);
            if (paymentScope is int paymentDealer && request.SaleId is int paymentSaleId &&
                !await db.Sales.AnyAsync(s => s.Id == paymentSaleId && s.DealerId == paymentDealer))
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            await using var tx = await db.Database.BeginTransactionAsync();
            Sale? sale = null;
            ServiceOrder? serviceOrder = null;
            if (request.ServiceOrderId is int orderId)
            {
                serviceOrder = await db.ServiceOrders.FirstOrDefaultAsync(x => x.Id == orderId);
                if (serviceOrder is null) return Results.NotFound("Servis iş emri bulunamadı.");
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"ServiceOrders\" WHERE \"Id\" = {orderId} FOR UPDATE");
                await db.Entry(serviceOrder).ReloadAsync();
                if (serviceOrder.Status != "Invoiced") return Results.Conflict("Yalnızca faturalanmış servis iş emrine tahsilat eklenebilir.");
                if (request.Direction != "In") return Results.BadRequest("Servis tahsilatı giriş yönünde olmalıdır.");
                if (request.Amount > serviceOrder.Total - serviceOrder.PaidAmount + 0.005m) return Results.BadRequest("Tahsilat servis iş emrinin açık bakiyesini aşamaz.");
            }
            if (request.SaleId is int saleId)
            {
                sale = await db.Sales.FirstOrDefaultAsync(s => s.Id == saleId);
                if (sale is null) return Results.NotFound("Satış bulunamadı.");
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Sales\" WHERE \"Id\" = {saleId} FOR UPDATE");
                await db.Entry(sale).ReloadAsync();
                if (sale.IsCancelled || sale.Status == "Cancelled") return Results.Conflict("İptal edilmiş satışa tahsilat eklenemez.");
                if (request.Direction != "In") return Results.BadRequest("Satış tahsilatı giriş yönünde olmalıdır.");
                if (request.Amount > sale.TotalPrice - sale.PaidAmount + 0.005m) return Results.BadRequest("Tahsilat satışın açık bakiyesini aşamaz.");
            }
            var payment = new Payment
            {
                Direction = request.Direction,
                Method = request.Method,
                Amount = decimal.Round(request.Amount, 2),
                SaleId = request.SaleId,
                DealerId = ScopeDealer(ctx) ?? request.DealerId,
                CustomerId = request.CustomerId ?? serviceOrder?.CustomerId,
                ServiceOrderId = request.ServiceOrderId,
                Counterparty = Clean(request.Counterparty),
                Note = Clean(request.Note),
                PaymentDate = request.PaymentDate?.ToUniversalTime() ?? DateTime.UtcNow,
                IdempotencyKey = idempotencyKey,
            };
            db.Payments.Add(payment);
            await db.SaveChangesAsync();
            if (sale is not null)
                sale.PaidAmount = Math.Min(sale.TotalPrice, sale.PaidAmount + payment.Amount);
            if (serviceOrder is not null)
                serviceOrder.PaidAmount = Math.Min(serviceOrder.Total, serviceOrder.PaidAmount + payment.Amount);
            db.AuditLogs.Add(new AuditLog
            {
                Username = ctx.Items["username"]?.ToString() ?? "system",
                Action = "create",
                Entity = "Payment",
                EntityId = payment.Id.ToString(),
                Details = $"{payment.Direction} {payment.Method} {payment.Amount:N2} TL{(sale is null ? "" : $" · Satış #{sale.Id}")}{(serviceOrder is null ? "" : $" · Servis #{serviceOrder.OrderNo}")}",
            });
            await acc.PostPaymentAsync(payment);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.Created($"/api/payments/{payment.Id}", payment);
        });

        app.MapGet("/api/reports/trial-balance", async (DateTime? asOf, AccountingService acc) => Results.Ok(await acc.TrialBalanceAsync(asOf)));
        app.MapGet("/api/reports/balance-sheet", async (DateTime? asOf, AccountingService acc) => Results.Ok(await acc.BalanceSheetAsync(asOf)));
        app.MapGet("/api/reports/income-statement", async (DateTime? from, DateTime? to, AccountingService acc) =>
        {
            var start = from ?? new DateTime(DateTime.UtcNow.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            var end = to ?? DateTime.UtcNow;
            return Results.Ok(await acc.IncomeStatementAsync(start, end));
        });
        app.MapGet("/api/reports/dealer-performance", async (HttpContext ctx, AppDbContext db) =>
        {
            if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var sales = await db.Sales.AsNoTracking().Where(s => !s.IsCancelled).ToListAsync();
            var dealers = await db.Dealers.AsNoTracking().ToListAsync();
            var rows = dealers.Select(d =>
            {
                var ds = sales.Where(s => s.DealerId == d.Id).ToList();
                var revenue = ds.Sum(s => s.TotalPrice);
                var cogs = ds.Sum(s => s.UnitCostAtSale * s.Quantity);
                var commission = decimal.Round(revenue * d.CommissionPercent / 100m, 2);
                return new { d.Id, d.Name, d.Code, saleCount = ds.Count, units = ds.Sum(s => s.Quantity), revenue, cost = cogs, grossProfit = revenue - cogs, commission, receivable = ds.Sum(s => s.TotalPrice - s.PaidAmount) };
            }).OrderByDescending(r => r.revenue);
            return Results.Ok(rows);
        });
    }

    static object Tdto(StockTransfer t) => new
    {
        t.Id, t.MotorcycleId, motorcycle = t.Motorcycle is null ? null : $"{t.Motorcycle.Brand} {t.Motorcycle.Model}",
        t.FromDealerId, fromDealer = t.FromDealer?.Name, t.ToDealerId, toDealer = t.ToDealer?.Name,
        t.Quantity, t.UnitCost, t.TransferType, t.Status, t.Note, t.CreatedAt, t.ShippedAt, t.ReceivedAt,
    };

    static string? ReadIdempotencyKey(HttpContext ctx)
    {
        var value = ctx.Request.Headers["Idempotency-Key"].ToString().Trim();
        return value.Length > 0 ? value : null;
    }
    static bool IsAdmin(HttpContext c) => c.Items["role"]?.ToString() == "Admin";
    static int? ScopeDealer(HttpContext c) => c.Items["dealerId"] is int id ? id : null;
    static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

public record DealerRequest(string Code, string Name, string? City, string? Phone, string? TaxNumber, string? Address, decimal CommissionPercent, decimal CreditLimit, bool IsActive = true);
public record TransferRequest(int MotorcycleId, int FromDealerId, int ToDealerId, int Quantity, string TransferType, string? Note);
public record ManualJournalRequest(string Description, DateTime? EntryDate, List<ManualJournalLine> Lines);
public record ManualJournalLine(string Code, decimal Debit, decimal Credit, string? Memo);
public record PaymentRequest(string Direction, string Method, decimal Amount, int? SaleId, int? DealerId, int? CustomerId, string? Counterparty, string? Note, DateTime? PaymentDate, int? ServiceOrderId = null);
