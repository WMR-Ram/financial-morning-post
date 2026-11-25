#!/usr/bin/env node
/* 《财经早报》发布前自检。用法：node assets/check.js E:/financial-morning-post
 * 检查项：JS 语法 / JSON 合法性 / HTML 标签闭合 / 图表容器与脚本一致 / 行情条快照 /
 *         noindex 与 UTF-8 / 资源 ?v= 全站一致 / 编号引用与文末来源表对得上 /
 *         篇幅（早报必须短）/ 每张表必须有 <thead>（窄屏堆叠靠它生成行标签）。
 * 不通过不许发布。 */
const fs = require("fs");
const path = require("path");
const root = (process.argv[2] || "E:/financial-morning-post").replace(/\\/g, "/");
let fail = 0;
const bad = (m) => { console.log("FAIL  " + m); fail++; };
const ok = (m) => console.log("ok    " + m);

const DIR = "daily";
const dirPath = path.join(root, DIR);
if (!fs.existsSync(dirPath)) { console.log("note   " + DIR + "/ 还不存在（首次运行会创建），本次只检查首页与资产"); }

/* 内容类规则（篇幅、必备小节、必含标的）只对**最新一期**生效：
   历史期数按当期规范写成，规则升级后不该把整站卡住。结构类规则（标签闭合、thead、编号引用、版本号）全站校验。 */
const dailyFiles = fs.existsSync(dirPath) ? fs.readdirSync(dirPath).filter(x => /^\d{4}-\d{2}-\d{2}\.html$/.test(x)).sort() : [];
const newest = dailyFiles.length ? DIR + "/" + dailyFiles[dailyFiles.length - 1] : null;

/* 1. JS 语法 */
for (const f of ["assets/js/ticker.js", "assets/js/chart.js", "assets/fetch_flow.js"]) {
  try {
    let src = fs.readFileSync(path.join(root, f), "utf8");
    if (src.startsWith("#!")) src = src.slice(src.indexOf("\n") + 1);
    new Function(src);
    ok("JS 语法 " + f);
  } catch (e) { bad("JS 语法 " + f + " : " + e.message); }
}

/* 2. JSON */
const dataDir = path.join(root, "data");
if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir).filter(x => x.endsWith(".json"))) {
    try { JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); ok("JSON " + f); }
    catch (e) { bad("JSON " + f + " : " + e.message); }
  }
}

/* 3. HTML */
const versions = new Set();
const htmls = fs.existsSync(dirPath)
  ? ["index.html", ...fs.readdirSync(dirPath).filter(x => x.endsWith(".html")).map(x => DIR + "/" + x)]
  : ["index.html"];

const CJK = (s) => (s.match(/[一-龥]/g) || []).length;

