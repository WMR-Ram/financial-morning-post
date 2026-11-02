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

  /* 篇幅闸门：早报的立身之本是短。中文正文（去标签、去脚本样式）1200—2600 字。 */
  if (h !== "index.html") {
    const plain = src.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    const chars = CJK(plain);
    if (chars > 2600) bad(`${h} 正文 ${chars} 个中文字，超过早报上限 2600（要删内容，不要缩字号）`);
    else if (chars < 700) bad(`${h} 正文只有 ${chars} 个中文字，疑似未取到数据就成稿`);
    else ok(`${h} 正文 ${chars} 字，符合早报篇幅`);

    /* 每日页必须有"上一交易日复盘"和"今日推演"两块的锚点 */
    for (const id of ["s1", "s6"]) if (!new RegExp('id="' + id + '"').test(src)) bad(h + ` 缺少必备小节 id="${id}"（复盘在今日 01 节、走势推演在 06 节）`);
    const mDate = path.basename(h, ".html");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mDate)) bad(h + " 文件名必须是 YYYY-MM-DD.html（上一交易日/发布日按规范 §1）");
    else if (!src.includes(mDate)) bad(h + ` 页面正文没有出现文件名日期 ${mDate}，日期与内容可能对不上`);
    else ok(h + " 文件名日期与正文一致 " + mDate);
  }
}
if (versions.size > 1) bad("资源版本号不一致，缓存会出现新旧混用：" + [...versions].join(" / "));
else if (versions.size === 1) ok("全站资源版本号统一为 " + [...versions][0]);
console.log(fail ? `\n${fail} 项需修复` : "\n全部检查通过");
process.exit(fail ? 1 : 0);
