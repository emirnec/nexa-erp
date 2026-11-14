using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using MotorcycleSales.Api;
using MotorcycleSales.Api.Data;
using MotorcycleSales.Api.Models;

const string FrontendPolicy = "FrontendPolicy";
var builder = WebApplication.CreateBuilder(args);
var configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").GetChildren().Select(section => section.Value).Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!).ToArray();

builder.Services.AddCors(options => options.AddPolicy(FrontendPolicy, policy =>
    policy.SetIsOriginAllowed(origin =>
              origin.Equals("http://localhost:5173", StringComparison.OrdinalIgnoreCase) ||
              origin.Equals("http://127.0.0.1:5173", StringComparison.OrdinalIgnoreCase) ||
              configuredOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
          .AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));
builder.Services.AddScoped<AccountingService>();
builder.Services.AddOpenApi();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(new { message = "Çok fazla giriş denemesi. Bir dakika sonra tekrar deneyin." }, token);
    };
});
var app = builder.Build();
var reportTimeZone = ResolveTimeZone(builder.Configuration["SaaS:TimeZone"]);
var jwtSecret = builder.Configuration["Jwt:Secret"] ?? "LOCAL-ONLY-CHANGE-THIS-SECRET-32-CHARS-MINIMUM";
if (!app.Environment.IsDevelopment() && builder.Configuration["Jwt:Secret"] is null)
    throw new InvalidOperationException("Production ortamında Jwt:Secret yapılandırılmalıdır.");

app.UseCors(FrontendPolicy);
app.UseRateLimiter();
// Beklenmeyen hataları JSON olarak döndür; aksi halde frontend yalnızca
// "Satış tamamlanamadı" gibi genel bir mesaj gösterir ve nedeni gizli kalır.
app.Use(async (context, next) =>
{
    try { await next(); }
    catch (Exception ex)
    {
        var pg = ex as PostgresException ?? ex.InnerException as PostgresException;
        var schemaOutdated = pg is not null && pg.SqlState is "42703" or "42P01";
        app.Logger.LogError(ex, "Unhandled error for {Method} {Path}", context.Request.Method, context.Request.Path);
        if (context.Response.HasStarted) throw;
        context.Response.Clear();
        if (schemaOutdated)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { message = "Veritabanı şeması güncel değil (satış ödeme/ek kalem kolonları eksik). Sunucuda database/upgrade_v5_sale_payments.sql dosyasını uygulayıp API'yi yeniden başlatın." });
        }
        else
        {
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            var detail = app.Environment.IsDevelopment() ? $"Sunucu hatası: {ex.Message}" : "Sunucu hatası. Ayrıntı için API loglarına bakın (journalctl -u nexa-api -n 100 --no-pager).";
            await context.Response.WriteAsJsonAsync(new { message = detail });
        }
    }
});
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    var isPublic = path == "/api/auth/bootstrap" || path == "/api/auth/login" || path == "/api/platform/tenants/provision" ||
                   path.StartsWithSegments("/api/public/catalog") || path.StartsWithSegments("/api/health") ||
                   (app.Environment.IsDevelopment() && path.StartsWithSegments("/openapi"));
    if (isPublic) { await next(); return; }

    var header = context.Request.Headers.Authorization.ToString();
    if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ||
        !TryReadToken(header[7..], jwtSecret, out var username, out var role, out var tenantId))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { message = "Oturum gerekli veya süresi dolmuş. Yeniden giriş yapın." });
        return;
    }

    var authDb = context.RequestServices.GetRequiredService<AppDbContext>();
    var tenant = await authDb.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId && t.IsActive);
    if (tenant is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { message = "Bayi/işletme hesabı aktif değil." });
        return;
    }
    authDb.CurrentTenantId = tenantId;
    var user = await authDb.AppUsers.IgnoreQueryFilters().AsNoTracking()
        .FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Username == username && u.IsActive && u.Role == role);
    if (user is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { message = "Kullanıcı hesabı aktif değil." });
        return;
    }

    // Deneme/abonelik süresi dolan işletme iş verisine erişemez; plan ve profil
    // ekranları açık kalır ki kullanıcı yenileme talebi oluşturabilsin.
    var subscriptionBlock = SubscriptionBlock(tenant);
    if (subscriptionBlock is not null && !IsSubscriptionExempt(path, context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status402PaymentRequired;
        await context.Response.WriteAsJsonAsync(new
        {
            message = subscriptionBlock,
            code = "subscription_required",
            planKey = tenant.PlanKey,
            subscriptionStatus = tenant.SubscriptionStatus,
            trialEndsAt = tenant.TrialEndsAt,
        });
        return;
    }

    context.Items["tenantId"] = tenantId;
    context.Items["tenantSlug"] = tenant.Slug;
    context.Items["tenantName"] = tenant.Name;
    if (user.DealerId is int dealerId) context.Items["dealerId"] = dealerId;
    context.Items["username"] = username;
    context.Items["role"] = role;

    if (role != "Admin" && !IsStaffAllowed(path, context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { message = "Bu işlem için yönetici yetkisi gereklidir." });
        return;
    }

    await next();
});
if (app.Environment.IsDevelopment()) app.MapOpenApi();

// Tenant-specific accounting initialization is performed after login, once the tenant scope is known.

app.MapGet("/api/health", async (AppDbContext db) =>
{
    var databaseOk = await db.Database.CanConnectAsync();
    var payload = new { status = databaseOk ? "healthy" : "degraded", database = databaseOk ? "ok" : "unavailable", application = "MMS ERP Control Panel", timestamp = DateTime.UtcNow };
    return databaseOk ? Results.Ok(payload) : Results.Json(payload, statusCode: StatusCodes.Status503ServiceUnavailable);
});
app.MapErp();
app.MapOperations();

