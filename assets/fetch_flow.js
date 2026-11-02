/* 东方财富板块/指数历史资金流（daykline）——按日输出，供《财经早报》§02/§03 取"上一交易日"数据。
 *
 * 接口：push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=<前缀.代码>
 * 字段顺序（2026-11-02 用 BK0917 原始返回逐列核验，别改回旧脚本的猜测顺序）：
 *   f51 日期 | f52 主力净额 | f53 小单净额 | f54 中单净额 | f55 大单净额 | f56 超大单净额
 *   f57 主力净占比 | f58 小单占比 | f59 中单占比 | f60 大单占比 | f61 超大单占比 | f62 收盘 | f63 涨跌幅
 * 恒等式（逐日实测成立，误差 < 0.02 亿）：主力净额 = 大单净额 + 超大单净额。
 * 口径红线：主力/大单/超大单是按**单笔成交金额阈值推算的分档**，不是机构身份，不等于"机构在买"。
 *
 * 用法：node assets/fetch_flow.js 2026-10-30 2026-10-30 BK0917 BK1128 BK1137 90.BK0896 1.000300
 *      裸 BKxxxx 自动加前缀 90.；带点的原样使用（90.=概念板块，1.=沪，0.=深）。
 * 输出：stdout 一个 JSON。日期区间给单日用同一天即可。
 */
const [BEGIN, END, ...CODES] = process.argv.slice(2);
if (!BEGIN || !END || !CODES.length) {
  console.error("用法: node fetch_flow.js <起> <止> <代码...>　例：node fetch_flow.js 2026-10-30 2026-10-30 BK0917 BK1128");
  process.exit(2);
}
const HEAD = { "User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/" };
const YI = 1e8;
const r2 = (x) => +((x || 0) / YI).toFixed(2);

function fetchText(url) {
  for (const base of ["https://", "http://"]) {
    const cmd = `curl -sS --max-time 25 -A "${HEAD["User-Agent"]}" -e "${HEAD.Referer}" "${base}${url}"`;
    try {
      const t = require("child_process").execSync(cmd, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (t && t.trim().length > 10) return t;
    } catch (e) { /* 换协议重试 */ }
  }
  return null;
}

const out = [];
for (const raw of CODES) {
  const secid = raw.includes(".") ? raw : "90." + raw;
  const t = fetchText(`push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid=${secid}` +
    `&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63`);
  if (!t) { out.push({ secid, error: "双协议均无响应（东财限流），改用 MCP list_fund_flow 或标注未取证" }); continue; }
  let j; try { j = JSON.parse(t); } catch (e) { out.push({ secid, error: "解析失败：" + t.slice(0, 80) }); continue; }
  const kl = (j.data && j.data.klines) || [];
  const days = [];
  for (const line of kl) {
    const f = line.split(",");
    const d = f[0];
    if (d < BEGIN || d > END) continue;
    const main = +f[1], small = +f[2], mid = +f[3], large = +f[4], superLarge = +f[5];
    /* 恒等式核验：主力 = 大单 + 超大单 */
    const err = (main - (large + superLarge)) / YI;
    days.push({
      date: d, mainYi: r2(main), superYi: r2(superLarge), largeYi: r2(large),
      midYi: r2(mid), smallYi: r2(small), mainPct: +f[6], close: f[11], pct: f[12],
      identityErrYi: +err.toFixed(2)
    });
  }
  const bad = days.filter(x => Math.abs(x.identityErrYi) > 0.02);
  out.push({
    secid,
    name: j.data && j.data.name,
    days,
    rangeMainYi: days.length ? +days.reduce((s, x) => s + x.mainYi, 0).toFixed(2) : null,
    identityCheck: days.length ? (bad.length ? `FAIL ${bad.length}/${days.length} 天` : "ok") : "EMPTY 区间内无交易日数据",
    lastDay: days.length ? days[days.length - 1] : null,
    note: "单位亿元；主力=大单+超大单，属单笔金额分档推算，非机构身份"
  });
}
console.log(JSON.stringify({
  caliber: "东财 daykline 逐日主力净额（超大单/大单分档推算，非机构身份）。核不到的代码看 error/identityCheck 字段。",
  range: [BEGIN, END],
  data: out
}, null, 1));
