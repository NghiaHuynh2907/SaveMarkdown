namespace SaveMarkdown.Auth;

public sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>Mật khẩu đăng nhập, sửa trực tiếp trong appsettings.json.</summary>
    public string Password { get; set; } = "";
}
