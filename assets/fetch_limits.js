/* 涨跌停板结构取数（财经早报 §04 用）。
 *
 * 接口：push2ex.eastmoney.com 的 getTopicZTPool / getTopicDTPool / getTopicZBPool
 * 口径红线（2026-11-16 实测更正，此前规范记错）：
 *   - **`date=YYYYMMDD` 是生效的**：可以逐日回取，工作日返回当日池、周末与节假日返回 `tc:0` 空池。
 *     旧结论"date 被忽略"来自两个假象：① `qdate` 恒等于最近交易日（所以不能拿它校验取到哪一天）；
 *     ② 11-12 与 11-13 两天的涨停家数恰好都是 37，抽样时误判成"永远返回最新"。
 *   - **可取窗口有限**：11-06（8 个交易日前）仍可取，10-09 起返回空池。超出窗口只能靠媒体口径并标 ⚠️。
 *   - 校验办法：不信任 `qdate`，改用"空池＝该日非交易日或超窗口"＋"同日两次抓取 tc 一致"。
 *   - **输出只有家数、连板梯队、行业分布与金额，不含任何股票代码或名称**——早报 §04 的尺度是"只到题材与家数"。
 *   - 炸板池 `getTopicZBPool` 实测可用，封板率是**自算**：涨停家数 ÷（涨停＋炸板），无官方成文值。
 *   - `days`（跌停池）＝连续跌停天数、`lbc`（涨停池）＝连板数、`zbc`＝当日炸板次数、`hybk`＝东财行业（截断到 5 字）。
 *     跌停池的 `fund`/`fba`/`oc` 语义未核实，本脚本不取、正文不得引用。
 *   - 涨跌停家数是**广度**，连板梯队是**纵深**，两者可以反向；脚本只给事实，判断由写页面的人按规范 §04 给。
 *
 * 用法：node assets/fetch_limits.js                    # 不带参数＝取最近一个交易日（09:20 跑时即上一交易日）
 *      node assets/fetch_limits.js 2026-11-13          # 显式指定目标交易日，接口按 date 参数回取该日池
 * 输出：stdout 一个 JSON。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const UA = "Mozilla/5.0";
const WANT = process.argv[2] || null;
if (WANT && !/^\d{4}-\d{2}-\d{2}$/.test(WANT)) { console.error("用法: node assets/fetch_limits.js [YYYY-MM-DD]"); process.exit(2); }
const dateParam = WANT ? WANT.replace(/-/g, "") : (() => { const t = new Date(); return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}`; })();

function pool(kind, sort) {
  const url = `https://push2ex.eastmoney.com/getTopic${kind}Pool?ut=7eea3edcaed734bea9cbfc24409ed989` +
    `&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=${encodeURIComponent(sort)}&date=${dateParam}`;
  const raw = execSync(`curl -s --max-time 30 -A "${UA}" "${url}"`, { maxBuffer: 1 << 26 }).toString();
  let j;
  try { j = JSON.parse(raw); } catch (e) { return { error: "非 JSON 响应（可能被限流）", head: raw.slice(0, 80) }; }
  if (!j.data) return { error: "data 为空", rc: j.rc };
  if (!j.data.pool || !j.data.pool.length) return { tc: j.data.tc, qdate: j.data.qdate, pool: [], empty: true };
  return { tc: j.data.tc, qdate: j.data.qdate, pool: j.data.pool };
}

const dist = (rows, key) => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh")).slice(0, n);

const ZT = pool("ZT", "fbt:asc");
const DT = pool("DT", "fund:asc");
const ZB = pool("ZB", "fbt:asc");

if (ZT.error) { console.log(JSON.stringify({ fatal: "涨停池取不到：" + ZT.error, head: ZT.head }, null, 2)); process.exit(1); }
const requested = WANT || null;
const qdate = ZT.qdate;
const qdateStr = `${String(qdate).slice(0, 4)}-${String(qdate).slice(4, 6)}-${String(qdate).slice(6, 8)}`;
const todayStr = new Date().toISOString().slice(0, 10);
/* 会话日期：显式指定就用指定日（date 参数生效，已实测），否则只能认为等于 qdate（最近交易日） */
const sessionDate = requested || qdateStr;
if (ZT.empty) {
  console.log(JSON.stringify({
    fatal: `涨停池为空（date=${dateParam}）`,
    requested_date: requested,
    meaning: "该日为周末/节假日，或超出接口可取窗口（实测 11-06 可取、10-09 起为空）",
    qdate_echo: qdateStr,
    hint: "qdate 恒等于最近交易日，不能用来校验取到哪一天；空池请改用媒体口径并标 ⚠️"
  }, null, 2));
  process.exit(1);
}
const intraday = sessionDate === todayStr && new Date().getHours() < 15;

const zt = ZT.pool, dt = DT.pool || [], zb = ZB.pool || [];
const ladder = {};
for (const r of zt) ladder[r.lbc] = (ladder[r.lbc] || 0) + 1;
const maxStreak = zt.reduce((a, r) => Math.max(a, r.lbc), 0);
const secondPlus = zt.filter(r => r.lbc >= 2).length;
const firstBoard = zt.filter(r => r.lbc === 1).length;
const zbcOnce = zt.filter(r => r.zbc > 0).length;

/* 上一交易日涨停家数：先从 data/ 往前找第一条 breadth.date ≠ 本次会话日期的快照；
   找不到就退回接口——把会话日期往前推一天逐个试（date 参数生效，周末会返回空池） */
let prev = null;
const files = fs.readdirSync(path.join(ROOT, "data")).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
    if (j.breadth && j.breadth.date && j.breadth.date !== sessionDate && j.breadth.limit_up) {
      prev = { source: "data/" + f, date: j.breadth.date, limit_up: j.breadth.limit_up, max_streak: j.breadth.max_streak };
      break;
    }
  } catch (e) { /* 坏文件跳过 */ }
}
if (!prev) {
  const start = new Date(sessionDate + "T00:00:00");
  for (let back = 1; back <= 6 && !prev; back++) {
    const p = new Date(start.getTime() - back * 86400000);
    const ds = `${p.getFullYear()}${String(p.getMonth() + 1).padStart(2, "0")}${String(p.getDate()).padStart(2, "0")}`;
    const raw = execSync(`curl -s --max-time 25 -A "${UA}" "https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${ds}"`, { maxBuffer: 1 << 24 }).toString();
    try {
      const j = JSON.parse(raw);
      if (j.data && j.data.tc) prev = { source: "push2ex 接口回取", date: ds.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"), limit_up: j.data.tc };
    } catch (e) { /* 换下一天 */ }
  }
}

console.log(JSON.stringify({
  session_date: sessionDate,
  requested_date: requested,
  qdate_echo: qdateStr + "（接口恒返回最近交易日，只用于判断是否盘中，不用于校验取到哪一天）",
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
    "date 参数生效（2026-11-16 实测更正）：可逐日回取，周末/节假日返回空池，超出窗口（实测 10-09 起）也返回空池；旧结论\"date 被忽略\"是误判",
    "东财行业 hybk 与申万一级不等价，且字段本身截断到 5 字（如\"农产品加\"）",
    "跌停池 fund/fba/oc 语义未核实，本脚本不取",
    "输出不含个股代码与名称；正文亦不得点名个股（用户 2026-11-03 定尺度）"
  ]
}, null, 2));
