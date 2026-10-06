"use strict";
/* mock fixture（本地自验专用，不进真实链路）：
 * file:// 双击 index.html 或 ?mock=1 时，app.js 全走这里的假数据——
 * 不打任何真实请求（连 Worker 也不打）。链接全是 example.com 死链或本地 mock 页，只验渲染与流程。
 * 形状镜像 Worker 回包：/api/state 一份 + /api/batch 七批（61 条 = [10×6,1]，
 * 编号 1~61 连续、批内真赞降序；初始已揭示 4 批 40 条，第 5 批起按需揭示 $0.010/批）。
 */

const MOCK_STATE = {
  date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10),
  total_items: 61, total_minutes: 91.5, batch_sizes: [10, 10, 10, 10, 10, 10, 1],
};

function _mkItem(num) {
  const b = Math.ceil(num / 10);
  const i = (num - 1) % 10;
  const vid = `mock-b${b}-i${String(i).padStart(2, "0")}`;
  return {
    num,
    vid,                                                  // 即 aweme_id（拼原帖地址用）
    title: `示例热视频 · 第 ${num} 条（批次${b}）`,
    author: `示例作者${((num - 1) % 5) + 1}`,
    digg: 900000 - num * 9000,                            // 全局降序 → 批内自然降序
    duration_ms: (40 + ((num * 37) % 140)) * 1000,
    share_url: `https://example.com/v/${vid}`,
    play_url: num % 4 === 0 ? "" : `https://example.com/play/${vid}.mp4`,  // 每 4 条 1 条无直链（验兜底）
    cover: "",
    is_photo: num === 8,                      // 1 条图文样本（验 🖼图文 渲染：徽标+无播放键+只走原帖）
  };
}

const MOCK_BATCHES = {};
{
  const sizes = MOCK_STATE.batch_sizes;
  let n = 0;
  sizes.forEach((sz, bi) => {
    const items = Array.from({ length: sz }, () => _mkItem(++n));
    MOCK_BATCHES[String(bi + 1)] = { cost: sz === 10 ? 0.010 : 0.001 * sz, items };
  });
}

// mock 初始游标：已揭示 4 批（40 条）、已花 $0.040（app.js mockDb 以它为底，揭示继续记账）
const MOCK_INIT_REVEALED = [1, 2, 3, 4];
const MOCK_INIT_SPEND = 0.040;
