"use strict";
/* mock fixture（本地自验专用，不进真实链路）：
 * file:// 双击 index.html 或 ?mock=1 时，app.js 全走这里的假数据——
 * 不打任何真实请求（连 Worker 也不打）。链接全是 example.com 死链或本地 mock 页，只验渲染与流程。
 * 形状镜像 Worker v4.1 回包：/api/state 一次返回当日全部条目（编号连续 + 标题/作者/时长/
 * 窗口赞/热度/窗口播放/赞播比/分享链接——全是池内免费数据；无真赞/评/转/藏/花费概念）。
 * 补后接力场景：?mocktopup=1 → 计划 61 条 + 补批 10 条 = 71 条（编号 #62~#71 接续）。
 */

function _mkItem(num) {
  const vid = `mock-v${String(num).padStart(3, "0")}`;
  return {
    num,
    vid,                                                  // 即 aweme_id（拼原帖地址用）
    title: `示例热视频 · 第 ${num} 条`,
    author: `示例作者${((num - 1) % 5) + 1}`,
    duration_ms: (40 + ((num * 37) % 140)) * 1000,
    digg: num % 7 === 0 ? 0 : 50000 - num * 500,          // 窗口赞（每 7 条 1 条为 0，验「非零才显示」）
    score: 90000 - num * 800,                             // 热度（榜分）
    play: num % 5 === 0 ? 0 : 2000000 - num * 20000,      // 窗口播放（每 5 条 1 条为 0，验非零才显示）
    ratio: num % 11 === 0 ? 0 : (2 + (num % 5)) / 100,    // 赞播比（每 11 条 1 条为 0）
    share_url: `https://example.com/v/${vid}`,
    is_photo: num === 8,                      // 1 条图文样本（验 🖼图文 渲染语义保留）
  };
}

const MOCK_STATE = {
  date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10),
  total_items: 61, total_minutes: 91.5,
  items: Array.from({ length: 61 }, (_, i) => _mkItem(i + 1)),
};

// 补后场景：正推 61 条 + 「补」一批 10 条（编号 #62~#71 接续；total_items 仍=正推 61）
const MOCK_STATE_TOPUP = Object.assign({}, MOCK_STATE, {
  items: MOCK_STATE.items.concat(
    Array.from({ length: 10 }, (_, i) => _mkItem(i + 62))),
});
