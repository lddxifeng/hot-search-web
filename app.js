"use strict";
/* 热搜连刷 · 原帖接力连刷（网页 v4 版次制，2026-10-07 拍板 C）
 *
 * 定位：本站只做「目录 + 接力导航」，视频流走抖音原帖页（永久免费、永不 403、
 * 原帖级清晰度）。不做沉浸式播放器、不 iframe（抖音 frame-ancestors 实测封死）、
 * 不抓视频流地址（临时链实测几分钟即烂）、不做播完自动跳转、不下载视频本体。
 *
 * 版次制：一推=一版报纸。目录按版分区（第 N 推 · HH:MM），各版编号各自 #1 起；
 * 数据=Worker /api/state 按 editions 一次全量返回（lean 免费字段；无真赞/评/转/藏）。
 * 补后接力：每次打开/刷新重读 /api/state，补批续挂末版尾部自然列出。
 * 系统日=北京时间 06:01 切（batchplan/Worker/本页三处同规则）：<06:01 归前一天，
 * 网页仍显示昨天最后一版（防刷一半被清）；06:01 后自动切新系统日（空目录等首推）。
 * ?date= 考古后门透传给 Worker（缺则补）。
 *
 * 接力机制（后悔药）：指针按 vid 锚定（新版插入/日清切换不漂移），
 * 逻辑只靠 localStorage 标记驱动（bfcache 与普通重载都走 pageshow）——
 *   hs_relay      "on"/"off"   连刷开关
 *   hs_relay_vid  当前条 vid（最后跳出/要续刷的）
 *   hs_pending_vid 跳出去看的那条 vid（返回目录=接力信号；处理即清，防 F5 重触发）
 *   hs_relay_date 标记所属系统日（跨系统日自动作废）
 *   hs_host       原帖域名偏好（iesdouyin / douyin）
 * 连刷循环：跳出看 X（pending=X.vid）→ 浏览器返回（pageshow）→ relay=on 且 pending 在
 *   → 倒计时横条「即将播放 第E推 #n+1」（↺ 重看 / ⏸ 暂停）→ 到点自动接下一条
 *   （同版尾部→下一版首条；最后一版末尾 → 结束页）。
 * 单看模式（relay=off）：点标题/条目跳原帖，返回后不自动跳（不写任何接力标记）。
 *
 * 暗号（拍板 e'）：永不硬编码；首次弹框手粘，存 localStorage，请求带
 * X-Hotsearch-Token 头。网页无图文区为永久拍板决策（2026-10-06）：偶遇图文帖
 * 仍正确渲染（🖼徽标+只走原帖），板块不做。
 */

// === 配置项（全页唯一）：Worker 地址。地址公开属正常——页面与源码本就公开，
//     真正的闸门是暗号（Worker 侧校验） ===
const WORKER_BASE = "https://bot.hotsearch-xifeng.top";   // hotsearch-feishu-bot 绑定的自定义域名

// 原帖地址候选（aweme_id 拼接；真机 A/B 拍默认=弹窗少者，另一个留设置切换）：
const POST_HOSTS = {
  iesdouyin: (vid) => `https://www.iesdouyin.com/share/video/${vid}/`,   // 暂定默认（待真机 A/B）
  douyin: (vid) => `https://www.douyin.com/video/${vid}`,
};

const TOKEN_KEY = "hotsearch_token";   // localStorage 键名（存的是用户手输的暗号，不是仓库硬编码）

// mock 模式：file:// 直接双击打开 或 显式 ?mock=1 → 全走 mock/fixture.js 假数据，
// 不打任何真实请求（连 Worker 也不打）。Pages 线上 https 打开=真实 Worker。
// mock 专属测试钩子：?setvid=eNvNN 预设指针 vid；?relay=on/off；?slow=1 倒计时放慢 15 秒；
// ?hold=1 横条只显示不到点；?mocktopup=1 补后场景（均仅 mock 生效）。
const _q = new URLSearchParams(location.search);
const MOCK = _q.has("mock") || location.protocol === "file:";

