/* 涨跌停板结构取数（财经早报 §04 用）。
 *
 * 接口：push2ex.eastmoney.com 的 getTopicZTPool / getTopicDTPool / getTopicZBPool
 *      （`date` 参数实测被忽略，返回**最近一个已完成交易日的完整池**；盘中运行时是当日进行中的池）。
 * 口径红线：
 *   - **输出只有家数、连板梯队、行业分布与金额，不含任何股票代码或名称**——早报 §04 的尺度是"只到题材与家数"。
 *   - 炸板池 `getTopicZBPool` 实测可用（2026-11-16 验证），封板率是**自算**：涨停家数 ÷（涨停＋炸板），无官方成文值。
 *   - `days`（跌停池）＝连续跌停天数、`lbc`（涨停池）＝连板数、`zbc`＝当日炸板次数、`hybk`＝东财行业（截断到 5 字）。
 *     跌停池的 `fund`/`fba`/`oc` 语义未核实，本脚本不取、正文不得引用。
 *   - 涨跌停家数是**广度**，连板梯队是**纵深**，两者可以反向；脚本只给事实，判断由写页面的人按规范 §04 给。
 *
 * 用法：node assets/fetch_limits.js                 # 取当前池并自动找上一交易日涨停家数算晋级率
 *      node assets/fetch_limits.js 2026-11-13     # 显式声明目标交易日（仅用于校验与提示，接口本身不接受历史回溯）
 * 输出：stdout 一个 JSON。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const UA = "Mozilla/5.0";

function pool(kind, sort) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const url = `https://push2ex.eastmoney.com/getTopic${kind}Pool?ut=7eea3edcaed734bea9cbfc24409ed989` +
    `&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=${encodeURIComponent(sort)}&date=${y}${m}${d}`;
  const raw = execSync(`curl -s --max-time 30 -A "${UA}" "${url}"`, { maxBuffer: 1 << 26 }).toString();
  let j;
  try { j = JSON.parse(raw); } catch (e) { return { error: "非 JSON 响应（可能被限流）", head: raw.slice(0, 80) }; }
  if (!j.data || !j.data.pool) return { error: "data 为空", rc: j.rc };
  return { tc: j.data.tc, qdate: j.data.qdate, pool: j.data.pool };
}

const dist = (rows, key) => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh")).slice(0, n);

const ZT = pool("ZT", "fbt:asc");
const DT = pool("DT", "fund:asc");
const ZB = pool("ZB", "fbt:asc");

if (ZT.error) { console.log(JSON.stringify({ fatal: "涨停池取不到：" + ZT.error, head: ZT.head }, null, 2)); process.exit(1); }
const qdate = ZT.qdate;
const qdateStr = `${String(qdate).slice(0, 4)}-${String(qdate).slice(4, 6)}-${String(qdate).slice(6, 8)}`;
const todayStr = new Date().toISOString().slice(0, 10);
const intraday = qdateStr === todayStr && new Date().getHours() < 15;

const zt = ZT.pool, dt = DT.pool || [], zb = ZB.pool || [];
const ladder = {};
for (const r of zt) ladder[r.lbc] = (ladder[r.lbc] || 0) + 1;
const maxStreak = zt.reduce((a, r) => Math.max(a, r.lbc), 0);
const secondPlus = zt.filter(r => r.lbc >= 2).length;
const firstBoard = zt.filter(r => r.lbc === 1).length;
const zbcOnce = zt.filter(r => r.zbc > 0).length;

/* 上一交易日涨停家数：从 data/ 里往前找第一条 breadth.date ≠ 本次池日期的快照 */
let prev = null;
const files = fs.readdirSync(path.join(ROOT, "data")).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
    if (j.breadth && j.breadth.date && j.breadth.date !== qdateStr && j.breadth.limit_up) {
      prev = { source: "data/" + f, date: j.breadth.date, limit_up: j.breadth.limit_up, max_streak: j.breadth.max_streak };
      break;
    }
  } catch (e) { /* 坏文件跳过 */ }
}

console.log(JSON.stringify({
  session_date: qdateStr,
  warning: intraday
    ? "本次池是当日**盘中进行中**的快照，禁止当成收盘涨跌停数写进正文（收盘值等 15:30 那期）"
    : "本次池是已完成交易日的收盘值",
  captured_at: new Date().toString(),
  limit_up: ZT.tc,
  limit_down: DT.error ? null : DT.tc,
  broken_board: ZB.error ? null : ZB.tc,
  net_boards: ZT.tc - (DT.tc || 0),
  seal_rate_pct: ZB.error ? null : +(ZT.tc / (ZT.tc + ZB.tc) * 100).toFixed(2),
  seal_rate_caliber: "涨停家数 ÷（涨停＋炸板）自算，非官方成文值；炸板池 getTopicZBPool 实测可用",
  limit_down_ratio_pct: DT.error ? null : +((DT.tc || 0) / ZT.tc * 100).toFixed(2),
  ladder: Object.fromEntries(Object.entries(ladder).sort((a, b) => b[0] - a[0])),
  max_streak: maxStreak,
  first_board: firstBoard,
  second_plus: secondPlus,
  promotion_rate_pct: prev ? +(secondPlus / prev.limit_up * 100).toFixed(2) : null,
  promotion_caliber: prev
    ? `${secondPlus}／${prev.limit_up}（当日 2 板及以上 ÷ 上一交易日涨停家数），上一交易日＝${prev.date}`
    : "data/ 里找不到上一交易日涨停家数，晋级率未取证",
  zt_reclosed_after_broken: zbcOnce,
  dt_multi_days: dt.filter(r => r.days >= 2).length,
  dt_industries: DT.error ? null : top(dist(dt, "hybk"), 5),
  zt_industries: top(dist(zt, "hybk"), 8),
  zt_industry_total: Object.keys(dist(zt, "hybk")).length,
  zt_hhi_pct: +(Object.values(dist(zt, "hybk")).reduce((a, n) => a + (n / ZT.tc) ** 2, 0) * 100).toFixed(2),
  zt_amount_yi: +(zt.reduce((a, r) => a + r.amount, 0) / 1e8).toFixed(2),
  dt_amount_yi: DT.error ? null : +(dt.reduce((a, r) => a + r.amount, 0) / 1e8).toFixed(2),
  dt_turnover_median_pct: DT.error ? null : +dt.map(r => r.hs).sort((a, b) => a - b)[Math.floor(dt.length / 2)].toFixed(2),
  prev: prev,
  notes: [
    "东财行业 hybk 与申万一级不等价，且字段本身截断到 5 字（如\"农产品加\"）",
    "跌停池 fund/fba/oc 语义未核实，本脚本不取",
    "输出不含个股代码与名称；正文亦不得点名个股（用户 2026-11-03 定尺度）"
  ]
}, null, 2));
