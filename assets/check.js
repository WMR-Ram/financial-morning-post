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
     v2（2026-11-03）：1500—3000；含 15:30 收盘验证区时上限 3500。 */
  if (h === newest) {
    const bodyOnly = srcIdx >= 0 ? src.slice(0, srcIdx) : src;
    const plain = bodyOnly.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    const chars = CJK(plain);
    const hasClose = /id="s-close"/.test(src);
    const cap = hasClose ? 3500 : 3000;
    if (chars > cap) bad(`${h} 正文 ${chars} 个中文字，超过上限 ${cap}（要删内容，不要缩字号）`);
    else if (chars < 1200) bad(`${h} 正文只有 ${chars} 个中文字，疑似未取到数据就成稿（下限 1200）`);
    else ok(`${h} 正文 ${chars} 字${hasClose ? "（含收盘验证区）" : "（盘前版）"}，符合篇幅 ${cap}`);

    /* 必备小节锚点：复盘 s1、走势推演 s7 */
    for (const id of ["s1", "s7"]) if (!new RegExp('id="' + id + '"').test(src)) bad(h + ` 缺少必备小节 id="${id}"（01 复盘、07 今日走势推演）`);
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