// İlk kurulum: yalnızca hiç kullanıcı yokken bir yönetici oluşturulabilir.
app.MapPost("/api/auth/bootstrap", async (BootstrapRequest request, AppDbContext db, AccountingService accounting) =>
{
    if (!app.Environment.IsDevelopment()) return Results.NotFound();
    if (await db.AppUsers.IgnoreQueryFilters().AnyAsync()) return Results.Conflict("İlk yönetici hesabı zaten oluşturulmuş.");
    if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Trim().Length < 3 ||
        string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 12)
        return Results.BadRequest("Kullanıcı adı en az 3, parola en az 12 karakter olmalıdır.");

    Tenant? tenant = null;
    if (!string.IsNullOrWhiteSpace(request.TenantSlug))
    {
        // Normalize outside the EF expression tree; EF Core can translate the captured scalar.
        var normalizedTenantSlug = NormalizeTenantSlug(request.TenantSlug);
        tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Slug == normalizedTenantSlug && t.IsActive);
    }
    else
    {
        var tenants = await db.Tenants.Where(t => t.IsActive).OrderBy(t => t.Id).Take(2).ToListAsync();
        if (tenants.Count == 1) tenant = tenants[0];
        else if (tenants.Count > 1) return Results.BadRequest("İlk kurulum için işletme kısa adını belirtin.");
    }

    if (tenant is null)
    {
        var name = string.IsNullOrWhiteSpace(request.TenantName) ? "Bayhas Motors" : request.TenantName.Trim();
        var slug = NormalizeTenantSlug(string.IsNullOrWhiteSpace(request.TenantSlug) ? name : request.TenantSlug);
        if (slug.Length < 3) return Results.BadRequest("İşletme kısa adı en az 3 karakter olmalıdır.");
        tenant = new Tenant { Name = name, Slug = slug, PlanKey = "Trial", SubscriptionStatus = "Trial", TrialEndsAt = DateTime.UtcNow.AddDays(14), MaxUsers = 5, MaxBranches = 1 };
        db.Tenants.Add(tenant); await db.SaveChangesAsync();
    }

    db.CurrentTenantId = tenant.Id;
    var user = new AppUser { Username = request.Username.Trim(), PasswordHash = HashPassword(request.Password), Role = "Admin" };
    db.AppUsers.Add(user); await db.SaveChangesAsync();
    await accounting.EnsureReadyAsync();
    return Results.Ok(new { token = CreateToken(user.Username, user.Role, tenant.Id, jwtSecret), username = user.Username, role = user.Role, tenantId = tenant.Id, tenantSlug = tenant.Slug, tenantName = tenant.Name });
});
app.MapPost("/api/auth/login", async (LoginRequest request, AppDbContext db, AccountingService accounting) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password)) return Results.Unauthorized();
    Tenant? tenant = null;
    if (!string.IsNullOrWhiteSpace(request.TenantSlug))
    {
        // Normalize outside the EF expression tree; EF Core can translate the captured scalar.
        var normalizedTenantSlug = NormalizeTenantSlug(request.TenantSlug);
        tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == normalizedTenantSlug && t.IsActive);
    }
    else
    {
        var activeTenants = await db.Tenants.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.Id).Take(2).ToListAsync();
        if (activeTenants.Count == 1) tenant = activeTenants[0];
        else if (activeTenants.Count > 1) return Results.BadRequest("Birden fazla işletme bulundu. İşletme kısa adını girin.");
    }
    if (tenant is null) return Results.Unauthorized();
    db.CurrentTenantId = tenant.Id;
    var user = await db.AppUsers.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.TenantId == tenant.Id && u.Username == request.Username.Trim() && u.IsActive);
    if (user is null || !VerifyPassword(request.Password, user.PasswordHash)) return Results.Unauthorized();
    await accounting.EnsureReadyAsync();
    return Results.Ok(new { token = CreateToken(user.Username, user.Role, tenant.Id, jwtSecret), username = user.Username, role = user.Role, tenantId = tenant.Id, tenantSlug = tenant.Slug, tenantName = tenant.Name });
}).RequireRateLimiting("login");
app.MapPost("/api/platform/tenants/provision", async (ProvisionTenantRequest request, HttpContext ctx, AppDbContext db, AccountingService accounting) =>
{
    var configuredKey = builder.Configuration["SaaS:ProvisioningKey"];
    var suppliedKey = ctx.Request.Headers["X-Provisioning-Key"].ToString();
    if (string.IsNullOrWhiteSpace(configuredKey)) return Results.StatusCode(503);
    var expectedBytes = Encoding.UTF8.GetBytes(configuredKey);
    var suppliedBytes = Encoding.UTF8.GetBytes(suppliedKey);
    if (expectedBytes.Length != suppliedBytes.Length || !CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes)) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(request.TenantName) || string.IsNullOrWhiteSpace(request.TenantSlug) ||
        string.IsNullOrWhiteSpace(request.OwnerUsername) || request.OwnerUsername.Trim().Length < 3 ||
        string.IsNullOrWhiteSpace(request.OwnerPassword) || request.OwnerPassword.Length < 12)
        return Results.BadRequest("İşletme adı/kısa adı ve en az 12 karakterlik yönetici parolası zorunludur.");
    var slug = NormalizeTenantSlug(request.TenantSlug);
    if (slug.Length < 3 || await db.Tenants.AnyAsync(t => t.Slug == slug)) return Results.Conflict("İşletme kısa adı geçersiz veya kullanımda.");
    var tenant = new Tenant { Name = request.TenantName.Trim(), Slug = slug, ContactEmail = Clean(request.ContactEmail), Phone = Clean(request.Phone), PlanKey = "Trial", SubscriptionStatus = "Trial", TrialEndsAt = DateTime.UtcNow.AddDays(14), MaxUsers = 5, MaxBranches = 1 };
    db.Tenants.Add(tenant); await db.SaveChangesAsync();
    db.CurrentTenantId = tenant.Id;
    var owner = new AppUser { Username = request.OwnerUsername.Trim(), PasswordHash = HashPassword(request.OwnerPassword), Role = "Admin" };
    db.AppUsers.Add(owner); await db.SaveChangesAsync();
    await accounting.EnsureReadyAsync();
    return Results.Created($"/api/platform/tenants/{tenant.Id}", new { tenant.Id, tenant.Name, tenant.Slug, owner.Username, tenant.PlanKey, tenant.SubscriptionStatus, tenant.TrialEndsAt });
});
app.MapGet("/api/auth/me", (HttpContext ctx) => Results.Ok(new { username = ctx.Items["username"], role = ctx.Items["role"], dealerId = ctx.Items["dealerId"], tenantId = ctx.Items["tenantId"], tenantSlug = ctx.Items["tenantSlug"], tenantName = ctx.Items["tenantName"] }));
app.MapPost("/api/auth/password", async (ChangePasswordRequest request, HttpContext ctx, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword))
        return Results.BadRequest("Mevcut ve yeni parola zorunludur.");
    if (request.NewPassword.Length < 12)
        return Results.BadRequest("Yeni parola en az 12 karakter olmalıdır.");
    if (request.NewPassword == request.CurrentPassword)
        return Results.BadRequest("Yeni parola mevcut paroladan farklı olmalıdır.");
    var username = ctx.Items["username"]?.ToString() ?? "";
    var user = await db.AppUsers.FirstOrDefaultAsync(u => u.Username == username);
    if (user is null) return Results.NotFound();
    if (!VerifyPassword(request.CurrentPassword, user.PasswordHash)) return Results.BadRequest("Mevcut parola doğru değil.");
    user.PasswordHash = HashPassword(request.NewPassword);
    db.AuditLogs.Add(new AuditLog { Username = username, Action = "password-change", Entity = "AppUser", EntityId = user.Id.ToString(), Details = "Kullanıcı kendi parolasını değiştirdi." });
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Parola güncellendi. Güvenlik için yeniden giriş yapın." });
});
app.MapGet("/api/tenant/current", async (HttpContext ctx, AppDbContext db) =>
{
    var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == (int)ctx.Items["tenantId"]!);
    return tenant is null ? Results.NotFound() : Results.Ok(new { tenant.Id, tenant.Name, tenant.Slug, tenant.LegalName, tenant.ContactEmail, tenant.Phone, tenant.PlanKey, tenant.SubscriptionStatus, tenant.TrialEndsAt, tenant.SubscriptionEndsAt, tenant.MaxUsers, tenant.MaxBranches, tenant.IsActive });
});
app.MapPut("/api/tenant/current", async (TenantSettingsRequest request, HttpContext ctx, AppDbContext db) =>
{
    if (!IsAdmin(ctx)) return Results.StatusCode(403);
    var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == (int)ctx.Items["tenantId"]!);
    if (tenant is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(request.Name)) return Results.BadRequest("İşletme adı zorunludur.");
    tenant.Name = request.Name.Trim(); tenant.LegalName = Clean(request.LegalName); tenant.ContactEmail = Clean(request.ContactEmail); tenant.Phone = Clean(request.Phone); tenant.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(); return Results.Ok(new { tenant.Id, tenant.Name, tenant.Slug, tenant.LegalName, tenant.ContactEmail, tenant.Phone, tenant.PlanKey, tenant.SubscriptionStatus, tenant.TrialEndsAt, tenant.MaxUsers, tenant.MaxBranches });
});
app.MapPost("/api/tenant/plan-request", async (PlanRequest request, HttpContext ctx, AppDbContext db) =>
{
    if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var plan = request.PlanKey?.Trim();
    if (plan is not ("Trial" or "Starter" or "Professional" or "Enterprise"))
        return Results.BadRequest("Geçerli bir paket seçin.");
    var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == (int)ctx.Items["tenantId"]!);
    if (tenant is null) return Results.NotFound();
    var row = new WorkflowRecord
    {
        Module = "automation",
        Title = $"Plan talebi: {plan}",
        Status = "Open",
        Description = $"{tenant.Name} için {plan} planına geçiş talebi. Mevcut plan: {tenant.PlanKey}.",
        ReferenceNo = tenant.Slug,
        Payload = JsonSerializer.Serialize(new { requestedPlan = plan, currentPlan = tenant.PlanKey }),
        CreatedBy = ctx.Items["username"]?.ToString() ?? "system",
    };
    db.WorkflowRecords.Add(row);
    await db.SaveChangesAsync();
    Audit(db, ctx, "plan-request", "Tenant", tenant.Id.ToString(), $"Plan talebi: {plan}");
    await db.SaveChangesAsync();
    return Results.Ok(new { row.Id, plan, message = "Plan talebi kaydedildi. Satış ekibi sizinle iletişime geçecek." });
});
app.MapGet("/api/users", async (HttpContext ctx, AppDbContext db) =>
    IsAdmin(ctx) ? Results.Ok(await db.AppUsers.AsNoTracking().Select(u => new { u.Id, u.Username, u.Role, u.DealerId, u.IsActive, u.CreatedAt }).ToListAsync()) : Results.StatusCode(StatusCodes.Status403Forbidden));
