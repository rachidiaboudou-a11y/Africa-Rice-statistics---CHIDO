/* Rice Statistics for Africa -- scientific visualization.
 *
 * Hand-rolled SVG. No chart library, which keeps the bundle self-contained and,
 * more importantly, keeps full control over the one thing that matters most here:
 * OBSERVED, FORECAST and SCENARIO values must never look alike. Solid line for
 * what was measured, dashed for what a model projected, dotted for what a policy
 * assumption produced, and a shaded band wherever an interval exists. A reader
 * who glances at a chart and cannot tell data from projection has been misled,
 * however careful the caption.
 *
 * The Africa map is a SCHEMATIC TILE CARTOGRAM, not a geographic projection.
 * Each country is one equal-sized tile placed in roughly its relative position.
 * That is a deliberate choice: it gives every country the same visual weight
 * regardless of land area (Seychelles is as legible as Algeria), it needs no
 * boundary file, and it takes no position on contested borders. It is labelled
 * as schematic everywhere it appears.
 */

const RSAFigs = (function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  /* Localised string with an English fallback baked in, so this module still
   * renders correctly if it is ever used without the i18n module loaded. */
  const FALLBACK = {
    'fig.desc.line': 'Line chart, {0} to {1}.',
    'fig.desc.bar': 'Bar chart of {0} items, from {1} at {2} to {3} at {4}',
    'fig.desc.fromTo': ' from {0} to {1}',
    'fig.desc.noData': ': no data'
  };
  function L(key) {
    if (typeof RSAi18n !== 'undefined' && RSAi18n.has(key)) return RSAi18n.t(key);
    return FALLBACK[key] || key;
  }

  /* Sequential ramp, light to dark. The direction matters: readers take darker
   * to mean "more", so the ramp must run light at the low end. An earlier
   * version had this reversed, which made the least self-sufficient countries
   * the darkest on the map -- the opposite of what anyone glancing at it would
   * conclude. */
  const RAMP = ['#e8f5ed', '#b9e0c6', '#7cc39b', '#3f9e75', '#1f7a5c', '#145841', '#0d3b2e'];
  const DIVERGING = ['#7a2e22', '#b5563d', '#d99178', '#e8e0d4', '#8fbfa4', '#3f9e75', '#1f7a5c'];

  /* Relative luminance, used to pick a legible label colour on top of whatever
   * fill a tile ends up with. */
  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function inkOn(hex) { return luminance(hex) > 0.42 ? '#0b1a14' : '#eaf5ef'; }

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }

  /* Capped at its natural width. Letting an SVG stretch to 100% of a wider
   * container scales the text with it, which is how a 10px axis label ends up
   * rendering at 18px and a chart title dominates the page. */
  function svg(width, height, cls) {
    const s = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: '100%', preserveAspectRatio: 'xMidYMid meet',
      style: 'max-width:' + width + 'px; height:auto; display:block',
      class: cls || 'rsa-fig', role: 'img'
    });
    return s;
  }

  /* ------------------------------------------------------------- scaling */

  function extent(arrays) {
    let lo = Infinity, hi = -Infinity;
    arrays.forEach(a => a.forEach(v => {
      if (v == null || !isFinite(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }));
    if (!isFinite(lo)) return [0, 1];
    if (lo === hi) return [lo - Math.abs(lo || 1) * 0.1, hi + Math.abs(hi || 1) * 0.1];
    return [lo, hi];
  }

  function niceTicks(lo, hi, n) {
    n = n || 5;
    const span = hi - lo;
    if (span <= 0) return [lo];
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const start = Math.ceil(lo / step) * step;
    const out = [];
    for (let v = start; v <= hi + step * 0.001; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  function fmtNum(v, unit) {
    if (v == null || !isFinite(v)) return '';
    const a = Math.abs(v);
    if (unit === 't' || unit === 'ha') {
      if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(0) + 'k';
      return v.toFixed(0);
    }
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  /* =========================================================== time series
   *
   * spec = {
   *   title, subtitle, unit, yLabel,
   *   series: [{ label, years, values, kind:'observed'|'forecast'|'scenario',
   *              colour, bands:[{lower,upper,label,opacity}] }],
   *   markers: [{ year, label }],
   *   reference: [{ value, label }]
   * }
   */
  function timeSeries(spec, opts) {
    opts = opts || {};
    const W = opts.width || 860, H = opts.height || 400;
    const m = { top: 34, right: 118, bottom: 44, left: 68 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const s = svg(W, H);

    const allYears = [], allVals = [];
    spec.series.forEach(ser => {
      ser.years.forEach((y, i) => { if (ser.values[i] != null) allYears.push(y); });
      allVals.push(ser.values);
      (ser.bands || []).forEach(b => { allVals.push(b.lower); allVals.push(b.upper); });
    });
    (spec.reference || []).forEach(r => allVals.push([r.value]));
    if (!allYears.length) return emptyFig(W, H, spec.title, 'no observations to plot');

    const x0 = Math.min.apply(null, allYears), x1 = Math.max.apply(null, allYears);
    let [y0, y1] = extent(allVals);
    if (opts.zeroBase && y0 > 0) y0 = 0;

    const X = y => m.left + (y - x0) / Math.max(1, x1 - x0) * iw;
    const Y = v => m.top + ih - (v - y0) / Math.max(1e-12, y1 - y0) * ih;

    // grid + axes
    const g = el('g', {}, s);
    niceTicks(y0, y1, 5).forEach(t => {
      el('line', { x1: m.left, x2: m.left + iw, y1: Y(t), y2: Y(t), class: 'rsa-grid' }, g);
      el('text', { x: m.left - 8, y: Y(t) + 4, class: 'rsa-axis rsa-axis-y' }, g).textContent = fmtNum(t, spec.unit);
    });
    const xt = niceTicks(x0, x1, 6).filter(t => t >= x0 && t <= x1);
    xt.forEach(t => {
      el('text', { x: X(t), y: m.top + ih + 20, class: 'rsa-axis rsa-axis-x' }, g).textContent = String(Math.round(t));
    });
    el('line', { x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih, class: 'rsa-axis-line' }, g);

    // reference lines (e.g. SSR = 100)
    (spec.reference || []).forEach(r => {
      if (r.value < y0 || r.value > y1) return;
      el('line', { x1: m.left, x2: m.left + iw, y1: Y(r.value), y2: Y(r.value), class: 'rsa-ref' }, g);
      el('text', { x: m.left + iw - 4, y: Y(r.value) - 6, class: 'rsa-ref-label', 'text-anchor': 'end' }, g)
        .textContent = r.label;
    });

    // prediction / scenario bands, drawn behind the lines
    spec.series.forEach((ser, si) => {
      (ser.bands || []).forEach(b => {
        const pts = [];
        for (let i = 0; i < ser.years.length; i++) {
          if (b.upper[i] == null) continue;
          pts.push(X(ser.years[i]) + ',' + Y(b.upper[i]));
        }
        for (let i = ser.years.length - 1; i >= 0; i--) {
          if (b.lower[i] == null) continue;
          pts.push(X(ser.years[i]) + ',' + Y(b.lower[i]));
        }
        if (pts.length < 4) return;
        el('polygon', {
          points: pts.join(' '),
          fill: ser.colour || colourFor(si),
          opacity: b.opacity != null ? b.opacity : 0.14,
          stroke: 'none'
        }, g);
      });
    });

    // the lines themselves
    spec.series.forEach((ser, si) => {
      const colour = ser.colour || colourFor(si);
      // Split on nulls so a gap in the data is a gap in the line, not a straight
      // segment bridging years nobody measured.
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          el('polyline', {
            points: run.join(' '), fill: 'none', stroke: colour,
            'stroke-width': ser.width || 2,
            'stroke-dasharray': dashFor(ser.kind),
            'stroke-linejoin': 'round', 'stroke-linecap': 'round',
            class: 'rsa-line rsa-line-' + (ser.kind || 'observed')
          }, g);
        } else if (run.length === 1) {
          const p = run[0].split(',');
          el('circle', { cx: p[0], cy: p[1], r: 2.5, fill: colour }, g);
        }
        run = [];
      };
      for (let i = 0; i < ser.years.length; i++) {
        if (ser.values[i] == null || !isFinite(ser.values[i])) { flush(); continue; }
        run.push(X(ser.years[i]) + ',' + Y(ser.values[i]));
      }
      flush();
    });

    // vertical markers (e.g. where the forecast starts)
    (spec.markers || []).forEach(mk => {
      if (mk.year < x0 || mk.year > x1) return;
      el('line', { x1: X(mk.year), x2: X(mk.year), y1: m.top, y2: m.top + ih, class: 'rsa-marker' }, g);
      el('text', { x: X(mk.year) + 4, y: m.top + 12, class: 'rsa-marker-label' }, g).textContent = mk.label;
    });

    // legend
    const lg = el('g', { transform: 'translate(' + (m.left + iw + 12) + ',' + m.top + ')' }, s);
    spec.series.forEach((ser, si) => {
      const yy = si * 18;
      el('line', {
        x1: 0, x2: 20, y1: yy, y2: yy, stroke: ser.colour || colourFor(si),
        'stroke-width': 2, 'stroke-dasharray': dashFor(ser.kind)
      }, lg);
      el('text', { x: 25, y: yy + 4, class: 'rsa-legend' }, lg).textContent = ser.label;
    });

    // titles
    if (spec.title) el('text', { x: m.left, y: 16, class: 'rsa-title' }, s).textContent = spec.title;
    if (spec.subtitle) el('text', { x: m.left, y: 29, class: 'rsa-subtitle' }, s).textContent = spec.subtitle;

    /* Accessible name and description. role="img" needs both, and a chart's
     * meaning is not in its pixels -- so the description states the series, the
     * range and, where relevant, that some of it is a projection. */
    el('title', {}, s).textContent = (spec.title || 'Chart') +
      (spec.subtitle ? ' — ' + spec.subtitle : '');
    /* Screen-reader description, localised like everything else. A French
     * reader using a screen reader is precisely the person who cannot fall
     * back on reading the chart. */
    el('desc', {}, s).textContent =
      L('fig.desc.line').replace('{0}', Math.round(x0)).replace('{1}', Math.round(x1)) + ' ' +
      spec.series.map(ser => {
        const vals = ser.values.filter(v => v != null && isFinite(v));
        if (!vals.length) return ser.label + L('fig.desc.noData');
        return ser.label + ' (' + (ser.kind || 'observed') + ')' +
          L('fig.desc.fromTo')
            .replace('{0}', fmtNum(vals[0], spec.unit))
            .replace('{1}', fmtNum(vals[vals.length - 1], spec.unit)) +
          ' ' + (spec.unit || '');
      }).join('; ') + '.';
    if (spec.yLabel) {
      el('text', {
        x: 14, y: m.top + ih / 2, class: 'rsa-axis-title',
        transform: 'rotate(-90 14 ' + (m.top + ih / 2) + ')'
      }, s).textContent = spec.yLabel;
    }
    return s;
  }

  /* The visual grammar that keeps data and model apart. */
  function dashFor(kind) {
    if (kind === 'forecast') return '7 4';
    if (kind === 'scenario') return '2 3';
    if (kind === 'baseline') return '7 4';
    return '';
  }

  const PALETTE = ['#3f9e75', '#5b8dd6', '#c9803f', '#9b6bc4', '#c05f77', '#4fa3a5', '#8a9a3f'];
  function colourFor(i) { return PALETTE[i % PALETTE.length]; }

  function emptyFig(W, H, title, msg) {
    const s = svg(W, H);
    if (title) el('text', { x: 16, y: 20, class: 'rsa-title' }, s).textContent = title;
    el('text', { x: W / 2, y: H / 2, class: 'rsa-empty', 'text-anchor': 'middle' }, s).textContent = msg;
    // role="img" without an accessible name is announced as an unlabelled image.
    el('title', {}, s).textContent = (title ? title + ': ' : '') + msg;
    return s;
  }

  /* ============================================================= bar chart */

  function bars(spec, opts) {
    opts = opts || {};
    const rows = spec.rows.filter(r => r.value != null && isFinite(r.value));
    if (!rows.length) return emptyFig(opts.width || 700, 200, spec.title, 'no comparable values');
    const W = opts.width || 700;
    const rowH = opts.rowHeight || 22;
    const m = { top: spec.title ? 40 : 12, right: 70, bottom: 28, left: opts.labelWidth || 170 };
    const H = m.top + rows.length * rowH + m.bottom;
    const s = svg(W, H);
    const iw = W - m.left - m.right;

    let [lo, hi] = extent([rows.map(r => r.value)]);
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
    const X = v => m.left + (v - lo) / Math.max(1e-12, hi - lo) * iw;

    niceTicks(lo, hi, 4).forEach(t => {
      el('line', { x1: X(t), x2: X(t), y1: m.top, y2: m.top + rows.length * rowH, class: 'rsa-grid' }, s);
      el('text', { x: X(t), y: H - 10, class: 'rsa-axis rsa-axis-x' }, s).textContent = fmtNum(t, spec.unit);
    });

    rows.forEach((r, i) => {
      const y = m.top + i * rowH;
      const x = X(Math.min(0, r.value)), w = Math.abs(X(r.value) - X(0));
      const grp = el('g', { class: 'rsa-bar-row' }, s);
      el('rect', {
        x: x, y: y + 3, width: Math.max(1, w), height: rowH - 7,
        fill: r.colour || (r.value < 0 ? '#b5563d' : '#3f9e75'),
        rx: 2, class: 'rsa-bar'
      }, grp);
      el('text', { x: m.left - 8, y: y + rowH / 2 + 4, class: 'rsa-bar-label', 'text-anchor': 'end' }, grp)
        .textContent = r.label;
      el('text', { x: X(r.value) + (r.value < 0 ? -6 : 6), y: y + rowH / 2 + 4,
                   class: 'rsa-bar-value', 'text-anchor': r.value < 0 ? 'end' : 'start' }, grp)
        .textContent = fmtNum(r.value, spec.unit) + (spec.suffix || '');
      if (r.title) el('title', {}, grp).textContent = r.title;
    });

    if (spec.reference != null) {
      el('line', { x1: X(spec.reference), x2: X(spec.reference), y1: m.top,
                   y2: m.top + rows.length * rowH, class: 'rsa-ref' }, s);
    }
    if (spec.title) el('text', { x: 12, y: 18, class: 'rsa-title' }, s).textContent = spec.title;
    if (spec.subtitle) el('text', { x: 12, y: 31, class: 'rsa-subtitle' }, s).textContent = spec.subtitle;
    el('title', {}, s).textContent = (spec.title || 'Bar chart') +
      (spec.subtitle ? ' — ' + spec.subtitle : '');
    el('desc', {}, s).textContent = L('fig.desc.bar')
      .replace('{0}', rows.length)
      .replace('{1}', rows[rows.length - 1].label)
      .replace('{2}', fmtNum(rows[rows.length - 1].value, spec.unit))
      .replace('{3}', rows[0].label)
      .replace('{4}', fmtNum(rows[0].value, spec.unit)) + ' ' + (spec.unit || '') + '.';
    return s;
  }

  /* ====================================================== correlogram plot
   *
   * ACF and PACF with the white-noise band, which is what Box-Jenkins
   * identification actually reads.
   */
  function correlogram(values, spec, opts) {
    opts = opts || {};
    const W = opts.width || 420, H = opts.height || 190;
    const m = { top: 26, right: 12, bottom: 26, left: 40 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const s = svg(W, H);
    const K = values.length - 1;
    if (K < 1) return emptyFig(W, H, spec.title, 'series too short');

    const band = spec.band || 0;
    const hi = Math.max(1, Math.max.apply(null, values.map(Math.abs)));
    const Y = v => m.top + ih / 2 - v / hi * (ih / 2);
    const X = k => m.left + (k - 1) / Math.max(1, K - 1) * iw;

    if (band > 0) {
      el('rect', { x: m.left, y: Y(band), width: iw, height: Math.abs(Y(-band) - Y(band)),
                   class: 'rsa-acf-band' }, s);
    }
    el('line', { x1: m.left, x2: m.left + iw, y1: Y(0), y2: Y(0), class: 'rsa-axis-line' }, s);

    for (let k = 1; k <= K; k++) {
      const x = X(k), v = values[k];
      const sig = band > 0 && Math.abs(v) > band;
      el('line', { x1: x, x2: x, y1: Y(0), y2: Y(v), 'stroke-width': 3,
                   stroke: sig ? '#c9803f' : '#3f9e75', class: 'rsa-acf-stick' }, s);
      el('circle', { cx: x, cy: Y(v), r: 2.5, fill: sig ? '#c9803f' : '#3f9e75' }, s);
    }
    [-1, 0, 1].forEach(t => {
      if (Math.abs(t) > hi) return;
      el('text', { x: m.left - 6, y: Y(t) + 4, class: 'rsa-axis rsa-axis-y' }, s).textContent = t.toFixed(0);
    });
    el('text', { x: m.left, y: m.top + ih + 18, class: 'rsa-axis rsa-axis-x' }, s).textContent = 'lag 1';
    el('text', { x: m.left + iw, y: m.top + ih + 18, class: 'rsa-axis rsa-axis-x', 'text-anchor': 'end' }, s)
      .textContent = 'lag ' + K;
    if (spec.title) el('text', { x: 8, y: 15, class: 'rsa-title-sm' }, s).textContent = spec.title;
    return s;
  }

  /* ================================================= schematic Africa map
   *
   * A tile cartogram. Grid coordinates below place each country in roughly its
   * relative geographic position; they are a LAYOUT, not coordinates, and the
   * figure is labelled schematic wherever it appears.
   */
  const TILES = {
    // col, row  (col 0 = west, row 0 = north)
    MAR: [1, 0], DZA: [2, 0], TUN: [3, 0], LBY: [4, 0], EGY: [5, 0],
    MRT: [0, 1], MLI: [1, 1], NER: [2, 1], TCD: [3, 1], SDN: [4, 1], ERI: [5, 1],
    CPV: [-1, 2], SEN: [0, 2], BFA: [1, 2], NGA: [2, 2], CAF: [3, 2], SSD: [4, 2], ETH: [5, 2], DJI: [6, 2],
    GMB: [-1, 3], GNB: [0, 3], GIN: [1, 3], BEN: [2, 3], CMR: [3, 3], COD: [4, 3], UGA: [5, 3], SOM: [6, 3],
    SLE: [0, 4], LBR: [1, 4], CIV: [1.6, 4], GHA: [2.2, 4], TGO: [2.8, 4], GNQ: [3.4, 4], COG: [4, 4], RWA: [4.6, 4], KEN: [5.4, 4],
    GAB: [3.4, 5], AGO: [4, 5], BDI: [4.6, 5], TZA: [5.2, 5], SYC: [6.2, 5],
    STP: [3, 6], ZMB: [4.3, 6], MWI: [5, 6], COM: [5.8, 6], MDG: [6.4, 6],
    NAM: [3.6, 7], BWA: [4.3, 7], ZWE: [5, 7], MOZ: [5.7, 7], MUS: [6.6, 7],
    ZAF: [4.3, 8], LSO: [5, 8], SWZ: [5.6, 8], REU: [6.4, 8]
  };

  /* Renders a choropleth over the tile grid.
   * values: { iso3: number }, spec: { title, unit, ramp, domain, higherIsBetter } */
  function africaMap(values, spec, opts) {
    opts = opts || {};
    spec = spec || {};
    const cell = opts.cell || 46, gap = 4;
    const cols = [], rows = [];
    Object.keys(TILES).forEach(k => { cols.push(TILES[k][0]); rows.push(TILES[k][1]); });
    const c0 = Math.min.apply(null, cols), c1 = Math.max.apply(null, cols);
    const r0 = Math.min.apply(null, rows), r1 = Math.max.apply(null, rows);
    const m = { top: 46, left: 12, right: 12, bottom: 54 };
    const W = m.left + (c1 - c0 + 1) * (cell + gap) + m.right;
    const H = m.top + (r1 - r0 + 1) * (cell + gap) + m.bottom;
    const s = svg(W, H, 'rsa-fig rsa-map');

    const present = Object.keys(values).filter(k => values[k] != null && isFinite(values[k]));
    let dom = spec.domain;
    if (!dom) {
      const vs = present.map(k => values[k]);
      dom = vs.length ? [Math.min.apply(null, vs), Math.max.apply(null, vs)] : [0, 1];
    }
    const ramp = spec.ramp || RAMP;

    function colour(v) {
      if (v == null || !isFinite(v)) return null;
      let t = (v - dom[0]) / Math.max(1e-12, dom[1] - dom[0]);
      t = Math.max(0, Math.min(1, t));
      if (spec.higherIsBetter === false) t = 1 - t;
      const idx = Math.min(ramp.length - 1, Math.floor(t * ramp.length));
      return ramp[idx];
    }

    Object.keys(TILES).forEach(iso => {
      const t = TILES[iso];
      const country = RSA.country(iso);
      const x = m.left + (t[0] - c0) * (cell + gap);
      const y = m.top + (t[1] - r0) * (cell + gap);
      const v = values[iso];
      const fill = colour(v);
      const ink = fill ? inkOn(fill) : null;
      const g = el('g', { class: 'rsa-tile' + (fill ? '' : ' rsa-tile-empty'), 'data-iso': iso }, s);
      el('rect', {
        x: x, y: y, width: cell, height: cell, rx: 4,
        fill: fill || 'rgba(127,140,132,0.10)',
        stroke: 'rgba(0,0,0,0.25)', 'stroke-width': 0.5
      }, g);
      el('text', { x: x + cell / 2, y: y + cell / 2 - 2, class: 'rsa-tile-code',
                   'text-anchor': 'middle', fill: ink }, g).textContent = iso;
      if (v != null && isFinite(v)) {
        el('text', { x: x + cell / 2, y: y + cell / 2 + 12, class: 'rsa-tile-value',
                     'text-anchor': 'middle', fill: ink }, g).textContent = fmtNum(v, spec.unit);
      }
      el('title', {}, g).textContent =
        (country ? country.name : iso) + ': ' +
        (v != null && isFinite(v) ? fmtNum(v, spec.unit) + (spec.suffix || '') : 'no data');
    });

    if (spec.title) el('text', { x: m.left, y: 18, class: 'rsa-title' }, s).textContent = spec.title;
    el('text', { x: m.left, y: 32, class: 'rsa-subtitle' }, s).textContent =
      (spec.subtitle ? spec.subtitle + ' — ' : '') + 'schematic tile map; tiles are equal-sized and are not geographic areas';

    // legend
    const lw = 150, lx = m.left, ly = H - 34;
    ramp.forEach((c, i) => {
      el('rect', { x: lx + i * (lw / ramp.length), y: ly, width: lw / ramp.length, height: 9, fill: c }, s);
    });
    el('text', { x: lx, y: ly + 22, class: 'rsa-axis' }, s).textContent =
      fmtNum(spec.higherIsBetter === false ? dom[1] : dom[0], spec.unit);
    el('text', { x: lx + lw, y: ly + 22, class: 'rsa-axis', 'text-anchor': 'end' }, s).textContent =
      fmtNum(spec.higherIsBetter === false ? dom[0] : dom[1], spec.unit);
    el('text', { x: lx + lw + 14, y: ly + 8, class: 'rsa-axis' }, s).textContent =
      (spec.unit || '') + (spec.suffix || '');
    return s;
  }

  /* ================================================== hero rice landscape
   *
   * An original SVG of a West African lowland paddy landscape at first light:
   * flooded terraces stepping back to a treeline, a figure working a plot, birds.
   * Drawn rather than photographed on purpose -- the platform is a single
   * self-contained file with a strict no-external-request rule, and a stock
   * photograph would bring a licence, a CDN dependency and a megabyte with it.
   * Vector also means it stays sharp at any width and can carry the platform's
   * own palette rather than fighting it.
   */
  function heroLandscape(opts) {
    opts = opts || {};
    const W = opts.width || 1200, H = opts.height || 380;
    const s = svg(W, H, 'rsa-hero-art');
    // Natural aspect, scaled to the container width. The CSS places it as a band.
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    s.removeAttribute('style');
    s.setAttribute('style', 'width:100%; height:auto; display:block');

    const defs = el('defs', {}, s);

    // Dawn sky.
    const sky = el('linearGradient', { id: 'rsa-sky', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    [['0%', '#12313f'], ['38%', '#2b5560'], ['64%', '#7d8f6a'], ['82%', '#d9a86a'], ['100%', '#e8c088']]
      .forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, sky));

    // Water: picks up the sky, darkening toward the foreground.
    const water = el('linearGradient', { id: 'rsa-water', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    [['0%', '#cbb184'], ['30%', '#8fa678'], ['100%', '#31513f']]
      .forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, water));

    // Haze over the treeline.
    const haze = el('linearGradient', { id: 'rsa-haze', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#e8c088', 'stop-opacity': '0.55' }, haze);
    el('stop', { offset: '100%', 'stop-color': '#e8c088', 'stop-opacity': '0' }, haze);

    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#rsa-sky)' }, s);

    // Low sun.
    el('circle', { cx: W * 0.74, cy: H * 0.46, r: H * 0.075, fill: '#f6d79b', opacity: 0.9 }, s);
    el('circle', { cx: W * 0.74, cy: H * 0.46, r: H * 0.16, fill: '#f0c27f', opacity: 0.18 }, s);

    const horizon = H * 0.5;

    // Distant hills.
    el('path', {
      d: 'M0,' + (horizon - 6) + ' Q' + (W * 0.16) + ',' + (horizon - 40) + ' ' + (W * 0.33) + ',' + (horizon - 12) +
         ' T' + (W * 0.62) + ',' + (horizon - 16) + ' T' + W + ',' + (horizon - 4) + ' L' + W + ',' + horizon + ' L0,' + horizon + ' Z',
      fill: '#2f4a4a', opacity: 0.75
    }, s);

    // Treeline: palms and canopy along the horizon.
    const tree = el('g', { opacity: 0.9 }, s);
    for (let i = 0; i < 46; i++) {
      const x = (i / 45) * W + ((i % 3) - 1) * 5;
      const hgt = 16 + ((i * 37) % 17);
      el('ellipse', { cx: x, cy: horizon - hgt * 0.35, rx: 9 + (i % 4) * 2.2, ry: hgt * 0.42,
                      fill: '#22403a' }, tree);
      if (i % 6 === 0) {
        el('rect', { x: x - 1.1, y: horizon - hgt * 1.5, width: 2.2, height: hgt * 1.5, fill: '#1c3630' }, tree);
        for (let f = 0; f < 5; f++) {
          const a = -Math.PI / 2 + (f - 2) * 0.5;
          el('path', {
            d: 'M' + x + ',' + (horizon - hgt * 1.5) + ' q' + (Math.cos(a) * 15) + ',' +
               (Math.sin(a) * 12) + ' ' + (Math.cos(a) * 26) + ',' + (Math.sin(a) * 9),
            stroke: '#1c3630', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round'
          }, tree);
        }
      }
    }
    el('rect', { x: 0, y: horizon - 46, width: W, height: 56, fill: 'url(#rsa-haze)' }, s);

    // Flooded paddies, stepping toward the viewer.
    el('rect', { x: 0, y: horizon, width: W, height: H - horizon, fill: 'url(#rsa-water)' }, s);

    const bunds = el('g', {}, s);
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      const t = r / rows;
      const y = horizon + Math.pow(t, 1.7) * (H - horizon);
      const nextY = horizon + Math.pow((r + 1) / rows, 1.7) * (H - horizon);
      // Terrace face, alternating tone so the steps read.
      el('path', {
        d: 'M0,' + y + ' C' + (W * 0.3) + ',' + (y - 4 - r) + ' ' + (W * 0.68) + ',' + (y + 4 + r) +
           ' ' + W + ',' + (y - 2) + ' L' + W + ',' + nextY + ' L0,' + nextY + ' Z',
        fill: r % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)'
      }, bunds);
      // The bund itself.
      el('path', {
        d: 'M0,' + y + ' C' + (W * 0.3) + ',' + (y - 4 - r) + ' ' + (W * 0.68) + ',' + (y + 4 + r) +
           ' ' + W + ',' + (y - 2),
        stroke: '#3d5a3c', 'stroke-width': 1.2 + r * 0.5, fill: 'none', opacity: 0.75
      }, bunds);
    }

    // Reflected sun on the water.
    const refl = el('g', { opacity: 0.5 }, s);
    for (let i = 0; i < 12; i++) {
      const y = horizon + 4 + i * ((H - horizon) / 13);
      const w = 26 + i * 7;
      el('rect', { x: W * 0.74 - w / 2, y: y, width: w, height: 2.2, rx: 1.1, fill: '#f6d79b',
                   opacity: 1 - i / 14 }, refl);
    }

    // Rice plants: denser and larger toward the foreground.
    const crop = el('g', {}, s);
    for (let i = 0; i < 320; i++) {
      const t = Math.pow((i % 40) / 40, 0.6);
      const y = horizon + 10 + t * (H - horizon - 10) + ((i * 13) % 9);
      if (y > H - 2) continue;
      const x = ((i * 149) % (W + 60)) - 30;
      const scale = 0.3 + (y - horizon) / (H - horizon) * 1.5;
      const g = el('g', { transform: 'translate(' + x + ',' + y + ') scale(' + scale + ')' }, crop);
      for (let bl = -2; bl <= 2; bl++) {
        el('path', {
          d: 'M0,0 q' + (bl * 3.2) + ',' + (-7 - Math.abs(bl)) + ' ' + (bl * 6.5) + ',' + (-12 - Math.abs(bl) * 2),
          stroke: bl % 2 ? '#4a7a4a' : '#5d8f52', 'stroke-width': 1.1, fill: 'none',
          'stroke-linecap': 'round', opacity: 0.85
        }, g);
      }
      // Grain head on the nearer plants.
      if (scale > 0.9) {
        el('path', { d: 'M0,-11 q3,-5 1,-9', stroke: '#c9b169', 'stroke-width': 1.5, fill: 'none',
                     'stroke-linecap': 'round' }, g);
      }
    }

    // A figure working a plot, mid-ground, for scale and for the fact that this
    // is a farmed landscape rather than scenery.
    const person = el('g', { transform: 'translate(' + (W * 0.29) + ',' + (horizon + (H - horizon) * 0.34) + ')' }, s);
    el('ellipse', { cx: 0, cy: 20, rx: 13, ry: 3, fill: 'rgba(0,0,0,0.18)' }, person);
    el('path', { d: 'M0,-2 L-3,16 M0,-2 L4,16', stroke: '#22323a', 'stroke-width': 2.6,
                 'stroke-linecap': 'round', fill: 'none' }, person);
    el('path', { d: 'M0,-14 L0,-1', stroke: '#2c5560', 'stroke-width': 5.4, 'stroke-linecap': 'round' }, person);
    el('path', { d: 'M0,-12 L9,-4', stroke: '#2c5560', 'stroke-width': 2.4, 'stroke-linecap': 'round' }, person);
    el('circle', { cx: 0, cy: -17.5, r: 3.4, fill: '#3b2b22' }, person);
    el('path', { d: 'M-7,-19 Q0,-25 7,-19 Q0,-17.5 -7,-19 Z', fill: '#d8b877' }, person);   // conical hat
    el('path', { d: 'M9,-4 L15,12', stroke: '#7a5c3a', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, person);

    // Birds.
    const birds = el('g', { opacity: 0.55 }, s);
    [[0.5, 0.16, 1], [0.55, 0.2, 0.8], [0.46, 0.23, 0.66], [0.62, 0.13, 0.7]].forEach(([bx, by, k]) => {
      el('path', { d: 'M' + (W * bx) + ',' + (H * by) + ' q' + (6 * k) + ',' + (-4 * k) + ' ' + (12 * k) + ',0 ' +
                      'M' + (W * bx + 12 * k) + ',' + (H * by) + ' q' + (6 * k) + ',' + (-4 * k) + ' ' + (12 * k) + ',0',
                   stroke: '#1b2b33', 'stroke-width': 1.4 * k, fill: 'none', 'stroke-linecap': 'round' }, birds);
    });

    /* Scrim for text legibility. Deliberately light: an earlier version ran to
     * 0.86 opacity on the left, which made the hero read as a dark green panel
     * with the landscape barely visible behind it. The text sits on this plus a
     * text-shadow, which together give contrast without erasing the artwork. */
    const vg = el('linearGradient', { id: 'rsa-vig', x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#06100d', 'stop-opacity': '0.62' }, vg);
    el('stop', { offset: '55%', 'stop-color': '#06100d', 'stop-opacity': '0.26' }, vg);
    el('stop', { offset: '100%', 'stop-color': '#06100d', 'stop-opacity': '0.06' }, vg);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#rsa-vig)' }, s);

    el('title', {}, s).textContent =
      'Illustration: flooded lowland rice paddies at dawn. Original vector artwork, not a photograph.';
    return s;
  }

  /* =============================================== real geographic choropleth
   *
   * Country boundaries from Natural Earth, projected with an equirectangular
   * projection whose horizontal scale is corrected by cos(latitude) at the centre
   * of the continent. Africa straddles the equator almost symmetrically, so this
   * keeps shapes close to correct without the distortion Web Mercator inflicts on
   * a continent that spans 70 degrees of latitude -- Mercator would stretch the
   * Maghreb and South Africa relative to the Sahel, and this is a map whose whole
   * job is comparing countries.
   */
  function geoMap(values, spec, opts) {
    opts = opts || {};
    spec = spec || {};
    const geo = RSA.state.geo;
    if (!geo || !geo.shapes) {
      return emptyFig(opts.width || 620, 420, spec.title,
        'boundary data not loaded — run tools/build-geo.ps1');
    }

    const W = opts.width || 640, H = opts.height || 660;
    const m = { top: 46, right: 12, bottom: 58, left: 12 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;

    // Continental extent, from the shapes actually present.
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    Object.keys(geo.shapes).forEach(iso => {
      const b = geo.shapes[iso].bbox;
      if (b[0] < minX) minX = b[0];
      if (b[1] < minY) minY = b[1];
      if (b[2] > maxX) maxX = b[2];
      if (b[3] > maxY) maxY = b[3];
    });
    const midLat = (minY + maxY) / 2;
    const kx = Math.cos(midLat * Math.PI / 180);
    const spanX = (maxX - minX) * kx, spanY = maxY - minY;
    const scale = Math.min(iw / spanX, ih / spanY);
    const offX = m.left + (iw - spanX * scale) / 2;
    const offY = m.top + (ih - spanY * scale) / 2;
    const PX = lon => offX + (lon - minX) * kx * scale;
    const PY = lat => offY + (maxY - lat) * scale;      // y grows downward

    const s = svg(W, H, 'rsa-fig rsa-geomap');

    const present = Object.keys(values).filter(k => values[k] != null && isFinite(values[k]));
    let dom = spec.domain;
    if (!dom) {
      const vs = present.map(k => values[k]);
      dom = vs.length ? [Math.min.apply(null, vs), Math.max.apply(null, vs)] : [0, 1];
    }
    const ramp = spec.ramp || RAMP;
    function colour(v) {
      if (v == null || !isFinite(v)) return null;
      let t = (v - dom[0]) / Math.max(1e-12, dom[1] - dom[0]);
      t = Math.max(0, Math.min(1, t));
      if (spec.higherIsBetter === false) t = 1 - t;
      return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
    }

    const layer = el('g', { class: 'rsa-geo-layer' }, s);
    Object.keys(geo.shapes).forEach(iso => {
      const sh = geo.shapes[iso];
      const country = RSA.country(iso);
      const v = values[iso];
      const fill = colour(v);
      const g = el('g', {
        class: 'rsa-geo-country' + (fill ? '' : ' rsa-geo-nodata'),
        'data-iso': iso
      }, layer);

      if (sh.point) {
        // Island states below the rendering threshold: a marker, clearly a marker.
        el('circle', {
          cx: PX(sh.point[0]), cy: PY(sh.point[1]), r: 5,
          fill: fill || 'rgba(127,140,132,0.25)',
          stroke: 'var(--line-2, rgba(0,0,0,.4))', 'stroke-width': 1
        }, g);
      } else {
        sh.rings.forEach(ring => {
          let d = '';
          for (let i = 0; i < ring.length; i++) {
            d += (i === 0 ? 'M' : 'L') + PX(ring[i][0]).toFixed(1) + ',' + PY(ring[i][1]).toFixed(1);
          }
          d += 'Z';
          el('path', {
            d: d, fill: fill || 'rgba(127,140,132,0.14)',
            stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 0.4,
            'vector-effect': 'non-scaling-stroke'
          }, g);
        });
      }
      el('title', {}, g).textContent =
        (country ? country.name : iso) + ': ' +
        (v != null && isFinite(v) ? fmtNum(v, spec.unit) + (spec.suffix || '') : 'no data') +
        (spec.year ? '  (' + spec.year + ')' : '');
    });

    // Labels for the larger countries only, or the map turns into a word cloud.
    if (opts.labels !== false) {
      Object.keys(geo.shapes).forEach(iso => {
        const sh = geo.shapes[iso];
        if (sh.point) return;
        const b = sh.bbox;
        const w = (b[2] - b[0]) * kx * scale, hgt = (b[3] - b[1]) * scale;
        if (w < 34 || hgt < 20) return;
        const v = values[iso];
        const fill = colour(v);
        const cx = PX(sh.centre[0]), cy = PY(sh.centre[1]);
        el('text', { x: cx, y: cy, class: 'rsa-geo-label', 'text-anchor': 'middle',
                     fill: fill ? inkOn(fill) : 'var(--ink-3, #7a867f)' }, s).textContent = iso;
        if (v != null && isFinite(v) && hgt > 32) {
          el('text', { x: cx, y: cy + 11, class: 'rsa-geo-value', 'text-anchor': 'middle',
                       fill: fill ? inkOn(fill) : 'var(--ink-3, #7a867f)' }, s)
            .textContent = fmtNum(v, spec.unit);
        }
      });
    }

    if (spec.title) el('text', { x: m.left, y: 18, class: 'rsa-title' }, s).textContent = spec.title;
    if (spec.subtitle) el('text', { x: m.left, y: 33, class: 'rsa-subtitle' }, s).textContent = spec.subtitle;

    // legend
    const lw = 170, lx = m.left, ly = H - 36;
    ramp.forEach((c, i) => {
      el('rect', { x: lx + i * (lw / ramp.length), y: ly, width: lw / ramp.length, height: 9, fill: c }, s);
    });
    el('text', { x: lx, y: ly + 22, class: 'rsa-axis' }, s).textContent =
      fmtNum(spec.higherIsBetter === false ? dom[1] : dom[0], spec.unit);
    el('text', { x: lx + lw, y: ly + 22, class: 'rsa-axis', 'text-anchor': 'end' }, s).textContent =
      fmtNum(spec.higherIsBetter === false ? dom[0] : dom[1], spec.unit);
    el('text', { x: lx + lw + 12, y: ly + 8, class: 'rsa-axis' }, s).textContent =
      (spec.unit || '') + (spec.suffix || '');
    el('text', { x: W - m.right, y: ly + 22, class: 'rsa-axis', 'text-anchor': 'end' }, s).textContent =
      'boundaries: Natural Earth (public domain)';
    return s;
  }

  /* ================================================== scenario comparison */

  function scenarioBars(comparison, opts) {
    return bars({
      title: 'Self-sufficiency ratio at the target year, by scenario',
      subtitle: 'scenario simulations under stated assumptions, not predictions',
      unit: '%', suffix: '%',
      reference: 100,
      rows: comparison.map(c => ({
        label: c.scenario,
        value: c.ssr,
        colour: c.selfSufficient ? '#3f9e75' : '#c9803f',
        title: c.description
      }))
    }, opts);
  }

  /* Cost against SSR gain -- the chart a finance ministry actually wants. */
  function costEffectiveness(comparison, opts) {
    opts = opts || {};
    const rows = comparison.filter(c => c.cost != null && c.ssrChange != null && c.cost > 0);
    if (!rows.length) return emptyFig(opts.width || 560, 300, 'Cost effectiveness', 'no costed scenarios');
    const W = opts.width || 560, H = opts.height || 300;
    const m = { top: 40, right: 20, bottom: 46, left: 62 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const s = svg(W, H);

    const [cx0, cx1] = extent([rows.map(r => r.ssrChange)]);
    const [cy0, cy1] = extent([rows.map(r => r.cost)]);
    const X = v => m.left + (v - Math.min(0, cx0)) / Math.max(1e-12, cx1 - Math.min(0, cx0)) * iw;
    const Y = v => m.top + ih - (v - 0) / Math.max(1e-12, cy1) * ih;

    niceTicks(0, cy1, 4).forEach(t => {
      el('line', { x1: m.left, x2: m.left + iw, y1: Y(t), y2: Y(t), class: 'rsa-grid' }, s);
      el('text', { x: m.left - 8, y: Y(t) + 4, class: 'rsa-axis rsa-axis-y' }, s).textContent = '$' + fmtNum(t);
    });
    niceTicks(Math.min(0, cx0), cx1, 5).forEach(t => {
      el('text', { x: X(t), y: m.top + ih + 18, class: 'rsa-axis rsa-axis-x' }, s).textContent = fmtNum(t) + 'pp';
    });

    rows.forEach((r, i) => {
      const g = el('g', {}, s);
      el('circle', { cx: X(r.ssrChange), cy: Y(r.cost), r: 6, fill: colourFor(i), opacity: 0.85 }, g);
      el('text', { x: X(r.ssrChange) + 10, y: Y(r.cost) + 4, class: 'rsa-legend' }, g).textContent = r.scenario;
      el('title', {}, g).textContent = r.scenario + ': ' + fmtNum(r.ssrChange) +
        ' percentage points for $' + fmtNum(r.cost);
    });

    el('text', { x: m.left, y: 18, class: 'rsa-title' }, s).textContent = 'Cost against self-sufficiency gain';
    el('text', { x: m.left, y: 31, class: 'rsa-subtitle' }, s).textContent =
      'lower and further right is better; costs rest on placeholder unit-cost assumptions';
    el('text', { x: m.left + iw / 2, y: H - 8, class: 'rsa-axis-title', 'text-anchor': 'middle' }, s)
      .textContent = 'SSR gain over baseline (percentage points)';
    return s;
  }

  /* ============================================================== export */

  function toSvgString(node) {
    const clone = node.cloneNode(true);
    clone.setAttribute('xmlns', NS);
    // Inline the stylesheet so the exported file stands alone.
    const style = document.createElementNS(NS, 'style');
    style.textContent = EXPORT_CSS;
    clone.insertBefore(style, clone.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  const EXPORT_CSS = `
    text { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; fill: #1b241f; }
    .rsa-title { font-size: 13px; font-weight: 600; }
    .rsa-title-sm { font-size: 11px; font-weight: 600; }
    .rsa-subtitle { font-size: 10.5px; fill: #5d6b63; }
    .rsa-axis { font-size: 10px; fill: #5d6b63; }
    .rsa-axis-y { text-anchor: end; }
    .rsa-axis-x { text-anchor: middle; }
    .rsa-axis-title { font-size: 10.5px; fill: #5d6b63; text-anchor: middle; }
    .rsa-legend { font-size: 10.5px; fill: #33403a; }
    .rsa-bar-label { font-size: 11px; fill: #33403a; }
    .rsa-bar-value { font-size: 10.5px; fill: #5d6b63; }
    .rsa-tile-code { font-size: 10px; font-weight: 600; fill: #10201a; }
    .rsa-tile-value { font-size: 9px; fill: #22322b; }
    .rsa-grid { stroke: rgba(0,0,0,0.08); stroke-width: 1; }
    .rsa-axis-line { stroke: rgba(0,0,0,0.35); stroke-width: 1; }
    .rsa-ref { stroke: #b5563d; stroke-width: 1; stroke-dasharray: 4 3; }
    .rsa-ref-label { font-size: 10px; fill: #b5563d; }
    .rsa-marker { stroke: rgba(0,0,0,0.30); stroke-width: 1; stroke-dasharray: 2 3; }
    .rsa-marker-label { font-size: 9.5px; fill: #5d6b63; }
    .rsa-acf-band { fill: rgba(63,158,117,0.12); }
    .rsa-empty { font-size: 12px; fill: #8a968f; }
  `;

  function downloadSvg(node, filename) {
    const blob = new Blob([toSvgString(node)], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, filename || 'figure.svg');
  }

  /* PNG export by drawing the serialized SVG onto a canvas. */
  function downloadPng(node, filename, scale) {
    scale = scale || 2;
    const str = toSvgString(node);
    const vb = node.getAttribute('viewBox').split(/\s+/).map(Number);
    const W = vb[2], H = vb[3];
    const img = new Image();
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = function () {
      const cv = document.createElement('canvas');
      cv.width = W * scale; cv.height = H * scale;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => triggerDownload(b, filename || 'figure.png'));
    };
    img.src = url;
  }

  function triggerDownload(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  return {
    svg: svg, el: el,
    timeSeries: timeSeries, bars: bars, correlogram: correlogram,
    africaMap: africaMap, geoMap: geoMap, heroLandscape: heroLandscape,
    scenarioBars: scenarioBars, costEffectiveness: costEffectiveness,
    emptyFig: emptyFig,
    toSvgString: toSvgString, downloadSvg: downloadSvg, downloadPng: downloadPng,
    triggerDownload: triggerDownload,
    fmtNum: fmtNum, colourFor: colourFor, RAMP: RAMP, DIVERGING: DIVERGING, TILES: TILES
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSAFigs; }
