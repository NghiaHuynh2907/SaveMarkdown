using System.Diagnostics;
using System.Text;
using System.Threading.Channels;
using Microsoft.Extensions.Options;

namespace SaveMarkdown.Files;

public sealed class GitOptions
{
    public const string Section = "Git";

    public bool Enabled { get; set; }

    /// <summary>URL repo GitHub chứa tài liệu, vd. https://github.com/owner/repo.git</summary>
    public string RemoteUrl { get; set; } = "";

    public string Branch { get; set; } = "main";

    /// <summary>
    /// Personal access token (quyền Contents: Read and write). Để trống thì dùng credential sẵn có của git trên máy.
    /// Không ghi token vào appsettings.json; dùng user-secrets hoặc biến môi trường Git__Token.
    /// </summary>
    public string Token { get; set; } = "";

    public string AuthorName { get; set; } = "SaveMarkdown";
    public string AuthorEmail { get; set; } = "savemarkdown@users.noreply.github.com";

    /// <summary>Địa chỉ GitHub Pages; để trống thì suy ra từ RemoteUrl (https://owner.github.io/repo).</summary>
    public string PagesUrl { get; set; } = "";

    /// <summary>
    /// Địa chỉ bản web SaveMarkdown (GitHub Pages của repo code), vd. https://owner.github.io/SaveMarkdown/.
    /// Có giá trị thì nút "Copy link" trong app trỏ tới bản web thay vì trang tài liệu.
    /// </summary>
    public string AppUrl { get; set; } = "";

    /// <summary>Chu kỳ kéo thay đổi từ GitHub (do người khác sửa qua bản web) khi ở đây không có gì mới.</summary>
    public double PullMinutes { get; set; } = 1;

    /// <summary>Tự sinh index.md ở thư mục gốc liệt kê mọi tài liệu (làm trang chủ cho GitHub Pages).</summary>
    public bool GenerateIndex { get; set; } = true;

    /// <summary>Gom các thay đổi liên tiếp trong khoảng này thành một commit.</summary>
    public double DebounceSeconds { get; set; } = 5;
}

