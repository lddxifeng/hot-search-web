"use strict";
/* mock fixture（本地自验专用，不进真实链路）：
 * file:// 双击 index.html 或 ?mock=1 时，app.js 全走这里的假数据——
 * 不打任何真实请求（连 Worker 也不打）。链接全是指向 example.com 的死链，只验渲染与流程。
 * 形状镜像 Worker 回包：/api/state 一份 + /api/batch 三批（[10,10,3]，编号 1~23 连续，
 * 批内真赞降序；第 4 批不存在 → app.js 走超界结束页）。
 */

const MOCK_STATE = {
  date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10),
  total_items: 23, total_minutes: 34.5, batch_sizes: [10, 10, 3],
};

function _mkItem(num, batchIdx, i) {
  const vid = `mock-b${batchIdx}-i${String(i).padStart(2, "0")}`;
  return {
    num,
    vid,
    title: `示例热视频 · 第 ${num} 条（批次${batchIdx}）`,
    author: `示例作者${((num - 1) % 5) + 1}`,
    digg: 900000 - num * 30000 - i * 1000,   // 批内降序
    duration_ms: (40 + ((num * 37) % 140)) * 1000,
    share_url: `https://example.com/v/${vid}`,
    play_url: num % 4 === 0 ? "" : `https://example.com/play/${vid}.mp4`,  // 每 4 条 1 条无直链（验兜底）
    cover: "",
    is_photo: num === 8,                      // 1 条图文样本（验 🖼图文 渲染：无播放键、只走原帖）
  };
}

const MOCK_BATCHES = {
  "1": { cost: 0.010, items: Array.from({ length: 10 }, (_, i) => _mkItem(i + 1, 1, i)) },
  "2": { cost: 0.010, items: Array.from({ length: 10 }, (_, i) => _mkItem(i + 11, 2, i)) },
  "3": { cost: 0.003, items: Array.from({ length: 3 }, (_, i) => _mkItem(i + 21, 3, i)) },
};
