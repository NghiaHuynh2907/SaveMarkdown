using System.IO.Compression;

namespace SaveMarkdown.Files;

public static class ZipHelper
{
    /// <summary>Nén thư mục (bỏ qua mục ẩn, symlink và các thư mục trong <paramref name="exclude"/>).</summary>
    public static void CreateFromDirectory(string sourceDir, string destinationFile, IReadOnlyCollection<string>? exclude = null)
    {
        using var output = File.Create(destinationFile);
        using var zip = new ZipArchive(output, ZipArchiveMode.Create);
        AddDirectory(zip, new DirectoryInfo(sourceDir), "", exclude ?? []);
    }

    private static void AddDirectory(ZipArchive zip, DirectoryInfo dir, string prefix, IReadOnlyCollection<string> exclude)
    {
        var hasEntries = false;
        foreach (var sub in dir.EnumerateDirectories().Where(FileEndpoints.IsVisible))
        {
            if (exclude.Any(e => string.Equals(Path.TrimEndingDirectorySeparator(e), sub.FullName, SafePathResolver.Comparison)))
            {
                continue;
            }
            hasEntries = true;
            AddDirectory(zip, sub, $"{prefix}{sub.Name}/", exclude);
        }
        foreach (var file in dir.EnumerateFiles().Where(FileEndpoints.IsVisible))
        {
            hasEntries = true;
            try
            {
                zip.CreateEntryFromFile(file.FullName, prefix + file.Name, CompressionLevel.Optimal);
            }
            catch (IOException)
            {
                // File đang bị khóa: bỏ qua, không làm hỏng cả bản nén.
            }
        }
        if (!hasEntries && prefix.Length > 0)
        {
            zip.CreateEntry(prefix); // giữ thư mục rỗng
        }
    }
}
