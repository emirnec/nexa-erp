using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Xunit;

namespace MotorcycleSales.Api.Tests;

public sealed class ApiIntegrationTests : IClassFixture<NexaFixture>
{
    private const string Password = "TestPassword123!";
    private readonly NexaFixture _fixture;
    private HttpClient? _admin;

    public ApiIntegrationTests(NexaFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Health_ReportsDatabaseStatus()
    {
        using var client = _fixture.Factory.CreateClient();
        var response = await client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("healthy", json.RootElement.GetProperty("status").GetString());
        Assert.Equal("ok", json.RootElement.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Sale_WithExtrasCost_UpdatesProfit_AndCancelClearsPaymentsAndStock()
    {
        var admin = await AdminClientAsync();
        var motorcycleId = await CreateMotorcycleAsync(admin, "Test", "M1", 2);

        var saleResponse = await admin.PostAsJsonAsync("/api/sales", new
        {
            motorcycleId,
            customerName = "Ayşe Test",
            customerPhone = "05550000000",
            quantity = 1,
            unitPrice = 100_000m,
            cashAmount = 100_000m,
            cardAmount = 0m,
            cardInstallments = 0,
            status = "Delivered",
            channel = "Retail",
            saleDate = DateTime.UtcNow,
            extras = new[] { new { description = "Çanta", unitPrice = 5_000m, quantity = 1, kind = "Product", unitCost = 3_000m } },
        });
        Assert.Equal(HttpStatusCode.Created, saleResponse.StatusCode);
        using var saleJson = JsonDocument.Parse(await saleResponse.Content.ReadAsStringAsync());
        var saleId = saleJson.RootElement.GetProperty("id").GetInt32();
        Assert.Equal(105_000m, saleJson.RootElement.GetProperty("totalPrice").GetDecimal());

        var profitResponse = await admin.GetAsync("/api/reports/profit");
        Assert.Equal(HttpStatusCode.OK, profitResponse.StatusCode);
        using var profit = JsonDocument.Parse(await profitResponse.Content.ReadAsStringAsync());
        Assert.Equal(105_000m, profit.RootElement.GetProperty("revenue").GetDecimal());
        Assert.Equal(83_000m, profit.RootElement.GetProperty("costOfGoodsSold").GetDecimal());
        Assert.Equal(22_000m, profit.RootElement.GetProperty("grossProfit").GetDecimal());

        var paymentsBefore = await GetJsonAsync(admin, "/api/payments");
        Assert.Contains(paymentsBefore.EnumerateArray(), p => p.GetProperty("saleId").GetInt32() == saleId);

        var cancelResponse = await admin.PostAsync($"/api/sales/{saleId}/cancel", null);
        Assert.Equal(HttpStatusCode.OK, cancelResponse.StatusCode);

        var sales = await GetJsonAsync(admin, "/api/sales");
        var cancelled = sales.EnumerateArray().Single(s => s.GetProperty("id").GetInt32() == saleId);
        Assert.True(cancelled.GetProperty("isCancelled").GetBoolean());
        Assert.Equal(0m, cancelled.GetProperty("paidAmount").GetDecimal());

        var paymentsAfter = await GetJsonAsync(admin, "/api/payments");
        Assert.DoesNotContain(paymentsAfter.EnumerateArray(), p =>
            p.TryGetProperty("saleId", out var value) && value.ValueKind == JsonValueKind.Number && value.GetInt32() == saleId);

        var motorcycle = await GetJsonAsync(admin, $"/api/motorcycles/{motorcycleId}");
        Assert.Equal(2, motorcycle.GetProperty("stockQuantity").GetInt32());

        var latePayment = await admin.PostAsJsonAsync("/api/payments", new
        {
            direction = "In", method = "Cash", amount = 100m, saleId,
        });
        Assert.Equal(HttpStatusCode.Conflict, latePayment.StatusCode);
    }

    [Fact]
    public async Task Tenant_CannotReadOrWriteAnotherTenantsRecords()
    {
        var admin = await AdminClientAsync();
        var motorcycleId = await CreateMotorcycleAsync(admin, "Isolation", "A1", 1);

        using var tenantB = await CreateTenantClientAsync("tenant-b", "Tenant B");
        var read = await tenantB.GetAsync($"/api/motorcycles/{motorcycleId}");
        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);

        var write = await tenantB.PutAsJsonAsync($"/api/motorcycles/{motorcycleId}", new
        {
            brand = "Hack", model = "X", engineCapacityCc = 125, price = 1m, purchaseCost = 1m,
            color = "Siyah", stockQuantity = 99,
        });
        Assert.Equal(HttpStatusCode.NotFound, write.StatusCode);

        var sales = await GetJsonAsync(tenantB, "/api/sales");
        Assert.Empty(sales.EnumerateArray());
    }

    [Fact]
    public async Task ExpiredTrial_BlocksBusinessData_ButPlanRequestWorks()
    {
        var tenantC = await CreateTenantClientAsync("tenant-c", "Tenant C");
        await using (var connection = new NpgsqlConnection(_fixture.TestConnectionString))
        {
            await connection.OpenAsync();
            await using var update = new NpgsqlCommand(
                "UPDATE \"Tenants\" SET \"TrialEndsAt\" = now() - interval '10 days' WHERE \"Slug\" = 'tenant-c'", connection);
            await update.ExecuteNonQueryAsync();
        }

        var blocked = await tenantC.GetAsync("/api/sales");
        Assert.Equal(HttpStatusCode.PaymentRequired, blocked.StatusCode);
        using var blockedJson = JsonDocument.Parse(await blocked.Content.ReadAsStringAsync());
        Assert.Equal("subscription_required", blockedJson.RootElement.GetProperty("code").GetString());

        var tenantInfo = await tenantC.GetAsync("/api/tenant/current");
        Assert.Equal(HttpStatusCode.OK, tenantInfo.StatusCode);

        var planRequest = await tenantC.PostAsJsonAsync("/api/tenant/plan-request", new { planKey = "Starter" });
        Assert.Equal(HttpStatusCode.OK, planRequest.StatusCode);
    }

    private async Task<HttpClient> AdminClientAsync()
    {
        if (_admin is not null) return _admin;
        var client = _fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/bootstrap", new
        {
            username = "admin", password = Password, tenantName = "Test Motors", tenantSlug = "test-motors",
        });
        // Aynı veritabanında sonraki testlerde ilk yönetici zaten vardır.
        if (response.StatusCode == HttpStatusCode.Conflict)
        {
            response = await client.PostAsJsonAsync("/api/auth/login", new
            {
                username = "admin", password = Password, tenantSlug = "test-motors",
            });
        }
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("token").GetString());
        _admin = client;
        return client;
    }

    private async Task<HttpClient> CreateTenantClientAsync(string slug, string name)
    {
        using var provisioning = _fixture.Factory.CreateClient();
        provisioning.DefaultRequestHeaders.Add("X-Provisioning-Key", "test-provisioning-key");
        var created = await provisioning.PostAsJsonAsync("/api/platform/tenants/provision", new
        {
            tenantName = name, tenantSlug = slug, ownerUsername = "owner", ownerPassword = Password,
        });
        created.EnsureSuccessStatusCode();

        var client = _fixture.Factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            username = "owner", password = Password, tenantSlug = slug,
        });
        login.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("token").GetString());
        return client;
    }

    private static async Task<int> CreateMotorcycleAsync(HttpClient client, string brand, string model, int stock)
    {
        var response = await client.PostAsJsonAsync("/api/motorcycles", new
        {
            brand, model, engineCapacityCc = 250, price = 100_000m, purchaseCost = 80_000m,
            color = "Siyah", stockQuantity = stock,
        });
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("id").GetInt32();
    }

    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.Clone();
    }
}
