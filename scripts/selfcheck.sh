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

# 6) v4.1 去真赞化：网页零 /api/batch 调用、无揭示/解锁/花费 UI 概念、无真赞字段
grep -n '"/api/batch"' app.js && hit "仍有 /api/batch 调用" || true
grep -nE '揭示|解锁|花费|日现取' index.html && hit "index.html 有揭示/花费概念" || true
grep -nE '揭示下一批|解锁中|日现取花费|spend' app.js | grep -vE ':\s*(//|\*)' && hit "app.js 渲染串有揭示/花费概念" || true
grep -n 'MOCK_BATCHES' mock/fixture.js && hit "fixture 仍有批次揭示遗产" || true
grep -n 'digg_total' app.js index.html mock/fixture.js && hit "出现真赞字段（digg_total）" || true
grep -n 'comment\|收藏' app.js index.html | grep -vE ':\s*(//|\*)' && hit "出现评论/收藏展示" || true

# 7) v4.2 结构断言：编号可点续刷 / 继续=下一条 / 倒计时 1s / 发布时间 / 峰值标签统一
grep -q 'data-relay' app.js || hit "编号可点（data-relay）缺失"
grep -q 'jumpTo(R.cur > 0 ? R.cur + 1 : 1, true)' app.js || hit "继续=下一条 未落位"
grep -q ': 1000' app.js || hit "倒计时 1000ms 未落位"
grep -q 'fmtPub' app.js || hit "发布时间 fmtPub 缺失"
grep -q 'hs_countdown_ms' app.js || hit "倒计时三档开关（hs_countdown_ms）缺失"
grep -q 'cd-15' index.html || hit "倒计时 1.5s 档位缺失"
grep -q 'pub_ts' mock/fixture.js || hit "fixture 缺 pub_ts"
grep -q '🔥${fmtWan(v.score)}<span class="tag">峰值</span>' app.js || hit "🔥热度缺「·峰值」标签"
grep -q '赞播比·峰值' app.js || hit "赞播比·峰值 缺失"
grep -q '窗口赞\|👍.*峰值' app.js || hit "窗口赞·峰值 缺失"

# 8) v3.1 起硬约束：禁 iframe 抖音、禁抓视频流地址、原帖双候选与接力标记在位
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
