using Microsoft.EntityFrameworkCore;
using MotorcycleSales.Api.Models;

namespace MotorcycleSales.Api.Data;

public class AccountingService(AppDbContext db)
{
    public static readonly (string Code, string Name, string Type)[] DefaultAccounts =
    [
        ("100", "Kasa", "Asset"),
        ("102", "Bankalar", "Asset"),
        ("120", "Alıcılar", "Asset"),
        ("153", "Ticari Mallar", "Asset"),
        ("320", "Satıcılar", "Liability"),
        ("331", "Bayilere Borçlar", "Liability"),
        ("500", "Sermaye", "Equity"),
        ("590", "Dönem Net Kârı", "Equity"),
        ("600", "Yurtiçi Satışlar", "Income"),
        ("610", "Satış İadeleri", "Income"),
        ("621", "Satılan Ticari Mallar Maliyeti", "Expense"),
        ("760", "Pazarlama Satış Dağıtım Giderleri", "Expense"),
        ("770", "Genel Yönetim Giderleri", "Expense"),
        ("780", "Finansman Giderleri", "Expense"),
    ];

    public async Task EnsureReadyAsync()
    {
        if (!await db.Dealers.AnyAsync())
        {
            db.Dealers.Add(new Dealer
            {
                Code = "HQ",
                Name = "Merkez Depo / Genel Müdürlük",
                City = "Merkez",
                IsHeadquarters = true,
                CommissionPercent = 0,
                CreditLimit = 0,
            });
            await db.SaveChangesAsync();
        }

        if (!await db.Accounts.AnyAsync())
        {
            foreach (var (code, name, type) in DefaultAccounts)
                db.Accounts.Add(new Account { Code = code, Name = name, Type = type, IsSystem = true });
            await db.SaveChangesAsync();
        }
    }

    public async Task<Dealer> HeadquartersAsync() =>
        await db.Dealers.FirstAsync(d => d.IsHeadquarters && d.IsActive);

    public async Task<int> GetHqStockAsync(int motorcycleId) =>
        await db.Motorcycles.Where(m => m.Id == motorcycleId).Select(m => m.StockQuantity).SingleAsync();

