# 财经早报（financial-morning-post）

每个 A 股交易日自动生成两期的中文财经早报，静态页面部署在 GitHub Pages。
盘前版复盘上一交易日并给当日情景推演，收盘版在同一页追加验证区——盘前写下的判断可以被逐条对账。

- 线上地址：<https://wmr-ram.github.io/financial-morning-post/>
- 生成方式：Qoder 定时任务，无人工干预；作者维护的是[规范文件](./MORNING_SPEC.md)，页面由任务按规范产出
- 内容含与个人持仓相关指数的提示，仅作个人研究记录，**不构成投资建议**

## 更新时间

| 期次 | cron（Asia/Shanghai） | 做什么 |
|---|---|---|
| 盘前版 | `20 9 * * 1-5` | 整页生成 `daily/<当日>.html` 并重建归档首页 |
| 收盘验证版 | `30 15 * * 1-5` | 只在当日页尾部插入 `<section id="s-close">`，把归档状态改成"已收盘验证" |

盘前定在 09:20 而不是 09:00，是为了拿到央行当日公开市场操作公告（通常 09:15 之后发布）。
收盘版**不允许改写盘前正文**——这是为了让推演可证伪，出错就在验证区公开更正。
周末、法定节假日（按上交所休市表）不生成、不提交。

## 页面结构

固定 11 节，顺序不随行情变化：

```
00 今日三条          ≤3 条判断，每条指向下文对应小节
01 上一交易日复盘    收盘表 + 归因链（逐环标注"有数据/推定/未取证"）
02 资金与筹码        成交额、两融、宽基 ETF 资金探针、涨跌分布
03 主线板块与板块速写 主线四证据（涨幅/主力净额/涨停行业集中度/成交额占比）+ 科技、红利、创新药速写
04 题材与情绪        涨停跌停家数与连板高度，只到题材与家数
05 隔夜海外与外部信号 美股、费城半导体 SOX、KOSPI/日经、A50 夜盘、美债
06 政策与信息面      隔夜至盘前新增政策与已公布数据
07 今日走势推演      乐观/基准/悲观三情景 + 触发条件与证伪信号 + 点位区间表
08 持仓关联提示      每个标的 1—3 句，不给操作指令
09 机构观点一句话
数据来源与免责       编号来源 + 待核清单
+ 收盘验证区          （仅 15:30 之后存在）
```

正文中文字数 1800—3400，含验证区时上限 3900；图表 ≤3 张。超了就删内容，不缩字号。

## 目录

```
index.html                 归档首页，每次运行扫描 daily/ 整体重建
daily/<YYYY-MM-DD>.html    当日页（文件名用发布日）
data/<YYYY-MM-DD>.json     当日结构化快照
MORNING_SPEC.md            唯一权威规范：口径、板块、数据源、硬约束都改这里
assets/css/theme.css       深色金融终端风（涨红跌绿）
assets/js/ticker.js        顶部行情条，自适应轮询
assets/js/chart.js         零依赖内联 SVG 图表，窄屏自动改横向条形
assets/fetch_flow.js       板块/指数逐日资金流取数
assets/fetch_etf_anchor.js 各宽基指数锚 ETF 的规模与跟踪指数
assets/check.js            发布前自检，不通过不发布
```

`MORNING_SPEC.md` 与定时任务提示词的关系是：提示词只把运行指回规范，规范改了就生效；调口径、换数据源、改篇幅都改规范文件。

## 数据源

`today_investment_financial_data` MCP 于 2026-11-02 起资源包失效（连接在，返回 `40001 您无可用的资源包`），
现在全部走公开接口，每个接口的字段口径与已知陷阱都写在 `MORNING_SPEC.md` §2 的表里：

- 指数与板块日线、逐日资金流：`push2his.eastmoney.com`
- 涨停/跌停池：`push2ex.eastmoney.com`（`date` 参数被忽略，只返回最近一个交易日）
- 两融：`datacenter-web.eastmoney.com`（`RPTA_RZRQ_LSHJ`，披露滞后 1—2 个交易日）
- SHIBOR：中国货币网；美债收益率：美国财政部 CSV
- 基金净值与持仓：`fund.eastmoney.com/pingzhongdata`
- ETF 规模与跟踪指数：`fundmobapi.eastmoney.com`（期末净资产口径，非实时）
- 指数估值分位：蛋卷 `djapi`（分位窗口不等于中证五年分位，引用必须写口径）
- 境外指数：腾讯 `qt.gtimg.cn`（注意东财 `100.NDX` 是纳指综合，不是纳指 100）
- 富时中国 A50 期指：新浪 `hq.sinajs.cn`（无 CORS，只能生成时抓取）
- 政策、新闻、机构观点：WebSearch / WebFetch，至少 3 组关键词交叉

取不到的数标 ⚠️ 并进待核清单，不用模型记忆补，也不编造 URL。

## 本地跑一遍

```bash
cd E:/financial-morning-post
node assets/fetch_flow.js 2026-11-01 2026-11-11 90.BK0917   # 资金流取数示例
node assets/fetch_etf_anchor.js                             # 锚 ETF 规模
node assets/check.js E:/financial-morning-post              # 全站自检，FAIL 就不该发布
```

`check.js` 卡的是结构全站（标签闭合、每表有 `<thead>`、编号引用能对上来源表、资源 `?v=` 版本号一致），
内容规则（篇幅、必备小节、锚 ETF 代码、`主线` 措辞、相对链接文件是否真的存在）只卡最新一期。

## 已知设计取舍

- 图表不出滚动条：`chart.js` 让 SVG 宽度等于容器宽度、高度由图表自算，类目挤了就自动换横向条形图。
  旧的 `overflow-x:auto` 方案会连带把 `overflow-y` 变成 auto，手机上必须上下滑才看得全。
- `daily/` 里所有回站点根的链接必须写 `../`，写成 `index.html` 会解析成 `daily/index.html` 直接 404（2026-11-04 实测踩过，现在 `check.js` 会拦）。
- 每页带 `<meta name="robots" content="noindex,nofollow">`，因为页面含持仓信息；仓库是公开的，git 历史删不干净，链接别外传。
- 改过 `assets/` 下任何文件，全站 `?v=` 必须递增一位且各页一致，否则浏览器缓存会让修复看起来没生效。
- 部署时 `github.com:443` 偶发连接被重置。失败重试 3 次后改用 GitHub Data API 直接提交（`api.github.com` 通常可用），流程记在规范 §4。**不靠关掉证书校验绕过。**
- 本 README 不参与站点渲染，Pages 用的是根目录 `index.html`。

## 姊妹站

[财经周报 · financial-weekly](https://github.com/WMR-Ram/financial-weekly) —— 每周一 09:00，
做国家队资金线索复核、逐行业展开、指数估值五年分位等深度内容。早报不重复这些，两者互相独立。