app.MapPost("/api/users", async (HttpContext ctx, CreateUserRequest request, AppDbContext db) =>
{
    if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Trim().Length < 3 || string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 12 ||
        request.Role is not ("Admin" or "Staff" or "Dealer")) return Results.BadRequest("Kullanıcı adı/parola/rol bilgilerini kontrol edin. Parola en az 12 karakter olmalı.");
    if (request.Role == "Dealer" && request.DealerId is null) return Results.BadRequest("Bayi kullanıcısı için bayi seçilmelidir.");
    if (request.Role == "Dealer" && !await db.Dealers.AnyAsync(d => d.Id == request.DealerId)) return Results.BadRequest("Seçilen bayi bu işletmeye ait değil.");
    var tenant = await db.Tenants.FirstAsync(t => t.Id == (int)ctx.Items["tenantId"]!);
    if (await db.AppUsers.CountAsync() >= tenant.MaxUsers) return Results.Conflict($"Mevcut paket en fazla {tenant.MaxUsers} kullanıcıya izin veriyor.");
    if (await db.AppUsers.AnyAsync(u => u.Username == request.Username.Trim())) return Results.Conflict("Bu kullanıcı adı kullanılıyor.");
    var user = new AppUser { Username = request.Username.Trim(), PasswordHash = HashPassword(request.Password), Role = request.Role, DealerId = request.Role == "Dealer" ? request.DealerId : null };
    db.AppUsers.Add(user); await db.SaveChangesAsync(); return Results.Created($"/api/users/{user.Id}", new { user.Id, user.Username, user.Role, user.DealerId, user.IsActive });
});
app.MapPost("/api/users/{id:int}/password", async (int id, HttpContext ctx, AdminPasswordRequest request, AppDbContext db) =>
{
    if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 12) return Results.BadRequest("Yeni parola en az 12 karakter olmalıdır.");
    var user = await db.AppUsers.FirstOrDefaultAsync(x => x.Id == id);
    if (user is null) return Results.NotFound();
    user.PasswordHash = HashPassword(request.NewPassword);
    db.AuditLogs.Add(new AuditLog { Username = ctx.Items["username"]?.ToString() ?? "system", Action = "password-reset", Entity = "AppUser", EntityId = user.Id.ToString(), Details = $"{user.Username} kullanıcısının parolası yönetici tarafından sıfırlandı." });
    await db.SaveChangesAsync();
    return Results.Ok(new { user.Id, message = "Parola sıfırlandı. Kullanıcı yeni parolayla giriş yapabilir." });
});
app.MapPatch("/api/users/{id:int}/active", async (int id, HttpContext ctx, UserActiveRequest request, AppDbContext db) =>
{
    if (!IsAdmin(ctx)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var user = await db.AppUsers.FirstOrDefaultAsync(x => x.Id == id); if (user is null) return Results.NotFound();
    if (user.Username == ctx.Items["username"]?.ToString() && !request.IsActive) return Results.BadRequest("Kendi hesabınızı devre dışı bırakamazsınız.");
    user.IsActive = request.IsActive; await db.SaveChangesAsync(); return Results.Ok(new { user.Id, user.IsActive });
});

app.MapGet("/api/db-test", async (AppDbContext db) => Results.Ok(new { connected = await db.Database.CanConnectAsync(), database = "MotorcycleSalesAPP" }));

// Motosikletler
app.MapGet("/api/motorcycles", async (HttpContext ctx, AppDbContext db) =>
{
    var list = await db.Motorcycles.AsNoTracking().OrderBy(m => m.Brand).ThenBy(m => m.Model).ToListAsync();
    if (ctx.Items["dealerId"] is int dealerId)
    {
        var dealer = await db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealerId);
        if (dealer is { IsHeadquarters: false })
        {
            var stocks = await db.DealerStocks.AsNoTracking().Where(s => s.DealerId == dealerId).ToListAsync();
            foreach (var m in list)
                m.StockQuantity = stocks.FirstOrDefault(s => s.MotorcycleId == m.Id)?.Quantity ?? 0;
        }
    }
    return Results.Ok(list);
});
app.MapGet("/api/motorcycles/{id:int}", async (int id, AppDbContext db) =>
{
    var item = await db.Motorcycles.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id);
    return item is null ? Results.NotFound("Motosiklet bulunamadı.") : Results.Ok(item);
});
app.MapPost("/api/motorcycles", async (Motorcycle item, AppDbContext db) =>
{
    var error = ValidateMotorcycle(item); if (error is not null) return Results.BadRequest(error);
    item.Brand = item.Brand.Trim(); item.Model = item.Model.Trim(); item.Color = item.Color.Trim(); item.ImageUrl = CleanImageUrl(item.ImageUrl); item.CreatedAt = DateTime.UtcNow;
    db.Motorcycles.Add(item); await db.SaveChangesAsync();
    if (item.StockQuantity > 0) db.StockMovements.Add(new StockMovement { MotorcycleId = item.Id, MovementType = "OpeningStock", Quantity = item.StockQuantity, UnitCost = item.PurchaseCost, Note = "İlk stok kaydı" });
    await db.SaveChangesAsync(); return Results.Created($"/api/motorcycles/{item.Id}", item);
});
app.MapPut("/api/motorcycles/{id:int}", async (int id, Motorcycle updated, AppDbContext db) =>
{
    var error = ValidateMotorcycle(updated); if (error is not null) return Results.BadRequest(error);
    var item = await db.Motorcycles.FirstOrDefaultAsync(x => x.Id == id); if (item is null) return Results.NotFound("Motosiklet bulunamadı.");
    var difference = updated.StockQuantity - item.StockQuantity;
    item.Brand = updated.Brand.Trim(); item.Model = updated.Model.Trim(); item.EngineCapacityCc = updated.EngineCapacityCc;
    item.Price = updated.Price; item.PurchaseCost = updated.PurchaseCost; item.Color = updated.Color.Trim(); item.ImageUrl = CleanImageUrl(updated.ImageUrl); item.StockQuantity = updated.StockQuantity;
    if (difference != 0) db.StockMovements.Add(new StockMovement { MotorcycleId = id, MovementType = difference > 0 ? "ManualIn" : "ManualOut", Quantity = Math.Abs(difference), UnitCost = item.PurchaseCost, Note = "Envanter ekranından stok düzeltmesi" });
    await db.SaveChangesAsync(); return Results.Ok(item);
});
app.MapDelete("/api/motorcycles/{id:int}", async (int id, AppDbContext db) =>
{
    var item = await db.Motorcycles.FirstOrDefaultAsync(x => x.Id == id); if (item is null) return Results.NotFound();
    if (await db.Sales.AnyAsync(s => s.MotorcycleId == id) || await db.StockMovements.AnyAsync(m => m.MotorcycleId == id)) return Results.Conflict("İşlem geçmişi bulunan motosiklet silinemez.");
    db.Motorcycles.Remove(item); await db.SaveChangesAsync(); return Results.NoContent();
});