// 后悔药倒计时（头部三档可调 1s/1.5s/2s，localStorage 持久化，默认 1s）
function countdownMs() {
  if (MOCK && _q.has("slow")) return 15000;
  const v = Number(localStorage.getItem("hs_countdown_ms"));
  return [1000, 1500, 2000].includes(v) ? v : 1000;
}
const RELAY_HOLD = MOCK && _q.has("hold");   // mock 验收钩子：倒计时横条只显示不到点

let token = localStorage.getItem(TOKEN_KEY) || "";
let plan = null;                 // /api/state 回包 {date, today, live, editions[]}
let editions = [];               // 版次序列（含 lean items）
let booted = false;
let lastRet = null;              // 本次返回刚看完的条目（倒计时横条的重看目标）
let countdownTimer = null;

const $ = (id) => document.getElementById(id);

// ---------- 接力标记（只读存储驱动，vid 锚定） ----------
const R = {
  get on() { return localStorage.getItem("hs_relay") === "on"; },
  set on(v) { localStorage.setItem("hs_relay", v ? "on" : "off"); },
  get vid() { return localStorage.getItem("hs_relay_vid") || ""; },
  set vid(v) { localStorage.setItem("hs_relay_vid", v || ""); },
  get pendingVid() { return localStorage.getItem("hs_pending_vid") || ""; },
  set pendingVid(v) { localStorage.setItem("hs_pending_vid", v || ""); },
  get date() { return localStorage.getItem("hs_relay_date") || ""; },
  set date(v) { localStorage.setItem("hs_relay_date", v); },
  get host() { return localStorage.getItem("hs_post_host") || "iesdouyin"; },
  set host(v) { localStorage.setItem("hs_post_host", v); },
  get ed() { return localStorage.getItem("hs_edition") || ""; },   // 推次选择器（指令块 E；""=全部）
  set ed(v) { localStorage.setItem("hs_edition", v || ""); },
};

// 系统日（与 hotsearch/batchplan.py、Worker systemDay 同规则）：<06:01 归前一天
function systemDay() {
  const n = new Date(Date.now() + 8 * 3600e3);
  if (n.getUTCHours() < 6 || (n.getUTCHours() === 6 && n.getUTCMinutes() < 1)) {
    return new Date(n.getTime() - 86400e3).toISOString().slice(0, 10);
  }
  return n.toISOString().slice(0, 10);
}

function postUrl(item) {
  if (MOCK) return `mock/post.html?vid=${encodeURIComponent(item.vid)}`;
  return (POST_HOSTS[R.host] || POST_HOSTS.iesdouyin)(item.vid);
}

// ---------- mock 引擎（v4 版次制：只认 /api/state；无 /api/batch 路由） ----------
function mockApi(path) {
  if (path.startsWith("/api/state")) {
    return Promise.resolve(structuredClone(
      _q.has("mocksolo") ? MOCK_STATE_SOLO
                         : _q.has("mocktopup") ? MOCK_STATE_TOPUP : MOCK_STATE));
  }
  return Promise.resolve({ ok: false, reason: "not_found" });
}

// ---------- 真实 API（带暗号头；?date= 考古透传） ----------
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
function fmtPub(ts) {
  // 发布·YYYY-MM-DD（北京时间）；pub_ts 缺省/0 → 隐藏（返回空串）
  ts = Number(ts) || 0;
  if (ts <= 0) return "";
  return "发布·" + new Date(ts * 1000 + 8 * 3600e3).toISOString().slice(0, 10);
}
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------- 版次数据 ----------
// 推次选择器（指令块 E）：R.ed="" = 全部；选中某版=只显示该版。连刷范围=当前显示集合。
function viewEditions() {
  return R.ed ? editions.filter((e) => String(e.edition_no) === R.ed) : editions;
}
function latestEdition() {
  const v = viewEditions();
  return v.length ? v[v.length - 1] : null;
}
function latestItem() {
  const ed = latestEdition();
  return ed && ed.items.length ? ed.items[ed.items.length - 1] : null;
}
function findItem(vid) {
  // 按 vid 锚定定位（限当前显示集合）：返回 {edition, idx, item} 或 null
  for (const ed of viewEditions()) {
    const idx = ed.items.findIndex((v) => v.vid === vid);
    if (idx >= 0) return { edition: ed, idx, item: ed.items[idx] };
  }
  return null;
}
function nextAfter(vid) {
  // 下一条（限当前显示集合）：同版 idx+1；版尾 → 下一可见版首条；末尾 → null（结束页）
  const hit = findItem(vid);
  if (!hit) return null;
  const { edition, idx } = hit;
  if (idx + 1 < edition.items.length) {
    return { edition, idx: idx + 1, item: edition.items[idx + 1] };
  }
  const veds = viewEditions();
  const eIdx = veds.indexOf(edition);
  if (eIdx >= 0 && eIdx + 1 < veds.length) {
    const nEd = veds[eIdx + 1];
    if (nEd.items.length) return { edition: nEd, idx: 0, item: nEd.items[0] };
  }
  return null;
}
function curPos() {
  // 当前指针位置（vid 锚定）；找不到（跨系统日/版已归档）→ null
  return R.vid ? findItem(R.vid) : null;
}

