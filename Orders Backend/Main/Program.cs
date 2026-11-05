using DataService.DataAccess;
using DataService.Engines.Orders;
using DataService.Models.DTOs;
using DataService.Others;
using DataService.Security;
using Main.Hubs;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// Connection strings may be stored encrypted (encryptor, see DataService/Security/EncDec.cs).
// A value with ";" is a plain connection string ("Data Source=SERVER;Initial Catalog=DATABASE;User ID=USER;Password=PASSWORD") and is used as it is.
foreach (var entry in builder.Configuration.GetSection("ConnectionStrings").GetChildren())
{
    var value = entry.Value;
    if (string.IsNullOrWhiteSpace(value) || value.Contains(';')) continue;
    try
    {
        builder.Configuration[entry.Path] = EncDec.DecryptConnectionString(value);
    }
    catch (Exception ex)
    {
        throw new InvalidOperationException(
            $"Connection string \"{entry.Key}\" in appsettings.json is neither a plain connection string nor one this app can decrypt.", ex);
    }
}

// CORS - only needed when the screens are served from another address than this API
// (e.g. the React dev server); SignalR needs explicit origins with credentials (appsettings "Cors:Origins").
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? Array.Empty<string>();
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(corsOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

builder.Services.AddSignalR();
builder.Services.AddControllers(options =>
{
    options.Filters.Add(new GlobalExceptionFilter());
});

builder.Services.AddEndpointsApiExplorer();
// Swagger "Authorize" button for the X-Api-Key header that /api/incoming-call checks
builder.Services.AddSwaggerGen(c =>
{
    c.AddSecurityDefinition("ApiKey", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.ApiKey,
        In = ParameterLocation.Header,
        Name = "X-Api-Key",
        Description = "Caller-id API key (appsettings \"IncomingCall:ApiKey\")",
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "ApiKey" } },
            Array.Empty<string>()
        }
    });
});

builder.Services.AddScoped<OrdersDAL>();
builder.Services.AddScoped<OrdersEngine>();
builder.Services.AddHostedService<MissedCallsService>();

builder.Services.Configure<OrdersOptions>(builder.Configuration.GetSection("Orders"));
builder.Services.Configure<IncomingCallOptions>(builder.Configuration.GetSection("IncomingCall"));

var app = builder.Build();

// "PathBase" (e.g. "/Orders"): the app answers under that path - http://server:8888/Orders/ -
// with config.js API_BASE "/Orders/api". The bare address redirects there.
var pathBase = (builder.Configuration["PathBase"] ?? string.Empty).Trim().TrimEnd('/');
if (pathBase.Length > 0)
{
    if (!pathBase.StartsWith('/')) pathBase = "/" + pathBase;
    app.Use(async (context, next) =>
    {
        if (context.Request.Path == "/")
        {
            context.Response.Redirect(pathBase + "/");
            return;
        }
        await next();
    });
    app.UsePathBase(pathBase);
}

// The app's own address without its final "/" (http://server/Orders, e.g. as an IIS application
// under Default Web Site): the screens load ./static/... relative to the address, so they would load
// from the wrong folder and show a blank page. Add the "/".
app.Use(async (context, next) =>
{
    if (!context.Request.Path.HasValue && context.Request.PathBase.HasValue)
    {
        context.Response.Redirect(context.Request.PathBase + "/" + context.Request.QueryString);
        return;
    }
    await next();
});

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// The built screens (Orders Frontend "npm run build") can be copied into wwwroot: they are then
// served from this same address, and config.js uses API_BASE "<PathBase>/api" (no CORS needed).
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("Frontend");

app.MapControllers();
app.MapHub<OrdersHub>("/hubs/orders");

app.Run();