// Müşteriler
app.MapGet("/api/customers", async (string? search, AppDbContext db) =>
{
    var query = db.Customers.AsNoTracking();
    if (!string.IsNullOrWhiteSpace(search)) query = query.Where(c => c.FullName.Contains(search) || (c.Phone != null && c.Phone.Contains(search)));
    return Results.Ok(await query.OrderBy(c => c.FullName).Take(500).ToListAsync());
});
app.MapPost("/api/customers", async (CustomerRequest request, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.FullName)) return Results.BadRequest("Müşteri adı zorunludur.");
    var customer = new Customer { FullName = request.FullName.Trim(), Phone = Clean(request.Phone), Email = Clean(request.Email), Notes = Clean(request.Notes) };
    db.Customers.Add(customer); await db.SaveChangesAsync(); return Results.Created($"/api/customers/{customer.Id}", customer);
});
app.MapPut("/api/customers/{id:int}", async (int id, CustomerRequest request, AppDbContext db) =>
{
    var customer = await db.Customers.FirstOrDefaultAsync(x => x.Id == id); if (customer is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(request.FullName)) return Results.BadRequest("Müşteri adı zorunludur.");
    customer.FullName = request.FullName.Trim(); customer.Phone = Clean(request.Phone); customer.Email = Clean(request.Email); customer.Notes = Clean(request.Notes);
    await db.SaveChangesAsync(); return Results.Ok(customer);
});
app.MapGet("/api/customers/{id:int}/sales", async (int id, AppDbContext db) => Results.Ok(await db.Sales.AsNoTracking().Include(s => s.Motorcycle).Where(s => s.CustomerId == id).OrderByDescending(s => s.SaleDate).ToListAsync()));

// Stok hareketleri: quantity pozitif girilir; yön movementType ile belirlenir.
app.MapGet("/api/stock-movements", async (int? motorcycleId, HttpContext ctx, AppDbContext db) =>
{
    // Bayi yalnızca kendi lokasyonunu görür; merkez stok defteri yönetici/personelde kalır.
    if (ctx.Items["role"]?.ToString() == "Dealer")
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    var q = db.StockMovements.AsNoTracking().Include(m => m.Motorcycle).AsQueryable();
    if (motorcycleId.HasValue) q = q.Where(m => m.MotorcycleId == motorcycleId.Value);
    return Results.Ok(await q.OrderByDescending(m => m.CreatedAt).Take(1000).ToListAsync());
});
app.MapPost("/api/stock-movements", async (StockAdjustmentRequest request, HttpContext ctx, AppDbContext db) =>
{
    // Bayi kullanıcısı merkez stok defterini değiştiremez; kendi lokasyonu satış/sevk ile yönetilir.
    if (ctx.Items["role"]?.ToString() == "Dealer")
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    if (!IsAdmin(ctx) && request.MovementType == "PurchaseIn")
        return Results.StatusCode(StatusCodes.Status403Forbidden);
    var admin = IsAdmin(ctx);
    // Maliyet yalnızca satın alma girişinde zorunludur; manuel girişler mevcut ortalama maliyeti kullanır.
    if (request.Quantity <= 0 || request.UnitCost < 0 || request.MovementType is not ("PurchaseIn" or "ManualIn" or "ManualOut") ||
        (request.MovementType == "PurchaseIn" && request.UnitCost <= 0))
        return Results.BadRequest("Stok girişinde miktar, hareket türü ve maliyet bilgilerini kontrol edin.");
    await using var tx = await db.Database.BeginTransactionAsync();
    var motorcycle = await db.Motorcycles.FirstOrDefaultAsync(m => m.Id == request.MotorcycleId);
    if (motorcycle is null) return Results.NotFound("Motosiklet bulunamadı.");
    if (request.MovementType == "ManualOut" && motorcycle.StockQuantity < request.Quantity) return Results.BadRequest("Yetersiz stok.");
    var oldQty = motorcycle.StockQuantity;
    if (request.MovementType == "ManualOut") motorcycle.StockQuantity -= request.Quantity;
    else
    {
        motorcycle.StockQuantity += request.Quantity;
        if (admin && request.UnitCost > 0) motorcycle.PurchaseCost = oldQty == 0 ? request.UnitCost : decimal.Round(((motorcycle.PurchaseCost * oldQty) + (request.UnitCost * request.Quantity)) / (oldQty + request.Quantity), 2);
    }
    var movement = new StockMovement { MotorcycleId = motorcycle.Id, MovementType = request.MovementType, Quantity = request.Quantity, UnitCost = admin ? request.UnitCost : 0m, Note = Clean(request.Note) };
    db.StockMovements.Add(movement); await db.SaveChangesAsync();
    if (request.MovementType == "PurchaseIn" && admin)
    {
        var acc = ctx.RequestServices.GetRequiredService<AccountingService>();
        await acc.EnsureReadyAsync();
        await acc.PostPurchaseAsync(movement.Id, decimal.Round(request.UnitCost * request.Quantity, 2), $"Alış #{movement.Id}");
    }
    await tx.CommitAsync();
    return Results.Ok(new { movement.Id, motorcycle.StockQuantity, motorcycle.PurchaseCost });
});

