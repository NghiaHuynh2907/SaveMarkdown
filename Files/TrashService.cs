using System.Text.Json;
using System.Text.RegularExpressions;

namespace SaveMarkdown.Files;

public sealed record TrashEntry(string Id, string Name, string OriginalPath, string Type, DateTimeOffset DeletedAt);

/// <summary>
/// Thùng rác: mục bị xóa được chuyển vào thư mục ẩn <c>.trash</c> trong thư mục gốc, kèm file mô tả .json.
/// Có thể khôi phục về chỗ cũ; tự dọn mục quá <see cref="Retention"/>.
/// </summary>
public sealed partial class TrashService(SafePathResolver paths, ILogger<TrashService> logger)
{
    public const string FolderName = ".trash";
    public static readonly TimeSpan Retention = TimeSpan.FromDays(30);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Lock _sync = new();

    [GeneratedRegex("^[0-9]{17}-[0-9a-f]{8}$")]
    private static partial Regex IdPattern();

    private string TrashRoot => Path.Combine(paths.Root, FolderName);
    private string ItemDir(string id) => Path.Combine(TrashRoot, id);
    private string MetaPath(string id) => Path.Combine(TrashRoot, id + ".json");

    public TrashEntry MoveToTrash(string fullPath)
    {
        lock (_sync)
        {
            var isDir = Directory.Exists(fullPath);
            var id = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid().ToString("N")[..8]}";
            var name = Path.GetFileName(fullPath);
            var entry = new TrashEntry(id, name, paths.ToRelative(fullPath), isDir ? "dir" : "file", DateTimeOffset.UtcNow);

            Directory.CreateDirectory(ItemDir(id));
            var target = Path.Combine(ItemDir(id), name);
            if (isDir) Directory.Move(fullPath, target);
            else File.Move(fullPath, target);

            File.WriteAllText(MetaPath(id), JsonSerializer.Serialize(entry, JsonOptions));
            return entry;
        }
    }

    public IReadOnlyList<TrashEntry> List()
    {
        lock (_sync)
        {
            if (!Directory.Exists(TrashRoot)) return [];

            var entries = new List<TrashEntry>();
            foreach (var meta in Directory.EnumerateFiles(TrashRoot, "*.json"))
            {
                var entry = ReadMeta(meta);
                if (entry is null) continue;
                if (DateTimeOffset.UtcNow - entry.DeletedAt > Retention)
                {
                    DeleteUnlocked(entry.Id);
                    continue;
                }
                entries.Add(entry);
            }
            return [.. entries.OrderByDescending(e => e.DeletedAt)];
        }
    }

    /// <summary>Khôi phục về chỗ cũ (đổi tên nếu đã có mục trùng). Trả path tương đối mới, hoặc null nếu không có.</summary>
    public string? Restore(string id)
    {
        lock (_sync)
        {
            if (!IdPattern().IsMatch(id) || ReadMeta(MetaPath(id)) is not { } entry) return null;

            var source = Path.Combine(ItemDir(id), entry.Name);
            var isDir = entry.Type == "dir";
            if (isDir ? !Directory.Exists(source) : !File.Exists(source)) return null;

            var target = paths.Resolve(entry.OriginalPath);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            target = FreePath(target);

            if (isDir) Directory.Move(source, target);
            else File.Move(source, target);

            DeleteUnlocked(id);
            return paths.ToRelative(target);
        }
    }

    public bool Delete(string id)
    {
        lock (_sync)
        {
            if (!IdPattern().IsMatch(id) || !File.Exists(MetaPath(id))) return false;
            DeleteUnlocked(id);
            return true;
        }
    }

    public void Empty()
    {
        lock (_sync)
        {
            if (!Directory.Exists(TrashRoot)) return;
            foreach (var meta in Directory.EnumerateFiles(TrashRoot, "*.json").ToList())
            {
                DeleteUnlocked(Path.GetFileNameWithoutExtension(meta));
            }
        }
    }

    private void DeleteUnlocked(string id)
    {
        try
        {
            if (Directory.Exists(ItemDir(id))) Directory.Delete(ItemDir(id), recursive: true);
            File.Delete(MetaPath(id));
        }
        catch (IOException ex)
        {
            logger.LogWarning(ex, "Không xóa được mục {Id} trong thùng rác", id);
        }
    }

    private static TrashEntry? ReadMeta(string metaPath)
    {
        try
        {
            return File.Exists(metaPath) ? JsonSerializer.Deserialize<TrashEntry>(File.ReadAllText(metaPath), JsonOptions) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string FreePath(string path)
    {
        if (!File.Exists(path) && !Directory.Exists(path)) return path;

        var dir = Path.GetDirectoryName(path)!;
        var isFile = File.Exists(path);
        var stem = isFile ? Path.GetFileNameWithoutExtension(path) : Path.GetFileName(path);
        var ext = isFile ? Path.GetExtension(path) : "";
        for (var i = 1; ; i++)
        {
            var candidate = Path.Combine(dir, $"{stem} ({i}){ext}");
            if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;
        }
    }
}
