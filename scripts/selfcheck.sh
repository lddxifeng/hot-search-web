#!/usr/bin/env bash
# 全仓库密钥扫描（连刷网页 v2 拍板 e'：暗号/密钥值永不落盘）+ 结构断言。
# 运行：bash scripts/selfcheck.sh（任何命中即退出码 1）
set -euo pipefail
cd "$(dirname "$0")/.."
fails=0
hit() { echo "HIT  $1"; fails=1; }

# 1) 禁止 Bearer 后接引号字面量（密钥值最常见的落盘形态）
grep -rnE 'Bearer[[:space:]]+["'"'"'][A-Za-z0-9._~-]{8,}' \
  --include="*.js" --include="*.html" --include="*.css" . && hit "Bearer 字面量" || true

# 2) 禁止 32 位以上密钥形字符串（hex/base64url 形；变量名/单词列表不在此形）
grep -rnE '["'"'"'][A-Za-z0-9_-]{32,}["'"'"']' \
  --include="*.js" --include="*.html" . && hit "密钥形长字符串" || true

# 3) 暗号只许来自 localStorage 读取，禁止任何赋值字面量
grep -rnE 'hotsearch_token"?\s*[:=][[:space:]]*"[^"]+"' --include="*.js" . \
  && hit "暗号硬编码赋值" || true

# 4) X-Hotsearch-Token 只许作为请求头名出现（代码行内恰好 1 处；注释行不计）
n=$(grep -rn "X-Hotsearch-Token" --include="*.js" . | grep -vE '^\s*[^:]+:[0-9]+:\s*(//|\*)' | wc -l)
[ "$n" -eq 1 ] || hit "X-Hotsearch-Token 代码行出现 $n 处（期望 1 处=请求头）"

# 5) 结构断言：暗号走 localStorage + mock 走 fixture + Worker 地址为单一常量
grep -q 'localStorage.getItem(TOKEN_KEY)' app.js || hit "缺少 localStorage 暗号读取"
grep -q 'const WORKER_BASE' app.js || hit "WORKER_BASE 常量缺失"
grep -q 'example.com' mock/fixture.js || hit "fixture 必须用 example.com 死链"

# 6) v3.1 硬约束：禁 iframe 抖音、禁抓视频流地址、原帖双候选与接力标记在位
grep -rniE '<iframe|iframe ' --include="*.html" --include="*.js" . \
  | grep -vE '不 iframe|frame-ancestors' && hit "出现 iframe" || true
grep -q 'iesdouyin.com/share/video/' app.js || hit "缺 iesdouyin 原帖模板"
grep -q 'douyin.com/video/' app.js || hit "缺 douyin 原帖模板"
grep -q 'hs_relay_pending' app.js || hit "缺接力返回标记（hs_relay_pending）"
grep -q 'pageshow' app.js || hit "缺 pageshow 返回检测"
grep -q 'mock/post.html' app.js || hit "mock 原帖页未接线"
[ -f mock/post.html ] || hit "mock/post.html 缺失"

if [ "$fails" -ne 0 ]; then
  echo "密钥扫描未通过"
  exit 1
fi
echo "密钥扫描全绿：仓库无任何密钥值（暗号永不落盘，拍板 e'）"
