"use strict";
/* 热搜连刷 · 原帖接力连刷（网页 v4「去真赞化」，2026-10-07 拍板）
 *
 * 定位：本站只做「目录 + 接力导航」，视频流走抖音原帖页（永久免费、永不 403、
 * 原帖级清晰度）。不做沉浸式播放器、不 iframe（抖音 frame-ancestors 实测封死）、
 * 不抓视频流地址（临时链实测几分钟即烂）、不做播完自动跳转、不下载视频本体。
 *
 * v4 去真赞化（机主 2026-10-07 拍板）：JIT 真赞揭示整体退役。网页不再调用
 * /api/batch，全站不出现「揭示/解锁/花费」概念；整日计划（编号 #1~N + 标题/作者/
 * 时长/窗口播放/分享链接）通过 /api/state 一次读取全量展示。条目不显示赞/评/转/藏，
 * 只带 ▶窗口播放（标注「近期」口径）。
 *
 * 接力机制（后悔药，与 v3.1 一字不动）：逻辑只靠 localStorage 标记驱动（bfcache
 * 与普通重载两条返回路径都走 pageshow → 同一段标记判断）——
 *   hs_relay    "on"/"off"   连刷开关
 *   hs_cur      当前序号（最后跳出/要续刷的编号；0=未开始）
 *   hs_pending  跳出去看的那条编号（返回目录=接力信号；处理即清，防 F5 重触发）
 *   hs_date     标记所属当日（跨天自动作废）
 *   hs_host     原帖域名偏好（iesdouyin / douyin；真机 A/B 后可换默认）
 * 连刷循环：跳出看 #N（pending=N）→ 浏览器返回（pageshow）→ relay=on 且 pending=N
 *   → 倒计时横条「即将播放 #N+1」2 秒（↺ 重看 #N / ⏸ 暂停）→ 到点无操作自动跳 #N+1；
 *   #N=计划末条 → 结束页「今日 N 条全部刷完」。
 *
 * 单看模式（relay=off）：点条目跳原帖，返回后不自动跳（不写任何接力标记）。
 * 连刷模式（relay=on）：点目录任意条目=从该条续刷（cur 改为该条）。
 *
 * 暗号（拍板 e'）：永不硬编码；首次弹框手粘，存 localStorage，请求带
 * X-Hotsearch-Token 头。网页无图文区为永久拍板决策（2026-10-06）：偶遇图文帖
 * 仍正确渲染（🖼徽标+只走原帖），板块不做。
 */

// === 配置项（全页唯一）：Worker 地址。地址公开属正常——页面与源码本就公开，
//     真正的闸门是暗号 + 日 $0.30 熔断 + 每批 ≤10 + 402 熔断（Worker 侧四条保险） ===
const WORKER_BASE = "https://bot.hotsearch-xifeng.top";   // hotsearch-feishu-bot 绑定的自定义域名

// 原帖地址候选（aweme_id 拼接；真机 A/B 拍默认=弹窗少者，另一个留设置切换）：
const POST_HOSTS = {
  iesdouyin: (vid) => `https://www.iesdouyin.com/share/video/${vid}/`,   // 暂定默认（待真机 A/B）
  douyin: (vid) => `https://www.douyin.com/video/${vid}`,
};

const TOKEN_KEY = "hotsearch_token";   // localStorage 键名（存的是用户手输的暗号，不是仓库硬编码）

// mock 模式：file:// 直接双击打开 或 显式 ?mock=1 → 全走 mock/fixture.js 假数据，
// 不打任何真实请求（连 Worker 也不打）。Pages 线上 https 打开=真实 Worker。
// mock 专属测试钩子：?setcur=N&relay=on 预设接力进度；?slow=1 倒计时放慢 15 秒；
// ?hold=1 倒计时横条只显示不到点（均仅 mock 生效，供自动化验收点按钮）。
const _q = new URLSearchParams(location.search);
const MOCK = _q.has("mock") || location.protocol === "file:";

const RELAY_COUNTDOWN_MS = (MOCK && _q.has("slow")) ? 15000 : 2000;   // 后悔药倒计时时长
const RELAY_HOLD = MOCK && _q.has("hold");   // mock 验收钩子：倒计时横条只显示不到点

let token = localStorage.getItem(TOKEN_KEY) || "";
let plan = null;                 // /api/state 回包（含 items 全量计划）
let items = [];                  // 当日全部计划条目（一次读取，无揭示概念）
let booted = false;
let lastRet = 0;                 // 本次返回刚看完的编号（倒计时横条的重看目标）
let countdownTimer = null;

const $ = (id) => document.getElementById(id);

