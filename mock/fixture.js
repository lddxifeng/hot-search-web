"use strict";
/* mock fixture（本地自验专用，不进真实链路）：
 * file:// 双击 index.html 或 ?mock=1 时，app.js 全走这里的假数据——
 * 不打任何真实请求（连 Worker 也不打）。链接全是 example.com 死链或本地 mock 页，只验渲染与流程。
 * 形状镜像 Worker v4 回包（去真赞化）：/api/state 一次返回当日全部计划条目
 * （61 条：编号 1~61 连续 + 标题/作者/时长/窗口播放/分享链接；无赞、无花费、无揭示概念）。
 */

function _mkItem(num) {
  const vid = `mock-v${String(num).padStart(3, "0")}`;
  return {
    num,
    vid,                                                  // 即 aweme_id（拼原帖地址用）
    title: `示例热视频 · 第 ${num} 条`,
    author: `示例作者${((num - 1) % 5) + 1}`,
    duration_ms: (40 + ((num * 37) % 140)) * 1000,
    play: 2000000 - num * 20000,                          // 窗口播放（近期口径）
    share_url: `https://example.com/v/${vid}`,
    is_photo: num === 8,                      // 1 条图文样本（验 🖼图文 渲染语义保留）
  };
}

const MOCK_STATE = {
  date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10),
  total_items: 61, total_minutes: 91.5,
  items: Array.from({ length: 61 }, (_, i) => _mkItem(i + 1)),
};