// Satışlar
app.MapGet("/api/sales", async (HttpContext ctx, AppDbContext db) =>
{
    var q = db.Sales.AsNoTracking().Include(s => s.Motorcycle).Include(s => s.Extras).AsQueryable();
    if (ctx.Items["dealerId"] is int dealerId) q = q.Where(s => s.DealerId == dealerId);
    return Results.Ok(await q.OrderByDescending(s => s.SaleDate).ToListAsync());
});
app.MapPost("/api/sales", async (SaleRequest request, HttpContext ctx, AppDbContext db, AccountingService acc) =>
{
    var validation = ValidateSaleRequest(request);
    if (validation is not null) return Results.BadRequest(validation);
    var channel = request.Channel is "DealerRetail" or "Wholesale" or "Retail" ? request.Channel : "Retail";
    var status = request.Status == "Reserved" ? "Reserved" : "Delivered";
    await acc.EnsureReadyAsync();
    await using var tx = await db.Database.BeginTransactionAsync();
    var motorcycle = await db.Motorcycles.FirstOrDefaultAsync(m => m.Id == request.MotorcycleId);
    if (motorcycle is null) return Results.NotFound("Motosiklet bulunamadı.");
    if (motorcycle.PurchaseCost <= 0) return Results.BadRequest("Bu motosikletin alış maliyeti tanımlı değil. Önce envanterden gerçek alış maliyetini gir.");
    var hq = await acc.HeadquartersAsync();
    var dealerId = CurrentDealer(ctx) ?? request.DealerId ?? hq.Id;
    var dealer = await db.Dealers.FirstOrDefaultAsync(d => d.Id == dealerId && d.IsActive);
    if (dealer is null) return Results.BadRequest("Satış lokasyonu (bayi) bulunamadı.");
    if (ctx.Items["dealerId"] is int scoped && scoped != dealerId) return Results.StatusCode(StatusCodes.Status403Forbidden);
    try { await acc.AdjustLocationStockAsync(dealer.Id, motorcycle.Id, -request.Quantity); }
    catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
    Customer? customer = null;
    if (request.CustomerId.HasValue) customer = await db.Customers.FirstOrDefaultAsync(x => x.Id == request.CustomerId.Value);
    if (customer is null)
    {
        var phone = Clean(request.CustomerPhone);
        customer = phone is null
            ? await db.Customers.FirstOrDefaultAsync(c => c.FullName == request.CustomerName.Trim() && c.Phone == null)
            : await db.Customers.FirstOrDefaultAsync(c => c.Phone == phone);
        if (customer is null) { customer = new Customer { FullName = request.CustomerName.Trim(), Phone = phone }; db.Customers.Add(customer); await db.SaveChangesAsync(); }
    }
    var unitPrice = decimal.Round(request.UnitPrice, 2);
    var totals = ComputeSaleTotals(request);
    var saleDate = request.SaleDate?.ToUniversalTime() ?? DateTime.UtcNow;
    var sale = new Sale
    {
        MotorcycleId = motorcycle.Id, CustomerId = customer!.Id, CustomerName = request.CustomerName.Trim(), CustomerPhone = Clean(request.CustomerPhone),
        Quantity = request.Quantity, UnitPrice = unitPrice, UnitCostAtSale = motorcycle.PurchaseCost, SaleDate = saleDate,
        DealerId = dealer.Id, Status = status, Channel = dealer.IsHeadquarters ? "Retail" : channel == "Retail" ? "DealerRetail" : channel,
        PaymentMethod = totals.Method, CashAmount = totals.Cash, CardAmount = totals.Card, CardInstallments = totals.Installments,
        ExtrasTotal = totals.ExtrasTotal, PaidAmount = status == "Reserved" ? 0 : totals.Paid,
    };
    db.Sales.Add(sale); await db.SaveChangesAsync();
    foreach (var extra in NormalizeSaleExtras(request.Extras))
        db.SaleExtras.Add(new SaleExtra { SaleId = sale.Id, Kind = extra.Kind ?? "Product", Description = extra.Description.Trim(), Quantity = extra.Quantity, UnitPrice = decimal.Round(extra.UnitPrice, 2), UnitCost = decimal.Round(extra.UnitCost, 2) });
    sale.InvoiceNo = status == "Reserved" ? null : $"SF-{sale.Id:D6}";
    db.StockMovements.Add(new StockMovement { MotorcycleId = motorcycle.Id, MovementType = status == "Reserved" ? "ReserveOut" : "SaleOut", Quantity = request.Quantity, UnitCost = motorcycle.PurchaseCost, SaleId = sale.Id, DealerId = dealer.Id, Note = status == "Reserved" ? $"Rezervasyon #{sale.Id}" : $"Satış #{sale.Id}" });
    await db.SaveChangesAsync();
    if (status != "Reserved")
    {
        await acc.PostSaleAsync(sale, dealer.CommissionPercent);
        CreateSalePayments(db, sale);
        await db.SaveChangesAsync();
    }
    Audit(db, ctx, "create", "Sale", sale.Id.ToString(), $"{sale.InvoiceNo ?? "rezervasyon"} · {sale.CustomerName} · {sale.TotalPrice:N2} TL");
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    await db.Entry(sale).Collection(s => s.Extras).LoadAsync();
    return Results.Created($"/api/sales/{sale.Id}", SalePayload(sale, motorcycle));
});
app.MapPut("/api/sales/{id:int}", async (int id, SaleRequest request, HttpContext ctx, AppDbContext db, AccountingService acc) =>
{
    var sale = await db.Sales.Include(s => s.Extras).FirstOrDefaultAsync(s => s.Id == id);
    if (sale is null) return Results.NotFound("Satış kaydı bulunamadı.");
    if (sale.IsCancelled || sale.Status == "Cancelled") return Results.Conflict("İptal edilmiş satış düzenlenemez.");
    var previousTotal = sale.TotalPrice;
    var validation = ValidateSaleRequest(request);
    if (validation is not null) return Results.BadRequest(validation);
    var status = request.Status == "Reserved" ? "Reserved" : sale.Status == "Reserved" && request.Status != "Delivered" ? "Reserved" : "Delivered";
    var channel = request.Channel is "DealerRetail" or "Wholesale" or "Retail" ? request.Channel : sale.Channel;
    await acc.EnsureReadyAsync();
    await using var tx = await db.Database.BeginTransactionAsync();
    var motorcycle = await db.Motorcycles.FirstOrDefaultAsync(m => m.Id == request.MotorcycleId);
    if (motorcycle is null) return Results.NotFound("Motosiklet bulunamadı.");
    if (motorcycle.PurchaseCost <= 0) return Results.BadRequest("Bu motosikletin alış maliyeti tanımlı değil. Önce envanterden gerçek alış maliyetini gir.");
    var hq = await acc.HeadquartersAsync();
    var oldDealerId = sale.DealerId ?? hq.Id;
    var newDealerId = request.DealerId ?? oldDealerId;
    var dealer = await db.Dealers.FirstOrDefaultAsync(d => d.Id == newDealerId && d.IsActive);
    if (dealer is null) return Results.BadRequest("Satış lokasyonu (bayi) bulunamadı.");
    if (ctx.Items["dealerId"] is int scoped && scoped != newDealerId) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var stockChanged = sale.MotorcycleId != motorcycle.Id || sale.Quantity != request.Quantity || oldDealerId != newDealerId;
    if (stockChanged)
    {
        await acc.AdjustLocationStockAsync(oldDealerId, sale.MotorcycleId, sale.Quantity);
        try { await acc.AdjustLocationStockAsync(newDealerId, motorcycle.Id, -request.Quantity); }
        catch (InvalidOperationException ex) { return Results.BadRequest(ex.Message); }
        db.StockMovements.Add(new StockMovement { MotorcycleId = motorcycle.Id, MovementType = "SaleAdjust", Quantity = request.Quantity, UnitCost = motorcycle.PurchaseCost, SaleId = sale.Id, DealerId = newDealerId, Note = $"Satış düzeltme #{sale.Id}" });
    }
    Customer? customer = null;
    if (request.CustomerId.HasValue) customer = await db.Customers.FirstOrDefaultAsync(x => x.Id == request.CustomerId.Value);
    if (customer is null)
    {
        var phone = Clean(request.CustomerPhone);
        customer = phone is null
            ? await db.Customers.FirstOrDefaultAsync(c => c.FullName == request.CustomerName.Trim() && c.Phone == null)
            : await db.Customers.FirstOrDefaultAsync(c => c.Phone == phone);
        if (customer is null) { customer = new Customer { FullName = request.CustomerName.Trim(), Phone = phone }; db.Customers.Add(customer); await db.SaveChangesAsync(); }
    }
    var totals = ComputeSaleTotals(request);
    sale.MotorcycleId = motorcycle.Id;
    sale.Quantity = request.Quantity;
    sale.UnitPrice = decimal.Round(request.UnitPrice, 2);
    sale.UnitCostAtSale = motorcycle.PurchaseCost;
    sale.SaleDate = request.SaleDate?.ToUniversalTime() ?? sale.SaleDate;
    sale.CustomerId = customer!.Id;
    sale.CustomerName = request.CustomerName.Trim();
    sale.CustomerPhone = Clean(request.CustomerPhone);
    sale.DealerId = newDealerId;
    sale.Status = status;
    sale.Channel = dealer.IsHeadquarters ? "Retail" : channel == "Retail" ? "DealerRetail" : channel;
    sale.PaymentMethod = totals.Method;
    sale.CashAmount = totals.Cash;
    sale.CardAmount = totals.Card;
    sale.CardInstallments = totals.Installments;
    sale.ExtrasTotal = totals.ExtrasTotal;
    sale.PaidAmount = status == "Reserved" ? 0 : totals.Paid;
    if (status != "Reserved" && string.IsNullOrWhiteSpace(sale.InvoiceNo)) sale.InvoiceNo = $"SF-{sale.Id:D6}";
    var oldExtras = sale.Extras.ToList();
    db.SaleExtras.RemoveRange(oldExtras);
    sale.Extras.Clear();
    foreach (var extra in NormalizeSaleExtras(request.Extras))
        sale.Extras.Add(new SaleExtra { SaleId = sale.Id, Kind = extra.Kind ?? "Product", Description = extra.Description.Trim(), Quantity = extra.Quantity, UnitPrice = decimal.Round(extra.UnitPrice, 2), UnitCost = decimal.Round(extra.UnitCost, 2) });
    await acc.ReverseBySourceAsync("Sale", sale.Id, $"Satış düzeltme #{sale.Id}");
    if (!string.IsNullOrWhiteSpace(sale.InvoiceNo))
    {
        var oldPayments = await db.Payments.Where(p => p.SaleId == sale.Id && p.Note != null && p.Note.StartsWith(sale.InvoiceNo)).ToListAsync();
        foreach (var payment in oldPayments)
        {
            await acc.ReverseBySourceAsync("Payment", payment.Id, $"Satış düzeltme #{sale.Id}");
            db.Payments.Remove(payment);
        }
    }
    await db.SaveChangesAsync();
    if (status != "Reserved")
    {
        await acc.PostSaleAsync(sale, dealer.CommissionPercent);
        CreateSalePayments(db, sale);
        await db.SaveChangesAsync();
    }
    Audit(db, ctx, "update", "Sale", sale.Id.ToString(), $"{previousTotal:N2} TL → {sale.TotalPrice:N2} TL · {sale.CustomerName}");
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    return Results.Ok(SalePayload(sale, motorcycle));
});
app.MapPost("/api/sales/{id:int}/complete", async (int id, HttpContext ctx, AppDbContext db, AccountingService acc) =>
{
    await using var tx = await db.Database.BeginTransactionAsync();
    var sale = await db.Sales.FirstOrDefaultAsync(s => s.Id == id);
    if (sale is null) return Results.NotFound("Satış kaydı bulunamadı.");
    if (sale.IsCancelled || sale.Status != "Reserved") return Results.Conflict("Yalnızca rezervasyon faturalandırılabilir.");
    if (ctx.Items["dealerId"] is int scoped && sale.DealerId != scoped) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var dealer = sale.DealerId is int did ? await db.Dealers.FirstOrDefaultAsync(x => x.Id == did) : await acc.HeadquartersAsync();
    sale.Status = "Delivered";
    sale.InvoiceNo = $"SF-{sale.Id:D6}";
    var plannedPaid = sale.CashAmount + sale.CardAmount;
    sale.PaidAmount = plannedPaid > 0 ? Math.Clamp(plannedPaid, 0, sale.TotalPrice) : sale.PaymentMethod == "Credit" ? sale.PaidAmount : sale.TotalPrice;
    db.StockMovements.Add(new StockMovement { MotorcycleId = sale.MotorcycleId, MovementType = "SaleOut", Quantity = sale.Quantity, UnitCost = sale.UnitCostAtSale, SaleId = sale.Id, DealerId = sale.DealerId, Note = $"Rezervasyon fatura #{sale.Id}" });
    await db.SaveChangesAsync();
    await acc.PostSaleAsync(sale, dealer?.CommissionPercent ?? 0);
    CreateSalePayments(db, sale);
    await db.SaveChangesAsync();
    await tx.CommitAsync();
    return Results.Ok(new { sale.Id, sale.Status, sale.InvoiceNo });
});
app.MapPost("/api/sales/{id:int}/cancel", async (int id, HttpContext ctx, AppDbContext db, AccountingService acc) =>
{
    await using var tx = await db.Database.BeginTransactionAsync();
    var sale = await db.Sales.FirstOrDefaultAsync(s => s.Id == id);
    if (sale is null) return Results.NotFound("Satış kaydı bulunamadı.");
    if (sale.IsCancelled) return Results.Conflict("Bu satış daha önce iptal edilmiş.");
    var now = DateTime.UtcNow;
    sale.IsCancelled = true;
    sale.CancelledAt = now;
    sale.Status = "Cancelled";
    if (sale.DealerId is int dealerId) await acc.AdjustLocationStockAsync(dealerId, sale.MotorcycleId, sale.Quantity);
    else
    {
        var restored = await db.Motorcycles.Where(m => m.Id == sale.MotorcycleId).ExecuteUpdateAsync(s => s.SetProperty(m => m.StockQuantity, m => m.StockQuantity + sale.Quantity));
        if (restored == 0) return Results.Problem("Stok iadesi yapılamadı.");
    }
    db.StockMovements.Add(new StockMovement { MotorcycleId = sale.MotorcycleId, MovementType = "SaleReturn", Quantity = sale.Quantity, UnitCost = sale.UnitCostAtSale, SaleId = sale.Id, DealerId = sale.DealerId, Note = $"Satış iptali #{sale.Id}" });
    // Satışa bağlı otomatik/manual tahsilatlar da iptal edilir; aksi halde kasa ve
    // cari raporlarında iptal edilmiş satışın tahsilatı açık kalır.
    var linkedPayments = await db.Payments.Where(p => p.SaleId == sale.Id).ToListAsync();
    foreach (var payment in linkedPayments)
    {
        await acc.ReverseBySourceAsync("Payment", payment.Id, $"Satış iptali #{sale.Id}");
        db.Payments.Remove(payment);
    }
    sale.PaidAmount = 0;
    await db.SaveChangesAsync();
    await acc.ReverseBySourceAsync("Sale", sale.Id, $"Satış iptali #{sale.Id}");
    Audit(db, ctx, "cancel", "Sale", sale.Id.ToString(), $"{sale.InvoiceNo ?? "rezervasyon"} · {sale.TotalPrice:N2} TL · {linkedPayments.Count} tahsilat iptal edildi");
    await db.SaveChangesAsync();
    var remaining = sale.DealerId is int d2 ? await acc.GetDealerStockAsync(d2, sale.MotorcycleId) : await db.Motorcycles.Where(m => m.Id == sale.MotorcycleId).Select(m => m.StockQuantity).SingleAsync();
    await tx.CommitAsync(); return Results.Ok(new { saleId = id, isCancelled = true, cancelledAt = now, restoredQuantity = sale.Quantity, remainingStock = remaining, message = "Satış iptal edildi ve ürün stoğa geri eklendi." });
});

