using Microsoft.AspNetCore.Authentication.Cookies;
using SaveMarkdown.Auth;
using SaveMarkdown.Files;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.Section));
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.Section));
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddSingleton<SafePathResolver>();
builder.Services.AddSingleton<TrashService>();
builder.Services.Configure<BackupOptions>(builder.Configuration.GetSection(BackupOptions.Section));
builder.Services.AddHostedService<BackupService>();

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "savemd.auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Strict;
        // Chỉ áp dụng cho cookie "Ghi nhớ" (persistent); cookie thường mất khi đóng trình duyệt.
        options.ExpireTimeSpan = TimeSpan.FromDays(7);
        options.SlidingExpiration = true;
        options.LoginPath = "/login";

        // API trả 401/403 thay vì redirect; trang thường thì chuyển về /login.
        options.Events.OnRedirectToLogin = ctx =>
        {
            if (IsApi(ctx.Request)) ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            else ctx.Response.Redirect("/login");
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = ctx =>
        {
            if (IsApi(ctx.Request)) ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            else ctx.Response.Redirect("/login");
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

// Fail sớm nếu thư mục gốc cấu hình sai.
_ = app.Services.GetRequiredService<SafePathResolver>();
if (string.IsNullOrEmpty(app.Configuration[$"{AuthOptions.Section}:Password"]))
{
    app.Logger.LogWarning("Chưa cấu hình Auth:Password trong appsettings.json.");
}

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseHttpsRedirection();

app.Use(async (ctx, next) =>
{
    var headers = ctx.Response.Headers;
    headers.XContentTypeOptions = "nosniff";
    headers.XFrameOptions = "DENY";
    headers["Referrer-Policy"] = "no-referrer";
    if (IsApi(ctx.Request)) headers.CacheControl = "no-store";
    await next();
});

// wwwroot chỉ chứa trang đăng nhập và css/js, không có dữ liệu.
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

var appPage = Path.Combine(app.Environment.ContentRootPath, "AppPages", "app.html");
var loginPage = Path.Combine(app.Environment.WebRootPath, "login.html");

app.MapGet("/", (HttpContext ctx) =>
{
    ctx.Response.Headers.CacheControl = "no-store";
    return Results.File(appPage, "text/html; charset=utf-8");
}).RequireAuthorization();

app.MapGet("/login", (HttpContext ctx) =>
    ctx.User.Identity?.IsAuthenticated == true
        ? Results.Redirect("/")
        : Results.File(loginPage, "text/html; charset=utf-8"));

app.MapAuthEndpoints();
app.MapFileEndpoints();

// URL lạ: API -> 404; trang -> yêu cầu đăng nhập (chưa đăng nhập sẽ bị chuyển về /login).
app.MapFallback((HttpContext ctx) =>
    IsApi(ctx.Request) ? Results.NotFound() : Results.Redirect("/")).RequireAuthorization();

app.Run();

static bool IsApi(HttpRequest request) => request.Path.StartsWithSegments("/api");
