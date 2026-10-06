"use strict";
/* 热搜连刷（连刷网页 v2，2026-10-06 拍板）
 *
 * 数据通道：本页 → Cloudflare Worker 公开代理 → TikHub。本页纯静态零密钥：
 * 暗号不硬编码（拍板 e'）：首次打开弹输入框手动粘贴，存 localStorage 永久记住，
 * 之后每次请求带 X-Hotsearch-Token 头；清浏览器数据/换浏览器/换设备才需重输。
 * 只放链接与文本；没有补按钮、没有任何写操作。
 *
 * 流程：启动 GET /api/state 渲染当日计划 → 从游标批续刷 → 刷到第 7 条自动
 * POST /api/batch 预取下一批（防卡死备胎=手动「下一批」按钮）→ 批内按 Worker
 * 回包顺序渲染（已是现取真赞降序）→ 超界显示结束页。
 */

// === 配置项（全页唯一）：Worker 地址。地址公开属正常——页面与源码本就公开，
//     真正的闸门是暗号 + 日 $0.30 熔断 + 每批 ≤10 + 402 熔断（Worker 侧四条保险） ===
const WORKER_BASE = "https://feishu-bot-worker.你的子域.workers.dev";  // TODO(机主)：部署前改成你的 Worker 地址（dashboard 可见）

const TOKEN_KEY = "hotsearch_token";   // localStorage 键名（存的是用户手输的暗号，不是仓库硬编码）

// mock 模式：file:// 直接双击打开 或 显式 ?mock=1 → 全走 mock/fixture.js 假数据，
// 不打任何真实请求（连 Worker 也不打）。Pages 线上 https 打开=真实 Worker。
const MOCK = new URLSearchParams(location.search).has("mock") || location.protocol === "file:";

let token = localStorage.getItem(TOKEN_KEY) || "";
let plan = null;          // /api/state 回包
let cur = 0;              // 当前批号（1 起）
let curItems = [];        // 当前批条目（Worker 回包序=现取真赞降序）
let prefetched = null;    // 已预取的下一批回包
let observer = null;

const $ = (id) => document.getElementById(id);

// ---------- mock 引擎（本地自验；镜像 Worker 行为：游标/花费/超界） ----------
const mockDb = { revealed: [], spend: 0.0 };
function mockApi(path, opts = {}) {
  if (path === "/api/state") {
    return Promise.resolve({
      ok: true, live: true, date: MOCK_STATE.date,
      total_items: MOCK_STATE.total_items, total_minutes: MOCK_STATE.total_minutes,
      batch_sizes: MOCK_STATE.batch_sizes, revealed: mockDb.revealed.slice(),
      next_batch: mockDb.revealed.length + 1, topup_done: 0,
      spend_usd: mockDb.spend,
    });
  }
  if (path === "/api/batch") {
    const n = Number(opts.batch);
    const b = MOCK_BATCHES[String(n)];
    if (!b) {
      return Promise.resolve({ ok: false, reason: "out_of_plan",
        text: "今日正推已完，继续请发「补」", batches: MOCK_STATE.batch_sizes.length });
    }
    if (!mockDb.revealed.includes(n)) {
      mockDb.revealed.push(n);
      mockDb.spend = Math.round((mockDb.spend + b.cost) * 1000) / 1000;
    }
    return Promise.resolve(Object.assign({ ok: true, cached: false, persisted: true,
      batch: n, batches: MOCK_STATE.batch_sizes.length,
      total_items: MOCK_STATE.total_items, spend_usd: mockDb.spend },
      structuredClone(b)));
  }
  return Promise.resolve({ ok: false, reason: "not_found" });
}

// ---------- 真实 API（带暗号头） ----------
async function api(path, opts = {}) {
  if (MOCK) return mockApi(path, opts);
  const r = await fetch(WORKER_BASE + path, {
    method: opts.method || "GET",
    headers: { "X-Hotsearch-Token": token, "Content-Type": "application/json" },
    body: opts.batch ? JSON.stringify({ batch: opts.batch }) : undefined,
  });
  const j = await r.json().catch(() => ({ ok: false, reason: "bad_json" }));
  if (r.status === 401 || j.reason === "bad_token") {
    // 暗号失效：清掉重输（不硬编码、不重试刷）
    localStorage.removeItem(TOKEN_KEY);
    token = "";
    showTokenModal("暗号不对或未配置，请重新输入。");
    throw new Error("bad_token");
  }
  return j;
}

// ---------- 暗号弹层 ----------
function showTokenModal(err) {
  $("token-error").textContent = err || "";
  $("token-error").classList.toggle("hidden", !err);
  $("token-modal").classList.remove("hidden");
  setTimeout(() => $("token-input").focus(), 50);
}
function hideTokenModal() { $("token-modal").classList.add("hidden"); }

