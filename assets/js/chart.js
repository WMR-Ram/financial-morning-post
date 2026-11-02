/* 轻量 SVG 图表：零外部依赖，离线与 file:// 均可渲染，深色主题统一。
 * fwBar(el, cfg)   正负柱状图（周涨跌对比）
 * fwGroup(el, cfg) 多期分组柱（近1周/1月/3月/1年）
 * fwLine(el, cfg)  折线（多序列，带图例）
 *
 * 2026-11-02 第二次移动端修订（用户明确要求：**不许出现滚动条**）：
 *  - 旧版"宽度不够就放大 svg + 容器横向滚动"作废。overflow-x:auto 会连带把 overflow-y 变成 auto，
 *    于是固定 300px 高的 .chart 里冒出一根竖向滚动条（用户截图指出的就是这个）。
 *  - 现在：svg 宽度永远等于容器宽度，容器 overflow:hidden，容器高度由图表自己算。
 *  - 竖排放不下（每个类目带宽 < 阈值）时，**自动改成横向条形图**：类目标签在左侧完整显示，
 *    条形从中线向两侧延伸，数值写在条端。类目再多也只是把图变高，不需要滑动。
 *  - 折线图按容器宽度自动抽稀 x 轴刻度（保证每个刻度有 ~62px），不靠横向滚动硬塞。
 *  - 图例仍在顶部自动换行；注册 resize 重绘。
 *  cfg 可选：minPer、maxBar、axisDigits、suffix、zeroBase、baseline、height、pad、horizontal(true 强制横排)。
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
  function scale(dmin, dmax, rmin, rmax) {
    var span = (dmax - dmin) || 1;
    return function (v) { return rmin + (v - dmin) / span * (rmax - rmin); };
  }
  function nice(a, b) {
    var min = Math.min(a, b), max = Math.max(a, b), pad = (max - min) * 0.12 || 1;
    return [min - pad, max + pad];
  }
  /* 可用宽度：与 host() 用同一套兜底，避免"按 900 判定放得下、实际只有 320"的错判 */
  function availW(el) {
    var cw = Math.floor(el.getBoundingClientRect().width) || el.clientWidth ||
      document.documentElement.clientWidth || 0;
    return cw < 240 ? 320 : cw;
  }
  /* 类目标签宽度：中文按每字约 fs 像素估，留 10px 余量，最少 56 最多 128 */
  function labelW(labels, fs) {
    var mx = 0;
    labels.forEach(function (l) { mx = Math.max(mx, String(l == null ? "" : l).length); });
    return Math.max(56, Math.min(128, Math.round(mx * fs) + 10));
  }

  /* 建画布：宽度永远 = 容器宽度；容器高度按 cfg 或横向布局算出的 h 设定，杜绝任何滚动条 */
  function host(el, cfg, forcedH) {
    var cw = Math.floor(el.getBoundingClientRect().width) || el.clientWidth ||
      document.documentElement.clientWidth || 900;
    if (cw < 240) cw = 320;
    var w = cw;
    var h = forcedH || cfg.height || 300;
    el.innerHTML = "";
    el.style.overflow = "hidden";
    el.style.height = h + "px";
    var svg = s("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h, "font-family": "sans-serif" });
    svg.style.display = "block";   /* 去掉 inline 基线留白，免得容器 scrollHeight 比 svg 高 7px */
    el.appendChild(svg);
    var sib = el.parentNode.querySelector(".chart-hint");
    if (sib) sib.parentNode.removeChild(sib);   /* 不再需要"可左右滑动"提示 */
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

  /* ============ 横向条形（放得下就不滑动的主力布局） ============
   * rows: [{label, bars:[{v,color,name}]}]；从中线向两侧画，数值写在条端。 */
  function hBars(el, cfg, rows) {
    var narrow = availW(el) < 560;
    var fs = narrow ? 10 : 11;
    var rowH = narrow ? 26 : 30;
    var headH = 30, footH = 26;
    var labels = rows.map(function (r) { return r.label; });
    var lw = labelW(labels, fs);
    var gutter = fs * 5.4;                       /* 数值文字留位 */
    var h = rows.length * rowH + headH + footH;
    var c = host(el, cfg, h);
    var P = { l: 6, r: 10, t: headH, b: footH };
    var innerW = Math.max(60, c.w - lw - gutter - 16);
    var maxPos = 0, maxNeg = 0;
    rows.forEach(function (r) { r.bars.forEach(function (b) {
      if (b.v >= 0) maxPos = Math.max(maxPos, b.v); else maxNeg = Math.max(maxNeg, -b.v);
    }); });
    if (cfg.span) { maxPos = Math.max(maxPos, cfg.span[0]); maxNeg = Math.max(maxNeg, cfg.span[1]); }
    var span = (maxPos + maxNeg) || 1;
    var zeroX = lw + (maxNeg / span) * innerW;
    var unit = innerW / span;
    var dg = cfg.digits === undefined ? 2 : cfg.digits;
    var sfx = cfg.suffix || "%";

    /* 中线与刻度 */
    s("line", { x1: zeroX, x2: zeroX, y1: P.t - 8, y2: c.h - footH + 4, stroke: "#3a4763" }, c.svg);
    [-maxNeg, -maxNeg / 2, maxPos / 2, maxPos].forEach(function (gv) {
      var gx = zeroX + gv * unit;
      s("line", { x1: gx, x2: gx, y1: P.t - 8, y2: c.h - footH + 4, stroke: GRID, "stroke-dasharray": "3 4" }, c.svg);
      txt(c.svg, gx, c.h - 8, (gv > 0 ? "+" : "") + gv.toFixed(cfg.axisDigits === undefined ? 1 : cfg.axisDigits) + sfx,
        { "font-size": fs - 1, "text-anchor": "middle" });
    });

    rows.forEach(function (r, i) {
      var top = P.t + i * rowH;
      var mid = top + rowH / 2;
      txt(c.svg, 2, mid + 4, r.label, { "font-size": fs, fill: "#d7dee9", "font-weight": 700 });
      var sn = r.bars.length;
      var bw = Math.max(4, Math.min(cfg.maxBar || 20, (rowH - 6) / sn));
      r.bars.forEach(function (b, k) {
        var y0 = mid - (sn * bw) / 2 + k * bw;
        var len = Math.abs(b.v) * unit;
        var x0 = b.v >= 0 ? zeroX : zeroX - len;
        var rect = s("rect", { x: x0, y: y0 + 1, width: Math.max(1.5, len), height: Math.max(3, bw - 2), fill: b.color, rx: 2, opacity: .92 }, c.svg);
        s("title", {}, rect).textContent = r.label + (b.name ? " · " + b.name : "") + " " + (b.v > 0 ? "+" : "") + b.v.toFixed(dg) + sfx;
        var lx = b.v >= 0 ? x0 + len + 3 : x0 - 3;
        txt(c.svg, lx, y0 + bw / 2 + 3.5, (b.v > 0 ? "+" : "") + b.v.toFixed(dg) + sfx, {
          "font-size": fs - 1, "font-weight": 700, fill: b.color,
          "text-anchor": b.v >= 0 ? "start" : "end"
        });
      });
      if (i) s("line", { x1: 2, x2: c.w - 2, y1: top, y2: top, stroke: "#141b28" }, c.svg);
    });
    return c;
  }

  function fwBar(el, cfg) {
    var n = cfg.values.length;
    var cw = availW(el);
    var band = (cw - 62) / n;
    /* 带宽不够写竖排类目标签（或 cfg.horizontal）→ 改横向条形，绝不滚动 */
    if (cfg.horizontal || band < (cfg.minPer || 46)) {
      return hBars(el, cfg, cfg.labels.map(function (lb, i) {
        return { label: lb, bars: [{ v: cfg.values[i], color: cfg.colors ? cfg.colors[i] : (cfg.values[i] >= 0 ? UP : DOWN) }] };
      }));
    }
    var c = host(el, cfg);
    c.pad.t += legend(c, cfg.series);
    var P = c.pad, innerW = c.w - P.l - P.r, vals = cfg.values;
    var range = cfg.zeroBase === false
      ? nice(Math.min.apply(null, vals), Math.max.apply(null, vals))
      : nice(Math.min(0, Math.min.apply(null, vals)), Math.max(0, Math.max.apply(null, vals)));
    var y = scale(range[0], range[1], c.h - P.b, P.t);
    var zero = y(0), dg = cfg.digits === undefined ? 2 : cfg.digits;
    var band2 = innerW / vals.length;
    if (band2 < 52) P.b = Math.max(P.b, 56);
    for (var g = 0; g <= 4; g++) {
      var gv = range[0] + (range[1] - range[0]) * g / 4, gy = y(gv);
      s("line", { x1: P.l, x2: c.w - P.r, y1: gy, y2: gy, stroke: GRID, "stroke-dasharray": gv === 0 ? "" : "3 4" }, c.svg);
      txt(c.svg, 4, gy + 4, gv.toFixed(cfg.axisDigits === undefined ? 1 : cfg.axisDigits) + (cfg.suffix || ""), { "font-size": c.fs - 1 });
    }
    var bw = Math.min(cfg.maxBar || 46, band2 * 0.62), rotate = band2 < 52;
    vals.forEach(function (v, i) {
      var cx = P.l + band2 * (i + 0.5);
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
    var cw = availW(el);
    var gw = (cw - 62) / cfg.labels.length;
    if (cfg.horizontal || gw < 72) {
      var pal = cfg.series.map(function (sr) { return sr.color; });
      return hBars(el, Object.assign({ maxBar: 12 }, cfg), cfg.labels.map(function (lb, i) {
        return { label: lb, bars: cfg.series.map(function (sr, k) { return { v: sr.values[i], color: pal[k], name: sr.name }; }) };
      }));
    }
    var c = host(el, cfg);
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
    var gw2 = innerW / groups, bw = Math.min(18, (gw2 * 0.74) / sn);
    if (gw2 < 62) P.b = Math.max(P.b, 52);
    cfg.labels.forEach(function (lb, i) {
      var gx = P.l + gw2 * (i + 0.5);
      cfg.series.forEach(function (sr, k) {
        var v = sr.values[i], cx = gx + (k - (sn - 1) / 2) * bw;
        var r = s("rect", { x: cx - bw / 2 + 1, y: v >= 0 ? y(v) : y(0), width: Math.max(3, bw - 2), height: Math.max(1.2, Math.abs(y(v) - y(0))), fill: sr.color, rx: 1.5 }, c.svg);
        s("title", {}, r).textContent = lb + " · " + sr.name + " " + (v > 0 ? "+" : "") + v.toFixed(2) + "%";
      });
      var ly = c.h - P.b + 16;
      var t = txt(c.svg, gx, ly, lb, { "text-anchor": gw2 < 62 ? "end" : "middle", "font-size": c.fs });
      if (gw2 < 62) t.setAttribute("transform", "rotate(-32 " + gx + " " + ly + ")");
    });
    return c;
  }

  function fwLine(el, cfg) {
    var n = cfg.series[0].values.length;
    var c = host(el, cfg);
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
    /* 刻度按容器宽度抽稀：每个刻度至少 62px，末点始终标注——放不下就少标，而不是滚动 */
    var step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 62))));
    (cfg.xLabels || []).forEach(function (lb, i) {
      if (lb === undefined) return;
      if (i % step !== 0 && i !== n - 1) return;
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