// Giderler
app.MapGet("/api/expenses", async (DateTime? from, DateTime? to, AppDbContext db) =>
{
    var fromUtc = from.HasValue ? LocalDayStartUtc(from.Value, reportTimeZone) : (DateTime?)null;
    var toUtc = to.HasValue ? LocalDayEndUtc(to.Value, reportTimeZone) : (DateTime?)null;
    var q = db.Expenses.AsNoTracking().AsQueryable();
    if (fromUtc.HasValue) q = q.Where(e => e.ExpenseDate >= fromUtc.Value);
    if (toUtc.HasValue) q = q.Where(e => e.ExpenseDate < toUtc.Value);
    return Results.Ok(await q.OrderByDescending(e => e.ExpenseDate).Take(2000).ToListAsync());
});
app.MapPost("/api/expenses", async (ExpenseRequest request, HttpContext ctx, AppDbContext db, AccountingService acc) =>
{
    if (string.IsNullOrWhiteSpace(request.Category) || string.IsNullOrWhiteSpace(request.Description) || request.Amount <= 0) return Results.BadRequest("Kategori, açıklama ve pozitif tutar zorunludur.");
    var expense = new Expense { Category = request.Category.Trim(), Description = request.Description.Trim(), Amount = decimal.Round(request.Amount, 2), ExpenseDate = request.ExpenseDate?.ToUniversalTime() ?? DateTime.UtcNow };
    db.Expenses.Add(expense); await db.SaveChangesAsync();
    await acc.EnsureReadyAsync();
    await acc.PostExpenseAsync(expense);
    Audit(db, ctx, "create", "Expense", expense.Id.ToString(), $"{expense.Category} · {expense.Amount:N2} TL");
    await db.SaveChangesAsync();
    return Results.Created($"/api/expenses/{expense.Id}", expense);
});
app.MapDelete("/api/expenses/{id:int}", async (int id, AppDbContext db, AccountingService acc) =>
{
    var item = await db.Expenses.FirstOrDefaultAsync(x => x.Id == id); if (item is null) return Results.NotFound();
    await acc.ReverseBySourceAsync("Expense", item.Id, $"Gider silindi #{item.Id}");
    db.Expenses.Remove(item); await db.SaveChangesAsync(); return Results.NoContent();
});

// Kârlılık: geçmiş satışlarda maliyet bilinmiyorsa grossProfitComplete=false olarak döner.
app.MapGet("/api/reports/profit", async (DateTime? from, DateTime? to, AppDbContext db) =>
{
    var fromUtc = from.HasValue ? LocalDayStartUtc(from.Value, reportTimeZone) : (DateTime?)null;
    var toUtc = to.HasValue ? LocalDayEndUtc(to.Value, reportTimeZone) : (DateTime?)null;
    var salesQ = db.Sales.AsNoTracking().Where(s => !s.IsCancelled);
    if (fromUtc.HasValue) salesQ = salesQ.Where(s => s.SaleDate >= fromUtc.Value);
    if (toUtc.HasValue) salesQ = salesQ.Where(s => s.SaleDate < toUtc.Value);
    var sales = await salesQ.Include(s => s.Extras).ToListAsync();
    var expensesQ = db.Expenses.AsNoTracking().AsQueryable();
    if (fromUtc.HasValue) expensesQ = expensesQ.Where(e => e.ExpenseDate >= fromUtc.Value);
    if (toUtc.HasValue) expensesQ = expensesQ.Where(e => e.ExpenseDate < toUtc.Value);
    var expenses = await expensesQ.SumAsync(e => (decimal?)e.Amount) ?? 0m;
    var revenue = sales.Sum(s => s.TotalPrice);
    var cogs = sales.Sum(s => s.UnitCostAtSale * s.Quantity + s.Extras.Sum(e => e.UnitCost * e.Quantity));
    return Results.Ok(new { revenue, costOfGoodsSold = cogs, grossProfit = revenue - cogs, expenses, netProfit = revenue - cogs - expenses, saleCount = sales.Count, unitsSold = sales.Sum(s => s.Quantity), grossProfitComplete = sales.All(s => s.UnitCostAtSale > 0), note = sales.Any(s => s.UnitCostAtSale == 0) ? "Maliyeti 0 olan eski satışlar nedeniyle kâr geçmiş dönem için eksik hesaplanabilir." : null });
});

