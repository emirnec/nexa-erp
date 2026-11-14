using Microsoft.EntityFrameworkCore;
using MotorcycleSales.Api.Data;
using MotorcycleSales.Api.Models;

namespace MotorcycleSales.Api;

public static class CrmEndpoints
{
    public static void MapCrm(this WebApplication app)
    {
        app.MapGet("/api/reports/receivables-aging", async (HttpContext ctx, AppDbContext db) =>
        {
            if (ctx.Items["role"]?.ToString() is not ("Admin" or "Staff")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var asOf = DateTime.UtcNow;
            var sales = await db.Sales.AsNoTracking()
                .Where(s => !s.IsCancelled)
                .Include(s => s.Installments)
                .ToListAsync();
            var customers = await db.Customers.AsNoTracking().ToDictionaryAsync(c => c.Id);
            var serviceOrders = await db.ServiceOrders.AsNoTracking()
                .Where(s => s.Status == "Invoiced" && s.Total > s.PaidAmount)
                .Include(s => s.Customer)
                .ToListAsync();

            var rows = new Dictionary<int, AgingRow>();
            foreach (var sale in sales)
            {
                var outstanding = sale.TotalPrice - sale.PaidAmount;
                if (outstanding <= 0.005m || sale.CustomerId is not int customerId) continue;
                customers.TryGetValue(customerId, out var customer);
                var row = GetRow(rows, customerId, customer?.FullName ?? sale.CustomerName, customer?.Phone ?? sale.CustomerPhone);
                foreach (var part in Allocate(sale, outstanding))
                {
                    AddBucket(row, part.DueDate, part.Amount, asOf);
                    row.Total += part.Amount;
                }
            }
            foreach (var order in serviceOrders)
            {
                if (order.CustomerId is not int customerId) continue;
                var row = GetRow(rows, customerId, order.Customer?.FullName ?? $"Müşteri #{customerId}", order.Customer?.Phone);
                var outstanding = order.Total - order.PaidAmount;
                AddBucket(row, order.DueDate ?? order.InvoicedAt?.AddDays(30) ?? order.OpenedAt.AddDays(30), outstanding, asOf);
                row.Total += outstanding;
            }

            var list = rows.Values.OrderByDescending(x => x.Total).ToList();
            return Results.Ok(new
            {
                asOf,
                totalOutstanding = list.Sum(x => x.Total),
                buckets = new
                {
                    current = list.Sum(x => x.Current),
                    days1To30 = list.Sum(x => x.Days1To30),
                    days31To60 = list.Sum(x => x.Days31To60),
                    days61To90 = list.Sum(x => x.Days61To90),
                    days90Plus = list.Sum(x => x.Days90Plus),
                },
                customers = list,
            });
        });

        app.MapGet("/api/customers/{id:int}/account", async (int id, HttpContext ctx, AppDbContext db) =>
        {
            if (ctx.Items["role"]?.ToString() is not ("Admin" or "Staff")) return Results.StatusCode(StatusCodes.Status403Forbidden);
            var customer = await db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
            if (customer is null) return Results.NotFound("Müşteri bulunamadı.");
            var sales = await db.Sales.AsNoTracking()
                .Where(s => s.CustomerId == id)
                .Include(s => s.Installments)
                .OrderByDescending(s => s.SaleDate)
                .ToListAsync();
            var orders = await db.ServiceOrders.AsNoTracking()
                .Where(s => s.CustomerId == id)
                .OrderByDescending(s => s.OpenedAt)
                .ToListAsync();
            var payments = await db.Payments.AsNoTracking()
                .Where(p => p.CustomerId == id)
                .OrderByDescending(p => p.PaymentDate)
                .Take(200)
                .ToListAsync();

            var saleRows = sales.Select(s =>
            {
                var paid = s.PaidAmount;
                var installments = s.Installments.OrderBy(x => x.Sequence).Select(x =>
                {
                    var applied = Math.Min(x.Amount, paid);
                    paid -= applied;
                    return new { x.Id, x.Sequence, x.DueDate, x.Amount, paidAmount = applied, remaining = x.Amount - applied };
                }).ToList();
                return new
                {
                    s.Id, s.InvoiceNo, s.SaleDate, s.TotalPrice, s.PaidAmount,
                    outstanding = Math.Max(0, s.TotalPrice - s.PaidAmount),
                    s.DueDate, s.InstallmentCount, s.IsCancelled, s.Status,
                    installments,
                };
            }).ToList();
            var orderRows = orders.Select(o => new
            {
                o.Id, o.OrderNo, o.InvoiceNo, o.OpenedAt, o.InvoicedAt, o.Total, o.PaidAmount,
                outstanding = o.Status == "Invoiced" ? Math.Max(0, o.Total - o.PaidAmount) : 0,
                o.DueDate, o.Status,
            }).ToList();
            var totalOutstanding = saleRows.Where(x => !x.IsCancelled).Sum(x => x.outstanding) + orderRows.Sum(x => x.outstanding);
            return Results.Ok(new
            {
                customer = new { customer.Id, customer.FullName, customer.Phone, customer.Email, customer.CreditLimit },
                totalOutstanding,
                creditLimit = customer.CreditLimit,
                creditAvailable = customer.CreditLimit > 0 ? Math.Max(0, customer.CreditLimit - totalOutstanding) : (decimal?)null,
                sales = saleRows,
                serviceOrders = orderRows,
                payments,
            });
        });
    }

    static AgingRow GetRow(Dictionary<int, AgingRow> rows, int id, string name, string? phone)
    {
        if (!rows.TryGetValue(id, out var row))
        {
            row = new AgingRow { CustomerId = id, CustomerName = name, Phone = phone };
            rows[id] = row;
        }
        return row;
    }

    static IEnumerable<(DateTime DueDate, decimal Amount)> Allocate(Sale sale, decimal outstanding)
    {
        var remaining = outstanding;
        foreach (var installment in sale.Installments.OrderBy(x => x.Sequence))
        {
            var amount = Math.Min(installment.Amount, remaining);
            if (amount > 0.005m) yield return (installment.DueDate, amount);
            remaining -= amount;
            if (remaining <= 0.005m) yield break;
        }
        if (remaining > 0.005m)
            yield return (sale.DueDate ?? sale.SaleDate.AddDays(30), remaining);
    }

    static void AddBucket(AgingRow row, DateTime dueDate, decimal amount, DateTime asOf)
    {
        var days = (asOf.Date - dueDate.Date).Days;
        if (days <= 0) row.Current += amount;
        else if (days <= 30) row.Days1To30 += amount;
        else if (days <= 60) row.Days31To60 += amount;
        else if (days <= 90) row.Days61To90 += amount;
        else row.Days90Plus += amount;
    }

    sealed class AgingRow
    {
        public int CustomerId { get; set; }
        public string CustomerName { get; set; } = "";
        public string? Phone { get; set; }
        public decimal Current { get; set; }
        public decimal Days1To30 { get; set; }
        public decimal Days31To60 { get; set; }
        public decimal Days61To90 { get; set; }
        public decimal Days90Plus { get; set; }
        public decimal Total { get; set; }
    }
}