// ---------- 渲染 ----------
function fmtWan(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  return String(n);
}
function fmtDur(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒` : `${s}秒`;
}

function renderHeader() {
  $("date").textContent = plan && plan.date ? `· ${plan.date}` : "";
  if (plan && plan.live) {
    $("overview").textContent =
      `当日计划 ${plan.total_items} 条 = ${plan.batch_sizes.length} 批 ` +
      `[${plan.batch_sizes.join(",")}]（总时长约 ${plan.total_minutes} 分钟）`;
    $("progress").textContent =
      `已揭示 ${plan.revealed.length}/${plan.batch_sizes.length} 批 · 日现取花费 $${Number(plan.spend_usd).toFixed(3)}`;
  } else {
    $("overview").textContent = "";
    $("progress").textContent = "";
  }
}

function notice(text) {
  $("notice").textContent = text || "";
  $("notice").classList.toggle("hidden", !text);
}

function renderItems(batchNo, items) {
  cur = batchNo;
  curItems = items;
  prefetched = null;
  $("batch-label").textContent = items.length
    ? `第 ${batchNo} 批 · #${items[0].num}–#${items[items.length - 1].num}（现取真赞降序）`
    : "";
  const ol = $("list");
  ol.innerHTML = "";
  for (const [i, v] of items.entries()) {
    const li = document.createElement("li");
    li.className = "card";
    li.dataset.idx = i;
    const badge = v.is_photo ? " <span class='tag'>🖼图文</span>" : "";
    const playBtn = (!v.is_photo && v.play_url)
      ? `<a class="btn primary" href="${v.play_url}" target="_blank" rel="noopener">▶ 播放</a>` : "";
    const shareBtn = v.share_url
      ? `<a class="btn" href="${v.share_url}" target="_blank" rel="noopener">原帖</a>` : "";
    li.innerHTML =
      `<div class="num">#${v.num}</div>` +
      `<div class="body">` +
      `<a class="title" href="${v.share_url || "#"}" target="_blank" rel="noopener">${escapeHtml(v.title) || "（无标题）"}</a>${badge}` +
      `<div class="dim meta">${escapeHtml(v.author) || "—"} · 👍${fmtWan(v.digg)} · ${fmtDur(v.duration_ms)}</div>` +
      `<div class="actions">${playBtn}${shareBtn}</div>` +
      `</div>`;
    ol.appendChild(li);
  }
  $("controls").classList.remove("hidden");
  $("end-page").classList.add("hidden");
  $("prefetch-hint").textContent = "";
  window.scrollTo({ top: 0 });
  armPrefetch();   // 刷到第 7 条自动预取下一批
}

function showEnd() {
  $("list").innerHTML = "";
  $("batch-label").textContent = "";
  $("controls").classList.add("hidden");
  $("end-page").classList.remove("hidden");
  $("end-recap").textContent = plan
    ? `今日 ${plan.batch_sizes.length} 批 ${plan.total_items} 条全部刷完 · 日现取花费 $${Number(plan.spend_usd).toFixed(3)}`
    : "";
}

// ---------- 预取（@7 自动 + 手动备胎） ----------
function armPrefetch() {
  if (observer) observer.disconnect();
  const triggerIdx = 6;   // 第 7 条（0 起 6）
  const doPrefetch = async () => {
    if (prefetched || !plan) return;
    const nxt = cur + 1;
    try {
      const j = await api("/api/batch", { method: "POST", batch: nxt });
      prefetched = j;
      $("prefetch-hint").textContent =
        j.ok ? `第 ${nxt} 批已备好` : (j.reason === "out_of_plan" ? "后面没有啦" : "");
    } catch (e) {
      $("prefetch-hint").textContent = "";   // 预取失败不吭声，手动按钮备胎兜底
    }
  };
  const lis = $("list").children;
  if (lis.length > triggerIdx) {
    observer = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { doPrefetch(); observer.disconnect(); }
    }, { rootMargin: "0px 0px -10% 0px" });
    observer.observe(lis[triggerIdx]);
  } else {
    doPrefetch();   // 末批不足 7 条：直接预取（多数情况是探出超界）
  }
}

async function nextBatch() {
  const btn = $("next-batch");
  btn.disabled = true;
  try {
    let j = prefetched;
    prefetched = null;
    if (!j) j = await api("/api/batch", { method: "POST", batch: cur + 1 });
    if (j.ok) {
      plan.revealed = plan.revealed.includes(j.batch) ? plan.revealed : plan.revealed.concat(j.batch);
      plan.spend_usd = j.spend_usd;
      renderHeader();
      renderItems(j.batch, j.items);
      return;
    }
    if (j.reason === "out_of_plan") { showEnd(); return; }
    if (j.reason === "daily_budget" || j.reason === "402" || j.reason === "state_read_failed"
        || j.reason === "no_plan") {
      notice(j.text || "暂时不可用，请稍后再试");
      return;
    }
    notice(j.text || "现取失败，请稍后再试（可再点一次「下一批」）");
  } catch (e) {
    if (String(e && e.message) !== "bad_token") notice("网络异常，请稍后再试");
  } finally {
    btn.disabled = false;
  }
}

// ---------- 启动 ----------
async function boot() {
  if (MOCK) $("mock-banner").classList.remove("hidden");
  if (!token) { showTokenModal(); return; }
  hideTokenModal();
  try {
    plan = await api("/api/state");
  } catch (e) {
    if (String(e && e.message) !== "bad_token") notice("网络异常，请刷新重试");
    return;
  }
  if (!plan.ok) { notice(plan.text || "状态读取失败，请稍后再试"); return; }
  if (!plan.live) { notice("今日还没有正推计划，请先在群里发「推」生成今日计划。"); return; }
  renderHeader();
  const start = plan.next_batch;   // 从游标批续刷（与网页/群推N/裸推共用游标）
  if (start > plan.batch_sizes.length) { showEnd(); renderHeader(); return; }
  await nextBatchFrom(start - 1);  // 借统一通道加载第 start 批
}

async function nextBatchFrom(prev) {
  cur = prev;
  await nextBatch();
}

// ---------- 事件 ----------
$("token-save").addEventListener("click", () => {
  const v = $("token-input").value.trim();
  if (!v) { $("token-error").textContent = "暗号不能为空"; $("token-error").classList.remove("hidden"); return; }
  token = v;
  localStorage.setItem(TOKEN_KEY, v);
  $("token-input").value = "";
  boot();
});
$("token-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("token-save").click();
});
$("change-token").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  token = "";
  showTokenModal();
});
$("next-batch").addEventListener("click", nextBatch);

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

boot();
