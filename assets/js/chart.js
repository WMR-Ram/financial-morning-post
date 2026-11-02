/* 轻量 SVG 图表：零外部依赖，离线与 file:// 均可渲染，深色主题统一。
 * fwBar(el, cfg)   正负柱状图（周涨跌对比）
 * fwGroup(el, cfg) 多期分组柱（近1周/1月/3月/1年）
 * fwLine(el, cfg)  折线（多序列，带图例）
 *
 * 移动端修订（2026-11-02）：
 *  - 图例改为顶部自动换行。旧版按名字长度横向累加，窄屏必然溢出画布外——这就是"图例显示异常"的根因。
 *  - 折线图不再在右端贴序列名（会被裁掉），统一用顶部图例，末端只留短名。
 *  - 内容宽度不足时按最小可读宽度渲染，容器 .chart 转为横向滚动，不靠缩字号硬塞。
 *  - 注册 resize 重绘：横屏、窗口缩放、手机地址栏收起后按新宽度重画。
 *  cfg 可选：minPer（每柱最小像素）、maxBar、axisDigits、suffix、zeroBase、baseline。
 */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var UP = "#ef4d4d", DOWN = "#17b877", GRID = "#232c3d", TXT = "#8b98ad";
  var registry = [];

  function s(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(parent, x, y, str, attrs) {
    var t = s("text", Object.assign({ x: x, y: y, fill: TXT, "font-size": 11, "font-family": "Consolas, monospace" }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }
  function minWidth(n, per) { return Math.max(340, (n + 1) * per); }

  function host(el, cfg, minW) {
    var cw = Math.ceil(el.getBoundingClientRect().width) || el.clientWidth || document.documentElement.clientWidth || 900;
    var w = Math.max(cw, minW || 0);
    var h = cfg.height || 300;
    el.innerHTML = "";
    el.style.overflowX = w > cw + 2 ? "auto" : "hidden";
    el.style.webkitOverflowScrolling = "touch";
    var svg = s("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h, "font-family": "sans-serif" });
    el.appendChild(svg);
    /* 需要横向滚动时给一个提示，免得用户以为图被截断了 */
    var sib = el.parentNode.querySelector(".chart-hint");
    if (w > cw + 2) {
      if (!sib) {
        sib = document.createElement("div");
        sib.className = "chart-hint";
        sib.textContent = "← 图表可左右滑动 →";
        el.parentNode.insertBefore(sib, el.nextSibling);
      }
    } else if (sib) { sib.parentNode.removeChild(sib); }
    return {
      svg: svg, w: w, h: h, narrow: w < 560,
      pad: Object.assign({ t: 18, r: 16, b: 42, l: 46 }, cfg.pad || {}),
      fs: w < 560 ? 10 : 11
    };
  }

  /* 顶部图例，自动换行；返回占用的额外高度 */
  function legend(c, series) {
    if (!series || series.length < 2) return 0;
    var x = c.pad.l, y = 13, rowH = 15, max = c.w - c.pad.r, rows = 0;
    series.forEach(function (sr) {
      var tw = sr.name.length * (c.narrow ? 10.5 : 12) + 20;
      if (x + tw > max && x > c.pad.l) { x = c.pad.l; y += rowH; rows++; }
      s("rect", { x: x, y: y - 8, width: 9, height: 9, fill: sr.color, rx: 2 }, c.svg);
      txt(c.svg, x + 13, y, sr.name, { fill: "#d7dee9", "font-size": c.fs });
      x += tw;
    });
    return rows * rowH + 12;
  }

  function scale(dmin, dmax, rmin, rmax) {
    var span = (dmax - dmin) || 1;
    return function (v) { return rmin + (v - dmin) / span * (rmax - rmin); };
  }
  function nice(a, b) {
    var min = Math.min(a, b), max = Math.max(a, b), pad = (max - min) * 0.12 || 1;
    return [min - pad, max + pad];
  }

  function fwBar(el, cfg) {
    var c = host(el, cfg, minWidth(cfg.values.length, cfg.minPer || 34));
    c.pad.t += legend(c, cfg.series);
    var P = c.pad, innerW = c.w - P.l - P.r, vals = cfg.values;
    var range = cfg.zeroBase === false
      ? nice(Math.min.apply(null, vals), Math.max.apply(null, vals))
      : nice(Math.min(0, Math.min.apply(null, vals)), Math.max(0, Math.max.apply(null, vals)));
    var y = scale(range[0], range[1], c.h - P.b, P.t);
    var zero = y(0), dg = cfg.digits === undefined ? 2 : cfg.digits;
    var band = innerW / vals.length;
    if (band < 52) P.b = Math.max(P.b, 54);
    for (var g = 0; g <= 4; g++) {
      var gv = range[0] + (range[1] - range[0]) * g / 4, gy = y(gv);
      s("line", { x1: P.l, x2: c.w - P.r, y1: gy, y2: gy, stroke: GRID, "stroke-dasharray": gv === 0 ? "" : "3 4" }, c.svg);
      txt(c.svg, 4, gy + 4, gv.toFixed(cfg.axisDigits === undefined ? 1 : cfg.axisDigits) + (cfg.suffix || ""), { "font-size": c.fs - 1 });
    }
    var bw = Math.min(cfg.maxBar || 46, band * 0.62), rotate = band < 52;
    vals.forEach(function (v, i) {
      var cx = P.l + band * (i + 0.5);
      var top = v >= 0 ? y(v) : zero, hgt = Math.abs(y(v) - zero);
      var col = cfg.colors ? cfg.colors[i] : (v >= 0 ? UP : DOWN);
      var bar = s("rect", { x: cx - bw / 2, y: top, width: bw, height: Math.max(1.5, hgt), fill: col, rx: 2, opacity: .9 }, c.svg);
      s("title", {}, bar).textContent = cfg.labels[i] + " " + (v > 0 ? "+" : "") + v.toFixed(dg) + (cfg.suffix || "%");
      txt(c.svg, cx, v >= 0 ? top - 4 : top + hgt + 12, (v > 0 ? "+" : "") + v.toFixed(dg) + (cfg.suffix || ""),
        { fill: col, "font-size": c.fs, "text-anchor": "middle", "font-weight": 700 });
      var ly = c.h - P.b + 16;
      var lb = txt(c.svg, cx, ly, cfg.labels[i], { "text-anchor": rotate ? "end" : "middle", "font-size": c.fs });
      if (rotate) lb.setAttribute("transform", "rotate(-36 " + cx + " " + ly + ")");
    });
    return c;
  }

  function fwGroup(el, cfg) {
    var c = host(el, cfg, minWidth(cfg.labels.length, 76));
    c.pad.t += legend(c, cfg.series);
    var P = c.pad, innerW = c.w - P.l - P.r, all = [];
    cfg.series.forEach(function (sr) { sr.values.forEach(function (v) { all.push(v); }); });
    var range = nice(Math.min(0, Math.min.apply(null, all)), Math.max(0, Math.max.apply(null, all)));
    var y = scale(range[0], range[1], c.h - P.b, P.t);
    for (var g = 0; g <= 4; g++) {
      var gv = range[0] + (range[1] - range[0]) * g / 4, gy = y(gv);
      s("line", { x1: P.l, x2: c.w - P.r, y1: gy, y2: gy, stroke: GRID, "stroke-dasharray": gv === 0 ? "" : "3 4" }, c.svg);
      txt(c.svg, 4, gy + 4, gv.toFixed(0) + "%", { "font-size": c.fs - 1 });
    }
    var groups = cfg.labels.length, sn = cfg.series.length;
    var gw = innerW / groups, bw = Math.min(18, (gw * 0.74) / sn);
    if (gw < 62) P.b = Math.max(P.b, 52);
    cfg.labels.forEach(function (lb, i) {
      var gx = P.l + gw * (i + 0.5);
      cfg.series.forEach(function (sr, k) {
        var v = sr.values[i], cx = gx + (k - (sn - 1) / 2) * bw;
        var r = s("rect", { x: cx - bw / 2 + 1, y: v >= 0 ? y(v) : y(0), width: Math.max(3, bw - 2), height: Math.max(1.2, Math.abs(y(v) - y(0))), fill: sr.color, rx: 1.5 }, c.svg);
        s("title", {}, r).textContent = lb + " · " + sr.name + " " + (v > 0 ? "+" : "") + v.toFixed(2) + "%";
      });
      var ly = c.h - P.b + 16;
      var t = txt(c.svg, gx, ly, lb, { "text-anchor": gw < 62 ? "end" : "middle", "font-size": c.fs });
      if (gw < 62) t.setAttribute("transform", "rotate(-32 " + gx + " " + ly + ")");
    });
    return c;
  }

  function fwLine(el, cfg) {
    var n = cfg.series[0].values.length;
    var c = host(el, cfg, minWidth(n, 56));
    c.pad = Object.assign({ t: 20, r: 20, b: 34, l: 46 }, cfg.pad || {});
    c.pad.t += legend(c, cfg.series);
    var P = c.pad, innerW = c.w - P.l - P.r, all = [];
    cfg.series.forEach(function (sr) { sr.values.forEach(function (v) { all.push(v); }); });
    var range = nice(Math.min.apply(null, all), Math.max.apply(null, all));
    var y = scale(range[0], range[1], c.h - P.b, P.t);
    var x = scale(0, Math.max(1, n - 1), P.l, P.l + innerW);
    for (var g = 0; g <= 4; g++) {
      var gv = range[0] + (range[1] - range[0]) * g / 4, gy = y(gv);
      s("line", { x1: P.l, x2: c.w - P.r, y1: gy, y2: gy, stroke: GRID, "stroke-dasharray": "3 4" }, c.svg);
      txt(c.svg, 4, gy + 4, gv.toFixed(cfg.digits === undefined ? 1 : cfg.digits), { "font-size": c.fs - 1 });
    }
    (cfg.xLabels || []).forEach(function (lb, i) {
      if (lb === undefined) return;
      txt(c.svg, x(i), c.h - P.b + 16, c.narrow && String(lb).length > 7 ? String(lb).slice(-5) : lb, { "text-anchor": "middle", "font-size": c.fs - 1 });
    });
    if (cfg.baseline !== undefined) {
      var by = y(cfg.baseline);
      s("line", { x1: P.l, x2: c.w - P.r, y1: by, y2: by, stroke: TXT, "stroke-dasharray": "5 3" }, c.svg);
      txt(c.svg, P.l + 3, by - 5, "基准 " + cfg.baseline, { "font-size": c.fs - 1 });
    }
    cfg.series.forEach(function (sr) {
      var d = sr.values.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
      s("path", { d: d, fill: "none", stroke: sr.color, "stroke-width": sr.width || 2, "stroke-linejoin": "round" }, c.svg);
      sr.values.forEach(function (v, i) {
        var dot = s("circle", { cx: x(i), cy: y(v), r: c.narrow ? 3 : 2.6, fill: sr.color }, c.svg);
        s("title", {}, dot).textContent = sr.name + " " + ((cfg.xLabels || [])[i] || "") + " " + v.toFixed(cfg.digits === undefined ? 1 : cfg.digits);
      });
      txt(c.svg, x(n - 1) + 4, y(sr.values[n - 1]) + 3, sr.name.slice(0, c.narrow ? 4 : 8),
        { fill: sr.color, "font-size": c.fs - 1, "font-weight": 700 });
    });
    return c;
  }

  function wrap(name, fn) {
    window[name] = function (el, cfg) {
      if (!el) return null;
      registry = registry.filter(function (r) { return r.el !== el; }).concat([{ el: el, cfg: cfg, fn: fn }]);
      try { return fn(el, cfg); }
      catch (e) { el.innerHTML = '<p class="chart-note">图表渲染失败：' + e.message + "</p>"; return null; }
    };
  }
  wrap("fwBar", fwBar); wrap("fwGroup", fwGroup); wrap("fwLine", fwLine);

  var t;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(function () {
      registry.forEach(function (r) { try { r.fn(r.el, r.cfg); } catch (e) {} });
    }, 240);
  });
})();