function syncTitle() {
  // document.title 实时同步「第E推 #n/N · 热搜连刷」（vid 定位；未开始只显站名）
  const hit = curPos();
  document.title = (plan && hit)
    ? `第${hit.edition.edition_no}推 #${hit.item.num}/${hit.edition.items.length} · 热搜连刷`
    : "热搜连刷";
}

// ---------- 渲染 ----------
function renderHeader() {
  $("date").textContent = plan && plan.date ? `· ${plan.date}` : "";
  const veds = viewEditions();
  if (plan && plan.live && editions.length) {
    const last = latestEdition();
    $("overview").textContent =
      `当日已推 ${editions.length} 版 · 最新版 第${editions[editions.length - 1].edition_no}推` +
      ` ${(editions[editions.length - 1].pushed_at || "").slice(11, 16)}` +
      (R.ed ? ` · 只看第${R.ed}推` : "") + ` · 今日全免费`;
    const hit = curPos();
    $("progress").textContent = hit
      ? `已刷到 第${hit.edition.edition_no}推 #${hit.item.num}/${hit.edition.items.length}`
      : "未开始";
  } else {
    $("overview").textContent = plan && !plan.live ? "今日还没有正推（等第一版）" : "";
    $("progress").textContent = "";
  }
  $("host-ies").classList.toggle("on", R.host === "iesdouyin");
  $("host-dy").classList.toggle("on", R.host === "douyin");
  const cd = countdownMs();
  $("cd-1").classList.toggle("on", cd === 1000);
  $("cd-15").classList.toggle("on", cd === 1500);
  $("cd-2").classList.toggle("on", cd === 2000);
  // 推次选择器（指令块 E）：「全部」+ 当日各版（动态生成，带 HH:MM）；与倒计时同款
  const sw = $("ed-switch");
  sw.innerHTML = "";
  const opts = [["", "全部"]].concat(
    editions.map((e) => [String(e.edition_no),
                         `第${e.edition_no}推 ${(e.pushed_at || "").slice(11, 16)}`]));
  for (const [val, label] of opts) {
    const b = document.createElement("button");
    b.className = "link-btn";
    b.id = `ed-${val || "all"}`;
    b.textContent = label;
    b.classList.toggle("on", R.ed === val);
    b.addEventListener("click", () => { R.ed = val; boot(); });
    sw.appendChild(b);
  }
  // 继续按钮：下一条（vid 锚定）；无指针=从当前显示集合最新版 #1 开始
  const nxt = curPos() ? nextAfter(R.vid) : null;
  const done = plan && plan.live && veds.length && !nxt && curPos() &&
               R.vid === (latestItem() || {}).vid;
  if (nxt) {
    $("relay-start").textContent = `▶ 继续 第${nxt.edition.edition_no}推 #${nxt.item.num}`;
  } else {
    $("relay-start").textContent = "▶ 开始连刷";
  }
  $("relay-start").classList.toggle("hidden", !plan || !plan.live || !veds.length || !!done);
  $("relay-stop").classList.toggle("hidden", !R.on);
  syncTitle();
}

