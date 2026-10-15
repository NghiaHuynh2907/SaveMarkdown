using System.Text;

namespace SaveMarkdown.Files;

public static class FileEndpoints
{
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".md", ".markdown", ".txt",
    };

    private static readonly Dictionary<string, string> ImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
        [".svg"] = "image/svg+xml",
    };

    private const long MaxFileBytes = 10 * 1024 * 1024;
    private const long MaxSearchFileBytes = 2 * 1024 * 1024;
    private const int MaxSearchHits = 100;
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    public sealed record TreeNode(string Name, string Path, string Type, IReadOnlyList<TreeNode>? Children);
    public sealed record PathRequest(string? Path);
    public sealed record MoveRequest(string? From, string? To);
    public sealed record SaveRequest(string? Path, string? Content, string? Version, bool Force);
    public sealed record IdRequest(string? Id);
    public sealed record SearchHit(string Path, string Name, string Type, string? Snippet, int MatchStart, int MatchLength, int Line);

    public static bool IsText(string path) => TextExtensions.Contains(Path.GetExtension(path));
    public static bool IsAllowed(string path) =>
        TextExtensions.Contains(Path.GetExtension(path)) || ImageTypes.ContainsKey(Path.GetExtension(path));

    public static void MapFileEndpoints(this IEndpointRouteBuilder app)
    {
        // Mọi endpoint file đều yêu cầu đăng nhập ở server, chưa đăng nhập -> 401.
        var files = app.MapGroup("/api/files").RequireAuthorization().AddEndpointFilter(InvalidPathFilter);
        files.MapGet("/tree", Tree);
        files.MapGet("/read", Read);
        files.MapGet("/raw", Raw);
        files.MapGet("/download", Download);
        files.MapGet("/zip", Zip);
        files.MapGet("/search", Search);
        files.MapPost("/upload", Upload);
        files.MapPost("/file", CreateFile);
        files.MapPost("/folder", CreateFolder);
        files.MapPut("/content", Save);
        files.MapPost("/move", Move);
        files.MapDelete("/", Delete);

        app.MapGet("/api/git/status", (GitSyncService git) => Results.Ok(git.Status())).RequireAuthorization();

        var trash = app.MapGroup("/api/trash").RequireAuthorization().AddEndpointFilter(InvalidPathFilter);
        trash.MapGet("/", (TrashService t) => Results.Ok(t.List()));
        trash.MapPost("/restore", RestoreTrash);
        trash.MapDelete("/{id}", (string id, TrashService t) => t.Delete(id) ? Results.NoContent() : NotFound("Không tìm thấy."));
        trash.MapDelete("/", (TrashService t) =>
        {
            t.Empty();
            return Results.NoContent();
        });
    }

    private static async ValueTask<object?> InvalidPathFilter(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        try
        {
            return await next(ctx);
        }
        catch (InvalidPathException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    // ---------- Đọc ----------

    private static IResult Tree(SafePathResolver paths) =>
        Results.Ok(new TreeNode("", "", "dir", BuildChildren(new DirectoryInfo(paths.Root), paths)));

    private static List<TreeNode> BuildChildren(DirectoryInfo dir, SafePathResolver paths)
    {
        var dirs = dir.EnumerateDirectories()
            .Where(IsVisible)
            .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(d => new TreeNode(d.Name, paths.ToRelative(d.FullName), "dir", BuildChildren(d, paths)));

        var files = dir.EnumerateFiles()
            .Where(f => IsVisible(f) && IsAllowed(f.Name))
            .OrderBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(f => new TreeNode(f.Name, paths.ToRelative(f.FullName), "file", null));

        return [.. dirs, .. files];
    }

    internal static bool IsVisible(FileSystemInfo info) =>
        !info.Name.StartsWith('.') &&
        info.LinkTarget is null &&
        !info.Attributes.HasFlag(FileAttributes.Hidden);

    /// <summary>Phiên bản file để phát hiện sửa đồng thời (từ thiết bị/tab khác).</summary>
    private static string Version(FileInfo file) => file.LastWriteTimeUtc.Ticks.ToString();

    private static async Task<IResult> Read(string? path, SafePathResolver paths, HttpContext ctx)
    {
        var full = paths.Resolve(path);
        var file = new FileInfo(full);
        if (!file.Exists || !IsText(full))
        {
            return NotFound("Không tìm thấy file.");
        }
        if (file.Length > MaxFileBytes)
        {
            return BadRequest("File quá lớn để hiển thị.");
        }

        ctx.Response.Headers["X-File-Version"] = Version(file);
        var content = await File.ReadAllTextAsync(full, Encoding.UTF8);
        return Results.Text(content, "text/plain; charset=utf-8");
    }

    private static IResult Raw(string? path, SafePathResolver paths, HttpContext ctx)
    {
        var full = paths.Resolve(path);
        if (!File.Exists(full) || !ImageTypes.TryGetValue(Path.GetExtension(full), out var contentType))
        {
            return NotFound("Không tìm thấy ảnh.");
        }

        ctx.Response.Headers.CacheControl = "private, max-age=300";
        // SVG có thể chứa script: chặn chạy script nếu mở ảnh trực tiếp.
        ctx.Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
        return Results.File(full, contentType, enableRangeProcessing: true);
    }

    private static IResult Download(string? path, SafePathResolver paths)
    {
        var full = paths.Resolve(path);
        var file = new FileInfo(full);
        if (!file.Exists || !IsAllowed(full))
        {
            return NotFound("Không tìm thấy file.");
        }

        var contentType = ImageTypes.TryGetValue(file.Extension, out var imageType) ? imageType
            : file.Extension.Equals(".txt", StringComparison.OrdinalIgnoreCase) ? "text/plain; charset=utf-8"
            : "text/markdown; charset=utf-8";
        return Results.File(full, contentType, fileDownloadName: file.Name);
    }

    private static IResult Zip(string? path, SafePathResolver paths)
    {
        var full = paths.Resolve(path);
        if (!Directory.Exists(full))
        {
            return NotFound("Không tìm thấy thư mục.");
        }

        var temp = Path.Combine(Path.GetTempPath(), $"savemd-{Guid.NewGuid():N}.zip");
        ZipHelper.CreateFromDirectory(full, temp);
        var stream = new FileStream(temp, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete,
            bufferSize: 81920, FileOptions.DeleteOnClose);

        var baseName = paths.IsRoot(full) ? "SaveMarkdown" : Path.GetFileName(full);
        return Results.File(stream, "application/zip", $"{baseName}-{DateTime.Now:yyyyMMdd-HHmm}.zip");
    }

    private static IResult Search(string? q, SafePathResolver paths)
    {
        q = q?.Trim();
        if (string.IsNullOrEmpty(q))
        {
            return Results.Ok(Array.Empty<SearchHit>());
        }

        // So khớp không phân biệt hoa thường và dấu tiếng Việt ("ghi chu" tìm được "Ghi chú").
        var needle = TextFold.Fold(q);
        var nameHits = new List<SearchHit>();
        var contentHits = new List<SearchHit>();

        foreach (var entry in EnumerateVisible(new DirectoryInfo(paths.Root)))
        {
            if (nameHits.Count + contentHits.Count >= MaxSearchHits) break;

            var isDir = entry is DirectoryInfo;
            var relative = paths.ToRelative(entry.FullName);
            var nameIndex = TextFold.Fold(entry.Name).IndexOf(needle, StringComparison.Ordinal);
            if (nameIndex >= 0)
            {
                nameHits.Add(new SearchHit(relative, entry.Name, isDir ? "dir" : "file", null, nameIndex, needle.Length, 0));
            }
            else if (entry is FileInfo file && IsText(file.Name) && file.Length <= MaxSearchFileBytes
                     && FindInFile(file.FullName, needle) is { } hit)
            {
                contentHits.Add(new SearchHit(relative, file.Name, "file", hit.Snippet, hit.Start, needle.Length, hit.Line));
            }
        }

        return Results.Ok(nameHits.Concat(contentHits));
    }

    private static IEnumerable<FileSystemInfo> EnumerateVisible(DirectoryInfo dir)
    {
        foreach (var sub in dir.EnumerateDirectories().Where(IsVisible).OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            yield return sub;
            foreach (var child in EnumerateVisible(sub)) yield return child;
        }
        foreach (var file in dir.EnumerateFiles().Where(f => IsVisible(f) && IsAllowed(f.Name)).OrderBy(f => f.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            yield return file;
        }
    }

    private static (string Snippet, int Start, int Line)? FindInFile(string fullPath, string needle)
    {
        string[] lines;
        try
        {
            lines = File.ReadAllLines(fullPath, Encoding.UTF8);
        }
        catch (IOException)
        {
            return null;
        }

        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            var index = TextFold.Fold(line).IndexOf(needle, StringComparison.Ordinal);
            if (index < 0) continue;

            var from = Math.Max(0, index - 50);
            var to = Math.Min(line.Length, index + needle.Length + 90);
            var prefix = from > 0 ? "…" : "";
            var suffix = to < line.Length ? "…" : "";
            return (prefix + line[from..to] + suffix, index - from + prefix.Length, i + 1);
        }
        return null;
    }

    // ---------- Ghi ----------

    private static async Task<IResult> Upload(HttpRequest request, SafePathResolver paths, GitSyncService git)
    {
        if (!request.HasFormContentType)
        {
            return BadRequest("Yêu cầu không hợp lệ.");
        }

        var form = await request.ReadFormAsync();
        var folder = paths.Resolve(form["folder"]);
        if (!Directory.Exists(folder))
        {
            return NotFound("Thư mục đích không tồn tại.");
        }
        if (form.Files.Count == 0)
        {
            return BadRequest("Chưa chọn file.");
        }
        var overwrite = string.Equals(form["overwrite"], "true", StringComparison.OrdinalIgnoreCase);

        // Kiểm tra toàn bộ trước khi ghi để không ghi dở dang.
        var targets = new List<(IFormFile File, string FullPath)>();
        foreach (var file in form.Files)
        {
            var name = Path.GetFileName(file.FileName);
            SafePathResolver.ValidateName(name);
            if (!IsAllowed(name))
            {
                return BadRequest($"\"{name}\": chỉ cho phép .md, .markdown, .txt và ảnh (png, jpg, gif, webp, svg).");
            }
            if (file.Length > MaxFileBytes)
            {
                return BadRequest($"\"{name}\" vượt quá 10 MB.");
            }
            targets.Add((file, paths.Resolve(Path.Combine(paths.ToRelative(folder), name))));
        }

        var existing = targets.Where(t => File.Exists(t.FullPath)).Select(t => Path.GetFileName(t.FullPath)).ToList();
        if (existing.Count > 0 && !overwrite)
        {
            return Results.Conflict(new { message = "File đã tồn tại.", existing });
        }

        foreach (var (file, fullPath) in targets)
        {
            await using var stream = File.Create(fullPath);
            await file.CopyToAsync(stream);
        }
        git.NotifyChanged("Tải lên " + string.Join(", ", targets.Select(t => paths.ToRelative(t.FullPath))));

        return Results.Ok(new { uploaded = targets.Select(t => paths.ToRelative(t.FullPath)) });
    }

    private static async Task<IResult> CreateFile(PathRequest request, SafePathResolver paths, GitSyncService git)
    {
        var full = paths.Resolve(request.Path);
        if (paths.IsRoot(full) || !IsText(full))
        {
            return BadRequest("Tên file phải có đuôi .md, .markdown hoặc .txt.");
        }
        if (File.Exists(full) || Directory.Exists(full))
        {
            return Conflict("Đã tồn tại file hoặc thư mục cùng tên.");
        }
        if (!Directory.Exists(Path.GetDirectoryName(full)))
        {
            return NotFound("Thư mục cha không tồn tại.");
        }

        var initial = Path.GetExtension(full).Equals(".txt", StringComparison.OrdinalIgnoreCase)
            ? ""
            : $"# {Path.GetFileNameWithoutExtension(full)}\n\n";
        await using (var stream = new FileStream(full, FileMode.CreateNew, FileAccess.Write))
        await using (var writer = new StreamWriter(stream, Utf8NoBom))
        {
            await writer.WriteAsync(initial);
        }
        git.NotifyChanged("Tạo " + paths.ToRelative(full));
        return Results.Ok(new { path = paths.ToRelative(full) });
    }

    private static IResult CreateFolder(PathRequest request, SafePathResolver paths, GitSyncService git)
    {
        var full = paths.Resolve(request.Path);
        if (paths.IsRoot(full))
        {
            return BadRequest("Chưa nhập tên thư mục.");
        }
        if (Directory.Exists(full) || File.Exists(full))
        {
            return Conflict("Đã tồn tại file hoặc thư mục cùng tên.");
        }
        if (!Directory.Exists(Path.GetDirectoryName(full)))
        {
            return NotFound("Thư mục cha không tồn tại.");
        }

        Directory.CreateDirectory(full);
        // Git không lưu thư mục rỗng: thêm file ẩn để thư mục mới vẫn được đồng bộ lên GitHub.
        File.WriteAllBytes(Path.Combine(full, ".gitkeep"), []);
        git.NotifyChanged("Tạo thư mục " + paths.ToRelative(full));
        return Results.Ok(new { path = paths.ToRelative(full) });
    }

    private static async Task<IResult> Save(SaveRequest request, SafePathResolver paths, GitSyncService git)
    {
        var full = paths.Resolve(request.Path);
        if (!IsText(full))
        {
            return BadRequest("Chỉ sửa được file văn bản.");
        }
        var file = new FileInfo(full);
        if (!file.Exists)
        {
            return NotFound("Không tìm thấy file.");
        }

        var content = request.Content ?? "";
        if (Utf8NoBom.GetByteCount(content) > MaxFileBytes)
        {
            return BadRequest("Nội dung vượt quá 10 MB.");
        }
        if (!request.Force && request.Version is not null && request.Version != Version(file))
        {
            return Conflict("File đã bị thay đổi ở nơi khác kể từ lúc bạn mở.");
        }

        // Ghi ra file tạm rồi thay thế, để không hỏng file nếu bị ngắt giữa chừng.
        var temp = $"{full}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllTextAsync(temp, content, Utf8NoBom);
        File.Move(temp, full, overwrite: true);
        git.NotifyChanged("Sửa " + paths.ToRelative(full));

        file.Refresh();
        return Results.Ok(new { version = Version(file) });
    }

    private static IResult Move(MoveRequest request, SafePathResolver paths, GitSyncService git)
    {
        var from = paths.Resolve(request.From);
        var to = paths.Resolve(request.To);
        if (paths.IsRoot(from) || paths.IsRoot(to))
        {
            return BadRequest("Không thể di chuyển thư mục gốc.");
        }

        var isFile = File.Exists(from);
        if (!isFile && !Directory.Exists(from))
        {
            return NotFound("Không tìm thấy.");
        }
        if (isFile && (!IsAllowed(from) || !IsAllowed(to)))
        {
            return BadRequest("Đuôi file không được hỗ trợ (.md, .markdown, .txt hoặc ảnh).");
        }
        if (string.Equals(from, to, StringComparison.Ordinal))
        {
            return Results.Ok(new { path = paths.ToRelative(to) });
        }
        if (!isFile && to.StartsWith(from + Path.DirectorySeparatorChar, SafePathResolver.Comparison))
        {
            return BadRequest("Không thể chuyển thư mục vào bên trong chính nó.");
        }

        // Windows không phân biệt hoa thường: đổi "a.md" -> "A.md" là cùng một file.
        var caseOnlyRename = OperatingSystem.IsWindows() && string.Equals(from, to, StringComparison.OrdinalIgnoreCase);
        if (!caseOnlyRename && (File.Exists(to) || Directory.Exists(to)))
        {
            return Conflict($"Đã có \"{Path.GetFileName(to)}\" ở thư mục đích.");
        }
        if (!Directory.Exists(Path.GetDirectoryName(to)))
        {
            return NotFound("Thư mục đích không tồn tại.");
        }

        void MoveEntry(string source, string target)
        {
            if (isFile) File.Move(source, target);
            else Directory.Move(source, target);
        }

        if (caseOnlyRename)
        {
            var temp = $"{from}.{Guid.NewGuid():N}.mv";
            MoveEntry(from, temp);
            MoveEntry(temp, to);
        }
        else
        {
            MoveEntry(from, to);
        }
        git.NotifyChanged($"Di chuyển {paths.ToRelative(from)} → {paths.ToRelative(to)}");
        return Results.Ok(new { path = paths.ToRelative(to) });
    }

    private static IResult Delete(string? path, SafePathResolver paths, TrashService trash, GitSyncService git)
    {
        var full = paths.Resolve(path);
        if (paths.IsRoot(full))
        {
            return BadRequest("Không thể xóa thư mục gốc.");
        }
        if (File.Exists(full) ? !IsAllowed(full) : !Directory.Exists(full))
        {
            return NotFound("Không tìm thấy.");
        }

        var entry = trash.MoveToTrash(full);
        git.NotifyChanged("Xóa " + entry.OriginalPath);
        return Results.Ok(new { trashId = entry.Id });
    }

    private static IResult RestoreTrash(IdRequest request, TrashService trash, GitSyncService git)
    {
        var restored = trash.Restore(request.Id ?? "");
        if (restored is not null) git.NotifyChanged("Khôi phục " + restored);
        return restored is null ? NotFound("Không tìm thấy trong thùng rác.") : Results.Ok(new { path = restored });
    }

    private static IResult NotFound(string message) => Results.NotFound(new { message });
    private static IResult BadRequest(string message) => Results.BadRequest(new { message });
    private static IResult Conflict(string message) => Results.Conflict(new { message });
}
