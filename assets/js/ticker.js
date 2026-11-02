/* 财经周报 · 实时行情跑马灯 + 小屏表格兜底
 * 数据三层：1) 页面内置快照（生成时写入，离线/失败兜底）
 *          2) 东方财富 push2 接口（浏览器直连，CORS *）
 *          3) 腾讯 qt.gtimg.cn 接口（GBK 文本，CORS *）作为备源
 * 轮询频率自适应：交易时段高频、非交易时段低频，连续失败自动退避，避免打爆公开接口。
 * 说明：本文件同时负责给每个 <table> 包一层 .tscroll，使历史周报在手机端也能横向滚动。
 */
(function () {
  "use strict";

  var CONF = [];                 /* boot() 时从 window.FW_TICK 读取 */
  var MARKET_HOURS = [           /* 相对活跃的时段（本地时间，含午休缓冲），单位小时 */
    [9, 5], [12, 0],             /* 09:05-12:00 A股 */
    [13, 0], [15, 10],           /* 13:00-15:10 A股 */
    [16, 0], [17, 0],            /* 港股尾市 */
    [21, 15], [24, 0],           /* 美股夜盘（北京时间） */
    [0, 0], [5, 0]               /* 美股跨零点 */
  ];
  var FAST_MS = 8000, SLOW_MS = 90000;
  var box, track, meta, seq = 0, busy = false, fails = 0, timer = null, last = null, rz = null;

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }

  function fmt(v, d) {
    if (v === null || v === undefined || isNaN(v)) return "--";
    var n = Number(v);
    return n >= 10000 ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : n.toFixed(d === undefined ? 2 : d);
  }
  function pct(v) {
    var n = Number(v);
    if (isNaN(n)) return { txt: "--", cls: "flat" };
    return { txt: (n > 0 ? "+" : "") + n.toFixed(2) + "%", cls: n > 0.005 ? "up" : n < -0.005 ? "down" : "flat" };
  }
  function inMarketWindow() {
    var d = new Date(), h = d.getHours() + d.getMinutes() / 60, wk = d.getDay();
    if (wk === 0 || wk === 6) { return h >= 21.25 || h < 5; }   /* 周末只有美股时段 */
    for (var i = 0; i < MARKET_HOURS.length; i += 2) {
      var a = MARKET_HOURS[i][0] + MARKET_HOURS[i][1] / 60, b = MARKET_HOURS[i + 1][0] + MARKET_HOURS[i + 1][1] / 60;
      if (h >= a && h <= b) return true;
    }
    return false;
  }

  /* ---------- 东方财富 ---------- */
  var emHosts = ["https://push2.eastmoney.com", "https://push2delay.eastmoney.com"];
  function fromEastmoney(secids) {
    var host = emHosts[(seq++) % emHosts.length];
    var url = host + "/api/qt/ulist.np/get?fltt=2&invt=2&secids=" + encodeURIComponent(secids.join(",")) +
      "&fields=f2,f3,f12,f14,f124&_=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("em " + r.status);
      return r.json();
    }).then(function (j) {
      var out = {};
      ((j && j.data && j.data.diff) || []).forEach(function (d) {
        if (typeof d.f2 === "string") return;                 /* 停牌/无数据返回 '-' */
        out[d.f12] = { price: Number(d.f2), pct: Number(d.f3) };
      });
      return out;
    });
  }

  /* ---------- 腾讯（GBK） ---------- */
  function fromTencent(codes) {
    var url = "https://qt.gtimg.cn/q=" + codes.join(",") + "&_=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("tc " + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      var txt;
      try { txt = new TextDecoder("gbk").decode(buf); }
      catch (e) { txt = new TextDecoder("utf-8").decode(buf); }
      var out = {};
      txt.split(";").forEach(function (line) {
        var m = line.match(/v_([a-zA-Z0-9]+)="([^"]*)"/);
        if (!m) return;
        var f = m[2].split("~");
        if (f.length < 33) return;
        var p = parseFloat(f[3]), prev = parseFloat(f[4]);
        if (isNaN(p) || !isFinite(p) || isNaN(prev) || prev === 0) return;
        var pc = f[32] !== undefined ? parseFloat(f[32]) : (p / prev - 1) * 100;
        out[m[1].replace(/^(sh|sz|hk|us)/, "")] = { price: p, pct: isNaN(pc) ? (p / prev - 1) * 100 : pc };
      });
      return out;
    });
  }

  /* ---------- 渲染：跑马灯需要两组相同内容才能无缝循环 ---------- */
  function group(aria) {
    var g = el("div", "grp");
    if (aria) g.setAttribute("aria-hidden", "true");
    CONF.forEach(function (item) {
      var d = item._live || item.snapshot || {};
      var p = pct(d.pct);
      var q = el("div", "q");
      q.appendChild(el("span", "n", item.name));
      q.appendChild(el("span", "v", fmt(d.price, item.dec)));
      q.appendChild(el("span", "c " + p.cls, " " + p.txt));
      q.appendChild(el("span", "mode" + (item._live ? " live" : ""), item._live ? "实时" : "快照"));
      g.appendChild(q);
    });
    return g;
  }
  function render() {
    if (!track) return;
    track.innerHTML = "";
    track.appendChild(group(false));
    track.appendChild(group(true));
    /* 滚动时长随内容宽度自适应，保持速度大致恒定（约 46px/s）；
       页面隐藏时 rAF 不触发，所以先同步测宽，测不到再交给 rAF 兜一次。 */
    function setDur() {
      var w = track.scrollWidth / 2;
      if (!w) return false;
      track.style.setProperty("--dur", Math.max(28, Math.round(w / 46)) + "s");
      return true;
    }
    if (!setDur()) requestAnimationFrame(setDur);
    if (meta) {
      var live = CONF.filter(function (i) { return i._live; }).length;
      meta.textContent = "共 " + CONF.length + " 条 · 实时 " + live + " 条 · " +
        (last ? "更新于 " + last : "尚未取得实时数据") +
        (fails ? " · 接口连续失败 " + fails + " 次，已降频重试" : "") +
        " · 悬停/点击可暂停";
    }
  }

  function apply(maps) {
    var any = false;
    CONF.forEach(function (item) {
      var keyEm = item.em && String(item.em).split(".")[1];
      var keyTc = item.tc && item.tc.replace(/^(sh|sz|hk|us)/, "");
      var got = (maps.em && keyEm && maps.em[keyEm]) || (maps.tc && keyTc && maps.tc[keyTc]);
      if (got && !isNaN(got.price)) { item._live = { price: got.price, pct: got.pct }; any = true; }
      else { item._live = null; }
    });
    render();
    return any;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    var base = inMarketWindow() ? FAST_MS : SLOW_MS;
    var wait = base * Math.pow(2, Math.min(fails, 3));   /* 失败退避，最多 8 倍 */
    timer = setTimeout(tick, wait);
  }

  function tick() {
    if (busy || !CONF.length) { schedule(); return; }
    if (document.hidden && last) { schedule(); return; }   /* 后台标签不轮询，但首帧仍取一次 */
    busy = true;
    var emIds = CONF.map(function (i) { return i.em; }).filter(Boolean);
    var tcIds = CONF.map(function (i) { return i.tc; }).filter(Boolean);
    var jobs = [];
    if (emIds.length) jobs.push(fromEastmoney(emIds).then(function (m) { return { em: m }; }, function () { return {}; }));
    if (tcIds.length) jobs.push(fromTencent(tcIds).then(function (m) { return { tc: m }; }, function () { return {}; }));
    Promise.all(jobs).then(function (res) {
      var merged = {};
      res.forEach(function (r) { if (r.em) merged.em = r.em; if (r.tc) merged.tc = r.tc; });
      var ok = apply(merged);
      fails = ok ? 0 : fails + 1;
      if (ok) last = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      render();
    }).catch(function () { fails++; render(); })
      .then(function () { busy = false; schedule(); });
  }

  /* ---------- 表格移动端预处理：≥3 列标记为可堆叠，1—2 列保持原样 ----------
     旧版只做了"包一层横滑 + min-width:620px"，结果连两列表也被撑破卡片布局。
     现在改为：给每列的单元格写 data-label（堆叠视图里当字段名），列数≥3 的表标记 data-stack=1，
     具体是否堆叠由 CSS 媒体查询决定（见 theme.css）。 */
  function prepTables() {
    [].forEach.call(document.querySelectorAll(".wrap table"), function (t) {
      if (!t.parentNode.classList.contains("tscroll")) {
        var w = el("div", "tscroll");
        t.parentNode.insertBefore(w, t);
        w.appendChild(t);
      }
      var box = t.parentNode;
      var head = t.querySelectorAll("thead th");
      var cols = head.length || (t.rows[0] ? t.rows[0].cells.length : 0);
      if (head.length) {
        var labels = [].map.call(head, function (h) { return h.textContent.trim(); });
        [].forEach.call(t.rows, function (r) {
          if (r.parentNode.tagName === "THEAD") return;
          [].forEach.call(r.cells, function (td, i) {
            if (labels[i] && !td.getAttribute("data-label")) td.setAttribute("data-label", labels[i]);
          });
        });
      }
      t.setAttribute("data-cols", cols);
      if (cols >= 3) t.setAttribute("data-stack", "1"); else t.removeAttribute("data-stack");
      /* 仍然放不下且不会堆叠时，才开启横向滚动 */
      var needs = t.getAttribute("data-stack") !== "1" && t.scrollWidth > box.clientWidth + 4;
      box.setAttribute("data-scroll", needs ? "1" : "0");
    });
  }

  function boot() {
    box = document.querySelector(".ticker");
    track = document.getElementById("ticker-strip");
    meta = document.getElementById("ticker-meta");
    prepTables();
    window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(prepTables, 250); });
    if (!track) return;
    CONF = window.FW_TICK || [];
    if (!CONF.length) { if (box) box.style.display = "none"; return; }
    track.classList.add("track");
    render();
    if (box) {
      box.addEventListener("click", function () { box.classList.toggle("paused"); });
      box.addEventListener("touchstart", function () { box.classList.add("paused"); }, { passive: true });
    }
    tick();
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
    window.addEventListener("resize", function () { render(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
