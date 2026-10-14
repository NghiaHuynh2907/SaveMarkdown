using Microsoft.Extensions.Options;

namespace SaveMarkdown.Files;

public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary>Thư mục gốc chứa file. Đường dẫn tương đối tính từ ContentRoot.</summary>
    public string RootPath { get; set; } = "data";
}

public sealed class InvalidPathException(string message) : Exception(message);

/// <summary>
/// Chuyển path tương đối do client gửi lên thành path tuyệt đối, đảm bảo luôn nằm trong thư mục gốc.
/// Chặn "..", path tuyệt đối, ký tự không hợp lệ, tên thiết bị Windows và symlink/junction.
/// </summary>
public sealed class SafePathResolver
{
    private static readonly StringComparison PathComparison =
        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    /// <summary>So sánh path theo hệ điều hành (Windows không phân biệt hoa thường).</summary>
    public static StringComparison Comparison => PathComparison;

    private static readonly HashSet<string> WindowsReservedNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    private static readonly char[] InvalidNameChars =
        [.. Path.GetInvalidFileNameChars().Union([':', '*', '?', '"', '<', '>', '|'])];

    private readonly string _root;        // không có dấu phân cách ở cuối
    private readonly string _rootPrefix;  // có dấu phân cách ở cuối

    public SafePathResolver(IOptions<StorageOptions> options, IWebHostEnvironment env)
    {
        var configured = options.Value.RootPath;
        if (string.IsNullOrWhiteSpace(configured))
        {
            throw new InvalidOperationException("Storage:RootPath chưa được cấu hình.");
        }

        var full = Path.GetFullPath(Path.IsPathRooted(configured)
            ? configured
            : Path.Combine(env.ContentRootPath, configured));
        Directory.CreateDirectory(full);

        _root = Path.TrimEndingDirectorySeparator(full);
        _rootPrefix = _root + Path.DirectorySeparatorChar;
    }

    public string Root => _root;

    /// <summary>Resolve path tương đối ("" hoặc "/" là thư mục gốc).</summary>
    public string Resolve(string? relativePath)
    {
        relativePath ??= "";
        if (relativePath.Contains('\0')) throw new InvalidPathException("Đường dẫn không hợp lệ.");

        var segments = relativePath.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        foreach (var segment in segments)
        {
            ValidateName(segment);
        }

        var full = Path.GetFullPath(Path.Combine([_root, .. segments]));
        if (!IsInsideRoot(full))
        {
            throw new InvalidPathException("Đường dẫn nằm ngoài thư mục gốc.");
        }

        EnsureNoLinks(full);
        return full;
    }

    /// <summary>Kiểm tra một tên file/thư mục đơn lẻ (không chứa dấu phân cách).</summary>
    public static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name is "." or ".." ||
            name.Equals(TrashService.FolderName, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidPathException("Đường dẫn không hợp lệ.");
        }
        if (name.IndexOfAny(InvalidNameChars) >= 0 || name.Contains('/') || name.Contains('\\'))
        {
            throw new InvalidPathException($"Tên \"{name}\" chứa ký tự không hợp lệ.");
        }
        if (name.EndsWith('.') || name.EndsWith(' '))
        {
            throw new InvalidPathException($"Tên \"{name}\" không được kết thúc bằng dấu chấm hoặc khoảng trắng.");
        }
        var stem = name.Split('.')[0].TrimEnd();
        if (WindowsReservedNames.Contains(stem))
        {
            throw new InvalidPathException($"Tên \"{name}\" là tên hệ thống, không được dùng.");
        }
    }

    public bool IsRoot(string fullPath) =>
        string.Equals(Path.TrimEndingDirectorySeparator(fullPath), _root, PathComparison);

    public string ToRelative(string fullPath)
    {
        var rel = Path.GetRelativePath(_root, fullPath);
        return rel == "." ? "" : rel.Replace('\\', '/');
    }

    private bool IsInsideRoot(string fullPath) =>
        IsRoot(fullPath) || fullPath.StartsWith(_rootPrefix, PathComparison);

    private void EnsureNoLinks(string fullPath)
    {
        var current = fullPath;
        while (!IsRoot(current))
        {
            FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (info.Exists && info.LinkTarget is not null)
            {
                throw new InvalidPathException("Không hỗ trợ symlink/junction.");
            }
            current = Path.GetDirectoryName(current)!;
        }
    }
}
