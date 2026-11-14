using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using MotorcycleSales.Api.Models;

namespace MotorcycleSales.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    /// <summary>Set by authentication middleware before any tenant-owned data is queried.</summary>
    public int? CurrentTenantId { get; set; }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Motorcycle> Motorcycles => Set<Motorcycle>();
    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<SaleExtra> SaleExtras => Set<SaleExtra>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<Expense> Expenses => Set<Expense>();
    public DbSet<AppUser> AppUsers => Set<AppUser>();
    public DbSet<Dealer> Dealers => Set<Dealer>();
    public DbSet<DealerStock> DealerStocks => Set<DealerStock>();
    public DbSet<StockTransfer> StockTransfers => Set<StockTransfer>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalLine> JournalLines => Set<JournalLine>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<WorkflowRecord> WorkflowRecords => Set<WorkflowRecord>();
    public DbSet<CatalogListing> CatalogListings => Set<CatalogListing>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Tenant>().HasIndex(t => t.Slug).IsUnique();
        modelBuilder.Entity<Tenant>().Property(t => t.Name).HasMaxLength(180);
        modelBuilder.Entity<Tenant>().Property(t => t.Slug).HasMaxLength(80);

        // ORM relationships remain keyed by the existing primary keys. The SQL upgrade also
        // adds tenant-aware composite foreign keys, so PostgreSQL rejects cross-tenant references.
        modelBuilder.Entity<Sale>().HasOne(s => s.Motorcycle).WithMany().HasForeignKey(s => s.MotorcycleId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Sale>().HasOne<Customer>().WithMany().HasForeignKey(s => s.CustomerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Sale>().HasOne<Dealer>().WithMany().HasForeignKey(s => s.DealerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<SaleExtra>().HasOne(x => x.Sale).WithMany(s => s.Extras).HasForeignKey(x => x.SaleId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<StockMovement>().HasOne(m => m.Motorcycle).WithMany().HasForeignKey(m => m.MotorcycleId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<DealerStock>().HasOne(s => s.Dealer).WithMany().HasForeignKey(s => s.DealerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<DealerStock>().HasOne(s => s.Motorcycle).WithMany().HasForeignKey(s => s.MotorcycleId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<StockTransfer>().HasOne(t => t.Motorcycle).WithMany().HasForeignKey(t => t.MotorcycleId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<StockTransfer>().HasOne(t => t.FromDealer).WithMany().HasForeignKey(t => t.FromDealerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<StockTransfer>().HasOne(t => t.ToDealer).WithMany().HasForeignKey(t => t.ToDealerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<JournalLine>().HasOne(l => l.JournalEntry).WithMany(e => e.Lines).HasForeignKey(l => l.JournalEntryId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<JournalLine>().HasOne(l => l.Account).WithMany().HasForeignKey(l => l.AccountId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<AppUser>().HasOne<Dealer>().WithMany().HasForeignKey(u => u.DealerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Payment>().HasOne<Sale>().WithMany().HasForeignKey(p => p.SaleId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Payment>().HasOne<Dealer>().WithMany().HasForeignKey(p => p.DealerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Payment>().HasOne<Customer>().WithMany().HasForeignKey(p => p.CustomerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<WorkflowRecord>().HasOne<Customer>().WithMany().HasForeignKey(w => w.CustomerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<WorkflowRecord>().HasOne<Motorcycle>().WithMany().HasForeignKey(w => w.MotorcycleId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<WorkflowRecord>().HasOne<Dealer>().WithMany().HasForeignKey(w => w.DealerId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<CatalogListing>().HasOne<Motorcycle>().WithMany().HasForeignKey(c => c.MotorcycleId).OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Sale>().Property(s => s.UnitPrice).HasPrecision(18, 2);
        modelBuilder.Entity<Sale>().Property(s => s.UnitCostAtSale).HasPrecision(18, 2);
        modelBuilder.Entity<Sale>().Property(s => s.PaidAmount).HasPrecision(18, 2);
        modelBuilder.Entity<Sale>().Property(s => s.CashAmount).HasPrecision(18, 2);
        modelBuilder.Entity<Sale>().Property(s => s.CardAmount).HasPrecision(18, 2);
        modelBuilder.Entity<Sale>().Property(s => s.ExtrasTotal).HasPrecision(18, 2);
        modelBuilder.Entity<SaleExtra>().Property(x => x.UnitPrice).HasPrecision(18, 2);
        modelBuilder.Entity<SaleExtra>().Property(x => x.UnitCost).HasPrecision(18, 2);
        modelBuilder.Entity<Sale>().Property(s => s.IsCancelled).HasDefaultValue(false);
        modelBuilder.Entity<Motorcycle>().Property(m => m.PurchaseCost).HasPrecision(18, 2);
        modelBuilder.Entity<StockMovement>().Property(m => m.UnitCost).HasPrecision(18, 2);
        modelBuilder.Entity<Expense>().Property(e => e.Amount).HasPrecision(18, 2);
        modelBuilder.Entity<Dealer>().Property(d => d.CommissionPercent).HasPrecision(5, 2);
        modelBuilder.Entity<Dealer>().Property(d => d.CreditLimit).HasPrecision(18, 2);
        modelBuilder.Entity<StockTransfer>().Property(t => t.UnitCost).HasPrecision(18, 2);
        modelBuilder.Entity<JournalLine>().Property(l => l.Debit).HasPrecision(18, 2);
        modelBuilder.Entity<JournalLine>().Property(l => l.Credit).HasPrecision(18, 2);
        modelBuilder.Entity<Payment>().Property(p => p.Amount).HasPrecision(18, 2);
        modelBuilder.Entity<WorkflowRecord>().Property(x => x.Amount).HasPrecision(18, 2);
        // PostgreSQL upgrade scripts create these as jsonb; map string properties so Npgsql
        // sends jsonb parameters instead of text (otherwise INSERT/UPDATE fails with 42804).
        modelBuilder.Entity<WorkflowRecord>().Property(x => x.Payload).HasColumnType("jsonb");
        modelBuilder.Entity<CatalogListing>().Property(x => x.ImageUrls).HasColumnType("jsonb");

        modelBuilder.Entity<AppUser>().HasIndex(u => new { u.TenantId, u.Username }).IsUnique();
        modelBuilder.Entity<Customer>().HasIndex(c => new { c.TenantId, c.Phone });
        modelBuilder.Entity<StockMovement>().HasIndex(m => new { m.TenantId, m.MotorcycleId, m.CreatedAt });
        modelBuilder.Entity<Expense>().HasIndex(e => new { e.TenantId, e.ExpenseDate });
        modelBuilder.Entity<Dealer>().HasIndex(d => new { d.TenantId, d.Code }).IsUnique();
        modelBuilder.Entity<Account>().HasIndex(a => new { a.TenantId, a.Code }).IsUnique();
        modelBuilder.Entity<DealerStock>().HasIndex(s => new { s.TenantId, s.DealerId, s.MotorcycleId }).IsUnique();
        modelBuilder.Entity<CatalogListing>().HasIndex(x => new { x.TenantId, x.MotorcycleId }).IsUnique();
        modelBuilder.Entity<WorkflowRecord>().HasIndex(x => new { x.TenantId, x.Module, x.DueAt });
        modelBuilder.Entity<AuditLog>().HasIndex(x => new { x.TenantId, x.CreatedAt });
        modelBuilder.Entity<SaleExtra>().HasIndex(x => new { x.TenantId, x.SaleId });
        modelBuilder.Entity<Sale>().HasIndex(x => new { x.TenantId, x.SaleDate });

        // A missing tenant context returns no tenant-owned rows (fail closed).
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().Where(t => typeof(ITenantEntity).IsAssignableFrom(t.ClrType)))
        {
            var parameter = Expression.Parameter(entityType.ClrType, "row");
            var tenantProperty = Expression.Property(parameter, nameof(ITenantEntity.TenantId));
            var contextProperty = Expression.Property(Expression.Constant(this), nameof(CurrentTenantId));
            var hasTenant = Expression.Property(contextProperty, nameof(Nullable<int>.HasValue));
            var tenantValue = Expression.Property(contextProperty, nameof(Nullable<int>.Value));
            var body = Expression.AndAlso(hasTenant, Expression.Equal(tenantProperty, tenantValue));
            modelBuilder.Entity(entityType.ClrType).HasQueryFilter(Expression.Lambda(body, parameter));
        }
    }

    public override int SaveChanges()
    {
        ApplyTenantScope();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        ApplyTenantScope();
        return base.SaveChangesAsync(cancellationToken);
    }

    private void ApplyTenantScope()
    {
        foreach (var entry in ChangeTracker.Entries<ITenantEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                if (CurrentTenantId is null) throw new InvalidOperationException("Tenant context is required before writing business data.");
                if (entry.Entity.TenantId != 0 && entry.Entity.TenantId != CurrentTenantId.Value)
                    throw new InvalidOperationException("Cross-tenant write rejected.");
                entry.Entity.TenantId = CurrentTenantId.Value;
            }
            else if (entry.State is EntityState.Modified or EntityState.Deleted)
            {
                if (CurrentTenantId is null || entry.Entity.TenantId != CurrentTenantId.Value)
                    throw new InvalidOperationException("Cross-tenant write rejected.");
                if (entry.State == EntityState.Modified)
                    entry.Property(nameof(ITenantEntity.TenantId)).IsModified = false;
            }
        }
    }
}
