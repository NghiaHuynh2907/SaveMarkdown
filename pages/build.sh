#!/usr/bin/env bash
# Dựng bản web tĩnh (GitHub Pages) vào thư mục $1 (mặc định _site):
# dùng chung app.js / styles.css / icons với bản ASP.NET, thay server bằng github-backend.js.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-_site}"
version="$(git -C "$root" rev-parse --short HEAD 2>/dev/null || date +%s)"

rm -rf "$out"
mkdir -p "$out"
cp "$root"/pages/{config.js,github-backend.js,login.js} "$out/"
cp "$root"/wwwroot/{app.js,styles.css} "$out/"
cp -r "$root/wwwroot/icons" "$out/icons"
touch "$out/.nojekyll"

# Thêm ?v=<commit> để trình duyệt không dùng bản cũ trong cache sau mỗi lần deploy.
sed -e "s#\"/styles.css\"#\"styles.css?v=$version\"#" \
    -e 's#"/icons/#"icons/#g' \
    -e '/rel="manifest"/d' \
    -e "s#<script src=\"/app.js\" defer></script>#<script src=\"config.js?v=$version\" defer></script>\n  <script src=\"github-backend.js?v=$version\" defer></script>\n  <script src=\"app.js?v=$version\" defer></script>#" \
    "$root/AppPages/app.html" > "$out/index.html"

sed -e "s#href=\"styles.css\"#href=\"styles.css?v=$version\"#" \
    -e "s#src=\"\([a-z-]*\.js\)\"#src=\"\1?v=$version\"#g" \
    "$root/pages/login.html" > "$out/login.html"

# Bản tĩnh không được còn đường dẫn tuyệt đối tới server.
if grep -nE '(src|href)="/' "$out/index.html" "$out/login.html"; then
  echo "Còn đường dẫn tuyệt đối ở trên" >&2
  exit 1
fi
echo "Đã dựng bản web vào $out"
