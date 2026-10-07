"use strict";
/* mock fixture（本地自验专用，不进真实链路）：
 * file:// 双击 index.html 或 ?mock=1 时，app.js 全走这里的假数据——
 * 不打任何真实请求（连 Worker 也不打）。链接全是 example.com 死链或本地 mock 页，只验渲染与流程。
 * 形状镜像 Worker v4 版次制回包：/api/state 按 editions 分区——
 * 第 1 推 08:30（12 条）+ 第 2 推 15:20（10 条），各版编号各自 #1 起；
 * ?mocktopup=1 → 补后场景（第 2 推尾部续挂 10 条，#11~#20）。
 * 字段全是池内免费数据（best_*=峰值口径；含 pub_ts/fans；无真赞/评/转/藏）。
 */

const _DAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

function _mkItem(edNo, num) {
  const vid = `e${edNo}v${String(num).padStart(2, "0")}`;
  return {
    num,                                                // 版内编号（各版 #1 起）
    vid,                                                // 即 aweme_id（拼原帖地址用；接力指针锚定它）
    title: `示例热视频 · 第${edNo}推 第 ${num} 条`,
    author: `示例作者${((num - 1) % 5) + 1}`,
    duration_ms: (40 + ((num * 37) % 140)) * 1000,
    pub_ts: num % 13 === 0 ? 0 : 1791279743 - num * 86400,   // 发布时刻（每 13 条 1 条为 0，验隐藏）
    fans: num % 6 === 0 ? 0 : 888000 - num * 1000,           // 作者粉丝数（每 6 条 1 条为 0，验隐藏）
    best_digg: num % 7 === 0 ? 0 : 50000 - num * 500,       // 窗口赞·峰值（每 7 条 1 条为 0）
    score: 90000 - num * 800,                             // 热度
    play: num % 5 === 0 ? 0 : 2000000 - num * 20000,      // 窗口播放·峰值（每 5 条 1 条为 0）
    ratio: num % 11 === 0 ? 0 : (2 + (num % 5)) / 100,    // 赞播比·峰值（透传 best_ratio；每 11 条 1 条为 0）
    share_url: `https://example.com/v/${vid}`,
    is_photo: edNo === 1 && num === 8,                    // 1 条图文样本（验 🖼图文 渲染语义保留）
  };
}

const MOCK_STATE = {
  ok: true, live: true, date: _DAY, today: _DAY,
  editions: [
    { edition_no: 1, pushed_at: `${_DAY}T08:30:00+08:00`,
      items: Array.from({ length: 12 }, (_, i) => _mkItem(1, i + 1)) },
    { edition_no: 2, pushed_at: `${_DAY}T15:20:00+08:00`,
      items: Array.from({ length: 10 }, (_, i) => _mkItem(2, i + 1)) },
  ],
};

// 补后场景：第 2 推尾部续挂 10 条（#11~#20，模拟群里「补」挂末版尾部）
const MOCK_STATE_TOPUP = Object.assign({}, MOCK_STATE, {
  editions: [
    MOCK_STATE.editions[0],
    Object.assign({}, MOCK_STATE.editions[1], {
      items: MOCK_STATE.editions[1].items.concat(
        Array.from({ length: 10 }, (_, i) => _mkItem(2, i + 11))),
    }),
  ],
});

// 回落场景（指令块 E）：只剩第 2 推（?mocksolo=1）——选了不存在的版 → 自动回落「全部」
const MOCK_STATE_SOLO = Object.assign({}, MOCK_STATE, {
  editions: [MOCK_STATE.editions[1]],
});