for (const h of htmls) {
  const src = fs.readFileSync(path.join(root, h), "utf8");

  for (const t of ["div", "section", "table", "thead", "tr", "td", "th", "ul", "li", "script", "html", "body", "head"]) {
    const o = (src.match(new RegExp("<" + t + "(\\s|>)", "g")) || []).length;
    const c = (src.match(new RegExp("</" + t + ">", "g")) || []).length;
    if (o !== c) bad(`${h} <${t}> 开 ${o} / 闭 ${c} 不匹配`);
  }
  if (!/noindex/.test(src)) bad(h + " 缺少 robots noindex");
  if (!/charset\s*=\s*"?\s*utf-8/i.test(src)) bad(h + " 缺少 UTF-8 声明");

  /* 表格必须有 <thead>：窄屏堆叠视图靠表头文字生成"列名 → 值"标签，缺了手机上就是光板 */
  const tables = (src.match(/<table(?:\s|>)/g) || []).length;
  const theads = (src.match(/<thead(?:\s|>)/g) || []).length;
  if (h !== "index.html" && tables !== theads) bad(`${h} 表格 ${tables} 张 / <thead> ${theads} 个不匹配（每张表都要有表头）`);

  /* 图表容器与脚本调用一致 */
  const calls = [...src.matchAll(/fw(Bar|Group|Line)\(document\.getElementById\("([^"]+)"\)/g)].map(m => m[2]);
  for (const id of calls) if (!new RegExp('id="' + id + '"').test(src)) bad(h + " 脚本引用了不存在的容器 #" + id);
  if (h !== "index.html" && calls.length > 3) bad(h + ` 图表 ${calls.length} 张——早报最多 3 张，多了就不叫早报`);

  /* 站际互链（2026-11-23 用户要求两站可互相跳转）：每一页的页头都要指向周报 */
  if (!/financial-weekly\/">财经周报/.test(src)) bad(h + " 页头缺少指向财经周报的互链（规范 §3 站际互链）");

  /* 归档卡片篇幅（2026-11-23 用户定口径：标题一句 ≤30 字，摘要四句 ≤200 字） */
  if (h === "index.html") {
    const cards = [...src.matchAll(/<a class="wk" href="daily\/(\d{4}-\d{2}-\d{2})\.html">([\s\S]*?)<\/a>/g)];
    if (!cards.length) bad("index.html 没有解析到任何 .wk 卡片（结构变了要同步改 check.js）");
    for (const c of cards) {
      const title = (c[2].match(/<div class="t">([^<]*)<\/div>/) || [])[1] || "";
      const desc = (c[2].match(/<div class="d">([\s\S]*?)<\/div>/) || [])[1] || "";
      const dt = CJK(title), dd = CJK(desc.replace(/<[^>]+>/g, ""));
      if (!title) bad(`归档卡片 ${c[1]} 没有 .t 标题`);
      else if (dt > 30) bad(`归档卡片 ${c[1]} 标题 ${dt} 字 > 30（标题只写一句主题）`);
      if (dd > 200) bad(`归档卡片 ${c[1]} 摘要 ${dd} 字 > 200（复盘／分析／政策／预测各一句，别把 §00 原文搬进来）`);
      if (dd && dd < 60) bad(`归档卡片 ${c[1]} 摘要只有 ${dd} 字，四句没写全`);
    }
    if (cards.length) ok(`归档卡片 ${cards.length} 张，标题与摘要篇幅合规`);
  }

  /* 行情条快照 */
  const tick = src.match(/window\.FW_TICK\s*=\s*(\[[\s\S]*?\]);/);
  if (tick) {
    try {
      const arr = new Function("return " + tick[1])();
      const noSnap = arr.filter(i => !i.snapshot || i.snapshot.price === undefined);
      if (noSnap.length) bad(h + " 行情条缺快照: " + noSnap.map(i => i.name).join(","));
      else ok(h + " 行情条 " + arr.length + " 项快照完整，图表 " + calls.length + " 张");
    } catch (e) { bad(h + " FW_TICK 解析失败: " + e.message); }
  } else if (/ticker\.js/.test(src)) bad(h + " 引入了 ticker.js 但未定义 FW_TICK");

  /* 资源版本号必须存在且全站一致（Pages 缓存会让修复看起来没生效） */
  const assets = [...src.matchAll(/(?:href|src)="([^"]*assets\/[^"]+)"/g)].map(m => m[1]);
  for (const a of assets) {
    const v = /[?&]v=([^&"]+)/.exec(a);
    if (!v) { bad(h + " 资源引用缺版本号（改过 assets 要递增 ?v=）：" + a); continue; }
    versions.add(v[1]);
  }
  if (!assets.length && h !== "index.html") bad(h + " 没有引用任何 assets 资源");

  /* 页内相对链接必须指向真实文件（daily/ 在子目录，写 href="index.html" 会 404，必须 ../index.html） */
  const links = [...src.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1])
    .filter(u => !/^(https?:|#|mailto:|data:|\/\/)/i.test(u));
  for (const u of links) {
    const clean = u.split("?")[0].split("#")[0];
    if (!clean) continue;
    const target = path.resolve(path.join(root, path.dirname(h)), clean);
    if (!fs.existsSync(target)) bad(`${h} 链接指向不存在的文件：href="${u}"（相对 ${path.dirname(h)}/ 解析不到；子目录页面回根目录要写 ../）`);
  }

  /* 正文里不许出现括号式来源；引用只能是文末编号 */
  const srcIdx = src.indexOf('<section id="src"');
  const body = src.slice(0, srcIdx < 0 ? src.length : srcIdx);
  if (/<source|（来源：|来源：/.test(body)) bad(h + " 正文出现括号式来源，应改为文末编号引用");

  const refs = new Set([...src.matchAll(/<sup>\[(\d+)\]<\/sup>/g)].map(m => +m[1]));
  let n = 0, listed = new Set(), anyList = false;
  for (const m of src.matchAll(/<ol(?:(\s+start="(\d+)"))?>([\s\S]*?)<\/ol>/g)) {
    anyList = true;
    let i = m[2] ? +m[2] : 1;
    for (const li of m[3].matchAll(/<li[\s>]/g)) { listed.add(i); i++; }
    n = i - 1;
  }
  if (refs.size) {
    const missing = [...refs].filter(x => !listed.has(x)).sort((a, b) => a - b);
    if (missing.length) bad(h + " 引用了来源表中不存在的编号: [" + missing.join("],[") + "]");
    else ok(h + " 编号引用 " + refs.size + " 处均可在文末来源表（1—" + n + "）中找到");
  } else if (anyList && srcIdx >= 0) bad(h + " 有来源表但正文没有任何 [n] 编号引用");

  /* 篇幅闸门：早报的立身之本是短。只统计正文（来源节 <section id="src"> 之前）。
     v3（2026-11-06，加主线板块与今日主线预测）：1800—3400；含收盘验证区上限 3900。
     v3.1（2026-11-16，§04 加涨跌停板结构）：1800—3600；含收盘验证区上限 4100。
     v3.2（2026-11-23，加站际互链）：**页头 masthead、行情条与 tickmeta 属站点外壳，不计入正文字数**——
       否则加一个"财经周报"链接就吃掉 4 个字，11-23 那次正是这样被顶到 3604 > 3600。 */
  if (h === newest) {
    const bodyOnly = (srcIdx >= 0 ? src.slice(0, srcIdx) : src)
      .replace(/<header class="masthead">[\s\S]*?<\/header>/g, " ")
      .replace(/<div class="ticker">[\s\S]*?<\/div>\s*<div class="tickmeta">[\s\S]*?<\/div>/g, " ");
    const plain = bodyOnly.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    const chars = CJK(plain);
    const hasClose = /id="s-close"/.test(src);
    const cap = hasClose ? 4100 : 3600;
    if (chars > cap) bad(`${h} 正文 ${chars} 个中文字，超过上限 ${cap}（要删内容，不要缩字号）`);
    else if (chars < 1500) bad(`${h} 正文只有 ${chars} 个中文字，疑似未取到数据就成稿（下限 1500）`);
    else ok(`${h} 正文 ${chars} 字${hasClose ? "（含收盘验证区）" : "（盘前版）"}，符合篇幅 ${cap}`);

    /* 必备小节锚点：复盘 s1；走势推演 2026-11-26 起前移为 s3（此前是 s7） */
    const anchorIds = path.basename(h, ".html") >= "2026-11-26" ? ["s1", "s3"] : ["s1", "s7"];
    for (const id of anchorIds) if (!new RegExp('id="' + id + '"').test(src)) bad(h + ` 缺少必备小节 id="${id}"（01 复盘、${id === "s3" ? "03" : "07"} 今日走势推演）`);
    /* 用户 2026-11-06 新增的两块内容，缺了就是漏写 */
    if (!/主线/.test(src)) bad(h + " 正文缺少主线板块（§05 上一交易日主线四证据、§03 今日主线候选与证伪信号）");
    /* 用户 2026-11-16 新增：§04 涨跌停板结构分析，缺任一块就是漏写。
       只对 2026-11-17（含）之后的期数生效——今天已发布的盘前版是按旧规范写的，
       不能让新闸门把当日 15:30 的收盘验证区卡住。 */
    if (path.basename(h, ".html") >= "2026-11-17") {
      if (!/跌停/.test(src)) bad(h + " 正文缺少跌停侧（规范 §06③：跌停家数、连续跌停家数、跌停行业分布）");
      if (!/连板|梯队/.test(src)) bad(h + " 正文缺少连板梯队（规范 §06②：最高连板与首板/2板/3板及以上分布）");
      if (!/晋级率/.test(src)) bad(h + " 正文缺少晋级率（规范 §06②：当日 2 板及以上 ÷ 上一交易日涨停家数，须给基数与日期）");
      if (!/升温|持平|退潮/.test(src)) bad(h + " 正文缺少情绪三态判断（规范 §06④：只能写 升温/持平/退潮 之一并给依据）");
      if (!/封板率|炸板/.test(src)) bad(h + " 正文缺少封板率或炸板家数（规范 §06①：自算口径要写明，炸板池 getTopicZBPool 已可用）");
      ok(h + " §06 涨跌停板结构五要素齐（广度/纵深/跌停侧/三态判断/封板率口径）");
    }

    /* 用户 2026-11-25 要求内容大改：先给观点与结论，数据只能当支撑；涨跌要红绿可辨。
       只对 2026-11-26（含）之后的期数生效——已发布期数保持原样，可证伪性优先。 */
    if (path.basename(h, ".html") >= "2026-11-26") {
      const NUM = /[+\-−]?\d[\d.,]*/g;
      const secs = [...src.matchAll(/<section id="(s\d)">([\s\S]*?)<\/section>/g)];
      if (secs.length < 10) bad(h + ` 只解析到 ${secs.length} 个 s* 小节，十一节结构不完整`);
      const verdicts = [];
      let dense = 0;
      for (const m of secs) {
        const id = m[1], inner = m[2].replace(/<h2>[\s\S]*?<\/h2>/, "");
        const v = inner.match(/<(p|div|ul)[^>]*class="[^"]*verdict[^"]*"[\s\S]*?(<\/p>|<\/div>|<\/ul>)/);
        if (!v) { bad(`${h} §${id} 没有以 class="verdict" 的结论句开头（规范 §3：先判断后数据）`); continue; }
        const vt = v[0].replace(/<[^>]+>/g, " ");
        const vn = (vt.match(NUM) || []).length;
        if (vn > 2) bad(`${h} §${id} 结论句里有 ${vn} 个数值，超过 2 个——结论要先能读懂，数字挪到后面的支撑段`);
        verdicts.push(vt);
        const noTab = m[2].replace(/<table[\s\S]*?<\/table>/g, " ").replace(/<[^>]+>/g, " ");
        const nn = (noTab.match(NUM) || []).length, nc = CJK(noTab);
        const per100 = nn * 100 / Math.max(1, nc);
        const lim = id === "s0" ? 6 : 10;
        if (per100 > lim) { dense++; bad(`${h} §${id} 每百中文字含 ${per100.toFixed(1)} 个数值，超过上限 ${lim}——把数字搬进表格或删掉，不能整版数据让用户自己分析`); }
      }
      const allV = verdicts.join(" ");
      if (allV && !/涨停集中在/.test(allV)) bad(h + " 结论句没写\"涨停集中在××行业\"（用户 2026-11-25 明确说读不出涨跌停集中于哪个板块）");
      if (allV && !/跌停(集中在|仅|无)/.test(allV)) bad(h + " 结论句没交代跌停集中在哪、或只是零星几家");
      /* 涨跌着色：表格里带符号的百分比/亿元单元格必须有 up/down 类，正文结论句里的涨跌数字要包 b.up/b.down */
      let uncolored = 0;
      for (const td of src.matchAll(/<td([^>]*)>([^<]{1,24})<\/td>/g)) {
        if (!/[+\-−]\d[\d.,]*\s*(?:%|亿|亿元|bp|个基点)/.test(td[2])) continue;
        if (!/\b(up|down)\b/.test(td[1])) uncolored++;
      }
      if (uncolored > 3) bad(h + ` 表格里有 ${uncolored} 个带符号涨跌单元格没加 class="up|down"（红涨绿跌，用户 2026-11-25 要求）`);
      if (!dense) ok(h + " 结论先行：每节 verdict 齐、涨跌停集中度已写明、数值密度与涨跌着色合规");
    }
    if (!/510300|588000|512890|159352|515450|510050|510500|512100|515180|510210/.test(src)) bad(h + " 正文缺少宽基 ETF 锚（规范 §04 要求写 ETF 全称＋代码＋跟踪指数，见 assets/fetch_etf_anchor.js）");
    const mDate = path.basename(h, ".html");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mDate)) bad(h + " 文件名必须是 YYYY-MM-DD.html");
    else if (!src.includes(mDate)) bad(h + ` 页面正文没有出现文件名日期 ${mDate}，日期与内容可能对不上`);
    else ok(h + " 文件名日期与正文一致 " + mDate);

    /* 红利家族与外部信号：用户 2026-11-03 要求新增，缺了就是漏写 */
    for (const [pat, what] of [[/SPCLLHCP|标普红利低波50|标普中国A股大盘红利低波50/, "标普红利低波50"], [/H30269|红利低波/, "中证红利低波"], [/A50/, "富时A50夜盘"]]) {
      if (!pat.test(src)) bad(h + ` 正文缺少${what}（规范 §2/§3 要求每期必含）`);
    }
  }
}
if (versions.size > 1) bad("资源版本号不一致，缓存会出现新旧混用：" + [...versions].join(" / "));
else if (versions.size === 1) ok("全站资源版本号统一为 " + [...versions][0]);
console.log(fail ? `\n${fail} 项需修复` : "\n全部检查通过");
process.exit(fail ? 1 : 0);
