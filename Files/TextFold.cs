using System.Collections.Concurrent;
using System.Text;

namespace SaveMarkdown.Files;

/// <summary>
/// Chuẩn hóa chữ để tìm kiếm: chữ thường, bỏ dấu tiếng Việt (đ -> d).
/// Mỗi ký tự ánh xạ đúng 1 ký tự, nên vị trí tìm được trên chuỗi đã chuẩn hóa dùng lại được trên chuỗi gốc.
/// </summary>
public static class TextFold
{
    private static readonly ConcurrentDictionary<char, char> Cache = new();

    public static string Fold(string text)
    {
        var chars = new char[text.Length];
        for (var i = 0; i < text.Length; i++)
        {
            chars[i] = FoldChar(text[i]);
        }
        return new string(chars);
    }

    private static char FoldChar(char c)
    {
        if (c < 128) return char.ToLowerInvariant(c);
        return Cache.GetOrAdd(c, static ch =>
        {
            if (ch is 'đ' or 'Đ') return 'd';
            if (char.IsSurrogate(ch)) return ch;
            var decomposed = ch.ToString().Normalize(NormalizationForm.FormD);
            return char.ToLowerInvariant(decomposed[0]);
        });
    }
}