/// <summary>
/// Đồng bộ thư mục dữ liệu với một repo GitHub: mỗi thay đổi (lưu, tạo, xóa, đổi tên, tải lên) được
/// gom lại, commit rồi push. Lỗi push (mất mạng, sai token...) được thử lại ở lần sau.
/// </summary>
public sealed class GitSyncService(
    SafePathResolver paths,
    IOptions<GitOptions> options,
    ILogger<GitSyncService> logger) : BackgroundService
{
    private static readonly TimeSpan RetryEvery = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromMinutes(2);

    private readonly GitOptions _o = options.Value;
    private readonly Channel<string> _changes = Channel.CreateUnbounded<string>();
    private readonly Lock _statusLock = new();
    private DateTimeOffset? _lastPush;
    private string? _lastError;

    public bool Enabled => _o.Enabled && !string.IsNullOrWhiteSpace(_o.RemoteUrl);

    /// <summary>Link xem trên web, vd. https://github.com/owner/repo (không kèm thông tin đăng nhập).</summary>
    public string? WebUrl => Enabled ? ToWebUrl(_o.RemoteUrl) : null;

    /// <summary>Địa chỉ GitHub Pages của repo tài liệu, vd. https://owner.github.io/repo</summary>
    public string? PagesUrl => !Enabled ? null
        : !string.IsNullOrWhiteSpace(_o.PagesUrl) ? _o.PagesUrl.Trim().TrimEnd('/')
        : ToPagesUrl(WebUrl!);

    public string Branch => _o.Branch;

    public object Status()
    {
        lock (_statusLock)
        {
            var appUrl = string.IsNullOrWhiteSpace(_o.AppUrl) ? null : _o.AppUrl.Trim();
            return new { enabled = Enabled, webUrl = WebUrl, pagesUrl = PagesUrl, appUrl, branch = Branch, lastPush = _lastPush, lastError = _lastError };
        }
    }

    /// <summary>Báo có thay đổi; <paramref name="description"/> dùng làm nội dung commit.</summary>
    public void NotifyChanged(string description)
    {
        if (Enabled) _changes.Writer.TryWrite(description);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled) return;

        var pending = new List<string>();
        try
        {
            await InitializeAsync(stoppingToken);
            pending.Add("Đồng bộ lúc khởi động");

            var debounce = TimeSpan.FromSeconds(Math.Max(1, _o.DebounceSeconds));
            var pullEvery = TimeSpan.FromMinutes(Math.Max(0.5, _o.PullMinutes));
            while (!stoppingToken.IsCancellationRequested)
            {
                if (pending.Count > 0)
                {
                    // Chờ đến khi không còn thay đổi mới trong khoảng debounce.
                    while (await WaitForChange(debounce, stoppingToken) is { } more) pending.Add(more);

                    if (await SyncAsync(pending, stoppingToken)) pending.Clear();
                    else if (await WaitForChange(RetryEvery, stoppingToken) is { } more) pending.Add(more);
                }
                else if (await WaitForChange(pullEvery, stoppingToken) is { } change)
                {
                    pending.Add(change);
                }
                else
                {
                    // Không có thay đổi ở đây: kéo thay đổi người khác sửa qua bản web về.
                    await SyncAsync(pending, stoppingToken);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // app đang tắt
        }
        catch (Exception ex)
        {
            SetError(ex.Message);
            logger.LogError(ex, "Không khởi tạo được git cho thư mục dữ liệu");
        }
    }

    private async Task<string?> WaitForChange(TimeSpan timeout, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        try
        {
            return await _changes.Reader.ReadAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return null;
        }
    }

    private async Task InitializeAsync(CancellationToken ct)
    {
        if (!Directory.Exists(Path.Combine(paths.Root, ".git")))
        {
            await GitAsync(ct, "init", "-b", _o.Branch);
            logger.LogInformation("Đã tạo git repo trong {Root}", paths.Root);
        }

        var remote = await GitAsync(ct, allowFail: true, "remote", "get-url", "origin");
        if (remote.ExitCode != 0) await GitAsync(ct, "remote", "add", "origin", _o.RemoteUrl);
        else if (remote.Output.Trim() != _o.RemoteUrl) await GitAsync(ct, "remote", "set-url", "origin", _o.RemoteUrl);

        // Không đưa thùng rác và file tạm lúc ghi vào repo.
        var exclude = Path.Combine(paths.Root, ".git", "info", "exclude");
        Directory.CreateDirectory(Path.GetDirectoryName(exclude)!);
        await File.WriteAllTextAsync(exclude, $"/{TrashService.FolderName}/\n*.tmp\n*.mv\n", ct);
    }

    private async Task<bool> SyncAsync(List<string> changes, CancellationToken ct)
    {
        try
        {
            // Chỉ sinh lại mục lục khi có thay đổi ở đây (bản web tự cập nhật index.md khi nó commit).
            if (_o.GenerateIndex && changes.Count > 0) await WriteIndexAsync(ct);
            await GitAsync(ct, "add", "-A");
            var dirty = await GitAsync(ct, "status", "--porcelain");
            if (dirty.Output.Length > 0)
            {
                await GitAsync(ct, "commit", "-q", "-m", CommitMessage(changes));
            }

            // Lấy thay đổi người khác đẩy lên GitHub (nếu có) trước khi push.
            var fetch = await GitAsync(ct, allowFail: true, "fetch", "origin", _o.Branch);
            var remoteHasBranch = fetch.ExitCode == 0;
            if (!remoteHasBranch && !fetch.Output.Contains("couldn't find remote ref", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(fetch.Output.Trim());
            }

            var hasCommits = (await GitAsync(ct, allowFail: true, "rev-parse", "--verify", "HEAD")).ExitCode == 0;
            if (!hasCommits)
            {
                if (remoteHasBranch) await GitAsync(ct, "reset", "-q", "--hard", $"origin/{_o.Branch}");
                SetPushed();
                return true;
            }

            if (remoteHasBranch)
            {
                var rebase = await GitAsync(ct, allowFail: true, "rebase", "-q", $"origin/{_o.Branch}");
                if (rebase.ExitCode != 0)
                {
                    await GitAsync(ct, allowFail: true, "rebase", "--abort");
                    throw new InvalidOperationException(
                        "Xung đột với thay đổi trên GitHub, cần xử lý tay trong thư mục dữ liệu: " + rebase.Output.Trim());
                }
            }

            var ahead = remoteHasBranch
                ? (await GitAsync(ct, "rev-list", "--count", $"origin/{_o.Branch}..HEAD")).Output.Trim()
                : "1";
            if (ahead != "0")
            {
                await GitAsync(ct, "push", "-q", "-u", "origin", $"HEAD:refs/heads/{_o.Branch}");
                logger.LogInformation("Đã push lên {Remote}", WebUrl);
            }
            SetPushed();
            return true;
        }
        catch (InvalidOperationException ex)
        {
            SetError(ex.Message);
            logger.LogWarning("Đồng bộ git thất bại, sẽ thử lại: {Error}", ex.Message);
            return false;
        }
    }

    public const string IndexFile = "index.md";

    private async Task WriteIndexAsync(CancellationToken ct)
    {
        var sb = new StringBuilder();
        sb.Append("# Tài liệu\n\n");
        sb.Append("> Trang này do SaveMarkdown tự sinh mỗi lần đồng bộ, sửa tay sẽ bị ghi đè.\n\n");
        AppendIndex(sb, new DirectoryInfo(paths.Root), 0);

        var full = Path.Combine(paths.Root, IndexFile);
        var content = sb.ToString();
        if (File.Exists(full) && await File.ReadAllTextAsync(full, ct) == content) return;
        await File.WriteAllTextAsync(full, content, new UTF8Encoding(false), ct);
    }

    private void AppendIndex(StringBuilder sb, DirectoryInfo dir, int depth)
    {
        var indent = new string(' ', depth * 2);
        foreach (var sub in dir.EnumerateDirectories().Where(FileEndpoints.IsVisible)
                     .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            // Git không lưu thư mục rỗng nên bỏ qua thư mục không có tài liệu.
            var children = new StringBuilder();
            AppendIndex(children, sub, depth + 1);
            if (children.Length == 0) continue;
            sb.Append($"{indent}- **{sub.Name}/**\n").Append(children);
        }
        foreach (var file in dir.EnumerateFiles()
                     .Where(f => FileEndpoints.IsVisible(f) && FileEndpoints.IsText(f.Name))
                     .Where(f => depth > 0 || !f.Name.Equals(IndexFile, StringComparison.OrdinalIgnoreCase))
                     .OrderBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            // Link tương đối tới .md: GitHub Pages tự đổi thành .html, trên github.com vẫn mở được.
            var link = paths.ToRelative(file.FullName).Replace(" ", "%20");
            sb.Append($"{indent}- [{Path.GetFileNameWithoutExtension(file.Name)}]({link})\n");
        }
    }

    private static string CommitMessage(List<string> changes)
    {
        var distinct = changes.Distinct().ToList();
        if (distinct.Count == 0) return "Cập nhật tài liệu";
        if (distinct.Count == 1) return distinct[0];
        return $"Cập nhật {distinct.Count} thay đổi\n\n" + string.Join('\n', distinct.Select(c => "- " + c));
    }

    private void SetPushed()
    {
        lock (_statusLock)
        {
            _lastPush = DateTimeOffset.UtcNow;
            _lastError = null;
        }
    }

    private void SetError(string error)
    {
        lock (_statusLock) _lastError = error;
    }

    private Task<(int ExitCode, string Output)> GitAsync(CancellationToken ct, params string[] args) =>
        GitAsync(ct, allowFail: false, args);

    private async Task<(int ExitCode, string Output)> GitAsync(CancellationToken ct, bool allowFail, params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = paths.Root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);

        // Chạy ngầm trên server: không bao giờ hỏi mật khẩu.
        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
        psi.Environment["GCM_INTERACTIVE"] = "never";
        psi.Environment["GIT_AUTHOR_NAME"] = psi.Environment["GIT_COMMITTER_NAME"] = _o.AuthorName;
        psi.Environment["GIT_AUTHOR_EMAIL"] = psi.Environment["GIT_COMMITTER_EMAIL"] = _o.AuthorEmail;
        var config = new List<(string Key, string Value)> { ("core.quotepath", "false") };
        if (!string.IsNullOrWhiteSpace(_o.Token))
        {
            // Truyền token qua biến môi trường để không lộ trên dòng lệnh và không lưu vào .git/config.
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"x-access-token:{_o.Token.Trim()}"));
            config.Add(("credential.helper", ""));
            config.Add(("http.extraHeader", $"Authorization: Basic {basic}"));
        }
        psi.Environment["GIT_CONFIG_COUNT"] = config.Count.ToString();
        for (var i = 0; i < config.Count; i++)
        {
            psi.Environment[$"GIT_CONFIG_KEY_{i}"] = config[i].Key;
            psi.Environment[$"GIT_CONFIG_VALUE_{i}"] = config[i].Value;
        }

        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Không chạy được git.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(CommandTimeout);
        var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            if (ct.IsCancellationRequested) throw;
            throw new InvalidOperationException($"git {args[0]} quá thời gian chờ.");
        }

        var output = (await stdout) + (await stderr);
        if (process.ExitCode != 0 && !allowFail)
        {
            throw new InvalidOperationException($"git {args[0]} lỗi: {output.Trim()}");
        }
        return (process.ExitCode, output);
    }

    // https://github.com/Owner/repo -> https://owner.github.io/repo
    private static string? ToPagesUrl(string webUrl)
    {
        if (!Uri.TryCreate(webUrl, UriKind.Absolute, out var uri) ||
            !uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase)) return null;
        var parts = uri.AbsolutePath.Trim('/').Split('/');
        return parts.Length == 2 ? $"https://{parts[0].ToLowerInvariant()}.github.io/{parts[1]}" : null;
    }

    private static string ToWebUrl(string remote)
    {
        var url = remote.Trim();
        // git@github.com:owner/repo.git -> https://github.com/owner/repo
        if (url.StartsWith("git@", StringComparison.Ordinal) && url.IndexOf(':') is var colon and > 0)
        {
            url = $"https://{url[4..colon]}/{url[(colon + 1)..]}";
        }
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            url = $"{uri.Scheme}://{uri.Host}{uri.AbsolutePath}";
        }
        url = url.TrimEnd('/');
        return url.EndsWith(".git", StringComparison.OrdinalIgnoreCase) ? url[..^4] : url;
    }
}