function renderDirectory() {
  const root = $("directory");
  root.innerHTML = "";
  for (const ed of viewEditions()) {   // 推次选择器：选中某版=只显示该版；全部=按序全展示
    const sec = document.createElement("section");
    sec.className = "group";
    const h = document.createElement("div");
    h.className = "group-label";
    // 版分区标题（拍板 C）：第 N 推 · HH:MM（各版编号各自 #1 起）
    h.textContent = `第 ${ed.edition_no} 推 · ${(ed.pushed_at || "").slice(11, 16)}`;
    sec.appendChild(h);
    const ol = document.createElement("ol");
    ol.className = "list";
    for (const v of ed.items) {
      const li = document.createElement("li");
      li.className = "card";
      li.id = `item-${v.vid}`;
      li.dataset.vid = v.vid;
      const photo = v.is_photo ? " <span class='tag'>🖼图文</span>" : "";
      const watched = lastRet && v.vid === lastRet.vid ? " <span class='tag hot'>刚看完</span>" : "";
      const stats = [];
      if (Number(v.best_digg) > 0) stats.push(`👍${fmtWan(v.best_digg)}<span class="tag">峰值</span>`);
      if (Number(v.score) > 0) stats.push(`🔥${fmtWan(v.score)}<span class="tag">峰值</span>`);
      if (Number(v.play) > 0) stats.push(`▶${fmtWan(v.play)}<span class="tag">峰值</span>`);
      if (Number(v.ratio) > 0)
        stats.push(`赞播比·峰值 ${(Number(v.ratio) * 100).toFixed(1)}%`);
      const pub = fmtPub(v.pub_ts);
      li.innerHTML =
        `<div class="num" data-relay="${v.vid}" title="从这条开始连刷">#${v.num}</div>` +
        `<div class="body">` +
        `<span class="title">${escapeHtml(v.title) || "（无标题）"}</span>${photo}${watched}` +
        `<div class="dim meta">${escapeHtml(v.author) || "—"}` +
        (Number(v.fans) > 0 ? ` · 粉丝·${fmtWan(v.fans)}` : "") +
        ` · ${fmtDur(v.duration_ms)}` +
        (pub ? ` · ${pub}` : "") +
        (stats.length ? ` · ${stats.join(" · ")}` : "") +
        `</div>` +
        `</div>`;
      // 点编号=从该条起连刷（vid 锚定）；点标题/其余=单看（纯跳转不写接力标记）
      li.querySelector(".num").addEventListener("click", (e) => {
        e.stopPropagation();
        jumpTo(v, true);
      });
      li.querySelector(".body").addEventListener("click", () => {
        jumpTo(v, false);
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
  R.pendingVid = "";
  hideRelayBar();
  $("directory").innerHTML = "";
  $("end-page").classList.remove("hidden");
  $("end-recap").textContent = plan
    ? (R.ed
        ? `第 ${R.ed} 推刷完 · 想继续到群里发「补」，补完回来刷新本页接着看`
        : `当日已推 ${editions.length} 版 · 全部刷完 · 想继续到群里发「补」，补完回来刷新本页接着看`)
    : "";
  renderHeader();
}

// ---------- 接力核心（vid 锚定） ----------
function jumpTo(item, relaying) {
  if (!item) return;
  if (relaying) {
    R.on = true;
    R.vid = item.vid;
    R.pendingVid = item.vid;
    R.date = plan ? plan.date : R.date;
  }
  syncTitle();
  location.href = postUrl(item);   // 同标签跳原帖（不 iframe、不抓流）
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
  // 后悔药横条：倒计时进度条 + ↺重看 / ⏸暂停；到点无操作自动接下一条
  cancelCountdown();
  const ms = countdownMs();             // 读存储（头部三档开关即时生效）
  $("relay-text").textContent = `即将播放 第${nxt.edition.edition_no}推 #${nxt.item.num}`;
  $("relay-replay").textContent = lastRet ? `↺ 重看 第${lastRet.edition.edition_no}推 #${lastRet.item.num}` : "";
  $("relay-bar").classList.remove("hidden");
  requestAnimationFrame(() => {
    $("relay-fill").style.transition = `width ${ms}ms linear`;
    $("relay-fill").style.width = "100%";
  });
  countdownTimer = RELAY_HOLD ? null : setTimeout(() => {
    countdownTimer = null;
    hideRelayBar();
    jumpTo(nxt.item, true);
  }, ms);
}

// 返回目录（pageshow 统一入口：bfcache 恢复与普通重载都走这里）
function onReturn() {
  const vid = R.pendingVid;
  if (!R.on || !vid || !plan || !plan.live) return;
  if (R.date && plan.date && R.date !== plan.date) {   // 跨系统日：标记作废
    R.on = false; R.pendingVid = ""; R.vid = "";
    renderHeader();
    return;
  }
  R.pendingVid = "";                    // 处理即清：F5/再度往返不重触发
  const hit = findItem(vid);
  if (!hit) { renderDirectory(); return; }   // vid 已不在目录（版已归档）→ 静候，不跳
  lastRet = hit;
  renderDirectory();                    // 「刚看完」高亮
  const el = $(`item-${vid}`);
  if (el) { el.classList.add("just-watched"); el.scrollIntoView({ block: "center" }); }
  const nxt = nextAfter(vid);
  if (!nxt) { showEnd(); return; }      // 最后一版末尾 → 结束页
  startCountdown(nxt);
}

// ---------- 启动 ----------
async function boot() {
  if (MOCK) {
    $("mock-banner").classList.remove("hidden");
    // mock 测试钩子（仅 mock 生效）：?setvid=eNvNN 预设指针；?relay=on/off
    if (_q.has("setvid")) { R.vid = _q.get("setvid") || ""; }
    if (_q.get("relay") === "on") { R.on = true; }
    if (_q.get("relay") === "off") { R.on = false; }
    if (_q.has("setvid") || _q.get("relay") === "on") {
      R.pendingVid = ""; R.date = MOCK_STATE.date;
    }
  }
  if (!token) { showTokenModal(); return; }
  hideTokenModal();
  try {
    plan = await api("/api/state" + (_q.get("date") ? `?date=${encodeURIComponent(_q.get("date"))}` : ""));
  } catch (e) {
    if (String(e && e.message) !== "bad_token") notice("网络异常，请刷新重试");
    return;
  }
  if (!plan.ok) { notice(plan.text || "状态读取失败，请稍后再试"); return; }
  if (!plan.live) { notice("今日还没有正推（等第一版）。请先在群里发「推」。"); return; }
  // 跨系统日作废旧接力进度
  if (R.date && R.date !== plan.date) { R.on = false; R.vid = ""; R.pendingVid = ""; }
  R.date = plan.date;
  editions = Array.isArray(plan.editions) ? plan.editions : [];
  // 推次选择器回落（指令块 E）：所选版不存在（日清后/跨天/?date= 考古）→ 自动回落「全部」
  if (R.ed && !editions.some((e) => String(e.edition_no) === R.ed)) R.ed = "";
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
// 倒计时三档（localStorage 持久化、跨天保留、选了立即生效）
for (const [id, ms] of [["cd-1", 1000], ["cd-15", 1500], ["cd-2", 2000]]) {
  $(id).addEventListener("click", () => {
    localStorage.setItem("hs_countdown_ms", String(ms));
    renderHeader();
  });
}

$("relay-start").addEventListener("click", () => {
  if (!plan || !plan.live) return;
  const nxt = curPos() ? nextAfter(R.vid) : null;
  const first = latestEdition() && latestEdition().items[0];
  jumpTo(nxt ? nxt.item : first, true);   // 继续=下一条；无指针=从最新版 #1 开始
});
$("relay-stop").addEventListener("click", () => {
  R.on = false; R.pendingVid = "";
  cancelCountdown(); hideRelayBar();
  renderHeader();
});
$("relay-replay").addEventListener("click", () => {
  cancelCountdown(); hideRelayBar();
  if (lastRet) jumpTo(lastRet.item, true);   // 重看（pending 重落，返回后再接下一条）
});
$("relay-pause").addEventListener("click", () => {
  cancelCountdown(); hideRelayBar();
  R.on = false;                     // 暂停：停在目录，进度（vid）保留可续
  renderHeader();
});

window.addEventListener("pageshow", () => { if (booted) onReturn(); });
window.addEventListener("pagehide", cancelCountdown);   // 离页即收倒计时（防后台到点乱跳）

boot();
