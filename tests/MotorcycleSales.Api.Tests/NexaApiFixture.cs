using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

namespace MotorcycleSales.Api.Tests;

/// <summary>
/// Her test sınıfı için boş bir PostgreSQL veritabanı oluşturur, şemayı yükler
/// ve testler bittiğinde veritabanını siler. Yerelde varsayılan olarak
/// postgres/postgres kullanılır; CI'da NEXA_TEST_ADMIN_CONNECTION ile değiştirilir.
/// </summary>
public sealed class NexaFixture : IAsyncLifetime
{
    private const string DefaultAdminConnection = "Host=127.0.0.1;Port=5432;Username=postgres;Password=postgres;Database=postgres";

    private readonly string _database = $"nexa_test_{Guid.NewGuid():N}";
    private string AdminConnection => Environment.GetEnvironmentVariable("NEXA_TEST_ADMIN_CONNECTION") ?? DefaultAdminConnection;
    private string ConnectionString => new NpgsqlConnectionStringBuilder(AdminConnection) { Database = _database }.ConnectionString;

    public NexaApiFactory Factory { get; } = new();

    public async Task InitializeAsync()
    {
        await using (var admin = new NpgsqlConnection(AdminConnection))
        {
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{_database}\"", admin);
            await create.ExecuteNonQueryAsync();
        }

        var schemaPath = Path.Combine(AppContext.BaseDirectory, "schema_current.sql");
        var schema = string.Join('\n', File.ReadAllLines(schemaPath)
            .Where(line => !line.TrimStart().StartsWith('\\')));
        await using (var db = new NpgsqlConnection(ConnectionString))
        {
            await db.OpenAsync();
            await using var command = new NpgsqlCommand(schema, db) { CommandTimeout = 120 };
            await command.ExecuteNonQueryAsync();
        }

        NpgsqlConnection.ClearAllPools();
        Factory.Configure(ConnectionString);
    }

    public async Task DisposeAsync()
    {
        await Factory.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        await using var admin = new NpgsqlConnection(AdminConnection);
        await admin.OpenAsync();
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_database}\" WITH (FORCE)", admin);
        await drop.ExecuteNonQueryAsync();
    }

    public string TestConnectionString => ConnectionString;
}

public sealed class NexaApiFactory : WebApplicationFactory<Program>
{
    private string? _connectionString;

    public void Configure(string connectionString) => _connectionString = connectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = _connectionString,
            ["Jwt:Secret"] = "integration-test-secret-key-0123456789abcdef",
            ["SaaS:ProvisioningKey"] = "test-provisioning-key",
            ["SaaS:TimeZone"] = "Europe/Istanbul",
        }));
    }
}