// ---------- 接力标记（只读存储驱动） ----------
const R = {
  get on() { return localStorage.getItem("hs_relay") === "on"; },
  set on(v) { localStorage.setItem("hs_relay", v ? "on" : "off"); },
  get cur() { return Number(localStorage.getItem("hs_relay_cur") || 0); },
  set cur(v) { localStorage.setItem("hs_relay_cur", String(v)); },
  get pending() { return Number(localStorage.getItem("hs_relay_pending") || 0); },
  set pending(v) { localStorage.setItem("hs_relay_pending", String(v)); },
  get date() { return localStorage.getItem("hs_relay_date") || ""; },
  set date(v) { localStorage.setItem("hs_relay_date", v); },
  get host() { return localStorage.getItem("hs_post_host") || "iesdouyin"; },
  set host(v) { localStorage.setItem("hs_post_host", v); },
};

function postUrl(v) {
  if (MOCK) return `mock/post.html?n=${v.num}&vid=${encodeURIComponent(v.vid)}`;
  return (POST_HOSTS[R.host] || POST_HOSTS.iesdouyin)(v.vid);
}

// ---------- mock 引擎（v4：只认 /api/state；无 /api/batch 路由——调了就露馅） ----------
function mockApi(path) {
  if (path === "/api/state") {
    return Promise.resolve(Object.assign({ ok: true, live: true },
      structuredClone(MOCK_STATE)));
  }
  return Promise.resolve({ ok: false, reason: "not_found" });   // v4 没有第二个端点
}

