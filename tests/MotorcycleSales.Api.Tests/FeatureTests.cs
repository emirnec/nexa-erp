using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace MotorcycleSales.Api.Tests;

public sealed class FeatureTests : IClassFixture<NexaFixture>
{
    private const string Password = "TestPassword123!";
    private readonly NexaFixture _fixture;

    public FeatureTests(NexaFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Sale_IdempotencyKey_ReturnsSameSale()
    {
        var admin = await AdminClientAsync();
        var motorcycleId = await CreateMotorcycleAsync(admin, "Idem", "One", stock: 5);

        var first = await PostSaleAsync(admin, motorcycleId, "idem-sale-key");
        var second = await PostSaleAsync(admin, motorcycleId, "idem-sale-key");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        using var firstJson = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        using var secondJson = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        Assert.Equal(firstJson.RootElement.GetProperty("id").GetInt32(), secondJson.RootElement.GetProperty("id").GetInt32());

        var sales = await GetJsonAsync(admin, "/api/sales");
        Assert.Single(sales.EnumerateArray(), s => s.GetProperty("id").GetInt32() == firstJson.RootElement.GetProperty("id").GetInt32());
        var motorcycle = await GetJsonAsync(admin, $"/api/motorcycles/{motorcycleId}");
        Assert.Equal(4, motorcycle.GetProperty("stockQuantity").GetInt32());
    }

    [Fact]
    public async Task ConcurrentSales_DoNotOversellLastUnit()
    {
        var admin = await AdminClientAsync();
        var motorcycleId = await CreateMotorcycleAsync(admin, "Race", "Last", stock: 1);

        var request1 = SaleRequest(admin, motorcycleId);
        var request2 = SaleRequest(admin, motorcycleId);
        var responses = await Task.WhenAll(admin.SendAsync(request1), admin.SendAsync(request2));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.Created),
            r => Assert.True(r.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Conflict, r.StatusCode.ToString()));

