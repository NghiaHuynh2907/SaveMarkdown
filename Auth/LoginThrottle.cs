using Microsoft.Extensions.Caching.Memory;

namespace SaveMarkdown.Auth;

/// <summary>
/// Giới hạn đăng nhập theo IP: sai <see cref="MaxFailures"/> lần thì khóa <see cref="LockDuration"/>.
/// Lượt thử được "giữ chỗ" trước khi kiểm tra mật khẩu, nên gửi song song nhiều request
/// cũng không vượt quá giới hạn.
/// </summary>
public sealed class LoginThrottle(IMemoryCache cache, TimeProvider? timeProvider = null)
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(15);

    private readonly TimeProvider _time = timeProvider ?? TimeProvider.System;
    private readonly Lock _sync = new();

    private sealed class Entry
    {
        public int Attempts;
        public DateTimeOffset? LockedUntil;
    }

    /// <summary>Trả false (kèm thời gian chờ) nếu IP đang bị khóa hoặc đã hết lượt.</summary>
    public bool TryBeginAttempt(string ip, out TimeSpan retryAfter)
    {
        lock (_sync)
        {
            var entry = GetOrCreate(ip);
            var now = _time.GetUtcNow();

            if (entry.LockedUntil is { } until)
            {
                if (until > now)
                {
                    retryAfter = until - now;
                    return false;
                }
                entry.Attempts = 0;
                entry.LockedUntil = null;
            }

            if (entry.Attempts >= MaxFailures)
            {
                retryAfter = LockDuration;
                return false;
            }

            entry.Attempts++;
            retryAfter = TimeSpan.Zero;
            return true;
        }
    }

    /// <summary>Ghi nhận lượt sai. Trả thời gian khóa nếu lượt này làm IP bị khóa.</summary>
    public TimeSpan? RecordFailure(string ip)
    {
        lock (_sync)
        {
            var entry = GetOrCreate(ip);
            if (entry.Attempts >= MaxFailures && entry.LockedUntil is null)
            {
                entry.LockedUntil = _time.GetUtcNow() + LockDuration;
                return LockDuration;
            }
            return null;
        }
    }

    public void RecordSuccess(string ip)
    {
        lock (_sync)
        {
            cache.Remove(Key(ip));
        }
    }

    private Entry GetOrCreate(string ip) =>
        cache.GetOrCreate(Key(ip), e =>
        {
            e.SlidingExpiration = LockDuration;
            return new Entry();
        })!;

    private static string Key(string ip) => "login-throttle:" + ip;
}
