using Microsoft.Extensions.Options;

namespace SaveMarkdown.Files;

public sealed class BackupOptions
{
    public const string Section = "Backup";

    public bool Enabled { get; set; } = true;

    /// <summary>Thư mục chứa bản sao lưu .zip. Đường dẫn tương đối tính từ ContentRoot.</summary>
    public string Directory { get; set; } = "backups";

    public double IntervalHours { get; set; } = 24;

    /// <summary>Số bản sao lưu giữ lại; bản cũ hơn bị xóa.</summary>
    public int Keep { get; set; } = 14;
}

/// <summary>Định kỳ nén toàn bộ thư mục dữ liệu thành backup-yyyyMMdd-HHmmss.zip.</summary>
public sealed class BackupService(
    SafePathResolver paths,
    IOptions<BackupOptions> options,
    IWebHostEnvironment env,
    ILogger<BackupService> logger) : BackgroundService
{
    private const string Prefix = "backup-";
    private static readonly TimeSpan CheckEvery = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = options.Value;
        if (!o.Enabled) return;

        var dir = Path.GetFullPath(Path.IsPathRooted(o.Directory) ? o.Directory : Path.Combine(env.ContentRootPath, o.Directory));
        var interval = TimeSpan.FromHours(Math.Max(0.1, o.IntervalHours));
        var keep = Math.Max(1, o.Keep);

        try
        {
            // Đợi app khởi động xong rồi mới sao lưu.
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            using var timer = new PeriodicTimer(CheckEvery);
            do
            {
                try
                {
                    System.IO.Directory.CreateDirectory(dir);
                    var last = LatestBackup(dir);
                    if (last is null || DateTime.UtcNow - last.Value >= interval)
                    {
                        Create(dir);
                        Prune(dir, keep);
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    logger.LogError(ex, "Sao lưu thất bại");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // app đang tắt
        }
    }

    private void Create(string dir)
    {
        var name = $"{Prefix}{DateTime.Now:yyyyMMdd-HHmmss}.zip";
        var temp = Path.Combine(dir, name + ".tmp");
        // Nếu thư mục sao lưu nằm trong thư mục dữ liệu thì bỏ nó ra khỏi bản nén.
        ZipHelper.CreateFromDirectory(paths.Root, temp, exclude: [dir]);
        File.Move(temp, Path.Combine(dir, name), overwrite: true);
        logger.LogInformation("Đã sao lưu dữ liệu vào {File}", name);
    }

    private static DateTime? LatestBackup(string dir) =>
        new DirectoryInfo(dir).EnumerateFiles($"{Prefix}*.zip")
            .Select(f => (DateTime?)f.LastWriteTimeUtc)
            .Max();

    private static void Prune(string dir, int keep)
    {
        foreach (var old in new DirectoryInfo(dir).EnumerateFiles($"{Prefix}*.zip")
                     .OrderByDescending(f => f.Name, StringComparer.Ordinal)
                     .Skip(keep))
        {
            old.Delete();
        }
    }
}
