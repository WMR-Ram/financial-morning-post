/* 宽基/红利指数"锚 ETF"选择器：按跟踪指数分组，取该指数下**规模最大**的场内 ETF，
 * 并输出其全称与跟踪指数名（用户 2026-11-06 要求：探针必须写清对应指数）。
 *
 * 数据源：东财 fundmobapi FundMNBasicInformation（实测可用）。
 *   ENDNAV = 期末净资产(元) → 亿元；FEGM = 份额(份)；FEGMRQ = 报告期；TRACKINDEX = 跟踪指数全称。
 * **口径红线**：ENDNAV/FEGM 来自最近一期定期报告（季报），不是实时规模；正文必须带报告期。
 *   东财 F10 的"持有人结构"只给机构/个人比例，**不含前十大份额持有人名单**（实测页面无"汇金"），
 *   所以"国家队是否持有该 ETF"必须每期用 WebSearch 复核定期报告或权威报道，脚本不猜、不沿用记忆。
 *
 * 用法：node assets/fetch_etf_anchor.js            # 跑内置候选池
 *      node assets/fetch_etf_anchor.js 510300 588000  # 只跑指定代码
 * 输出：stdout 一个 JSON，含每个指数的锚 ETF、同指数第二名（备选）、以及需要人工复核的字段。
 */
const { execSync } = require("child_process");
const UA = "Mozilla/5.0";

/* 候选池：按跟踪指数归组（2026-11-06 用本脚本逐个实测过简称与 TRACKINDEX 字段，别凭记忆改） */
const POOL = [
  { index: "沪深300", sid: "1.000300", codes: ["510300", "510310", "510330", "159919", "159925"] },
  { index: "上证50", sid: "1.000016", codes: ["510050", "510850"] },
  { index: "上证指数", sid: "1.000001", codes: ["510760", "510210"] },
  { index: "中证500", sid: "1.000905", codes: ["510500", "159922", "512500"] },
  { index: "中证1000", sid: "1.000852", codes: ["512100", "159845", "560010"] },
  { index: "中证A500", sid: "1.000510", codes: ["159352", "159338", "512050", "159339"] },
  { index: "科创50", sid: "1.000688", codes: ["588000", "588080", "588090"] },
  { index: "创业板指", sid: "0.399006", codes: ["159915", "159957"] },
  { index: "创业板50", sid: "0.399673", codes: ["159949"] },
  { index: "中证红利", sid: "1.000922", codes: ["515080", "515180"] },
  { index: "中证红利低波动", sid: "2.H30269", codes: ["512890", "563020", "159525"] },
  { index: "标普中国A股大盘红利低波50", sid: "1.515450(代理)", codes: ["515450", "561450"] }
];

function info(code) {
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBasicInformation?FCODE=${code}&deviceid=1&plat=Iphone&product=EFund&version=6.2.8`;
  try {
    const j = JSON.parse(execSync(`curl -s --max-time 15 -A "${UA}" "${url}"`, { encoding: "utf8" })).Datas;
    if (!j || !j.SHORTNAME) return null;
    return {
      code,
      name: j.SHORTNAME,
      scaleYi: j.ENDNAV && j.ENDNAV !== "--" ? +(Number(j.ENDNAV) / 1e8).toFixed(2) : null,
      sharesYi: j.FEGM && j.FEGM !== "--" ? +(Number(j.FEGM) / 1e8).toFixed(2) : null,
      reportDate: j.FEGMRQ || "--",
      trackIndex: j.TRACKINDEX || j.INDEXNAME || "--"
    };
  } catch (e) { return null; }
}

const only = process.argv.slice(2);
const groups = only.length
  ? [{ index: "指定代码", sid: "-", codes: only }]
  : POOL;

const out = [];
for (const g of groups) {
  const rows = g.codes.map(info).filter(Boolean).sort((a, b) => (b.scaleYi || 0) - (a.scaleYi || 0));
  if (!rows.length) { out.push({ indexName: g.index, error: "候选全部无数据" }); continue; }
  out.push({
    indexName: g.index,
    indexSid: g.sid,
    anchorEtf: rows[0],
    runnerUp: rows[1] || null,
    /* 规模第二与第一差得越近，越要说明为什么选前者；差得远则探针更该用锚 ETF */
    scaleGapYi: rows[1] ? +(rows[0].scaleYi - rows[1].scaleYi).toFixed(2) : null,
    stateHolderEvidence: "待复核：东财 F10 无持有人名单，须查最近一期定期报告前十大份额持有人或权威报道是否出现中央汇金/诚通/国新",
    note: "规模口径＝最近一期定期报告期末净资产（ENDNAV，报告期见 reportDate），非实时"
  });
}
console.log(JSON.stringify({
  caliber: "每个宽基/红利指数取该指数下规模最大的场内 ETF 作资金流探针；正文必须写『ETF 全称（代码）跟踪××指数』。若复核到汇金等国家队持仓证据且不在规模第一位，两者并列报告，不替换。",
  fetchedAt: new Date().toISOString(),
  groups: out
}, null, 1));