app.Run();

static bool IsAdmin(HttpContext c) => c.Items["role"]?.ToString() == "Admin";
static string? SubscriptionBlock(Tenant tenant)
{
    if (!tenant.IsActive) return "İşletme hesabı pasif. Destek ekibiyle iletişime geçin.";
    if (tenant.SubscriptionStatus is "Suspended" or "Cancelled" or "Expired")
        return "Abonelik aktif değil. Devam etmek için bir paket seçin veya satış ekibiyle iletişime geçin.";
    var now = DateTime.UtcNow;
    var grace = TimeSpan.FromDays(3);
    if (tenant.SubscriptionStatus == "Trial" && tenant.TrialEndsAt is DateTime trialEnd && now > trialEnd + grace)
        return "Deneme süresi doldu. Devam etmek için bir paket seçin.";
    if (tenant.SubscriptionStatus == "Active" && tenant.SubscriptionEndsAt is DateTime subscriptionEnd && now > subscriptionEnd + grace)
        return "Abonelik süresi doldu. Devam etmek için planınızı yenileyin.";
    return null;
}
static bool IsSubscriptionExempt(PathString path, string method)
{
    var verb = method.ToUpperInvariant();
    if (path == "/api/auth/me" || path == "/api/auth/password" || path == "/api/tenant/plan-request") return true;
    if (path == "/api/tenant/current") return verb is "GET" or "PUT";
    if (verb == "GET" && (path == "/api/users" || path == "/api/dealers" || path == "/api/audit")) return true;
    return false;
}
static TimeZoneInfo ResolveTimeZone(string? id)
{
    try { return TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(id) ? "Europe/Istanbul" : id); }
    catch { return TimeZoneInfo.Utc; }
}
static DateTime LocalDayStartUtc(DateTime value, TimeZoneInfo timeZone) =>
    TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(value.Date, DateTimeKind.Unspecified), timeZone);
static DateTime LocalDayEndUtc(DateTime value, TimeZoneInfo timeZone) =>
    LocalDayStartUtc(value.AddDays(1), timeZone);
static void Audit(AppDbContext db, HttpContext ctx, string action, string entity, string id, string? details) =>
    db.AuditLogs.Add(new AuditLog { Username = ctx.Items["username"]?.ToString() ?? "system", Action = action, Entity = entity, EntityId = id, Details = details });
static int? CurrentDealer(HttpContext c) => c.Items["dealerId"] is int id ? id : null;
static string? ValidateSaleRequest(SaleRequest request)
{
    if (request.MotorcycleId <= 0 || string.IsNullOrWhiteSpace(request.CustomerName) || request.Quantity <= 0 || request.UnitPrice <= 0)
        return "Satış bilgilerini kontrol edin.";
    if (request.CashAmount is < 0 || request.CardAmount is < 0 || request.PaidAmount is < 0)
        return "Ödeme tutarları negatif olamaz.";
    if (request.CardInstallments is < 0 or > 36)
        return "Taksit sayısı 0 ile 36 arasında olmalıdır.";
    var extrasError = ValidateSaleExtras(request.Extras);
    if (extrasError is not null) return extrasError;
    var totals = ComputeSaleTotals(request);
    if (totals.Cash + totals.Card > totals.Total + 0.005m)
        return "Nakit ve kart toplamı satış tutarını aşamaz.";
    return null;
}
static string? ValidateSaleExtras(List<SaleExtraRequest>? extras)
{
    if (extras is null || extras.Count == 0) return null;
    if (extras.Count > 30) return "Bir satışa en fazla 30 ek ürün/hizmet eklenebilir.";
    foreach (var extra in extras)
    {
        if (string.IsNullOrWhiteSpace(extra.Description)) return "Ek ürün/hizmet açıklaması zorunludur.";
        if (extra.Description.Trim().Length > 200) return "Ek ürün/hizmet açıklaması en fazla 200 karakter olabilir.";
        if (extra.Quantity <= 0) return "Ek ürün/hizmet adedi pozitif olmalıdır.";
        if (extra.UnitPrice < 0) return "Ek ürün/hizmet fiyatı negatif olamaz.";
        if (extra.UnitCost < 0) return "Ek ürün/hizmet maliyeti negatif olamaz.";
        if (extra.Kind is not (null or "Product" or "Service")) return "Ek ürün/hizmet türü geçersiz.";
    }
    return null;
}
static List<SaleExtraRequest> NormalizeSaleExtras(List<SaleExtraRequest>? extras) =>
    (extras ?? []).Where(e => !string.IsNullOrWhiteSpace(e.Description)).ToList();