        var motorcycle = await GetJsonAsync(admin, $"/api/motorcycles/{motorcycleId}");
        Assert.Equal(0, motorcycle.GetProperty("stockQuantity").GetInt32());
    }

    [Fact]
    public async Task CreditLimit_BlocksSecondOpenSale_AndInstallmentsExposeAging()
    {
        var admin = await AdminClientAsync();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var customerResponse = await admin.PostAsJsonAsync("/api/customers", new
        {
            fullName = $"Cari Test {suffix}", phone = $"0555{suffix}", creditLimit = 100_000m,
        });
        customerResponse.EnsureSuccessStatusCode();
        using var customerJson = JsonDocument.Parse(await customerResponse.Content.ReadAsStringAsync());
        var customerId = customerJson.RootElement.GetProperty("id").GetInt32();
        var motorcycleId = await CreateMotorcycleAsync(admin, "Cari", suffix, stock: 2, price: 100_000m);

        var sale = await admin.PostAsJsonAsync("/api/sales", new
        {
            motorcycleId, customerId, customerName = $"Cari Test {suffix}", quantity = 1, unitPrice = 100_000m,
            cashAmount = 20_000m, cardAmount = 0m, installmentCount = 4, dueDate = DateTime.UtcNow.AddDays(10),
            status = "Delivered", channel = "Retail",
        });
        Assert.Equal(HttpStatusCode.Created, sale.StatusCode);
        using var saleJson = JsonDocument.Parse(await sale.Content.ReadAsStringAsync());
        Assert.Equal(4, saleJson.RootElement.GetProperty("installmentCount").GetInt32());
        Assert.Equal(4, saleJson.RootElement.GetProperty("installments").GetArrayLength());

        // 80.000 TL açık bakiye varken 50.000 TL daha vadeli satış limiti aşmalı.
        var blocked = await admin.PostAsJsonAsync("/api/sales", new
        {
            motorcycleId, customerId, customerName = $"Cari Test {suffix}", quantity = 1, unitPrice = 50_000m,
            cashAmount = 0m, cardAmount = 0m, installmentCount = 1, status = "Delivered", channel = "Retail",
        });
        Assert.Equal(HttpStatusCode.BadRequest, blocked.StatusCode);

        var aging = await GetJsonAsync(admin, "/api/reports/receivables-aging");
        Assert.True(aging.GetProperty("totalOutstanding").GetDecimal() >= 80_000m);
        Assert.Contains(aging.GetProperty("customers").EnumerateArray(),
            c => c.GetProperty("customerId").GetInt32() == customerId && c.GetProperty("total").GetDecimal() >= 80_000m);
    }

    [Fact]
    public async Task ServiceOrder_InvoiceConsumesPartStock_AndCannotInvoiceTwice()
    {
        var admin = await AdminClientAsync();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var partResponse = await admin.PostAsJsonAsync("/api/parts", new
        {
            code = $"P-{suffix}", name = "Fren balatası", stockQuantity = 2, purchaseCost = 1_000m, salePrice = 1_500m,
        });
        partResponse.EnsureSuccessStatusCode();
        using var partJson = JsonDocument.Parse(await partResponse.Content.ReadAsStringAsync());
        var partId = partJson.RootElement.GetProperty("id").GetInt32();

        var customerResponse = await admin.PostAsJsonAsync("/api/customers", new { fullName = $"Servis Müşteri {suffix}" });
        customerResponse.EnsureSuccessStatusCode();
        using var customerJson = JsonDocument.Parse(await customerResponse.Content.ReadAsStringAsync());
        var customerId = customerJson.RootElement.GetProperty("id").GetInt32();

        var orderResponse = await admin.PostAsJsonAsync("/api/service-orders", new
        {
            customerId,
            complaint = "Fren sesi",
            items = new object[]
            {
                new { kind = "Labor", description = "Fren ayarı", quantity = 1, unitPrice = 500m, unitCost = 0m, partId = (int?)null },
                new { kind = "Part", description = "Fren balatası", quantity = 1, unitPrice = 1_500m, unitCost = 0m, partId },
            },
        });
        orderResponse.EnsureSuccessStatusCode();
        using var orderJson = JsonDocument.Parse(await orderResponse.Content.ReadAsStringAsync());
        var orderId = orderJson.RootElement.GetProperty("id").GetInt32();

        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/service-orders/{orderId}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/service-orders/{orderId}/ready", null)).StatusCode);

        var invoice = await admin.PostAsJsonAsync($"/api/service-orders/{orderId}/invoice", new { paymentMethod = "Cash" });
        Assert.Equal(HttpStatusCode.OK, invoice.StatusCode);
        using var invoiceJson = JsonDocument.Parse(await invoice.Content.ReadAsStringAsync());
        Assert.Equal("Invoiced", invoiceJson.RootElement.GetProperty("status").GetString());
        Assert.Equal(2_000m, invoiceJson.RootElement.GetProperty("total").GetDecimal());

        var parts = await GetJsonAsync(admin, "/api/parts");
        Assert.Equal(1, parts.EnumerateArray().Single(p => p.GetProperty("id").GetInt32() == partId).GetProperty("stockQuantity").GetInt32());

        var duplicate = await admin.PostAsJsonAsync($"/api/service-orders/{orderId}/invoice", new { paymentMethod = "Cash" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task Staff_CanReadServicePartsAndReceivables_ButCannotManageParts()
    {
        var admin = await AdminClientAsync();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var username = $"staff{suffix}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = Password, role = "Staff" });
        create.EnsureSuccessStatusCode();

        using var staff = _fixture.Factory.CreateClient();
        var login = await staff.PostAsJsonAsync("/api/auth/login", new { username, password = Password, tenantSlug = "feature-motors" });
        login.EnsureSuccessStatusCode();
        using var loginJson = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        staff.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginJson.RootElement.GetProperty("token").GetString());

        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync("/api/parts")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync("/api/service-orders")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync("/api/reports/receivables-aging")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/parts", new { code = $"X-{suffix}", name = "Yetkisiz", stockQuantity = 1, purchaseCost = 1m, salePrice = 2m })).StatusCode);
    }

    [Fact]
    public async Task Logout_InvalidatesExistingToken()
    {
        var admin = await AdminClientAsync();
        var response = await admin.PostAsync("/api/auth/logout", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = await admin.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        _admin = null;
    }

    [Fact]
    public async Task PasswordChange_InvalidatesOldToken()
    {
        var admin = await AdminClientAsync();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var username = $"user{suffix}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "OldPassword123!", role = "Staff" });
        create.EnsureSuccessStatusCode();

        using var staff = _fixture.Factory.CreateClient();
        var login = await staff.PostAsJsonAsync("/api/auth/login", new { username, password = "OldPassword123!", tenantSlug = "feature-motors" });
        login.EnsureSuccessStatusCode();
        using var loginJson = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        staff.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginJson.RootElement.GetProperty("token").GetString());

        var changed = await staff.PostAsJsonAsync("/api/auth/password", new
        {
            currentPassword = "OldPassword123!", newPassword = "NewPassword123!",
        });
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync("/api/auth/me")).StatusCode);

        using var fresh = _fixture.Factory.CreateClient();
        var newLogin = await fresh.PostAsJsonAsync("/api/auth/login", new { username, password = "NewPassword123!", tenantSlug = "feature-motors" });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }

    private HttpClient? _admin;

    private async Task<HttpClient> AdminClientAsync()
    {
        if (_admin is not null) return _admin;
        var client = _fixture.Factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/bootstrap", new
        {
            username = "admin", password = Password, tenantName = "Feature Motors", tenantSlug = "feature-motors",
        });
        if (response.StatusCode == HttpStatusCode.Conflict)
            response = await client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password = Password, tenantSlug = "feature-motors" });
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("token").GetString());
        _admin = client;
        return client;
    }

    private static async Task<int> CreateMotorcycleAsync(HttpClient client, string brand, string model, int stock, decimal price = 100_000m)
    {
        var response = await client.PostAsJsonAsync("/api/motorcycles", new
        {
            brand, model, engineCapacityCc = 250, price, purchaseCost = 80_000m, color = "Siyah", stockQuantity = stock,
        });
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("id").GetInt32();
    }

    private static Task<HttpResponseMessage> PostSaleAsync(HttpClient client, int motorcycleId, string key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/sales")
        {
            Content = JsonContent.Create(new
            {
                motorcycleId, customerName = "Idempotency Test", quantity = 1, unitPrice = 100_000m,
                cashAmount = 100_000m, cardAmount = 0m, status = "Delivered", channel = "Retail",
            }),
        };
        request.Headers.Add("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static HttpRequestMessage SaleRequest(HttpClient client, int motorcycleId)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/sales")
        {
            Content = JsonContent.Create(new
            {
                motorcycleId, customerName = "Concurrent Test", quantity = 1, unitPrice = 100_000m,
                cashAmount = 100_000m, cardAmount = 0m, status = "Delivered", channel = "Retail",
            }),
        };
        request.Headers.Authorization = client.DefaultRequestHeaders.Authorization;
        return request;
    }

    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.Clone();
    }
}