    public async Task<int> GetDealerStockAsync(int dealerId, int motorcycleId)
    {
        var hq = await db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealerId);
        if (hq is { IsHeadquarters: true }) return await GetHqStockAsync(motorcycleId);
        return await db.DealerStocks.Where(s => s.DealerId == dealerId && s.MotorcycleId == motorcycleId)
            .Select(s => s.Quantity).FirstOrDefaultAsync();
    }

    public async Task AdjustLocationStockAsync(int dealerId, int motorcycleId, int delta)
    {
        var dealer = await db.Dealers.FirstOrDefaultAsync(d => d.Id == dealerId)
            ?? throw new InvalidOperationException("Bayi bulunamadı.");
        if (dealer.IsHeadquarters)
        {
            var moto = await db.Motorcycles.FirstOrDefaultAsync(m => m.Id == motorcycleId)
                ?? throw new InvalidOperationException("Motosiklet bulunamadı.");
            if (moto.StockQuantity + delta < 0) throw new InvalidOperationException("Yetersiz stok.");
            moto.StockQuantity += delta;
            return;
        }

        var row = await db.DealerStocks.FirstOrDefaultAsync(s => s.DealerId == dealerId && s.MotorcycleId == motorcycleId);
        if (row is null)
        {
            if (delta < 0) throw new InvalidOperationException("Yetersiz bayi stoğu.");
            db.DealerStocks.Add(new DealerStock { DealerId = dealerId, MotorcycleId = motorcycleId, Quantity = delta });
            return;
        }
        if (row.Quantity + delta < 0) throw new InvalidOperationException("Yetersiz bayi stoğu.");
        row.Quantity += delta;
    }

    public async Task<JournalEntry> PostAsync(string source, int? sourceId, string description, DateTime date,
        IReadOnlyList<(string Code, decimal Debit, decimal Credit, string? Memo)> lines)
    {
        var valid = lines.Where(l => l.Debit != 0 || l.Credit != 0).ToList();
        if (valid.Count == 0) throw new InvalidOperationException("Yevmiye satırı yok.");
        var debit = valid.Sum(l => l.Debit);
        var credit = valid.Sum(l => l.Credit);
        if (debit != credit) throw new InvalidOperationException($"Yevmiye dengesiz: borç {debit:N2} alacak {credit:N2}.");

        var codes = valid.Select(l => l.Code).Distinct().ToList();
        var accounts = await db.Accounts.Where(a => codes.Contains(a.Code)).ToListAsync();
        JournalLine Map((string Code, decimal Debit, decimal Credit, string? Memo) line)
        {
            var acc = accounts.FirstOrDefault(a => a.Code == line.Code)
                ?? throw new InvalidOperationException($"Hesap bulunamadı: {line.Code}");
            return new JournalLine { AccountId = acc.Id, Debit = decimal.Round(line.Debit, 2), Credit = decimal.Round(line.Credit, 2), Memo = line.Memo };
        }

        var entry = new JournalEntry
        {
            EntryDate = date.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(date, DateTimeKind.Utc) : date.ToUniversalTime(),
            Description = description,
            Source = source,
            SourceId = sourceId,
            Lines = valid.Select(Map).ToList(),
        };
        db.JournalEntries.Add(entry);
        await db.SaveChangesAsync();
        return entry;
    }

    public async Task ReverseBySourceAsync(string source, int sourceId, string note)
    {
        var originals = await db.JournalEntries.Include(j => j.Lines)
            .Where(j => j.Source == source && j.SourceId == sourceId && !j.IsReversed && j.ReversesEntryId == null)
            .ToListAsync();
        foreach (var original in originals)
        {
            original.IsReversed = true;
            var reverse = new JournalEntry
            {
                EntryDate = DateTime.UtcNow,
                Description = note,
                Source = source,
                SourceId = sourceId,
                ReversesEntryId = original.Id,
                Lines = original.Lines.Select(l => new JournalLine
                {
                    AccountId = l.AccountId,
                    Debit = l.Credit,
                    Credit = l.Debit,
                    Memo = "Ters kayıt",
                }).ToList(),
            };
            db.JournalEntries.Add(reverse);
        }
        await db.SaveChangesAsync();
    }

    public async Task PostSaleAsync(Sale sale, decimal commissionPercent)
    {
        // Satış nakit + kart olarak bölünebilir. Yeni kayıtlarda tutarlar doğrudan
        // Sale.CashAmount/CardAmount alanlarından gelir; eski kayıtlarda tek tutarlı
        // PaidAmount ve PaymentMethod alanlarına geri düşülür.
        var cashPart = sale.CashAmount;
        var cardPart = sale.CardAmount;
        if (cashPart == 0 && cardPart == 0 && sale.PaidAmount > 0)
        {
            if (sale.PaymentMethod is "Bank" or "Card") cardPart = sale.PaidAmount;
            else cashPart = sale.PaidAmount;
        }
        cashPart = Math.Clamp(decimal.Round(cashPart, 2), 0, sale.TotalPrice);
        cardPart = Math.Clamp(decimal.Round(cardPart, 2), 0, sale.TotalPrice - cashPart);
        var receivable = sale.TotalPrice - cashPart - cardPart;
        // Ek ürün/hizmetlerin de maliyeti satılan mal maliyetine eklenir; aksi halde
        // aksesuar satışı kârı olduğundan yüksek görünür.
        var extrasCost = await db.SaleExtras.Where(x => x.SaleId == sale.Id)
            .SumAsync(x => (decimal?)(x.UnitCost * x.Quantity)) ?? 0m;
        var cogs = decimal.Round(sale.UnitCostAtSale * sale.Quantity + extrasCost, 2);
        var lines = new List<(string, decimal, decimal, string?)>
        {
            ("100", cashPart, 0, "Nakit tahsilat"),
            ("102", cardPart, 0, "Kart/banka tahsilatı"),
            ("120", receivable, 0, "Açık bakiye"),
            ("600", 0, sale.TotalPrice, "Satış geliri"),
            ("621", cogs, 0, "Satılan mal maliyeti"),
            ("153", 0, cogs, "Stok çıkışı"),
        };
        if (commissionPercent > 0 && sale.Channel == "DealerRetail")
        {
            var commission = decimal.Round(sale.TotalPrice * commissionPercent / 100m, 2);
            if (commission > 0)
            {
                lines.Add(("760", commission, 0, "Bayi komisyonu"));
                lines.Add(("331", 0, commission, "Bayi borcu"));
            }
        }
        await PostAsync("Sale", sale.Id, $"Satış #{sale.Id} {sale.InvoiceNo}", sale.SaleDate, lines);
    }

    public async Task PostServiceOrderAsync(ServiceOrder order, decimal cost)
    {
        if (order.Total <= 0) return;
        var debit = order.PaymentMethod switch { "Cash" => "100", "Card" => "102", _ => "120" };
        var lines = new List<(string, decimal, decimal, string?)>
        {
            (debit, order.Total, 0, "Servis tahsilatı"),
            ("600", 0, order.Total, "Servis geliri"),
        };
        if (cost > 0)
        {
            lines.Add(("621", cost, 0, "Servis parça maliyeti"));
            lines.Add(("153", 0, cost, "Parça stok çıkışı"));
        }
        await PostAsync("ServiceOrder", order.Id, $"Servis faturası {order.InvoiceNo}", order.InvoicedAt ?? DateTime.UtcNow, lines);
    }

    public async Task PostPurchaseAsync(int movementId, decimal amount, string note) =>
        await PostAsync("Purchase", movementId, note, DateTime.UtcNow,
        [
            ("153", amount, 0, "Stok girişi"),
            ("320", 0, amount, "Satıcı borcu"),
        ]);

    public async Task PostExpenseAsync(Expense expense)
    {
        var code = expense.Category.Contains("pazarlama", StringComparison.OrdinalIgnoreCase) || expense.Category.Contains("reklam", StringComparison.OrdinalIgnoreCase) ? "760"
            : expense.Category.Contains("finans", StringComparison.OrdinalIgnoreCase) || expense.Category.Contains("faiz", StringComparison.OrdinalIgnoreCase) ? "780"
            : "770";
        await PostAsync("Expense", expense.Id, expense.Description, expense.ExpenseDate,
        [
            (code, expense.Amount, 0, expense.Category),
            ("100", 0, expense.Amount, "Kasa ödeme"),
        ]);
    }

    public async Task PostPaymentAsync(Payment payment)
    {
        var cash = payment.Method is "Bank" or "Card" ? "102" : "100";
        var counterpart = payment.DealerId.HasValue && payment.Direction == "Out" ? "331"
            : payment.Direction == "Out" ? "320"
            : "120";
        var lines = payment.Direction == "In"
            ? new List<(string, decimal, decimal, string?)> { (cash, payment.Amount, 0, payment.Method), (counterpart, 0, payment.Amount, "Tahsilat") }
            : new List<(string, decimal, decimal, string?)> { (counterpart, payment.Amount, 0, "Tediye"), (cash, 0, payment.Amount, payment.Method) };
        await PostAsync("Payment", payment.Id, payment.Note ?? $"{payment.Direction} {payment.Amount:N2}", payment.PaymentDate, lines);
    }

    public async Task PostWholesaleTransferAsync(StockTransfer transfer)
    {
        var amount = decimal.Round(transfer.UnitCost * transfer.Quantity, 2);
        await PostAsync("Transfer", transfer.Id, $"Toptan sevk #{transfer.Id}", DateTime.UtcNow,
        [
            ("120", amount, 0, "Bayi alacağı"),
            ("600", 0, amount, "Toptan satış"),
            ("621", amount, 0, "Maliyet"),
            ("153", 0, amount, "Stok çıkışı"),
        ]);
    }

    public async Task<object> TrialBalanceAsync(DateTime? asOf)
    {
        var cutoff = asOf?.ToUniversalTime() ?? DateTime.UtcNow;
        var rows = await (
            from l in db.JournalLines.AsNoTracking()
            join e in db.JournalEntries.AsNoTracking() on l.JournalEntryId equals e.Id
            join a in db.Accounts.AsNoTracking() on l.AccountId equals a.Id
            where e.EntryDate <= cutoff
            group new { l.Debit, l.Credit } by new { a.Code, a.Name, a.Type } into g
            select new
            {
                g.Key.Code,
                g.Key.Name,
                g.Key.Type,
                debit = g.Sum(x => x.Debit),
                credit = g.Sum(x => x.Credit),
                balance = g.Sum(x => x.Debit) - g.Sum(x => x.Credit),
            }).OrderBy(x => x.Code).ToListAsync();
        return new { asOf = cutoff, rows, totalDebit = rows.Sum(r => r.debit), totalCredit = rows.Sum(r => r.credit) };
    }

    public async Task<object> BalanceSheetAsync(DateTime? asOf)
    {
        var trial = await BalancesAsync(asOf);
        // JSON'da item1/item2/item3 yerine code/name/amount dönmesi için açık nesne kullanılır.
        var assets = trial.Where(a => a.Type == "Asset").Select(a => new { a.Code, a.Name, amount = a.Balance }).ToList();
        var liabilities = trial.Where(a => a.Type == "Liability").Select(a => new { a.Code, a.Name, amount = -a.Balance }).ToList();
        var equity = trial.Where(a => a.Type == "Equity").Select(a => new { a.Code, a.Name, amount = -a.Balance }).ToList();
        var income = trial.Where(a => a.Type == "Income").Sum(a => -a.Balance);
        var expense = trial.Where(a => a.Type == "Expense").Sum(a => a.Balance);
        var net = income - expense;
        var totalAssets = assets.Sum(r => r.amount);
        var totalLiabEq = liabilities.Sum(r => r.amount) + equity.Sum(r => r.amount) + net;
        return new
        {
            asOf = asOf?.ToUniversalTime() ?? DateTime.UtcNow,
            assets,
            liabilities,
            equity,
            netIncome = net,
            totalAssets,
            totalLiabilitiesAndEquity = totalLiabEq,
            balanced = totalAssets == totalLiabEq,
        };
    }

    public async Task<object> IncomeStatementAsync(DateTime from, DateTime to)
    {
        var start = from.ToUniversalTime();
        var end = to.ToUniversalTime();
        var rows = await (
            from l in db.JournalLines.AsNoTracking()
            join e in db.JournalEntries.AsNoTracking() on l.JournalEntryId equals e.Id
            join a in db.Accounts.AsNoTracking() on l.AccountId equals a.Id
            where e.EntryDate >= start && e.EntryDate <= end && (a.Type == "Income" || a.Type == "Expense")
            group new { l.Debit, l.Credit } by new { a.Code, a.Name, a.Type } into g
            select new { g.Key.Code, g.Key.Name, g.Key.Type, amount = g.Sum(x => x.Debit - x.Credit) }
        ).OrderBy(x => x.Code).ToListAsync();

        var revenue = rows.Where(r => r.Type == "Income").Sum(r => -r.amount);
        var expenses = rows.Where(r => r.Type == "Expense").Sum(r => r.amount);
        return new { from = start, to = end, rows = rows.Select(r => new { r.Code, r.Name, r.Type, amount = r.Type == "Income" ? -r.amount : r.amount }), revenue, expenses, netIncome = revenue - expenses };
    }

    async Task<List<(string Code, string Name, string Type, decimal Balance)>> BalancesAsync(DateTime? asOf)
    {
        var cutoff = asOf?.ToUniversalTime() ?? DateTime.UtcNow;
        var raw = await (
            from l in db.JournalLines.AsNoTracking()
            join e in db.JournalEntries.AsNoTracking() on l.JournalEntryId equals e.Id
            join a in db.Accounts.AsNoTracking() on l.AccountId equals a.Id
            where e.EntryDate <= cutoff
            group new { l.Debit, l.Credit } by new { a.Code, a.Name, a.Type } into g
            select new { g.Key.Code, g.Key.Name, g.Key.Type, Balance = g.Sum(x => x.Debit - x.Credit) }
        ).ToListAsync();
        return raw.Select(x => (x.Code, x.Name, x.Type, x.Balance)).ToList();
    }
}