static (decimal ExtrasTotal, decimal Total, decimal Cash, decimal Card, int Installments, decimal Paid, string Method) ComputeSaleTotals(SaleRequest request)
{
    var extrasTotal = decimal.Round((request.Extras ?? []).Sum(e => Math.Max(0, e.Quantity) * Math.Max(0, e.UnitPrice)), 2);
    var total = decimal.Round(request.Quantity * request.UnitPrice, 2) + extrasTotal;
    var hasSplit = request.CashAmount.HasValue || request.CardAmount.HasValue;
    var cash = request.CashAmount ?? 0m;
    var card = request.CardAmount ?? 0m;
    if (!hasSplit)
    {
        if (request.PaymentMethod is "Card" or "Bank") card = total;
        else if (request.PaymentMethod is "Credit") cash = Math.Clamp(request.PaidAmount ?? 0m, 0m, total);
        else cash = total;
    }
    cash = decimal.Round(Math.Max(0m, cash), 2);
    card = decimal.Round(Math.Max(0m, card), 2);
    var paid = Math.Min(total, cash + card);
    var installments = card > 0 ? Math.Clamp(request.CardInstallments ?? 1, 1, 36) : 0;
    var method = paid <= 0
        ? "Credit"
        : cash > 0 && card > 0 ? "Mixed"
        : card > 0 ? (!hasSplit && request.PaymentMethod == "Bank" ? "Bank" : "Card")
        : "Cash";
    return (extrasTotal, total, cash, card, installments, paid, method);
}
static void CreateSalePayments(AppDbContext db, Sale sale)
{
    if (sale.PaidAmount <= 0) return;
    if (sale.CashAmount > 0)
        db.Payments.Add(new Payment { Direction = "In", Method = "Cash", Amount = sale.CashAmount, SaleId = sale.Id, DealerId = sale.DealerId, CustomerId = sale.CustomerId, Counterparty = sale.CustomerName, Note = sale.InvoiceNo, PaymentDate = sale.SaleDate });
    if (sale.CardAmount > 0)
        db.Payments.Add(new Payment { Direction = "In", Method = "Card", Amount = sale.CardAmount, SaleId = sale.Id, DealerId = sale.DealerId, CustomerId = sale.CustomerId, Counterparty = sale.CustomerName, Note = sale.CardInstallments > 1 ? $"{sale.InvoiceNo} · Kart {sale.CardInstallments} taksit" : sale.InvoiceNo, PaymentDate = sale.SaleDate });
}
static object SalePayload(Sale sale, Motorcycle? motorcycle = null) => new
{
    sale.Id,
    sale.MotorcycleId,
    Motorcycle = motorcycle is null ? null : $"{motorcycle.Brand} {motorcycle.Model}",
    sale.CustomerId,
    sale.CustomerName,
    sale.CustomerPhone,
    sale.Quantity,
    sale.UnitPrice,
    sale.TotalPrice,
    sale.UnitCostAtSale,
    sale.SaleDate,
    sale.IsCancelled,
    sale.CancelledAt,
    sale.Status,
    sale.Channel,
    sale.PaymentMethod,
    sale.PaidAmount,
    sale.CashAmount,
    sale.CardAmount,
    sale.CardInstallments,
    sale.ExtrasTotal,
    sale.InvoiceNo,
    sale.DealerId,
    Extras = sale.Extras.Select(e => new { e.Id, e.Kind, e.Description, e.Quantity, e.UnitPrice, e.UnitCost, Total = e.Quantity * e.UnitPrice, TotalCost = e.Quantity * e.UnitCost }),
};
static bool IsStaffAllowed(PathString path, string method)
{
    var route = path.Value ?? string.Empty;
    var verb = method.ToUpperInvariant();
    if (route == "/api/auth/me") return verb == "GET";
    if (route == "/api/auth/password") return verb == "POST";
    // Tüm roller kendi işletme adını görebilmeli; yazma işlemi yöneticide kalır.
    if (route == "/api/tenant/current") return verb == "GET";
    if (route == "/api/workflows") return verb == "POST";
    if (System.Text.RegularExpressions.Regex.IsMatch(route, @"^/api/workflows/(calendar|service|crm)$")) return verb == "GET";
    if (System.Text.RegularExpressions.Regex.IsMatch(route, @"^/api/workflows/(calendar|service|crm)/\d+$")) return verb == "PUT";
    if (route == "/api/motorcycles" || System.Text.RegularExpressions.Regex.IsMatch(route, @"^/api/motorcycles/\d+$")) return verb == "GET";
    if (route == "/api/customers") return verb is "GET" or "POST";
    if (System.Text.RegularExpressions.Regex.IsMatch(route, @"^/api/customers/\d+/sales$")) return verb == "GET";
    if (route == "/api/stock-movements") return verb is "GET" or "POST";
    if (route == "/api/sales") return verb is "GET" or "POST";
    if (System.Text.RegularExpressions.Regex.IsMatch(route, @"^/api/sales/\d+/complete$")) return verb == "POST";
    if (route == "/api/expenses") return verb is "GET" or "POST";
    if (route == "/api/dealers" || route == "/api/inventory" || route == "/api/accounts" || route == "/api/payments") return verb == "GET" || (route == "/api/payments" && verb == "POST");
    if (route == "/api/stock-transfers") return verb is "GET" or "POST";
    if (System.Text.RegularExpressions.Regex.IsMatch(route, @"^/api/stock-transfers/\d+/(ship|receive)$")) return verb == "POST";
    return false;
}
static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
static string? CleanImageUrl(string? value)
{
    if (string.IsNullOrWhiteSpace(value)) return null;
    var candidate = value.Trim();
    return candidate.Length <= 2048 && Uri.TryCreate(candidate, UriKind.Absolute, out var uri) &&
        (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && string.IsNullOrEmpty(uri.UserInfo)
        ? candidate : null;
}
static string? ValidateMotorcycle(Motorcycle m)
{
    if (string.IsNullOrWhiteSpace(m.Brand) || string.IsNullOrWhiteSpace(m.Model) || string.IsNullOrWhiteSpace(m.Color)) return "Marka, model ve renk zorunludur.";
    if (m.EngineCapacityCc <= 0 || m.Price <= 0 || m.PurchaseCost < 0 || m.StockQuantity < 0) return "Motor hacmi/fiyat pozitif; maliyet/stok sıfır veya daha büyük olmalıdır.";
    if (m.StockQuantity > 0 && m.PurchaseCost <= 0) return "Stoklu motosikletlerde birim alış maliyeti girilmelidir.";
    return null;
}
static string NormalizeTenantSlug(string? value)
{
    if (string.IsNullOrWhiteSpace(value)) return "";
    var normalized = value.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
    var builder = new StringBuilder();
    foreach (var ch in normalized)
    {
        if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) == System.Globalization.UnicodeCategory.NonSpacingMark) continue;
        if (char.IsLetterOrDigit(ch)) builder.Append(ch);
        else if (builder.Length > 0 && builder[builder.Length - 1] != '-') builder.Append('-');
    }
    return builder.ToString().Trim('-');
}
static string HashPassword(string password)
{
    var salt = RandomNumberGenerator.GetBytes(16); var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 210000, HashAlgorithmName.SHA256, 32);
    return $"{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
}
static bool VerifyPassword(string password, string encoded)
{
    try { var parts = encoded.Split('.'); if (parts.Length != 2) return false; var salt = Convert.FromBase64String(parts[0]); var expected = Convert.FromBase64String(parts[1]); var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, 210000, HashAlgorithmName.SHA256, expected.Length); return CryptographicOperations.FixedTimeEquals(actual, expected); }
    catch { return false; }
}
static string CreateToken(string username, string role, int tenantId, string secret)
{
    var payload = JsonSerializer.SerializeToUtf8Bytes(new { sub = username, role, tid = tenantId, exp = DateTimeOffset.UtcNow.AddHours(8).ToUnixTimeSeconds() });
    var body = Base64Url(payload); using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)); return $"{body}.{Base64Url(hmac.ComputeHash(Encoding.UTF8.GetBytes(body)))}";
}
static bool TryReadToken(string token, string secret, out string username, out string role, out int tenantId)
{
    username = ""; role = ""; tenantId = 0;
    try { var p = token.Split('.'); if (p.Length != 2) return false; using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)); var expected = hmac.ComputeHash(Encoding.UTF8.GetBytes(p[0])); if (!CryptographicOperations.FixedTimeEquals(expected, FromBase64Url(p[1]))) return false; using var doc = JsonDocument.Parse(FromBase64Url(p[0])); var root = doc.RootElement; if (root.GetProperty("exp").GetInt64() < DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false; username = root.GetProperty("sub").GetString() ?? ""; role = root.GetProperty("role").GetString() ?? "Staff"; tenantId = root.GetProperty("tid").GetInt32(); return username.Length > 0 && tenantId > 0; }
    catch { return false; }
}
static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
static byte[] FromBase64Url(string s) { s = s.Replace('-', '+').Replace('_', '/'); s += new string('=', (4 - s.Length % 4) % 4); return Convert.FromBase64String(s); }

record BootstrapRequest(string Username, string Password, string? TenantName = null, string? TenantSlug = null);
record PlanRequest(string PlanKey);
record LoginRequest(string Username, string Password, string? TenantSlug = null);
record TenantSettingsRequest(string Name, string? LegalName, string? ContactEmail, string? Phone);
record ProvisionTenantRequest(string TenantName, string TenantSlug, string OwnerUsername, string OwnerPassword, string? ContactEmail = null, string? Phone = null);
record CreateUserRequest(string Username, string Password, string Role, int? DealerId = null);
record UserActiveRequest(bool IsActive);
record ChangePasswordRequest(string CurrentPassword, string NewPassword);
record AdminPasswordRequest(string NewPassword);
record CustomerRequest(string FullName, string? Phone, string? Email, string? Notes);
record StockAdjustmentRequest(int MotorcycleId, string MovementType, int Quantity, decimal UnitCost, string? Note);
record SaleExtraRequest(string Description, decimal UnitPrice, int Quantity = 1, string? Kind = "Product", decimal UnitCost = 0);
record SaleRequest(int MotorcycleId, string CustomerName, string? CustomerPhone, int Quantity, decimal UnitPrice, int? CustomerId = null, int? DealerId = null, string? PaymentMethod = "Cash", decimal? PaidAmount = null, string? Channel = "Retail", string? Status = "Delivered", DateTime? SaleDate = null, decimal? CashAmount = null, decimal? CardAmount = null, int? CardInstallments = null, List<SaleExtraRequest>? Extras = null);
record ExpenseRequest(string Category, string Description, decimal Amount, DateTime? ExpenseDate);

// WebApplicationFactory tabanlı entegrasyon testlerinin giriş noktasını görmesi için.
public partial class Program { }