// ---------- 真实 API（v4 只有 GET /api/state 一条路；带暗号头） ----------
async function api(path) {
  if (MOCK) return mockApi(path);
  const r = await fetch(WORKER_BASE + path, {
    headers: { "X-Hotsearch-Token": token },
  });
  const j = await r.json().catch(() => ({ ok: false, reason: "bad_json" }));
  if (r.status === 401 || j.reason === "bad_token") {
    localStorage.removeItem(TOKEN_KEY);   // 暗号失效：清掉重输（不硬编码、不重试刷）
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

// ---------- 工具 ----------
function fmtWan(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  return String(n);
}
function fmtDur(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒` : `${s}秒`;
}
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function syncTitle() {
  // document.title 实时同步「#N/61 · 热搜连刷」（N=当前序号；未开始只显站名）
  document.title = (plan && R.cur > 0)
    ? `#${R.cur}/${plan.total_items} · 热搜连刷`
    : "热搜连刷";
}
function findItem(num) {
  return items.find((v) => v.num === num) || null;
}

// ---------- 渲染 ----------
function renderHeader() {
  $("date").textContent = plan && plan.date ? `· ${plan.date}` : "";
  if (plan && plan.live) {
    $("overview").textContent =
      `当日计划 ${plan.total_items} 条（总时长约 ${plan.total_minutes} 分钟）· 今日全免费`;
    $("progress").textContent = `已刷到 #${R.cur}/${plan.total_items}`;
  } else {
    $("overview").textContent = "";
    $("progress").textContent = "";
  }
  $("host-ies").classList.toggle("on", R.host === "iesdouyin");
  $("host-dy").classList.toggle("on", R.host === "douyin");
  const done = plan && R.cur >= plan.total_items;
  $("relay-start").textContent = R.cur > 0 ? `▶ 继续 #${R.cur}` : "▶ 开始连刷";
  $("relay-start").classList.toggle("hidden", !!done);
  $("relay-stop").classList.toggle("hidden", !R.on);
  syncTitle();
}

function renderDirectory() {
  const root = $("directory");
  root.innerHTML = "";
  // 10 条一个视觉分区（第 1 区 #1–#10…）——纯视觉分区，无「揭示」概念
  for (let s = 0; s * 10 < items.length; s++) {
    const sec = document.createElement("section");
    sec.className = "group";
    const zone = items.slice(s * 10, s * 10 + 10);
    const h = document.createElement("div");
    h.className = "group-label";
    h.textContent = `第 ${s + 1} 区 · #${zone[0].num}–#${zone[zone.length - 1].num}`;
    sec.appendChild(h);
    const ol = document.createElement("ol");
    ol.className = "list";
    for (const v of zone) {
      const li = document.createElement("li");
      li.className = "card";
      li.id = `item-${v.num}`;
      li.dataset.num = v.num;
      const photo = v.is_photo ? " <span class='tag'>🖼图文</span>" : "";
      const watched = v.num === lastRet ? " <span class='tag hot'>刚看完</span>" : "";
      li.innerHTML =
        `<div class="num">#${v.num}</div>` +
        `<div class="body">` +
        `<span class="title">${escapeHtml(v.title) || "（无标题）"}</span>${photo}${watched}` +
        `<div class="dim meta">${escapeHtml(v.author) || "—"} · ${fmtDur(v.duration_ms)}` +
        ` · ▶${fmtWan(v.play)}<span class="tag">近期</span></div>` +
        `</div>`;
      li.addEventListener("click", () => {
        // 连刷模式点目录任意条目=从该条续刷；单看模式=纯跳转不写接力标记
        jumpTo(v.num, R.on);
      });
      ol.appendChild(li);
    }
    sec.appendChild(ol);
    root.appendChild(sec);
  }
}

function notice(text) {
  $("notice").textContent = text || "";
  $("notice").classList.toggle("hidden", !text);
}

function showEnd() {
  R.on = false;
  R.pending = 0;
  hideRelayBar();
  $("directory").innerHTML = "";
  $("end-page").classList.remove("hidden");
  $("end-recap").textContent = plan ? `今日 ${plan.total_items} 条全部刷完` : "";
  renderHeader();
}

// ---------- 接力核心 ----------
function jumpTo(num, relaying) {
  const v = findItem(num);
  if (!v) return;
  if (relaying) {
    R.on = true;
    R.cur = num;
    R.pending = num;
    R.date = plan ? plan.date : R.date;
  }
  syncTitle();
  location.href = postUrl(v);   // 同标签跳原帖（不 iframe、不抓流）
}

function hideRelayBar() {
  $("relay-bar").classList.add("hidden");
  $("relay-fill").style.transition = "none";
  $("relay-fill").style.width = "0%";
}

function cancelCountdown() {
  if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
}

function startCountdown(nxt) {
  // 后悔药横条：2 秒进度条 + ↺重看 #N / ⏸暂停；到点无操作自动接 #N+1
  cancelCountdown();
  $("relay-text").textContent = `即将播放 #${nxt}/${plan.total_items}`;
  $("relay-replay").textContent = `↺ 重看 #${lastRet}`;
  $("relay-bar").classList.remove("hidden");
  requestAnimationFrame(() => {
    $("relay-fill").style.transition = `width ${RELAY_COUNTDOWN_MS}ms linear`;
    $("relay-fill").style.width = "100%";
  });
  countdownTimer = RELAY_HOLD ? null : setTimeout(() => {
    countdownTimer = null;
    hideRelayBar();
    jumpTo(nxt, true);
  }, RELAY_COUNTDOWN_MS);
}

// 返回目录（pageshow 统一入口：bfcache 恢复与普通重载都走这里）
function onReturn() {
  const n = R.pending;
  if (!R.on || !n || !plan || !plan.live) return;
  if (R.date && plan.date && R.date !== plan.date) { R.on = false; R.pending = 0; renderHeader(); return; }
  R.pending = 0;                    // 处理即清：F5/再度往返不重触发
  lastRet = n;
  renderDirectory();                // 「刚看完」高亮
  const el = $(`item-${n}`);
  if (el) { el.classList.add("just-watched"); el.scrollIntoView({ block: "center" }); }
  if (n >= plan.total_items) { showEnd(); return; }          // 刷完全部
  startCountdown(n + 1);            // v4：无揭示概念，直接接续
}

// ---------- 启动 ----------
async function boot() {
  if (MOCK) {
    $("mock-banner").classList.remove("hidden");
    // mock 测试钩子（仅 mock 生效）：?setcur=N&relay=on 预设接力进度
    if (_q.has("setcur")) { R.cur = Number(_q.get("setcur")) || 0; }
    if (_q.get("relay") === "on") { R.on = true; }
    if (_q.has("setcur") || _q.get("relay") === "on") {
      R.pending = 0; R.date = MOCK_STATE.date;
    }
  }
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
  // 跨天作废旧接力进度
  if (R.date && R.date !== plan.date) { R.on = false; R.cur = 0; R.pending = 0; }
  R.date = plan.date;
  items = Array.isArray(plan.items) ? plan.items : [];
  booted = true;
  renderHeader();
  renderDirectory();
  onReturn();                       // 若是「看原帖→返回」则进入接力倒计时
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
$("host-ies").addEventListener("click", () => { R.host = "iesdouyin"; renderHeader(); });
$("host-dy").addEventListener("click", () => { R.host = "douyin"; renderHeader(); });

$("relay-start").addEventListener("click", () => {
  if (!plan || !plan.live) return;
  jumpTo(Math.max(R.cur, 1), true);
});
$("relay-stop").addEventListener("click", () => {
  R.on = false; R.pending = 0;
  cancelCountdown(); hideRelayBar();
  renderHeader();
});
$("relay-replay").addEventListener("click", () => {
  cancelCountdown(); hideRelayBar();
  jumpTo(lastRet, true);            // 重看 #N（pending=N 重落，返回后再接 #N+1）
});
$("relay-pause").addEventListener("click", () => {
  cancelCountdown(); hideRelayBar();
  R.on = false;                     // 暂停：停在目录，进度（cur）保留可续
  renderHeader();
});

window.addEventListener("pageshow", () => { if (booted) onReturn(); });
window.addEventListener("pagehide", cancelCountdown);   // 离页即收倒计时（防后台到点乱跳）

boot();
