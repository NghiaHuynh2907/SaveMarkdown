using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;

namespace SaveMarkdown.Auth;

public static class AuthEndpoints
{
    private static readonly TimeSpan FailureDelay = TimeSpan.FromMilliseconds(500);

    public sealed record LoginRequest(string? Password, bool Remember);

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/login", Login).AllowAnonymous();

        group.MapPost("/logout", async (HttpContext ctx) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).AllowAnonymous();

        group.MapGet("/me", (ClaimsPrincipal user) =>
            Results.Ok(new { authenticated = true, name = user.Identity?.Name }))
            .RequireAuthorization();
    }

    private static async Task<IResult> Login(
        LoginRequest request,
        HttpContext ctx,
        LoginThrottle throttle,
        IOptionsMonitor<AuthOptions> options,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger(typeof(AuthEndpoints));
        var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        var expected = options.CurrentValue.Password;
        if (string.IsNullOrEmpty(expected))
        {
            logger.LogError("Đăng nhập thất bại: chưa cấu hình Auth:Password.");
            return Message("Server chưa được cấu hình mật khẩu.", StatusCodes.Status500InternalServerError);
        }

        if (!throttle.TryBeginAttempt(ip, out var retryAfter))
        {
            return Locked(retryAfter);
        }

        if (!Verify(expected, request.Password))
        {
            await Task.Delay(FailureDelay);
            logger.LogWarning("Đăng nhập sai từ {Ip}", ip);
            return throttle.RecordFailure(ip) is { } lockedFor
                ? Locked(lockedFor)
                : Message("Mật khẩu không đúng", StatusCodes.Status401Unauthorized);
        }

        throttle.RecordSuccess(ip);

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, "owner")],
            CookieAuthenticationDefaults.AuthenticationScheme);
        await ctx.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = request.Remember, AllowRefresh = true });

        return Results.Ok(new { authenticated = true });
    }

    // So sánh thời gian không đổi để không lộ độ dài khớp qua timing.
    private static bool Verify(string expected, string? password) =>
        !string.IsNullOrEmpty(password) &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(password));

    private static IResult Locked(TimeSpan retryAfter)
    {
        var minutes = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalMinutes));
        return Message($"Sai quá nhiều lần. Thử lại sau {minutes} phút.", StatusCodes.Status429TooManyRequests);
    }

    private static IResult Message(string message, int statusCode) =>
        Results.Json(new { message }, statusCode: statusCode);
}
