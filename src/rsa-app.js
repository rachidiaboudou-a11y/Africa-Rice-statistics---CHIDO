/* Rice Statistics for Africa -- application shell.
 *
 * Owns the selection state, renders the eight panels, and wires the download
 * buttons. Panels render lazily and re-render when the selection changes, which
 * matters because a forecast panel refits models and that is the one genuinely
 * expensive thing the platform does.
 */

(function () {
  'use strict';

  const S = {
    db: 'fao',
    // Milled is the default because it is the basis on which the FAO
    // self-sufficiency definition is stated:
    //   SSR = Production(milled) / (Production(milled) + Imports - Exports) x 100
    basis: 'milled',
    // FAOSTAT item 30, the standardized total rice trade aggregate. Item 31
    // ("Rice, milled") excludes broken rice and understates imports across much
    // of West Africa; it is available for reproducing Gassi et al. (2025).
    stdTrade: true,
    sel: { kind: 'country', id: 'BEN' },
    targetYear: 2040,
    trends: false,          // "Trends" target: report observed years, not projections
    from: 1961,
    to: 2024,
    tab: 'overview',
    mapIndicator: 'ssr',
    compare: ['NGA', 'BEN', 'CIV', 'SEN', 'GHA', 'MLI'],
    weights: null,
    // Map panel
    mapYear: 2024,
    mapScenario: 'observed',
    mapMode: 'geo',         // 'geo' | 'tiles'
    gmapKey: null,
    cache: {}
  };

  // Tab ids only; labels come from the translation table at render time so a
  // language switch re-labels everything without a reload.
  const TABS = ['overview', 'map', 'profile', 'compare', 'forecast',
                'scenarios', 'condition', 'crisis', 'westafrica', 'datused',
                'sources', 'copilot', 'report'];

  // The 16 West African countries, for the van Oort model section.
  const WEST_AFRICA = ['BEN', 'BFA', 'CPV', 'CIV', 'GMB', 'GHA', 'GIN', 'GNB',
                       'LBR', 'MLI', 'MRT', 'NER', 'NGA', 'SEN', 'SLE', 'TGO'];

  // Short alias for the translation helper, used throughout this file.
  const T = (k, v) => RSAi18n.t(k, v);

  // Horizons every scenario reports against.
  const HORIZONS = [2030, 2035, 2040, 2045, 2050];

  /* ------------------------------------------------------------ utilities */

  const $ = sel => document.querySelector(sel);
  const h = (tag, attrs, kids) => {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(c => { if (c) n.appendChild(c); });
    return n;
  };

  function f(x, dp) {
    if (x == null || !isFinite(x)) return '—';
    return Number(x).toLocaleString(undefined,
      { minimumFractionDigits: dp == null ? 1 : dp, maximumFractionDigits: dp == null ? 1 : dp });
  }
  function pc(x) { return x == null ? '—' : (x * 100).toFixed(0) + '%'; }
  function tonnes(x) {
    if (x == null || !isFinite(x)) return '—';
    if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2) + ' Mt';
    if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(0) + ' kt';
    return Math.round(x) + ' t';
  }
  function usd1k(x) {
    if (x == null || !isFinite(x)) return '—';
    const v = x * 1000;
    if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'bn';
    if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'm';
    return '$' + Math.round(v).toLocaleString();
  }
  function usdRaw(x) {
    if (x == null || !isFinite(x)) return '—';
    if (Math.abs(x) >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'bn';
    if (Math.abs(x) >= 1e6) return '$' + (x / 1e6).toFixed(0) + 'm';
    if (Math.abs(x) >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'k';
    return '$' + Math.round(x);
  }

  function balOpts(basis) {
    return { basis: basis || S.basis, standardizedTrade: S.stdTrade !== false };
  }

  function bal(sel, db, basis) {
    const key = [db || S.db, basis || S.basis, S.stdTrade !== false ? 'std' : 'm31',
                 JSON.stringify(sel || S.sel)].join('|');
    if (!S.cache[key]) {
      S.cache[key] = RSA.balance(db || S.db, sel || S.sel, balOpts(basis));
    }
    return S.cache[key];
  }

  function kpi(label, value, year, kind) {
    return h('div', { class: 'kpi kpi-' + (kind || 'observed') }, [
      h('span', { class: 'k', text: label }),
      h('div', { class: 'v', text: value }),
      h('span', { class: 'y', text: year != null ? String(year) : '' })
    ]);
  }

  function note(level, text) { return h('div', { class: 'note note-' + level, text: text }); }

  function finding(level, title, text, meta) {
    return h('div', { class: 'finding finding-' + level }, [
      h('h4', { text: title }), h('p', { text: text }),
      meta ? h('div', { class: 'meta', text: meta }) : null
    ]);
  }

  function card(title, kids) {
    return h('div', { class: 'card' }, [title ? h('h3', { text: title }) : null].concat(kids || []));
  }

  function table(caption, columns, rows, numeric) {
    const t = h('table', { class: 'data' });
    if (caption) t.appendChild(h('caption', { text: caption }));
    const thead = h('thead'), tr = h('tr');
    columns.forEach((c, i) => tr.appendChild(h('th', { text: c, class: numeric && numeric[i] ? 'num' : '' })));
    thead.appendChild(tr); t.appendChild(thead);
    const tb = h('tbody');
    rows.forEach(r => {
      const row = h('tr');
      r.forEach((c, i) => row.appendChild(h('td', {
        text: c == null ? '—' : String(c), class: numeric && numeric[i] ? 'num' : ''
      })));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return h('div', { class: 'scroll' }, [t]);
  }

  /* Wraps a figure with its export buttons. */
  function figure(title, node, subtitle) {
    const acts = h('div', { class: 'acts' }, [
      h('button', { text: 'SVG', title: 'Download as SVG',
        onclick: () => RSAFigs.downloadSvg(node, slug(title) + '.svg') }),
      h('button', { text: 'PNG', title: 'Download as PNG',
        onclick: () => RSAFigs.downloadPng(node, slug(title) + '.png') })
    ]);
    return h('div', { class: 'fig' }, [
      h('div', { class: 'fig-head' }, [
        h('h3', { text: title }),
        subtitle ? h('span', { class: 'muted', text: subtitle }) : null,
        acts
      ]),
      node
    ]);
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function round4(x) { return (x == null || !isFinite(x)) ? '' : Math.round(x * 1e4) / 1e4; }

  function kindLegend() {
    return h('div', { class: 'legend-kinds', html:
      '<span><i></i>' + escapeHtml(T('legend.observed')) + '</span>' +
      '<span class="f"><i></i>' + escapeHtml(T('legend.forecast')) + '</span>' +
      '<span class="s"><i></i>' + escapeHtml(T('legend.scenario')) + '</span>' });
  }

  function lastOf(res) { return RSAPolicy.lastObs(res); }

  /* =============================================================== panels */

  function renderOverview() {
    const el = $('#p-overview');
    el.innerHTML = '';

    // hero
    const africa = bal({ kind: 'africa' });
    const I = RSAIndicators;
    const ssrA = lastOf(I.compute('ssr', africa));
    const idrA = lastOf(I.compute('idr', africa));
    const billA = lastOf(I.compute('importBill', africa));

    const heroFig = RSAFigs.timeSeries({
      title: T('fig.africaPvC'),
      unit: 't', series: [
        { label: 'Production', years: africa.years, values: africa.production, kind: 'observed', colour: '#7cc39b' },
        { label: 'Consumption', years: africa.years, values: africa.consumption, kind: 'observed', colour: '#e0a35c' }
      ]
    }, { width: 460, height: 250, zeroBase: true });

    el.appendChild(h('div', { class: 'hero' }, [
      h('div', { class: 'hero-art' }, [RSAFigs.heroLandscape({ width: 1200, height: 380 })]),
      h('div', { class: 'hero-credit', text: T('hero.credit') }),
      h('div', { class: 'hero-grid' }, [
        h('div', {}, [
          h('h1', { text: T('hero.title') }),
          h('p', { text: T('hero.lede', { n: RSA.countries().length }) }),
          h('div', { class: 'q' }, [
            h('div', {}, [h('b', { text: T('hero.q1') }),
              h('span', { text: T('hero.a1', {
                ssr: RSAi18n.pct(ssrA && ssrA.value),
                year: (ssrA && ssrA.year) || '—',
                idr: RSAi18n.pct(idrA && idrA.value) }) })]),
            h('div', {}, [h('b', { text: T('hero.q2') }), h('span', { text: T('hero.a2') })]),
            h('div', {}, [h('b', { text: T('hero.q3') }), h('span', { text: T('hero.a3') })])
          ])
        ]),
        h('div', { class: 'hero-fig' }, [heroFig])
      ])
    ]));

    // Africa aggregate KPIs
    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('sec.africaAggregate') }),
      h('p', { text: africa.db + ' · ' + basisShort() + ' · all ' + africa.members.length + ' reporting countries' })
    ]));
    const prodA = lastOf(I.compute('production', africa));
    const consA = lastOf(I.compute('consumption', africa));
    const cpcA = lastOf(I.compute('cpc', africa));
    el.appendChild(h('div', { class: 'kpis' }, [
      kpi('Self-sufficiency ratio', f(ssrA && ssrA.value) + '%', ssrA && ssrA.year, 'observed'),
      kpi('Import dependency', f(idrA && idrA.value) + '%', idrA && idrA.year, 'observed'),
      kpi('Production', tonnes(prodA && prodA.value), prodA && prodA.year, 'observed'),
      kpi(T('kpi.apparentCons'), tonnes(consA && consA.value), consA && consA.year, 'observed'),
      kpi('Per capita consumption', f(cpcA && cpcA.value) + ' kg', cpcA && cpcA.year, 'observed'),
      kpi('Rice import bill', usd1k(billA && billA.value), billA && billA.year, 'observed')
    ]));
    africa.notes.forEach(n => el.appendChild(note(n.level, n.text)));

    // map
    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('sec.map') }),
      h('p', { text: T('sec.mapHint') })
    ]));
    const mapCtl = h('div', { class: 'controls' }, [
      field('Indicator', selectEl('map-ind', [
        ['ssr', 'Self-sufficiency ratio (%)'], ['idr', 'Import dependency ratio (%)'],
        ['production', 'Production (t)'], ['yield', 'Yield (kg/ha)'], ['area', 'Harvested area (ha)'],
        ['imports', 'Imports (t)'], ['exports', 'Exports (t)'],
        ['ppc', 'Per capita production (kg)'], ['cpc', 'Per capita consumption (kg)'],
        ['importBill', 'Import bill (1000 USD)']
      ], S.mapIndicator, v => { S.mapIndicator = v; renderOverview(); }))
    ]);
    el.appendChild(mapCtl);
    el.appendChild(buildMap());

    // rankings
    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('sec.rankings') })]));
    const g = h('div', { class: 'grid g2' });
    g.appendChild(rankCard('ssr', 'Lowest self-sufficiency', 'asc', '%'));
    g.appendChild(rankCard('idr', 'Highest import dependency', 'desc', '%'));
    g.appendChild(rankCard('production', 'Largest producers', 'desc', 't'));
    g.appendChild(rankCard('importBill', 'Largest rice import bills', 'desc', '1000 USD'));
    el.appendChild(g);
  }

  function buildMap() {
    const I = RSAIndicators;
    const vals = {};
    RSA.countries().forEach(c => {
      if (!RSA.hasSeries(S.db, c.iso3)) return;
      const b = bal({ kind: 'country', id: c.iso3 });
      const r = I.compute(S.mapIndicator, b);
      const last = lastOf(r);
      if (last) vals[c.iso3] = last.value;
    });
    const ind = I.get(S.mapIndicator);
    // For dependency-style indicators a high value is bad, so invert the ramp.
    const higherIsBetter = ['idr'].indexOf(S.mapIndicator) < 0;
    // SSR gets a fixed 0-120 domain so colours mean the same thing across sessions.
    const domain = S.mapIndicator === 'ssr' ? [0, 120] : null;
    const node = RSAFigs.africaMap(vals, {
      title: T('fig.mostRecent').replace('{0}', ind.label),
      subtitle: RSA.state[S.db === 'usda' ? 'usda' : 'fao'].db,
      unit: ind.unit, higherIsBetter: higherIsBetter, domain: domain,
      suffix: ind.unit === '%' ? '%' : ''
    });
    node.addEventListener('click', ev => {
      const g = ev.target.closest('[data-iso]');
      if (!g) return;
      const iso = g.getAttribute('data-iso');
      if (!RSA.country(iso)) return;
      S.sel = { kind: 'country', id: iso };
      syncSelection();
      go('profile');
    });
    return figure(T('fig.acrossAfrica').replace('{0}', ind.label), node, T('fig.tileMap'));
  }

  function rankCard(indicatorId, title, dir, unit) {
    const rows = RSAPolicy.rankCountries(indicatorId, S.db, { basis: S.basis }, 12, dir);
    const node = RSAFigs.bars({
      title: title, unit: unit, suffix: unit === '%' ? '%' : '',
      reference: indicatorId === 'ssr' ? 100 : null,
      rows: rows.map(r => ({ label: r.name, value: r.value, title: r.name + ' (' + r.year + ')' }))
    }, { width: 620, labelWidth: 180 });
    return figure(title, node, T('fig.perCountry'));
  }

  /* ----------------------------------------------------------------- map
   *
   * One indicator, every country, at any year, under any scenario. Observed years
   * come straight from the data; projected years come from each country's own
   * baseline with the selected policy applied. Building 55 baselines is the most
   * expensive thing the platform does, so results are cached per (indicator,
   * scenario, basis, database) and the year slider then costs nothing.
   */

  const MAP_INDICATOR_IDS = ['ssr', 'idr', 'production', 'consumption', 'yield', 'area',
                             'imports', 'exports', 'ppc', 'cpc', 'cpcFood', 'kcalRice',
                             'importBill', 'importBillPerCapita'];

  function mapIndicatorOptions() {
    return MAP_INDICATOR_IDS.map(id => {
      const d = RSAIndicators.get(id);
      return [id, RSAIndicators.label(id) +
        (d && d.unit ? ' (' + RSAIndicators.unitLabel(d.unit) + ')' : '')];
    });
  }

  const MAP_SCENARIOS = [
    ['observed', 'Observed data only'],
    ['baseline', 'Baseline projection (no policy change)'],
    ['area', 'Scenario: area expansion'],
    ['variety', 'Scenario: improved varieties'],
    ['yield', 'Scenario: productivity improvement'],
    ['tariff', 'Scenario: import tariff'],
    ['combined', 'Scenario: combined strategy']
  ];

  // Only these can be projected; the rest are observation-only.
  const PROJECTABLE = ['ssr', 'idr', 'production', 'consumption', 'yield', 'area', 'imports', 'cpc'];

  function mapCacheKey() {
    return [S.db, S.basis, S.mapIndicator, S.mapScenario].join('|');
  }

  /* Returns { years:[...], byYear: { year: {iso: value} }, projectedFrom: year|null } */
  function buildMapSeries(onProgress) {
    const key = mapCacheKey();
    S.cache.map = S.cache.map || {};
    if (S.cache.map[key]) return S.cache.map[key];

    const I = RSAIndicators;
    const byYear = {};
    const isProjection = S.mapScenario !== 'observed';
    const wantProjection = isProjection && PROJECTABLE.indexOf(S.mapIndicator) >= 0;
    let projectedFrom = null;
    const failures = [];

    RSA.countries().forEach((c, ix) => {
      if (onProgress) onProgress(ix, RSA.countries().length, c.name);
      if (!RSA.hasSeries(S.db, c.iso3)) return;
      const b = bal({ kind: 'country', id: c.iso3 });

      // observed
      const r = I.compute(S.mapIndicator, b);
      r.years.forEach((y, i) => {
        if (r.values[i] == null) return;
        (byYear[y] = byYear[y] || {})[c.iso3] = r.values[i];
      });

      if (!wantProjection) return;

      // projected
      let base = null;
      try { base = RSAScenarios.baseline(b, 2050, {}); } catch (e) { base = null; }
      if (!base || !base.ok) { failures.push(c.iso3); return; }
      const path = scenarioPathFor(base, S.mapScenario);
      if (!path) return;
      if (projectedFrom == null && path.length) projectedFrom = path[0].year;
      path.forEach(p => {
        const v = mapValueFromPoint(p, S.mapIndicator);
        if (v == null || !isFinite(v)) return;
        (byYear[p.year] = byYear[p.year] || {})[c.iso3] = v;
      });
    });

    const years = Object.keys(byYear).map(Number).sort((a, b2) => a - b2);
    const out = { years: years, byYear: byYear, projectedFrom: projectedFrom,
                  failures: failures, projected: wantProjection,
                  requestedProjection: isProjection };
    S.cache.map[key] = out;
    return out;
  }

  function scenarioPathFor(base, id) {
    const P = S.params || (S.params = defaultParams());
    const o = { rampTo: S.trends ? 2040 : S.targetYear, rampModel: S.rampModel || 'linear' };
    switch (id) {
      case 'baseline':  return base.path;
      case 'area':      return RSAScenarios.scenarioArea(base, P.area, o).path;
      case 'variety':   return RSAScenarios.scenarioVariety(base, P.adoption, P.gain, o).path;
      case 'yield':     return RSAScenarios.scenarioYield(base, P.yieldImp, o).path;
      case 'tariff':    return RSAScenarios.scenarioTariff(base, P.tariff, o).path;
      case 'combined':  return RSAScenarios.scenarioCombined(base, {
        areaExpansion: P.area, adoptionRate: P.adoption, varietyYieldGain: P.gain,
        yieldImprovement: P.yieldImp, tariff: P.tariff
      }, o).path;
      default: return null;
    }
  }

  function mapValueFromPoint(p, id) {
    switch (id) {
      case 'ssr': return p.ssr;
      case 'idr': return p.idr;
      case 'production': return p.production;
      case 'consumption': return p.consumption;
      case 'yield': return p.yield;
      case 'area': return p.area;
      case 'imports': return p.imports;
      case 'cpc': return p.cpc;
      default: return null;
    }
  }

  function defaultParams() {
    return { area: 0.10, adoption: 0.40, gain: 0.30, yieldImp: 0.20, tariff: 0.10 };
  }

  function renderMap() {
    const el = $('#p-map');
    el.innerHTML = '';
    const ind = RSAIndicators.get(S.mapIndicator);

    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: 'Africa map' }),
      h('p', { text: T('sub.map') })
    ]));

    // controls
    const ctl = h('div', { class: 'controls' }, [
      field(T('ctl.indicator'), selectEl('m-ind', mapIndicatorOptions(), S.mapIndicator, v => {
        S.mapIndicator = v; renderMap();
      })),
      field(T('ctl.scenario'), selectEl('m-sc', MAP_SCENARIOS, S.mapScenario, v => {
        S.mapScenario = v; renderMap();
      })),
      field(T('ctl.rendering'), selectEl('m-mode', [
        ['geo', 'Geographic boundaries'], ['tiles', 'Schematic tile map']
      ], S.mapMode, v => { S.mapMode = v; renderMap(); }))
    ]);
    el.appendChild(ctl);

    if (S.mapScenario !== 'observed' && PROJECTABLE.indexOf(S.mapIndicator) < 0) {
      el.appendChild(note('warning', ind.label + ' cannot be projected — the scenario engine models ' +
        'area, yield, production, consumption, imports and the ratios built from them. The map is ' +
        'showing observed values only. Pick a projectable indicator to see scenario years.'));
    }

    const host = h('div');
    el.appendChild(host);
    const spin = h('div', { class: 'spinner', text: 'Building country projections…' });
    host.appendChild(spin);

    setTimeout(() => {
      const data = buildMapSeries();
      host.innerHTML = '';
      if (!data.years.length) {
        host.appendChild(note('error', 'No values available for this indicator.'));
        return;
      }

      const minY = data.years[0], maxY = data.years[data.years.length - 1];
      if (S.mapYear < minY || S.mapYear > maxY) S.mapYear = maxY;

      const badge = h('span', { class: 'yearbadge', text: String(S.mapYear) });
      const slider = h('input', { type: 'range', min: minY, max: maxY, step: 1, value: S.mapYear });
      const kindTag = h('span', { class: 'tag' });
      const figHost = h('div');

      function paint() {
        const values = data.byYear[S.mapYear] || {};
        const projected = data.projectedFrom != null && S.mapYear >= data.projectedFrom;
        kindTag.className = 'tag ' + (projected
          ? (S.mapScenario === 'baseline' ? 'tag-forecast' : 'tag-scenario') : 'tag-observed');
        kindTag.textContent = projected
          ? (S.mapScenario === 'baseline' ? 'model forecast' : 'scenario simulation') : 'observed';

        // A fixed domain per indicator keeps colours comparable as the year moves;
        // a domain recomputed each frame would make an unchanged country appear to
        // change colour purely because its neighbours did.
        const domain = fixedDomain(S.mapIndicator, data);
        const higherIsBetter = ['idr'].indexOf(S.mapIndicator) < 0;
        const scLabel = (MAP_SCENARIOS.find(x => x[0] === S.mapScenario) || [])[1] || '';

        const spec = {
          title: ind.label + ' — ' + S.mapYear,
          subtitle: (projected ? scLabel : 'observed data') + ' · ' + RSA.state[S.db === 'usda' ? 'usda' : 'fao'].db +
                    ' · ' + basisShort(),
          unit: ind.unit, suffix: ind.unit === '%' ? '%' : '',
          domain: domain, higherIsBetter: higherIsBetter, year: S.mapYear
        };

        figHost.innerHTML = '';
        const node = (S.mapMode === 'geo' && RSA.state.geo)
          ? RSAFigs.geoMap(values, spec, { width: 660, height: 680 })
          : RSAFigs.africaMap(values, spec, {});

        // Ranking for the displayed year, so hover can report position as well
        // as level -- "44%" means little without knowing it is 31st of 49.
        const ranked = Object.keys(values)
          .filter(k => values[k] != null && isFinite(values[k]))
          .sort((a, b2) => values[b2] - values[a]);
        const rankOf = {};
        ranked.forEach((iso, i) => { rankOf[iso] = i + 1; });

        // Live readout. A tooltip alone hides the value the moment you look away
        // from the map; a fixed readout lets you sweep the continent and read.
        const readout = h('div', { class: 'map-readout' }, [
          h('span', { class: 'ro-name', text: T('sec.mapHint') }),
          h('span', { class: 'ro-val' }),
          h('span', { class: 'ro-rank' })
        ]);
        const setReadout = iso => {
          const c = RSA.country(iso);
          const v = values[iso];
          readout.querySelector('.ro-name').textContent = c ? c.name : iso;
          readout.querySelector('.ro-val').textContent =
            (v != null && isFinite(v))
              ? RSAi18n.num(v, ind.unit === '%' ? 1 : 0) + (ind.unit === '%' ? '%' : ' ' + ind.unit)
              : T('lbl.noData');
          readout.querySelector('.ro-rank').textContent =
            rankOf[iso] ? '#' + rankOf[iso] + ' / ' + ranked.length : '';
        };
        node.addEventListener('mousemove', ev => {
          const g = ev.target.closest('[data-iso]');
          if (g) setReadout(g.getAttribute('data-iso'));
        });
        node.addEventListener('mouseleave', () => {
          readout.querySelector('.ro-name').textContent = T('sec.mapHint');
          readout.querySelector('.ro-val').textContent = '';
          readout.querySelector('.ro-rank').textContent = '';
        });
        node.addEventListener('click', ev => {
          const g = ev.target.closest('[data-iso]');
          if (!g) return;
          const iso = g.getAttribute('data-iso');
          if (!RSA.country(iso)) return;
          S.sel = { kind: 'country', id: iso };
          syncSelection(); invalidate(); go('profile');
        });

        const covered = Object.keys(values).filter(k => values[k] != null && isFinite(values[k])).length;
        figHost.appendChild(figure(ind.label + ' — ' + S.mapYear, node,
          (projected ? scLabel : T('legend.observed')) + ' · ' +
          T('map.coverage', { n: covered, total: RSA.countries().length })));
        figHost.appendChild(readout);

        // ranked table for the displayed year
        const rows = Object.keys(values)
          .map(iso => ({ iso: iso, name: (RSA.country(iso) || {}).name || iso, v: values[iso] }))
          .filter(r => r.v != null && isFinite(r.v))
          .sort((a, b2) => b2.v - a.v);
        figHost.appendChild(card('Values in ' + S.mapYear + ' (' + rows.length + ' countries)', [
          h('div', { class: 'scroll-y' }, [table(null, [T('tbl.rank'), T('tbl.country'), ind.label],
            rows.map((r, i) => [i + 1, r.name, f(r.v, ind.unit === '%' ? 1 : 0)]),
            [true, false, true])]),
          h('div', { class: 'controls' }, [
            h('button', { text: 'Download this year (CSV)', onclick: () => {
              const L = ['# ' + ind.label + ' by country, ' + S.mapYear,
                         '# equation,' + q2(ind.equation),
                         '# database,' + q2(bal().db), '# basis,' + q2(S.basis),
                         '# kind,' + (projected ? 'projection/scenario: ' + scLabel : 'observed'),
                         '# generated,' + new Date().toISOString(), '',
                         'iso3,country,' + ind.id + '_' + ind.unit.replace(/[^a-z]/gi, '')];
              rows.forEach(r => L.push([r.iso, q2(r.name), r.v].join(',')));
              downloadText(L.join('\n'), 'africa-' + ind.id + '-' + S.mapYear + '.csv', 'text/csv');
            } })
          ])
        ]));
      }

      slider.addEventListener('input', () => {
        S.mapYear = Number(slider.value);
        badge.textContent = String(S.mapYear);
      });
      slider.addEventListener('change', paint);

      // Animate across years, which is the fastest way to see a trajectory.
      let timer = null;
      const play = h('button', { text: '▶ Play' });
      play.addEventListener('click', () => {
        if (timer) { clearInterval(timer); timer = null; play.textContent = '▶ Play'; return; }
        play.textContent = '❚❚ Pause';
        timer = setInterval(() => {
          let y = S.mapYear + 1;
          if (y > maxY) y = minY;
          S.mapYear = y; slider.value = y; badge.textContent = String(y);
          paint();
        }, 420);
      });

      const jump = h('div', { class: 'controls' }, HORIZONS.map(y =>
        h('button', { text: String(y), onclick: () => {
          if (y < minY || y > maxY) return;
          S.mapYear = y; slider.value = y; badge.textContent = String(y); paint();
        } })));

      host.appendChild(h('div', { class: 'playbar' }, [play, badge, slider, kindTag]));
      host.appendChild(jump);
      if (data.projectedFrom != null) {
        host.appendChild(note('info', 'Years up to ' + (data.projectedFrom - 1) + ' are OBSERVED. ' +
          'From ' + data.projectedFrom + ' the map shows ' +
          (S.mapScenario === 'baseline' ? 'a model projection under no policy change'
            : 'a scenario simulation under stated assumptions') +
          ', built per country from its own area, yield and per-capita consumption trends with UN ' +
          'population. These are not predictions.'));
      }
      if (data.failures && data.failures.length) {
        host.appendChild(note('warning', 'No baseline could be built for ' + data.failures.length +
          ' countries (' + data.failures.slice(0, 8).join(', ') +
          (data.failures.length > 8 ? '…' : '') + '); they show observed values only. This is a ' +
          'shortage of usable history, not a modelling failure.'));
      }
      host.appendChild(figHost);
      paint();

      // Optional Google Maps base layer.
      host.appendChild(googleMapsCard());
    }, 30);
  }

  /* Colour domains fixed per indicator so a country's colour means the same thing
   * in every year of the animation. */
  function fixedDomain(id, data) {
    if (id === 'ssr') return [0, 120];
    if (id === 'idr') return [0, 120];
    let lo = Infinity, hi = -Infinity;
    Object.keys(data.byYear).forEach(y => {
      const v = data.byYear[y];
      Object.keys(v).forEach(iso => {
        const x = v[iso];
        if (x == null || !isFinite(x)) return;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      });
    });
    if (!isFinite(lo)) return [0, 1];
    // Cap at the 95th percentile so one outlier does not flatten the whole ramp.
    const all = [];
    Object.keys(data.byYear).forEach(y => {
      const v = data.byYear[y];
      Object.keys(v).forEach(iso => { if (v[iso] != null && isFinite(v[iso])) all.push(v[iso]); });
    });
    all.sort((a, b) => a - b);
    const p95 = all[Math.floor(all.length * 0.95)];
    return [Math.min(0, lo), p95 != null ? p95 : hi];
  }

  /* Google Maps is offered as an optional base layer rather than the map itself.
   * It needs a billing-enabled API key, and a platform whose core function
   * depended on the user having one would simply not work for most people. The
   * choropleth above is complete without it. */
  function googleMapsCard() {
    const stored = (function () {
      try { return localStorage.getItem('rsa.gmapKey') || ''; } catch (e) { return ''; }
    })();
    const input = h('input', { type: 'text', value: stored, placeholder: 'Google Maps JavaScript API key',
                               style: 'flex:1;min-width:260px' });
    const status = h('div', { class: 'muted' });
    const mount = h('div', { class: 'mapstack', style: 'height:520px; display:none' });

    function loadGoogle(key) {
      status.textContent = 'Loading Google Maps…';
      mount.style.display = 'block';
      mount.innerHTML = '';
      const div = h('div', { class: 'gmap', id: 'rsa-gmap' });
      mount.appendChild(div);

      window.__rsaGmapReady = function () {
        try {
          const map = new google.maps.Map(div, {
            center: { lat: 2, lng: 18 }, zoom: 3, mapTypeId: 'terrain',
            streetViewControl: false, fullscreenControl: false
          });
          const data = buildMapSeries();
          const values = data.byYear[S.mapYear] || {};
          const ind = RSAIndicators.get(S.mapIndicator);
          const domain = fixedDomain(S.mapIndicator, data);
          const geo = RSA.state.geo;
          if (!geo) { status.textContent = 'Boundary data not loaded.'; return; }
          Object.keys(geo.shapes).forEach(iso => {
            const sh = geo.shapes[iso];
            const v = values[iso];
            let t = v == null ? null : (v - domain[0]) / Math.max(1e-12, domain[1] - domain[0]);
            if (t != null && S.mapIndicator === 'idr') t = 1 - t;
            const ramp = RSAFigs.RAMP;
            const fill = t == null ? '#9aa8a1'
              : ramp[Math.min(ramp.length - 1, Math.floor(Math.max(0, Math.min(1, t)) * ramp.length))];
            (sh.rings || []).forEach(ring => {
              new google.maps.Polygon({
                paths: ring.map(p => ({ lat: p[1], lng: p[0] })),
                strokeColor: '#22302a', strokeOpacity: 0.6, strokeWeight: 0.6,
                fillColor: fill, fillOpacity: 0.72, map: map
              }).addListener('click', () => {
                new google.maps.InfoWindow({
                  content: '<b>' + ((RSA.country(iso) || {}).name || iso) + '</b><br>' +
                    ind.label + ' ' + S.mapYear + ': ' +
                    (v == null ? 'no data' : RSAFigs.fmtNum(v, ind.unit) + (ind.unit === '%' ? '%' : ''))
                }).open(map);
              });
            });
          });
          status.textContent = 'Google Maps base layer showing ' + ind.label + ' for ' + S.mapYear +
            '. Change the year above and reload the layer to update it.';
        } catch (e) {
          status.textContent = 'Google Maps failed to initialise: ' + e.message;
        }
      };

      const sc = document.createElement('script');
      sc.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
               '&callback=__rsaGmapReady';
      sc.async = true;
      sc.onerror = () => {
        status.textContent = 'Could not load Google Maps. Check the key, that the Maps JavaScript ' +
          'API is enabled, and that billing is active on the project.';
        mount.style.display = 'none';
      };
      document.head.appendChild(sc);
    }

    return card('Google Maps base layer (optional)', [
      h('p', { class: 'muted', text:
        'The map above needs nothing external: boundaries are Natural Earth, public domain, bundled ' +
        'with the platform. If you would rather see the same choropleth over a Google Maps base ' +
        'layer, paste a Google Maps JavaScript API key with billing enabled. The key is stored only ' +
        'in this browser and is never sent anywhere except to Google when loading the map.' }),
      h('div', { class: 'controls' }, [
        input,
        h('button', { class: 'primary', text: 'Load Google layer', onclick: () => {
          const k = input.value.trim();
          if (!k) { status.textContent = 'Enter a key first.'; return; }
          try { localStorage.setItem('rsa.gmapKey', k); } catch (e) {}
          loadGoogle(k);
        } }),
        h('button', { text: 'Forget key', onclick: () => {
          try { localStorage.removeItem('rsa.gmapKey'); } catch (e) {}
          input.value = ''; mount.style.display = 'none';
          status.textContent = 'Key removed from this browser.';
        } })
      ]),
      status, mount
    ]);
  }

  function q2(s) {
    s = String(s == null ? '' : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ------------------------------------------------------------- profile */

  function renderProfile() {
    const el = $('#p-profile');
    el.innerHTML = '';
    const b = bal();
    const I = RSAIndicators;

    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: b.label }),
      h('p', { text: b.db + ' · ' + basisShort() + ' · ' + b.years[0] + '–' + b.years[b.years.length - 1] })
    ]));

    const ids = ['ssr', 'idr', 'ppc', 'cpc', 'production', 'yield', 'area', 'imports'];
    const kp = h('div', { class: 'kpis' });
    ids.forEach(id => {
      const r = I.compute(id, b), last = lastOf(r);
      const v = last ? (r.unit === '%' ? f(last.value) + '%'
        : r.unit === 't' || r.unit === 'ha' ? tonnes(last.value)
        : r.unit === 'kg/capita' ? f(last.value) + ' kg'
        : f(last.value)) : '—';
      kp.appendChild(kpi(I.get(id).label, v, last && last.year, 'observed'));
    });
    el.appendChild(kp);
    b.notes.forEach(n => el.appendChild(note(n.level, n.text)));

    // diagnosis
    const q = RSA.quality(S.db, b.members.length === 1 ? b.members[0] : b.members[0], { from: 1990 });
    const diag = RSAPolicy.diagnose(b, { quality: q ? q.score : null });
    if (diag.findings.length) {
      el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('sec.diagnosis') })]));
      diag.findings.forEach(fd => el.appendChild(finding(
        fd.severity === 'high' ? 'warning' : fd.severity === 'positive' ? 'positive' : 'info',
        fd.title, fd.text, 'rule ' + fd.ruleId + ' — fires when ' + fd.condition)));
      el.appendChild(note('warning', diag.caveat));
    }

    // charts
    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: 'Trends' })]));
    const g = h('div', { class: 'grid g2' });

    g.appendChild(figure('Production and consumption', RSAFigs.timeSeries({
      title: 'Production and apparent consumption', unit: 't', yLabel: 'tonnes',
      series: [
        { label: 'Production', years: b.years, values: b.production, kind: 'observed', colour: '#4fb98a' },
        { label: 'Consumption', years: b.years, values: b.consumption, kind: 'observed', colour: '#d9944f' },
        { label: 'Imports', years: b.years, values: b.imports, kind: 'observed', colour: '#6ba3e0' }
      ]
    }, { zeroBase: true, width: 620 })));

    g.appendChild(figure('Self-sufficiency and dependency', RSAFigs.timeSeries({
      title: 'SSR and IDR', unit: '%', yLabel: 'per cent',
      reference: [{ value: 100, label: 'self-sufficiency' }],
      series: [
        { label: 'SSR', years: b.years, values: I.compute('ssr', b).values, kind: 'observed', colour: '#4fb98a' },
        { label: 'IDR', years: b.years, values: I.compute('idr', b).values, kind: 'observed', colour: '#e0705c' }
      ]
    }, { width: 620 })));

    g.appendChild(figure('Area and yield', RSAFigs.timeSeries({
      title: 'Harvested area (ha)', unit: 'ha', yLabel: 'hectares',
      series: [{ label: 'Area', years: b.years, values: b.area, kind: 'observed', colour: '#8d7ce0' }]
    }, { zeroBase: true, width: 620 })));

    g.appendChild(figure('Yield', RSAFigs.timeSeries({
      title: 'Yield (kg/ha)', unit: 'kg/ha', yLabel: 'kg/ha',
      series: [{ label: 'Yield', years: b.years, values: b.yield, kind: 'observed', colour: '#7cc39b' }]
    }, { zeroBase: true, width: 620 })));

    g.appendChild(figure('Per capita', RSAFigs.timeSeries({
      title: 'Per capita production and consumption', unit: 'kg/capita', yLabel: 'kg/capita',
      series: [
        { label: 'PPC', years: b.years, values: I.compute('ppc', b).values, kind: 'observed', colour: '#4fb98a' },
        { label: 'CPC', years: b.years, values: I.compute('cpc', b).values, kind: 'observed', colour: '#d9944f' }
      ]
    }, { zeroBase: true, width: 620 })));

    const billVals = I.compute('importBill', b).values;
    if (billVals.some(v => v != null)) {
      g.appendChild(figure('Rice import bill', RSAFigs.timeSeries({
        title: 'What imported rice costs', unit: '1000 USD', yLabel: '1000 USD (current)',
        series: [{ label: 'Import bill', years: b.years, values: billVals, kind: 'observed', colour: '#e0a35c' }]
      }, { zeroBase: true, width: 620 })));
    }
    el.appendChild(g);
    el.appendChild(kindLegend());

    // full indicator table
    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('sec.fullSeries') })]));
    const cols = ['production', 'area', 'yield', 'imports', 'exports', 'consumption', 'ppc', 'cpc', 'ssr', 'idr'];
    const computed = cols.map(id => I.compute(id, b));
    const rows = [];
    for (let i = b.years.length - 1; i >= 0; i--) {
      if (computed.every(c => c.values[i] == null)) continue;
      rows.push([b.years[i]].concat(computed.map(c => c.values[i] == null ? null : f(c.values[i], 1))));
    }
    el.appendChild(h('div', { class: 'scroll-y' }, [
      table(null, ['Year'].concat(cols.map(id => I.get(id).label)), rows,
        [false].concat(cols.map(() => true)))
    ]));
    el.appendChild(h('div', { class: 'controls', style: 'margin-top:12px' }, [
      h('button', { text: 'Download CSV', onclick: () => downloadText(
        RSAReport.toCsv(b, { from: S.from, to: S.to }), slug(b.label) + '-rice.csv', 'text/csv') })
    ]));
  }

  /* ------------------------------------------------------------- compare */

  function renderCompare() {
    const el = $('#p-compare');
    el.innerHTML = '';
    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('sec.compare') }),
      h('p', { text: T('sub.compare') })
    ]));

    const grid = h('div', { class: 'checkgrid' });
    RSA.countries().forEach(c => {
      const cb = h('input', { type: 'checkbox', value: c.iso3 });
      cb.checked = S.compare.indexOf(c.iso3) >= 0;
      cb.addEventListener('change', () => {
        S.compare = Array.prototype.slice.call(grid.querySelectorAll('input:checked')).map(i => i.value);
        drawCompare();
      });
      grid.appendChild(h('label', {}, [cb, h('span', { text: c.name })]));
    });
    el.appendChild(card(T('sec.countries'), [grid]));
    const out = h('div', { id: 'cmp-out' });
    el.appendChild(out);
    drawCompare();

    function drawCompare() {
      const o = $('#cmp-out');
      o.innerHTML = '';
      if (S.compare.length < 1) { o.appendChild(note('info', 'Select at least one country.')); return; }
      const I = RSAIndicators;
      const bals = S.compare.map(iso => ({ iso: iso, b: bal({ kind: 'country', id: iso }) }));

      // ranking table
      const rows = bals.map(x => {
        const g = id => { const l = lastOf(I.compute(id, x.b)); return l ? l.value : null; };
        return {
          name: RSA.country(x.iso).name,
          ssr: g('ssr'), idr: g('idr'), prod: g('production'), yld: g('yield'),
          imp: g('imports'), cpc: g('cpc'), bill: g('importBill')
        };
      }).sort((a, b2) => (b2.ssr || -1) - (a.ssr || -1));

      o.appendChild(card(T('card.ranking'), [
        table(null,
          ['Country', 'SSR (%)', 'IDR (%)', 'Production', 'Yield (kg/ha)', 'Imports', 'CPC (kg)', 'Import bill'],
          rows.map(r => [r.name, f(r.ssr), f(r.idr), tonnes(r.prod), f(r.yld, 0), tonnes(r.imp),
                         f(r.cpc), usd1k(r.bill)]),
          [false, true, true, true, true, true, true, true])
      ]));

      // overlay charts
      const g2 = h('div', { class: 'grid g2' });
      [['ssr', 'Self-sufficiency ratio', '%', [{ value: 100, label: 'self-sufficiency' }]],
       ['production', 'Production', 't', null],
       ['yield', 'Yield', 'kg/ha', null],
       ['cpc', 'Per capita consumption', 'kg/capita', null]].forEach(([id, title, unit, ref]) => {
        const node = RSAFigs.timeSeries({
          title: title, unit: unit, yLabel: unit, reference: ref,
          series: bals.map((x, i) => ({
            label: RSA.country(x.iso).name,
            years: x.b.years, values: I.compute(id, x.b).values,
            kind: 'observed', colour: RSAFigs.colourFor(i)
          }))
        }, { width: 620, zeroBase: id !== 'ssr' });
        g2.appendChild(figure(title, node));
      });
      o.appendChild(g2);

      // FAOSTAT vs USDA
      o.appendChild(h('div', { class: 'section-h' }, [
        h('h2', { text: 'FAOSTAT against USDA PSD' }),
        h('p', { text: 'the same indicator from both sources, never merged' })
      ]));
      const dbRows = [];
      let anyDivergence = false;
      S.compare.forEach(iso => {
        const name = RSA.country(iso).name;
        const x = RSAPolicy.crossDatabase(iso, {});
        if (!x) {
          dbRows.push([name, '—', '—', '—', '—', '—', '—',
                       RSA.hasSeries('usda', iso) ? 'no common year' : 'not in USDA PSD']);
          return;
        }
        if (x.imports.ratio != null && x.imports.ratio >= 3 && x.imports.usda > 100000) anyDivergence = true;
        dbRows.push([
          name, x.year,
          tonnes(x.production.fao), tonnes(x.production.usda),
          x.production.pctDiff != null ? f(x.production.pctDiff) + '%' : '—',
          tonnes(x.imports.fao), tonnes(x.imports.usda),
          x.imports.ratio != null ? (x.imports.ratio >= 10
            ? f(x.imports.ratio, 0) + '×' : f(x.imports.ratio, 1) + '×') : '—'
        ]);
      });
      o.appendChild(card('FAOSTAT vs USDA PSD, common year, milled basis', [
        table(null,
          ['Country', 'Year', 'Production FAO', 'Production USDA', 'Prod. diff',
           'Imports FAO', 'Imports USDA', 'Import ratio'],
          dbRows, [false, true, true, true, true, true, true, true]),
        note('info', 'Both columns are on a MILLED basis in a year both databases report, so the ' +
          'product-basis and reporting-year differences have been removed. What remains is genuine ' +
          'disagreement between the two sources.'),
        anyDivergence ? note('error',
          'At least one country above shows USDA estimating imports at three times FAOSTAT or more, ' +
          'while the two agree closely on production. That pattern is not a data error and it is not ' +
          'noise: FAOSTAT counts rice that clears customs, USDA estimates what the supply-demand ' +
          'balance requires, and the gap between them is rice entering outside official trade ' +
          'records. Nigeria is the clearest case — FAOSTAT records a few thousand tonnes of imports ' +
          'where USDA estimates close to two million. Any self-sufficiency figure for such a country ' +
          'depends entirely on which trade measure it rests on, and the FAOSTAT-based figure will ' +
          'look far more self-sufficient than the country is.') : null,
        note('warning', 'The two sources are never merged or averaged. Where they disagree, the ' +
          'disagreement is itself the finding.')
      ].filter(Boolean)));
    }
  }

  /* -------------------------------------------------------------- trends
   *
   * Selected by choosing "Trends" as the target instead of a year. Projections
   * are switched off entirely and every indicator is reported for every observed
   * year, with year-on-year growth and period CAGR beside it. This is the view
   * for reading what the data actually record, with nothing modelled on top.
   */
  const TREND_IDS = ['production', 'area', 'yield', 'imports', 'exports', 'consumption',
                     'population', 'ppc', 'cpc', 'ssr', 'idr', 'pcb', 'ntr', 'importBill',
                     'importUnitValue'];

  function renderTrends(el, contextLabel) {
    const b = bal();
    const I = RSAIndicators;

    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: 'Trends — ' + b.label }),
      h('p', { text: 'observed values for every year; projections are off' })
    ]));
    el.appendChild(note('info', 'Target is set to "Trends", so ' + contextLabel + ' is not shown. ' +
      'Everything below is OBSERVED data — no model, no projection, no scenario. Choose a target ' +
      'year (2030–2050) to turn projections back on.'));
    b.notes.forEach(n => el.appendChild(note(n.level, n.text)));

    const computed = TREND_IDS.map(id => I.compute(id, b));
    const desc = computed.map(c => I.describe(c, S.from, S.to));

    // Summary: first, last, CAGR, peak for each indicator.
    el.appendChild(card('Summary over ' + S.from + '–' + S.to, [
      table(null, ['Indicator', 'Unit', 'First', 'Last', 'Change', 'CAGR', 'Min', 'Max', 'Obs.'],
        computed.map((c, i) => {
          const d = desc[i];
          if (!d.first) return [c.label, c.unit, '—', '—', '—', '—', '—', '—', 0];
          const chg = (d.first.value !== 0)
            ? 100 * (d.last.value - d.first.value) / Math.abs(d.first.value) : null;
          return [c.label, c.unit,
            d.first.year + ': ' + f(d.first.value, 1),
            d.last.year + ': ' + f(d.last.value, 1),
            chg == null ? '—' : (chg > 0 ? '+' : '') + f(chg, 1) + '%',
            d.cagr == null ? '—' : f(d.cagr, 2) + '%/yr',
            d.min ? d.min.year + ': ' + f(d.min.value, 1) : '—',
            d.max ? d.max.year + ': ' + f(d.max.value, 1) : '—',
            d.observations];
        }), [false, false, true, true, true, true, true, true, true])
    ]));

    // Full year-by-year matrix.
    const rows = [];
    for (let i = b.years.length - 1; i >= 0; i--) {
      if (computed.every(c => c.values[i] == null)) continue;
      rows.push([b.years[i]].concat(computed.map(c =>
        c.values[i] == null ? null : f(c.values[i], c.unit === '%' ? 2 : 1))));
    }
    el.appendChild(card('Every indicator, every observed year (' + rows.length + ' years)', [
      h('div', { class: 'scroll-y' }, [table(null,
        ['Year'].concat(computed.map(c => c.label + ' (' + c.unit + ')')), rows,
        [false].concat(computed.map(() => true)))]),
      h('div', { class: 'controls' }, [
        h('button', { text: 'Download all indicators (CSV)', onclick: () => downloadText(
          RSAReport.toCsv(b, { from: S.from, to: S.to }), slug(b.label) + '-trends.csv', 'text/csv') }),
        h('button', { text: 'Download with growth rates (CSV)', onclick: () => {
          const L = ['# trends with year-on-year growth, ' + b.label,
                     '# database,' + q2(b.db), '# basis,' + q2(S.basis),
                     '# generated,' + new Date().toISOString(), ''];
          const head = ['year'];
          computed.forEach(c => { head.push(c.id); head.push(c.id + '_growth_pct'); });
          L.push(head.join(','));
          b.years.forEach((y, i) => {
            const line = [y];
            computed.forEach((c, ci) => {
              line.push(c.values[i] == null ? '' : round4(c.values[i]));
              const g = desc[ci].growth[i];
              line.push(g == null ? '' : round4(g));
            });
            L.push(line.join(','));
          });
          downloadText(L.join('\n'), slug(b.label) + '-trends-growth.csv', 'text/csv');
        } })
      ])
    ]));

    // Year-on-year growth matrix.
    const gRows = [];
    for (let i = b.years.length - 1; i >= 0; i--) {
      if (desc.every(d => d.growth[i] == null)) continue;
      gRows.push([b.years[i]].concat(desc.map(d =>
        d.growth[i] == null ? null : (d.growth[i] > 0 ? '+' : '') + f(d.growth[i], 1) + '%')));
    }
    el.appendChild(card('Year-on-year growth', [
      h('div', { class: 'scroll-y' }, [table(null,
        ['Year'].concat(computed.map(c => c.label)), gRows,
        [false].concat(computed.map(() => true)))])
    ]));

    // Charts of the headline series.
    const g = h('div', { class: 'grid g2' });
    // Titles come from the indicator registry rather than being repeated here,
    // so they follow the chosen language and cannot drift from the labels used
    // everywhere else.
    [['ssr', '%', [{ value: 100, label: T('ref.selfSufficiency') }]],
     ['idr', '%', null],
     ['production', 't', null],
     ['consumption', 't', null],
     ['yield', 'kg/ha', null],
     ['cpc', 'kg/capita', null]].forEach(([id, unit, ref]) => {
      const title = RSAIndicators.label(id);
      const c = computed[TREND_IDS.indexOf(id)];
      if (!c) return;
      g.appendChild(figure(title, RSAFigs.timeSeries({
        title: title, unit: RSAIndicators.unitLabel(unit), yLabel: RSAIndicators.unitLabel(unit),
        reference: ref,
        series: [{ label: T('kind.observed'), years: c.years, values: c.values,
                   kind: 'observed', colour: '#4fb98a' }]
      }, { width: 620, zeroBase: id !== 'ssr' && id !== 'idr' })));
    });
    el.appendChild(g);
    el.appendChild(kindLegend());
  }

  /* ------------------------------------------------------------ forecast */

  function renderForecast() {
    const el = $('#p-forecast');
    el.innerHTML = '';
    if (S.trends) { renderTrends(el, 'the forecast'); return; }
    const b = bal();
    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: 'Box–Jenkins forecasting — ' + b.label }),
      h('p', { text: 'to ' + S.targetYear })
    ]));

    const ctl = h('div', { class: 'controls' }, [
      field('Series', selectEl('fc-series', [
        ['production', 'Production'], ['imports', 'Imports'], ['consumption', 'Consumption'],
        ['yield', 'Yield'], ['area', 'Harvested area'], ['ssr', 'Self-sufficiency ratio'],
        ['cpc', 'Per capita consumption']
      ], S.fcSeries || 'production', v => { S.fcSeries = v; renderForecast(); })),
      field('Criterion', selectEl('fc-crit', [['aic', 'AIC'], ['bic', 'BIC'], ['hqic', 'HQIC']],
        S.fcCrit || 'aic', v => { S.fcCrit = v; renderForecast(); }))
    ]);
    el.appendChild(ctl);

    const out = h('div', { class: 'spinner', text: 'Fitting models…' });
    el.appendChild(out);

    // Defer so the spinner paints before the fit blocks the thread.
    setTimeout(() => {
      const id = S.fcSeries || 'production';
      const res = RSAIndicators.compute(id, b);
      const c = RSA.compact(res.years, res.values);
      out.classList.remove('spinner');
      out.innerHTML = '';
      if (c.values.length < 15) {
        out.appendChild(note('warning', 'Only ' + c.values.length + ' usable observations for ' +
          res.label + ' in ' + b.label + '. A Box–Jenkins model needs a longer run than this to say ' +
          'anything defensible, so no forecast is produced.'));
        return;
      }

      const sel = RSATsa.selectModel(c.values, { criterion: S.fcCrit || 'aic', maxP: 4, maxQ: 4 });
      if (!sel.selected) {
        out.appendChild(note('error', 'No ARIMA model could be fitted to this series.'));
        return;
      }
      const m = sel.selected;
      const lastYear = c.years[c.years.length - 1];
      const hz = Math.max(1, S.targetYear - lastYear);
      const fc = RSATsa.forecast(m, hz, { levels: [0.80, 0.95] });

      if (sel.warning) out.appendChild(note('error', sel.note));
      else out.appendChild(note('info', sel.note));

      // Forecasting a bounded ratio directly is weaker than forecasting its parts.
      // An unconstrained ARIMA on SSR or IDR can return negative percentages and
      // intervals that run through regions the quantity cannot occupy, so say so
      // rather than let the chart imply otherwise.
      if (id === 'ssr' || id === 'idr') {
        out.appendChild(note('warning',
          'This forecasts a RATIO directly. ' + res.label + ' is a bounded quantity — it cannot be ' +
          'negative — but an ARIMA fitted to it is unconstrained, so point forecasts and especially ' +
          'the interval bounds can stray into values the ratio cannot take. The Policy simulator ' +
          'builds SSR structurally instead, projecting area, yield and per-capita consumption ' +
          'separately and forming the ratio from them, which cannot produce an impossible value. ' +
          'Prefer that for anything load-bearing; use this view to see the ratio\'s own time-series ' +
          'behaviour.'));
      }

      // stationarity
      out.appendChild(card('Stationarity', [
        table(null, ['Test', 'Specification', 'Statistic', '5% critical', 'Conclusion'],
          sel.dSelection.trace.map(t => [
            t.pp.test + ' (d=' + t.d + ')', t.pp.specLabel, f(t.pp.statistic, 3),
            f(t.pp.critical['5'], 3), t.pp.conclusion
          ]).concat(sel.dSelection.trace.map(t => [
            t.kpss.test + ' (d=' + t.d + ')', t.kpss.specLabel, f(t.kpss.statistic, 3),
            f(t.kpss.critical['5'], 3), t.kpss.conclusion
          ])), [false, false, true, true, false]),
        note('info', 'Differencing order d = ' + sel.d + ': ' + sel.dSelection.reason + '.')
      ]));

      // correlograms
      const w = RSATsa.diff(c.values, sel.d);
      const band = RSATsa.acfBand(w.length);
      const maxLag = Math.min(20, Math.floor(w.length / 3));
      const cg = h('div', { class: 'grid g2' }, [
        figure('ACF (d=' + sel.d + ')', RSAFigs.correlogram(RSATsa.acf(w, maxLag),
          { title: 'Autocorrelation — identifies q', band: band })),
        figure('PACF (d=' + sel.d + ')', RSAFigs.correlogram(RSATsa.pacf(w, maxLag),
          { title: 'Partial autocorrelation — identifies p', band: band }))
      ]);
      out.appendChild(cg);

      // model table
      out.appendChild(card('Model selection', [
        table(null, ['Model', 'AIC', 'BIC', 'HQIC', 'sigma²', 'Ljung–Box p', 'White noise', 'RMSE'],
          sel.candidates.slice(0, 10).map(x => [
            x.label, f(x.aic, 2), f(x.bic, 2), f(x.hqic, 2), x.sigma2.toExponential(2),
            x.ljungBox && x.ljungBox.pValue != null ? f(x.ljungBox.pValue, 3) : '—',
            x.adequate ? 'yes' : 'no', x.accuracy ? f(x.accuracy.rmse, 1) : '—'
          ]), [false, true, true, true, true, true, false, true]),
        note('info', 'Selected: ' + m.label + '. AR coefficients ' +
          (m.phi.length ? m.phi.map(v => f(v, 3)).join(', ') : 'none') + '; MA coefficients ' +
          (m.theta.length ? m.theta.map(v => f(v, 3)).join(', ') : 'none') + '.'),
        note(m.stationary && m.invertible ? 'positive' : 'error',
          'Stationarity and invertibility. The largest AR inverse root has modulus ' +
          f(m.maxArRoot, 4) + ' and the largest MA inverse root ' + f(m.maxMaRoot, 4) + '. ' +
          'Both must lie strictly inside the unit circle. Stationary: ' +
          (m.stationary ? 'yes' : 'NO') + '; invertible: ' + (m.invertible ? 'yes' : 'NO') + '.'),
        note('info', 'Information criteria are comparable only among models fitted to the same ' +
          'differenced series. They must not be compared across different values of d.')
      ]));

      // residual diagnostics
      const lb = m.ljungBox || RSATsa.ljungBox(m.residuals, 12, m.nPar);
      const jb = m.jarqueBera || RSATsa.jarqueBera(m.residuals);
      out.appendChild(card('Residual diagnostics', [
        table(null, ['Test', 'Statistic', 'df', 'p-value', 'Conclusion'], [
          ['Ljung–Box Q', f(lb.statistic, 3), lb.df, lb.pValue != null ? f(lb.pValue, 4) : '—', lb.conclusion],
          ['Jarque–Bera', f(jb.statistic, 3), jb.df, f(jb.pValue, 4),
           jb.normal ? 'residuals consistent with normality' : 'residuals depart from normality']
        ], [false, true, true, true, false]),
        figure('Residual ACF', RSAFigs.correlogram(RSATsa.acf(m.residuals, maxLag),
          { title: 'Residual autocorrelation — should be inside the band', band: RSATsa.acfBand(m.residuals.length) })),
        jb.normal ? null : note('warning', 'Residuals are not normally distributed, so the Gaussian ' +
          'prediction intervals below are approximate and probably too narrow in the tails.')
      ].filter(Boolean)));

      // backtest
      const bt = RSATsa.backtest(c.values, { h: 5, p: m.order.p, d: m.order.d, q: m.order.q,
                                             drift: m.includeMean && m.order.d > 0 });
      if (bt.model) {
        out.appendChild(card('Out-of-sample performance', [
          table(null, ['', 'RMSE', 'MAE', 'MAPE', 'n'], [
            [m.label, f(bt.model.rmse, 1), f(bt.model.mae, 1),
             bt.model.mape != null ? f(bt.model.mape, 1) + '%' : '—', bt.model.n],
            ['Random walk with drift', f(bt.benchmark.rmse, 1), f(bt.benchmark.mae, 1),
             bt.benchmark.mape != null ? f(bt.benchmark.mape, 1) + '%' : '—', bt.benchmark.n]
          ], [false, true, true, true, true]),
          note(bt.skill != null && bt.skill > 0 ? 'positive' : 'warning',
            bt.skill == null ? bt.note
              : bt.skill > 0
                ? 'The model beats a random walk with drift out of sample by ' + f(100 * bt.skill, 1) +
                  '% on RMSE at horizons up to 5 years.'
                : 'The model does NOT beat a random walk with drift out of sample (skill ' +
                  f(100 * bt.skill, 1) + '%). On this evidence the benchmark is the better forecast ' +
                  'and the ARIMA should be read as description rather than prediction.')
        ]));
      }

      // the forecast chart
      const fy = [], fv = [], lo80 = [], hi80 = [], lo95 = [], hi95 = [];
      const allY = c.years.concat([]);
      const obs = c.values.concat([]);
      for (let i = 0; i < hz; i++) {
        allY.push(lastYear + i + 1);
        obs.push(null);
      }
      c.years.forEach(() => { fv.push(null); lo80.push(null); hi80.push(null); lo95.push(null); hi95.push(null); });
      // join the last observation so the dashed line starts on the solid one
      fv[fv.length - 1] = c.values[c.values.length - 1];
      lo80[lo80.length - 1] = c.values[c.values.length - 1];
      hi80[hi80.length - 1] = c.values[c.values.length - 1];
      lo95[lo95.length - 1] = c.values[c.values.length - 1];
      hi95[hi95.length - 1] = c.values[c.values.length - 1];
      for (let i = 0; i < hz; i++) {
        fv.push(fc.mean[i]);
        lo80.push(fc.intervals['80'].lower[i]); hi80.push(fc.intervals['80'].upper[i]);
        lo95.push(fc.intervals['95'].lower[i]); hi95.push(fc.intervals['95'].upper[i]);
      }

      const node = RSAFigs.timeSeries({
        title: res.label + ' — observed and forecast',
        subtitle: m.label + ' · 80% and 95% prediction intervals',
        unit: res.unit, yLabel: res.unit,
        reference: id === 'ssr' ? [{ value: 100, label: 'self-sufficiency' }] : null,
        markers: [{ year: lastYear, label: 'forecast starts' }],
        series: [
          { label: 'Observed', years: allY, values: obs, kind: 'observed', colour: '#4fb98a' },
          { label: 'Forecast', years: allY, values: fv, kind: 'forecast', colour: '#6ba3e0',
            bands: [{ lower: lo95, upper: hi95, opacity: 0.10 }, { lower: lo80, upper: hi80, opacity: 0.16 }] }
        ]
      }, { width: 900, height: 420 });
      out.appendChild(figure(res.label + ' forecast', node));
      out.appendChild(kindLegend());
      out.appendChild(note('warning', fc.caveat));

      // forecast table
      const rows = [];
      for (let i = 0; i < hz; i++) {
        rows.push([lastYear + i + 1, f(fc.mean[i], 1),
          f(fc.intervals['80'].lower[i], 1), f(fc.intervals['80'].upper[i], 1),
          f(fc.intervals['95'].lower[i], 1), f(fc.intervals['95'].upper[i], 1)]);
      }
      out.appendChild(card('Forecast values', [
        h('div', { class: 'scroll-y' }, [table(null,
          ['Year', 'Forecast', '80% lower', '80% upper', '95% lower', '95% upper'], rows,
          [false, true, true, true, true, true])]),
        h('div', { class: 'controls', style: 'margin-top:10px' }, [
          h('button', { text: 'Download CSV', onclick: () => {
            const L = ['# ' + res.label + ' forecast, ' + b.label,
                       '# model,' + m.label, '# database,' + b.db, '# basis,' + b.basis,
                       '# generated,' + new Date().toISOString(), '',
                       'year,forecast,lower80,upper80,lower95,upper95'];
            rows.forEach(r => L.push(r.join(',').replace(/,/g, ',')));
            downloadText(L.join('\n'), slug(b.label + ' ' + id) + '-forecast.csv', 'text/csv');
          } })
        ])
      ]));
    }, 30);
  }

  /* ----------------------------------------------------------- scenarios */

  function renderScenarios() {
    const el = $('#p-scenarios');
    el.innerHTML = '';
    if (S.trends) { renderTrends(el, 'the policy simulator'); return; }
    const b = bal();
    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: 'Rice self-sufficiency policy simulator — ' + b.label }),
      h('p', { text: 'target year ' + S.targetYear })
    ]));
    el.appendChild(note('warning', 'Everything below is a SIMULATION under stated assumptions. It is ' +
      'not a prediction and not causal evidence about what a policy would achieve. Every parameter ' +
      'is shown and editable.'));

    const P = S.params || (S.params = defaultParams());

    const ctl = h('div', { class: 'controls' }, [
      slider('Area expansion', 0, 100, P.area * 100, v => { P.area = v / 100; draw(); }, '%'),
      slider('Variety adoption', 0, 100, P.adoption * 100, v => { P.adoption = v / 100; draw(); }, '%'),
      slider('Yield gain per adopter', 0, 80, P.gain * 100, v => { P.gain = v / 100; draw(); }, '%'),
      slider('Yield improvement', 0, 80, P.yieldImp * 100, v => { P.yieldImp = v / 100; draw(); }, '%'),
      slider('Import tariff', 0, 50, P.tariff * 100, v => { P.tariff = v / 100; draw(); }, '%')
    ]);

    // Phase-in model. How fast an intervention arrives changes the answer as much
    // as how big it is, so the shape is a first-class, user-chosen assumption.
    const rampOpts = Object.keys(RSAScenarios.RAMPS).map(k => [k, RSAScenarios.RAMPS[k].label]);
    const rampNote = h('div', { class: 'muted' });
    function setRampNote() {
      const m = RSAScenarios.RAMPS[S.rampModel || 'linear'];
      rampNote.textContent = m.label + ' — ' + m.note;
    }
    const modelCtl = h('div', { class: 'controls' }, [
      field('Phase-in model', selectEl('sc-ramp', rampOpts, S.rampModel || 'linear', v => {
        S.rampModel = v; setRampNote(); S.cache.map = {}; draw();
      })),
      field('Fully phased in by', selectEl('sc-rampto', HORIZONS.map(y => [String(y), String(y)]),
        String(S.rampTo || S.targetYear), v => { S.rampTo = Number(v); draw(); }))
    ]);
    setRampNote();

    el.appendChild(card(T('sec.policyLevers'), [ctl]));
    el.appendChild(card(T('sec.simModel'), [modelCtl, rampNote,
      note('info', 'Every scenario below is reported at ' + HORIZONS.join(', ') + '. The phase-in ' +
        'model controls how the intervention arrives between now and the year it is fully in place; ' +
        'after that year it holds at full intensity rather than switching off.')]));

    const out = h('div', { class: 'spinner', text: 'Building baseline…' });
    el.appendChild(out);
    setTimeout(draw, 30);

    function draw() {
      out.classList.remove('spinner');
      out.innerHTML = '';
      // Always project to the last horizon so every scenario can be reported at
      // all five, regardless of which target year is selected.
      const maxHorizon = HORIZONS[HORIZONS.length - 1];
      const base = RSAScenarios.baseline(b, maxHorizon, {});
      if (!base.ok) { out.appendChild(note('error', base.reason)); return; }

      // Plausibility problems with the baseline go at the very top: every number
      // below inherits them, so they must be read before anything else.
      (base.warnings || []).forEach(w => out.appendChild(note(w.level, w.text)));

      const opts = { rampTo: S.rampTo || S.targetYear, rampModel: S.rampModel || 'linear' };
      const scenarios = [
        RSAScenarios.scenarioArea(base, P.area, opts),
        RSAScenarios.scenarioVariety(base, P.adoption, P.gain, opts),
        RSAScenarios.scenarioTariff(base, P.tariff, opts),
        RSAScenarios.scenarioYield(base, P.yieldImp, opts),
        RSAScenarios.scenarioCombined(base, {
          areaExpansion: P.area, adoptionRate: P.adoption, varietyYieldGain: P.gain,
          yieldImprovement: P.yieldImp, tariff: P.tariff
        }, opts)
      ];

      // baseline card
      const end = RSAScenarios.atTarget(base.path, S.targetYear);
      const cross = RSAScenarios.firstCrossing(base.path, 100);
      const baseHorizons = HORIZONS.map(y => {
        const p = RSAScenarios.pointAt(base.path, y);
        return p ? [y, f(p.ssr) + '%', tonnes(p.production), tonnes(p.consumption),
                    tonnes(p.imports), p.population ? (p.population / 1e6).toFixed(1) + 'M' : '—']
                 : [y, '—', '—', '—', '—', '—'];
      });
      out.appendChild(card(T('sec.baseline'), [
        h('div', { class: 'kpis' }, [
          kpi('SSR at ' + S.targetYear, f(end.ssr) + '%', null, 'forecast'),
          kpi('Production', tonnes(end.production), null, 'forecast'),
          kpi('Consumption', tonnes(end.consumption), null, 'forecast'),
          kpi('Imports needed', tonnes(end.imports), null, 'forecast'),
          kpi('Population', end.population ? (end.population / 1e6).toFixed(1) + 'M' : '—', null, 'forecast')
        ]),
        table('Baseline at each horizon',
          ['Year', 'SSR', 'Production', 'Consumption', 'Imports', 'Population'],
          baseHorizons, [false, true, true, true, true, true]),
        finding(cross ? 'positive' : 'warning',
          cross ? 'Projected self-sufficiency year: ' + cross
                : 'Self-sufficiency is not reached under the baseline trajectory by ' + S.targetYear,
          cross ? 'On the baseline projection SSR first reaches 100% in ' + cross + '.'
                : 'The baseline projection does not reach 100% by ' + S.targetYear +
                  '. No crossing year is shown because the projection does not produce one.'),
        note('info', base.structure + '. Population: ' + base.populationSource + '.'),
        note('warning', base.caveat),
        table('How each component was projected',
          ['Component', 'Method', 'Model', 'Last observed'],
          ['area', 'yield', 'cpc'].map(k => {
            const cp = base.components[k];
            return [k, cp.method, cp.model, cp.lastObserved.year + ': ' + f(cp.lastObserved.value, 1)];
          }))
      ]));

      // SSR paths chart
      const years = base.path.map(p => p.year);
      const hist = base.history.filter(p => p.ssr != null);
      const allYears = hist.map(p => p.year).concat(years);
      const pad = n => hist.map(() => null);
      const node = RSAFigs.timeSeries({
        title: 'Self-sufficiency ratio: observed, baseline and scenarios',
        subtitle: 'dashed = model projection, dotted = policy simulation',
        unit: '%', yLabel: 'SSR (%)',
        reference: [{ value: 100, label: 'self-sufficiency' }],
        markers: [{ year: hist.length ? hist[hist.length - 1].year : null, label: 'projection starts' }],
        series: [
          { label: 'Observed', years: allYears, values: hist.map(p => p.ssr).concat(years.map(() => null)),
            kind: 'observed', colour: '#4fb98a', width: 2.4 },
          { label: 'Baseline', years: allYears, values: pad().concat(base.path.map(p => p.ssr)),
            kind: 'forecast', colour: '#6ba3e0' }
        ].concat(scenarios.map((sc, i) => ({
          label: sc.label, years: allYears, values: pad().concat(sc.path.map(p => p.ssr)),
          kind: 'scenario', colour: RSAFigs.colourFor(i + 2)
        })))
      }, { width: 900, height: 430 });
      out.appendChild(figure('SSR trajectories', node));
      out.appendChild(kindLegend());

      // per-scenario detail
      scenarios.forEach(sc => {
        const kids = [
          h('p', { class: 'muted', text: sc.description }),
          h('div', { class: 'kpis' }, [
            kpi('SSR at ' + S.targetYear, f(sc.summary.ssr) + '%', null, 'scenario'),
            kpi('vs baseline', (sc.summary.ssrChange > 0 ? '+' : '') + f(sc.summary.ssrChange) + ' pp', null, 'scenario'),
            kpi('Production', tonnes(sc.summary.production), null, 'scenario'),
            kpi('Import saving', tonnes(sc.summary.importSaving), null, 'scenario'),
            kpi('Estimated cost', usdRaw(sc.summary.cost), null, 'assumption'),
            kpi('Feasibility', sc.feasibility.level, null, 'assumption')
          ]),
          h('div', { class: 'formula', text: sc.equations.join('\n') })
        ];
        // Results at every horizon, which is what shows the SHAPE of the policy
        // rather than a single snapshot.
        kids.push(table('Results at each horizon',
          ['Year', 'Phase-in', 'SSR', 'Baseline SSR', 'Change', 'Production', 'Imports',
           'Import saving', 'Self-sufficient'],
          sc.horizons.map(r => r.available
            ? [r.year, pc(r.phaseIn), f(r.ssr) + '%', f(r.ssrBaseline) + '%',
               (r.ssrChange > 0 ? '+' : '') + f(r.ssrChange) + ' pp',
               tonnes(r.production), tonnes(r.imports), tonnes(r.importSaving),
               r.selfSufficient ? 'yes' : 'no']
            : [r.year, '—', '—', '—', '—', '—', '—', '—', '—']),
          [false, true, true, true, true, true, true, true, false]));

        sc.warnings.forEach(w => kids.push(note(w.level, w.text)));
        if (sc.consumerImpact) kids.push(note('warning', sc.consumerImpact.note));
        kids.push(h('div', { class: 'muted', text: 'Cost basis: ' + sc.costBasis }));
        out.appendChild(card(sc.label, kids));
      });

      // One table across every scenario and every horizon -- the single view a
      // policymaker comparing options actually needs.
      const matrixRows = [];
      scenarios.forEach(sc => {
        sc.horizons.forEach(r => {
          if (!r.available) return;
          matrixRows.push([sc.label, r.year, f(r.ssr) + '%',
            (r.ssrChange > 0 ? '+' : '') + f(r.ssrChange) + ' pp',
            f(r.idr) + '%', tonnes(r.production), tonnes(r.imports),
            tonnes(r.importSaving), r.selfSufficient ? 'yes' : 'no']);
        });
      });
      out.appendChild(card(T('sec.allHorizons'), [
        h('div', { class: 'scroll-y' }, [table(null,
          ['Scenario', 'Year', 'SSR', 'vs baseline', 'IDR', 'Production', 'Imports',
           'Import saving', 'Self-sufficient'],
          matrixRows, [false, false, true, true, true, true, true, true, false])]),
        h('div', { class: 'controls' }, [
          h('button', { text: 'Download matrix (CSV)', onclick: () => {
            const L = ['# scenario results at all horizons, ' + b.label,
                       '# database,' + q2(b.db), '# basis,' + q2(S.basis),
                       '# phase-in model,' + q2(RSAScenarios.RAMPS[S.rampModel || 'linear'].label),
                       '# fully phased in by,' + (S.rampTo || S.targetYear),
                       '# NOTE,scenario simulation under stated assumptions - not a prediction',
                       '# generated,' + new Date().toISOString(), '',
                       'scenario,year,ssr_pct,ssr_change_pp,idr_pct,production_t,imports_t,import_saving_t,self_sufficient'];
            scenarios.forEach(sc => sc.horizons.forEach(r => {
              if (!r.available) return;
              L.push([q2(sc.label), r.year, round4(r.ssr), round4(r.ssrChange), round4(r.idr),
                      round4(r.production), round4(r.imports), round4(r.importSaving),
                      r.selfSufficient ? 'yes' : 'no'].join(','));
            }));
            downloadText(L.join('\n'), slug(b.label) + '-scenario-horizons.csv', 'text/csv');
          } })
        ])
      ]));

      // comparison + score
      const cmp = RSAScenarios.compare(scenarios);
      out.appendChild(card(T('sec.comparison'), [
        table(null,
          ['Scenario', 'Area Δ', 'Yield Δ', 'Adoption', 'Tariff', 'Imports', 'SSR', 'IDR', 'Cost',
           'Cost per SSR point', 'Feasibility', 'Self-sufficient'],
          cmp.map(c => [c.scenario, pc(c.areaChange), pc(c.yieldChange), pc(c.adoption), pc(c.tariff),
            tonnes(c.imports), f(c.ssr) + '%', f(c.idr) + '%', usdRaw(c.cost),
            c.costPerSsrPoint ? usdRaw(c.costPerSsrPoint) : '—',
            c.feasibility.level, c.selfSufficient ? 'yes' : 'no']),
          [false, true, true, true, true, true, true, true, true, true, false, false])
      ]));

      const ranking = RSAPolicy.rankScenarios(scenarios, S.weights);
      out.appendChild(card(T('sec.policyScore'), [
        table(null, ['Rank', 'Scenario', 'Score', 'SSR gain', 'Import cut', 'Cost', 'Feasibility',
                     'Environment', 'Consumer welfare'],
          ranking.map(r => [r.rank, r.score.scenario, f(r.score.total, 1),
            f(r.score.components.ssrGain, 0), f(r.score.components.importReduction, 0),
            f(r.score.components.cost, 0), f(r.score.components.feasibility, 0),
            f(r.score.components.environment, 0), f(r.score.components.consumerWelfare, 0)]),
          [true, false, true, true, true, true, true, true, true]),
        h('div', { class: 'formula', text: ranking[0].score.equation }),
        weightEditor(() => draw())
      ].concat(ranking[0].score.caveats.map(c => note('info', c)))));

      const g2 = h('div', { class: 'grid g2' }, [
        figure('SSR by scenario', RSAFigs.scenarioBars(cmp, { width: 620, labelWidth: 190 })),
        figure('Cost against SSR gain', RSAFigs.costEffectiveness(cmp, { width: 620 }))
      ]);
      out.appendChild(g2);

      // optimiser
      const opt = RSAScenarios.optimize(base, { ssrTarget: 100 });
      const okids = [];
      if (opt.ok) {
        okids.push(h('div', { class: 'kpis' }, [
          kpi('Area expansion', pc(opt.solution.areaExpansion), null, 'scenario'),
          kpi('Variety adoption', pc(opt.solution.adoptionRate), null, 'scenario'),
          kpi('Yield improvement', pc(opt.solution.yieldImprovement), null, 'scenario'),
          kpi('Resulting SSR', f(opt.solution.ssr) + '%', null, 'scenario'),
          kpi('Estimated cost', usdRaw(opt.solution.cost), null, 'assumption')
        ]));
        okids.push(table('Cost breakdown', ['Component', 'Cost'],
          Object.keys(opt.solution.costParts).map(k => [k, usdRaw(opt.solution.costParts[k])]),
          [false, true]));
      } else {
        okids.push(finding('warning', 'No feasible least-cost package', opt.reason +
          (opt.bestAttainable ? ' The most ambitious admissible package reaches SSR ' +
            f(opt.bestAttainable.ssr) + '%.' : '')));
      }
      okids.push(h('div', { class: 'formula', text: opt.objective }));
      okids.push(table('Constraints', ['Constraint', 'Value'], [
        ['Maximum area expansion', pc(opt.constraints.maxArea)],
        ['Maximum adoption', pc(opt.constraints.maxAdoption)],
        ['Maximum yield improvement', pc(opt.constraints.maxYield)],
        ['Land ceiling', opt.constraints.landCeiling.source]
      ]));
      okids.push(note('warning', opt.disclaimer));
      out.appendChild(card(T('sec.leastCost'), okids));

      S.lastScenarios = scenarios;
      S.lastBaseline = base;
      S.lastRanking = ranking;
      S.lastOpt = opt;
    }
  }

  function weightEditor(onChange) {
    const w = S.weights || Object.assign({}, RSAPolicy.DEFAULT_WEIGHTS);
    S.weights = w;
    const wrap = h('div', { class: 'controls', style: 'margin-top:10px' });
    Object.keys(w).forEach(k => {
      wrap.appendChild(slider(k, 0, 50, w[k] * 100, v => { w[k] = v / 100; onChange(); }, '%'));
    });
    wrap.appendChild(h('button', { text: 'Reset weights', onclick: () => {
      S.weights = Object.assign({}, RSAPolicy.DEFAULT_WEIGHTS); onChange();
    } }));
    return wrap;
  }

  /* ------------------------------------------- self-sufficiency condition
   *
   * What would have to be true for each country to feed itself in rice, at each
   * horizon. Four routes to the frontier, each tested against its own ceiling,
   * with the binding constraint named where a route fails.
   */
  function renderCondition() {
    const el = $('#p-condition');
    el.innerHTML = '';

    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('cond.title') }),
      h('p', { text: T('cond.lede') })
    ]));
    el.appendChild(note('info', T('cond.method')));

    const P = S.condParams || (S.condParams = {
      maxYieldFactor: RSACondition.DEFAULTS.maxYieldFactor,
      maxAreaFactor: RSACondition.DEFAULTS.maxAreaFactor,
      maxAdoption: RSACondition.DEFAULTS.maxAdoption
    });

    el.appendChild(card(T('cond.ceilings'), [
      h('div', { class: 'controls' }, [
        slider(T('cond.maxYield'), 100, 400, P.maxYieldFactor * 100,
          v => { P.maxYieldFactor = v / 100; S.condCache = null; renderCondition(); }, '%'),
        slider(T('cond.maxArea'), 100, 600, P.maxAreaFactor * 100,
          v => { P.maxAreaFactor = v / 100; S.condCache = null; renderCondition(); }, '%'),
        slider(T('cond.maxAdopt'), 10, 100, P.maxAdoption * 100,
          v => { P.maxAdoption = v / 100; S.condCache = null; renderCondition(); }, '%')
      ]),
      note('warning', T('cond.ceilingNote'))
    ]));

    const host = h('div');
    el.appendChild(host);

    const opts = { dbKey: S.db, basis: S.basis, standardizedTrade: S.stdTrade !== false,
                   maxYieldFactor: P.maxYieldFactor, maxAreaFactor: P.maxAreaFactor,
                   maxAdoption: P.maxAdoption };
    const cacheKey = JSON.stringify(opts) + '|' + JSON.stringify(S.sel);

    // Scanning every country costs several seconds, so it runs chunked with a
    // progress bar and the result is cached against the exact options used.
    if (S.condCache && S.condCache.key === cacheKey) {
      condPaint(host, S.condCache);
      return;
    }

    const bar = h('div', { class: 'progress' }, [
      h('div', { class: 'progress-fill' }),
      h('span', { class: 'progress-label', text: T('cond.computing') })
    ]);
    host.appendChild(bar);
    const setProgress = (done, total, label) => {
      const pct = Math.round(100 * done / total);
      bar.querySelector('.progress-fill').style.width = pct + '%';
      bar.querySelector('.progress-label').textContent =
        T('cond.progress', { done: done, total: total, name: label || '' });
    };

    setTimeout(async () => {
      const mine = RSACondition.forSelection(S.sel, opts);
      const regions = await RSACondition.scanRegionsAsync(opts,
        (d, t, n) => setProgress(d, t + RSA.countries().length, n));
      const countries = await RSACondition.scanAllAsync(opts,
        (d, t, n) => setProgress(regions.length + d, t + regions.length, n));
      S.condCache = { key: cacheKey, mine: mine, regions: regions,
                      countries: countries, opts: opts };
      condPaint(host, S.condCache);
    }, 30);
  }

  function condPaint(host, c) {
    host.innerHTML = '';
    host.appendChild(condDetailCard(c.mine));
    host.appendChild(condMatrixCard(T('cond.regions'), c.regions.map(r =>
      ({ key: r.id, name: r.name, result: r.result }))));
    host.appendChild(condMatrixCard(T('cond.countries'), c.countries.map(x =>
      ({ key: x.iso3, name: x.name, result: x.result })), true));
    host.appendChild(condSummaryCard(c.countries));
    host.appendChild(condReportCard(c.mine, c.regions, c.countries, c.opts));
  }

  function condVerdictPill(v) {
    const cls = v.code === 'met' ? 'good' : v.code === 'none' ? 'bad' : 'mid';
    return '<span class="pill ' + cls + '">' + escapeHtml(v.label) + '</span>';
  }

  function condDetailCard(res) {
    if (!res.ok) return card(T('cond.detail'), [note('error', res.reason)]);
    const kids = [];

    if (!res.baselineReliable) {
      kids.push(note('error', T('cond.unreliable')));
    }
    (res.baselineWarnings || []).forEach(w => kids.push(note(w.level, w.text)));

    kids.push(h('div', { class: 'kpis' }, [
      kpi(T('cond.selection'), res.selection, null, 'observed'),
      kpi(T('cond.crossing'),
          res.baselineCrossing ? String(res.baselineCrossing) : T('cond.never'), null, 'forecast')
    ]));

    res.years.forEach(yr => {
      if (!yr.available) {
        kids.push(note('warning', yr.year + ': ' + yr.reason));
        return;
      }
      const v = RSACondition.verdict(yr);
      const sub = [
        h('div', { class: 'kpis' }, [
          kpi(T('cond.baselineSSR'), f(yr.baseline.ssr, 1) + '%', yr.year, 'forecast'),
          kpi(T('cond.gap'), yr.alreadySelfSufficient ? '—' : tonnes(yr.productionGap), null, 'forecast'),
          kpi(T('cond.multiplier'),
              yr.requiredMultiplier ? '×' + f(yr.requiredMultiplier, 2) : '—', null, 'forecast')
        ]),
        table(null,
          [T('cond.route'), T('cond.requirement'), T('cond.ceiling'), T('cond.feasible'), T('cond.binding')],
          yr.routes.map(r => {
            const rl = RSACondition.ROUTES.filter(x => x.id === r.id)[0];
            return [RSAi18n.get() === 'fr' && rl ? rl.labelFr : (rl ? rl.label : r.id),
                    r.requirement, r.ceilingLabel || '—',
                    r.feasible ? T('lbl.yes') : T('lbl.no'), r.binding || '—'];
          }), [false, false, false, false, false]),
        h('div', { class: 'note note-' + (yr.alreadySelfSufficient ? 'positive'
                    : yr.anyFeasible ? 'info' : 'warning'),
                   html: '<b>' + escapeHtml(T('cond.best')) + ':</b> ' +
                         (yr.best ? escapeHtml(routeLabel(yr.best.id)) : escapeHtml(T('cond.none'))) +
                         ' — ' + escapeHtml(yr.bestReason) })
      ];
      kids.push(h('div', { class: 'card', style: 'margin-bottom:12px' }, [
        h('h3', { html: yr.year + '  ' + condVerdictPill(v) })
      ].concat(sub)));
    });

    res.caveats.forEach(c => kids.push(note('warning', c)));
    return card(T('cond.detail') + ' — ' + res.selection, kids);
  }

  function routeLabel(id) {
    if (id === 'none') return T('cond.alreadyMet');
    const rl = RSACondition.ROUTES.filter(x => x.id === id)[0];
    return rl ? (RSAi18n.get() === 'fr' ? rl.labelFr : rl.label) : id;
  }

  function condMatrixCard(title, rows, scroll) {
    const H = RSACondition.HORIZONS;
    const tbl = h('table', { class: 'data' });
    const thead = h('thead'), tr = h('tr');
    tr.appendChild(h('th', { text: T('lbl.country') }));
    H.forEach(y => tr.appendChild(h('th', { text: String(y), class: 'num' })));
    thead.appendChild(tr); tbl.appendChild(thead);
    const tb = h('tbody');
    rows.forEach(r => {
      const row = h('tr');
      row.appendChild(h('td', { text: r.name }));
      H.forEach(y => {
        const td = h('td');
        if (!r.result.ok) { td.textContent = '—'; row.appendChild(td); return; }
        const yr = r.result.years.filter(x => x.year === y)[0];
        if (!yr || !yr.available) { td.textContent = '—'; row.appendChild(td); return; }
        const v = RSACondition.verdict(yr);
        td.innerHTML = condVerdictPill(v);
        td.title = yr.best ? routeLabel(yr.best.id) + ': ' +
          (yr.routes.filter(x => x.id === yr.best.id)[0] || {}).requirement || '' : '';
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    tbl.appendChild(tb);
    return card(title, [
      h('div', { class: scroll ? 'scroll-y' : 'scroll' }, [tbl]),
      note('info', T('cond.matrixNote'))
    ]);
  }

  function condSummaryCard(countries) {
    const H = RSACondition.HORIZONS;
    const rows = H.map(y => {
      let met = 0, mix = 0, single = 0, none = 0, na = 0;
      countries.forEach(c => {
        if (!c.result.ok) { na++; return; }
        const yr = c.result.years.filter(x => x.year === y)[0];
        if (!yr || !yr.available) { na++; return; }
        const v = RSACondition.verdict(yr);
        if (v.code === 'met') met++;
        else if (v.code === 'mix') mix++;
        else if (v.code === 'none') none++;
        else single++;
      });
      return [y, met, mix, single, none, na];
    });
    const node = RSAFigs.bars({
      title: T('cond.summaryChart'), subtitle: T('cond.summarySub'),
      unit: 'countries',
      rows: H.map((y, i) => ({ label: String(y),
        value: rows[i][1] + rows[i][2] + rows[i][3],
        colour: '#3f9e75',
        title: y + ': ' + (rows[i][1] + rows[i][2] + rows[i][3]) + ' reachable' }))
    }, { width: 560, labelWidth: 90 });

    return card(T('cond.summary'), [
      table(null, [T('lbl.year'), T('cond.cMet'), T('cond.cMix'), T('cond.cSingle'),
                   T('cond.cNone'), T('cond.cNa')],
        rows, [false, true, true, true, true, true]),
      figure(T('cond.summaryChart'), node, T('cond.summarySub')),
      h('div', { class: 'controls' }, [
        h('button', { text: T('lbl.downloadCsv'), onclick: () => downloadCondCsv() })
      ])
    ]);
  }

  function downloadCondCsv() {
    const c = S.condCache;
    if (!c) return;
    const q = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const L = ['# Rice Statistics for Africa — self-sufficiency condition',
               '# database,' + q(bal().db) + ',basis,' + q(S.basis),
               '# ceilings,yield x' + c.opts.maxYieldFactor + ',area x' + c.opts.maxAreaFactor +
                 ',adoption ' + c.opts.maxAdoption,
               '# NOTE,evaluated against a baseline PROJECTION - not observed data',
               '# NOTE,ceilings are assumptions; an infeasible verdict is infeasible under those bounds',
               '# generated,' + new Date().toISOString(), '',
               'scope,key,name,year,baseline_ssr_pct,production_gap_t,required_multiplier,' +
               'route,requirement,ceiling,feasible,binding_constraint,best_route'];
    const emit = (scope, key, name, res) => {
      if (!res.ok) { L.push([scope, key, q(name), '', '', '', '', '', q(res.reason), '', 'no', '', ''].join(',')); return; }
      res.years.forEach(yr => {
        if (!yr.available) { L.push([scope, key, q(name), yr.year, '', '', '', '', q(yr.reason), '', 'no', '', ''].join(',')); return; }
        yr.routes.forEach(r => {
          L.push([scope, key, q(name), yr.year, round4(yr.baseline.ssr), round4(yr.productionGap),
                  round4(yr.requiredMultiplier), r.id, q(r.requirement), q(r.ceilingLabel || ''),
                  r.feasible ? 'yes' : 'no', q(r.binding || ''),
                  yr.best ? yr.best.id : 'none'].join(','));
        });
      });
    };
    c.regions.forEach(r => emit('region', r.id, r.name, r.result));
    c.countries.forEach(r => emit('country', r.iso3, r.name, r.result));
    downloadText(L.join('\n'), 'self-sufficiency-condition.csv', 'text/csv');
  }

  function condReportCard(mine, regions, countries, opts) {
    const gen = h('button', { class: 'primary', text: T('cond.buildReport') });
    const out = h('div');
    gen.addEventListener('click', () => {
      out.innerHTML = '';
      const rep = buildConditionReport(mine, regions, countries, opts);
      out.appendChild(h('div', { class: 'controls' }, [
        h('button', { text: 'HTML (print to PDF)', onclick: () => {
          const w = window.open('', '_blank'); w.document.write(RSAReport.toHtml(rep)); w.document.close();
        } }),
        h('button', { text: 'Word (.doc)', onclick: () => downloadText(RSAReport.toWord(rep),
          'self-sufficiency-condition.doc', 'application/msword') }),
        h('button', { text: 'Markdown', onclick: () => downloadText(RSAReport.toMarkdown(rep),
          'self-sufficiency-condition.md', 'text/markdown') }),
        h('button', { text: 'LaTeX', onclick: () => downloadText(RSAReport.toLatex(rep),
          'self-sufficiency-condition.tex', 'text/x-tex') })
      ]));
      rep.sections.forEach(s => {
        const kids = [];
        s.blocks.forEach(b => { const n = renderBlock(b); if (n) kids.push(n); });
        out.appendChild(card(s.title, kids));
      });
    });
    return card(T('cond.report'), [
      h('p', { class: 'muted', text: T('cond.reportLede') }),
      h('div', { class: 'controls' }, [gen]),
      out
    ]);
  }

  function buildConditionReport(mine, regions, countries, opts) {
    const H = RSACondition.HORIZONS;
    const prov = RSA.provenance();
    const rep = {
      meta: {
        title: 'Self-sufficiency condition — African rice, ' + H[0] + '–' + H[H.length - 1],
        subtitle: bal().db + ' · ' + basisShort(),
        generated: new Date().toISOString(),
        platformVersion: RSA_VERSION,
        dataExtracted: prov.extracted
      },
      sections: []
    };
    const push = (id, title, blocks) => rep.sections.push({ id: id, title: title, blocks: blocks });

    const tally = y => {
      let met = 0, reach = 0, none = 0;
      countries.forEach(c => {
        if (!c.result.ok) return;
        const yr = c.result.years.filter(x => x.year === y)[0];
        if (!yr || !yr.available) return;
        if (yr.alreadySelfSufficient) { met++; reach++; }
        else if (yr.anyFeasible) reach++;
        else none++;
      });
      return { met: met, reach: reach, none: none };
    };

    push('summary', 'Executive summary', [
      { type: 'p', text:
        'Self-sufficiency at a given year means projected production covers projected utilization: ' +
        'A × Y ≥ cpc × N. Because production is the product of area and yield, that condition is not ' +
        'a single requirement but a frontier — any combination of area and yield on or above the ' +
        'curve satisfies it. This report asks, for each African country and region and for four ' +
        'horizons, which points on that frontier are actually reachable.' },
      { type: 'table', caption: 'How many countries could reach self-sufficiency',
        columns: ['Year', 'Already self-sufficient on the baseline', 'Reachable within the ceilings',
                  'Not reachable'],
        rows: H.map(y => { const t = tally(y); return [y, t.met, t.reach, t.none]; }) },
      { type: 'note', level: 'warning', text:
        'Reachable means reachable UNDER THE STATED CEILINGS — yield at most ' +
        opts.maxYieldFactor + '× current, area at most ' + opts.maxAreaFactor + '× current, ' +
        'adoption at most ' + (opts.maxAdoption * 100).toFixed(0) + '%. These are assumptions, not ' +
        'measurements. Change a ceiling and the verdict changes; every verdict names the ceiling it ' +
        'was tested against.' },
      { type: 'note', level: 'warning', text:
        'Reaching P/C = 1 is not the same as food security and is not necessarily optimal. A country ' +
        'able to import rice cheaply and export something else may be better off doing so ' +
        '(Clapp, 2017). This report answers what self-sufficiency would require, not whether it is ' +
        'worth requiring.' }
    ]);

    push('method', 'The condition and the four routes', [
      { type: 'equation', id: 'cond', label: 'The self-sufficiency condition',
        equation: 'A(T) × Y(T) / 1000 ≥ cpc(T) × N(T) / 1000',
        latex: 'A_T Y_T \\ge \\mathrm{cpc}_T N_T', unit: 't',
        variables: [
          { sym: 'A(T)', def: 'harvested area at the horizon', unit: 'ha' },
          { sym: 'Y(T)', def: 'yield at the horizon', unit: 'kg/ha' },
          { sym: 'cpc(T)', def: 'per-capita consumption at the horizon', unit: 'kg/capita/yr' },
          { sym: 'N(T)', def: 'population at the horizon, UN medium variant', unit: 'persons' }
        ],
        interpretation: 'Defines an isoquant in area-yield space. Every point on or above it meets ' +
          'the condition, so there is a frontier of answers rather than one answer.',
        limitations: 'Evaluated against a projected baseline, not observed data.' },
      { type: 'table', caption: 'The four routes and what each requires',
        columns: ['Route', 'Requirement', 'Tested against'],
        rows: [
          ['Yield only', 'Y* = 1000·C / A — hold area, raise yield to close the gap',
           'agronomic ceiling: ' + opts.maxYieldFactor + '× current yield'],
          ['Area only', 'A* = 1000·C / Y — hold yield, expand area to close the gap',
           'land ceiling: ' + opts.maxAreaFactor + '× current area'],
          ['Improved varieties only', 'a = (C/P − 1) / g — adoption rate at gain g per adopting hectare',
           'adoption ceiling: ' + (opts.maxAdoption * 100).toFixed(0) + '%'],
          ['Least-cost mix', 'cheapest admissible combination of all three',
           'all ceilings simultaneously, plus placeholder unit costs']
        ] },
      { type: 'p', text:
        'The routes are reported separately because they are not interchangeable in policy terms. ' +
        'Yield growth needs seed systems, fertiliser and extension: slow, but land-sparing. Area ' +
        'expansion is faster but converts wetland and forest, with emissions and biodiversity costs ' +
        'this platform does not price. Reporting only a blended optimum would hide precisely the ' +
        'trade-off that constitutes the political choice (van Oort et al., 2015).' }
    ]);

    push('regions', 'Regions and blocs', [
      { type: 'table', caption: 'Best route by region and horizon',
        columns: ['Region'].concat(H.map(String)),
        rows: regions.map(r => [r.name].concat(H.map(y => {
          if (!r.result.ok) return '—';
          const yr = r.result.years.filter(x => x.year === y)[0];
          if (!yr || !yr.available) return '—';
          if (yr.alreadySelfSufficient) return 'already met';
          if (!yr.anyFeasible) return 'not reachable';
          return yr.best ? routeLabel(yr.best.id) : 'not reachable';
        }))) }
    ]);

    push('countries', 'Countries', [
      { type: 'table', caption: 'Best route by country and horizon',
        columns: ['Country'].concat(H.map(String)),
        rows: countries.map(c => [c.name].concat(H.map(y => {
          if (!c.result.ok) return '—';
          const yr = c.result.years.filter(x => x.year === y)[0];
          if (!yr || !yr.available) return '—';
          if (yr.alreadySelfSufficient) return 'already met';
          if (!yr.anyFeasible) return 'not reachable';
          return yr.best ? routeLabel(yr.best.id) : 'not reachable';
        }))) },
      { type: 'table', caption: 'What the condition requires at ' + H[1] + ', by country',
        columns: ['Country', 'Baseline SSR', 'Yield needed', 'Area needed', 'Adoption needed', 'Feasible'],
        rows: countries.filter(c => c.result.ok).map(c => {
          const yr = c.result.years.filter(x => x.year === H[1])[0];
          if (!yr || !yr.available) return [c.name, '—', '—', '—', '—', '—'];
          const r = id => yr.routes.filter(x => x.id === id)[0] || {};
          return [c.name, f(yr.baseline.ssr, 1) + '%',
                  r('yield').value ? f(r('yield').value, 0) + ' kg/ha' : '—',
                  r('area').value ? RSACondition.fmtHa(r('area').value) : '—',
                  r('variety').value != null ? (r('variety').value * 100).toFixed(0) + '%' : '—',
                  yr.anyFeasible ? 'yes' : 'no'];
        }) }
    ]);

    if (mine.ok) {
      push('detail', 'Detail — ' + mine.selection,
        mine.years.filter(y => y.available).map(yr => ({
          type: 'table', caption: mine.selection + ', ' + yr.year +
            ' (baseline SSR ' + f(yr.baseline.ssr, 1) + '%)',
          columns: ['Route', 'Requirement', 'Ceiling', 'Feasible', 'Binding constraint'],
          rows: yr.routes.map(r => [routeLabel(r.id), r.requirement, r.ceilingLabel || '—',
                                    r.feasible ? 'yes' : 'no', r.binding || '—'])
        })).concat(mine.caveats.map(c => ({ type: 'note', level: 'warning', text: c }))));
    }

    push('limits', 'Limitations and reproducibility', [
      { type: 'list', items: (mine.ok ? mine.caveats : []).concat([
        'Countries that grow no rice appear with a baseline SSR of 0% and are reported as not ' +
        'reachable. That is arithmetically correct and substantively uninteresting: the question ' +
        'for Libya or Botswana is not how to grow rice.',
        'The least-cost mix uses placeholder unit costs. Its composition is more informative than ' +
        'its price.'
      ]) },
      { type: 'table', caption: 'Reproducibility', columns: ['Field', 'Value'],
        rows: [['Platform', 'Rice Statistics for Africa v' + RSA_VERSION],
               ['Database', bal().db], ['Basis', S.basis],
               ['Yield ceiling', opts.maxYieldFactor + '× current'],
               ['Area ceiling', opts.maxAreaFactor + '× current'],
               ['Adoption ceiling', (opts.maxAdoption * 100).toFixed(0) + '%'],
               ['Horizons', H.join(', ')],
               ['Data extracted', prov.extracted],
               ['Generated', new Date().toISOString()]] }
    ]);

    push('references', 'References', [
      { type: 'list', items: RSAVanOort.REFERENCES.map(r =>
        r.text + (r.doi ? ' doi:' + r.doi : '')) }
    ]);

    return rep;
  }

  /* ---------------------------------------------------------- crisis panel
   *
   * Interrupted time-series around dated external shocks. The counterfactual is
   * the load-bearing part: a movement that stays inside the pre-crisis model's
   * own prediction interval is reported as NOT evidence of a crisis effect, which
   * is the discipline that stops this section becoming a collection of stories.
   */
  function renderCrisis() {
    const el = $('#p-crisis');
    el.innerHTML = '';
    const b = bal();

    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('crisis.title') }),
      h('p', { text: b.label + ' · ' + b.db + ' · ' + basisShort() })
    ]));
    el.appendChild(note('info', T('crisis.method')));

    const ctl = h('div', { class: 'controls' }, [
      field(T('crisis.event'), selectEl('cr-sel',
        RSACrisis.CRISES.map(c => [c.id, crisisName(c)]).concat([['all', T('crisis.allEvents')]]),
        S.crisis || 'food2008', v => { S.crisis = v; renderCrisis(); })),
      field(T('ctl.indicator'), selectEl('cr-ind',
        RSACrisis.INDICATORS.map(id => [id, RSAIndicators.label(id)]),
        S.crisisIndicator || 'importUnitValue',
        v => { S.crisisIndicator = v; renderCrisis(); }))
    ]);
    el.appendChild(ctl);

    const host = h('div', { class: 'spinner', text: T('lbl.computing') });
    el.appendChild(host);

    setTimeout(() => {
      host.classList.remove('spinner');
      host.innerHTML = '';
      const which = S.crisis || 'food2008';
      const analyses = (which === 'all')
        ? RSACrisis.analyseAll(b, {})
        : [RSACrisis.analyse(b, which, {})].filter(Boolean);

      if (!analyses.length) { host.appendChild(note('error', 'No crisis analysis available.')); return; }

      analyses.forEach(a => host.appendChild(crisisCard(a, b)));

      // Cross-country ranking for a single selected event.
      if (which !== 'all') {
        host.appendChild(crisisCrossCountry(which));
      }

      // Recommendations and the report, at the end.
      host.appendChild(crisisRecommendations(analyses));
      host.appendChild(crisisReportCard(analyses, b));
    }, 30);
  }

  function crisisName(c) {
    return RSAi18n.get() === 'fr' && c.nameFr ? c.nameFr : c.name;
  }
  function crisisChannel(c) {
    return RSAi18n.get() === 'fr' && c.channelFr ? c.channelFr : c.channel;
  }

  function crisisCard(a, b) {
    const c = a.crisis;
    const kids = [];

    kids.push(h('p', { class: 'muted', text: crisisChannel(c) }));
    // A contaminated pre-window invalidates every "change from before" figure in
    // the card, so it goes above them rather than in a footnote.
    if (a.preWarning) kids.push(note('error', a.preWarning));
    kids.push(h('div', { class: 'kpis' }, [
      kpi(T('crisis.window'), c.start + '–' + c.end, null, 'observed'),
      kpi(T('crisis.preWindow'), a.windows.preFrom + '–' + a.windows.preTo, null, 'observed'),
      kpi(T('crisis.postWindow'),
          a.windows.hasPost ? a.windows.postFrom + '–' + a.windows.postTo : '—', null, 'observed')
    ]));

    // Event-window table.
    kids.push(table(T('crisis.tblWindows'),
      [T('ctl.indicator'), T('lbl.unit'), T('crisis.before'), T('crisis.during'),
       T('crisis.changePct'), T('crisis.after'), T('crisis.peakYear')],
      a.rows.map(r => [
        r.label, r.unit,
        r.pre == null ? '—' : RSAi18n.num(r.pre, 1),
        r.during == null ? '—' : RSAi18n.num(r.during, 1),
        r.changePct == null ? '—' : (r.changePct > 0 ? '+' : '') + RSAi18n.num(r.changePct, 1) + '%',
        r.post == null ? '—' : RSAi18n.num(r.post, 1),
        r.peak ? r.peak.year + ': ' + RSAi18n.num(r.peak.value, 1) : '—'
      ]), [false, false, true, true, true, true, true]));

    // Counterfactual for the chosen indicator.
    const id = S.crisisIndicator || 'importUnitValue';
    const cf = a.counterfactual[id] || RSACrisis.counterfactual(RSAIndicators.compute(id, b), c, {});
    kids.push(h('h3', { text: T('crisis.counterfactual') + ' — ' + RSAIndicators.label(id),
                        style: 'margin:16px 0 6px' }));
    if (!cf || !cf.ok) {
      kids.push(note('warning', T('crisis.cfUnavailable') + ' ' + (cf ? cf.reason : '')));
    } else {
      kids.push(h('div', { class: 'muted', text:
        cf.method + ' (' + cf.model + '), ' + T('crisis.fitted') + ' ' + cf.fittedFrom + '–' +
        cf.fittedTo + ' (n=' + cf.fittedN + ')' }));
      kids.push(table(null,
        [T('lbl.year'), T('crisis.actual'), T('crisis.expected'), '95% ' + T('crisis.lower'),
         '95% ' + T('crisis.upper'), T('crisis.deviation'), T('crisis.beyondNormal')],
        cf.rows.map(r => [r.year, RSAi18n.num(r.actual, 1), RSAi18n.num(r.expected, 1),
          RSAi18n.num(r.lower, 1), RSAi18n.num(r.upper, 1),
          (r.deviation > 0 ? '+' : '') + RSAi18n.num(r.deviation, 1) +
            (r.deviationPct != null ? ' (' + (r.deviationPct > 0 ? '+' : '') +
              RSAi18n.num(r.deviationPct, 1) + '%)' : ''),
          r.outsideInterval ? T('lbl.yes') : T('lbl.no')]),
        [false, true, true, true, true, true, false]));
      kids.push(note(cf.anyOutsideInterval ? 'warning' : 'info', cf.verdict));

      // Chart: observed, counterfactual, interval, crisis window marked.
      kids.push(crisisChart(b, c, id, cf));
    }

    // Structural break.
    const br = a.breaks[id];
    if (br && br.ok) {
      kids.push(table(T('crisis.chow'),
        ['F', 'df', 'p', T('crisis.nPre'), T('crisis.nPost'), T('crisis.conclusion')],
        [[RSAi18n.num(br.F, 3), br.df1 + ', ' + br.df2, RSAi18n.num(br.pValue, 4),
          br.nPre, br.nPost, br.conclusion]], [true, false, true, true, true, false]));
      kids.push(h('div', { class: 'muted', text: br.caveat }));
    }

    // Findings.
    kids.push(h('h3', { text: T('crisis.interpretation'), style: 'margin:16px 0 6px' }));
    a.findings.forEach(f => kids.push(finding(
      f.severity === 'high' ? 'warning' : f.severity === 'info' ? 'info' : 'info',
      f.title, f.text, T('crisis.evidence') + ': ' + f.evidence)));

    kids.push(note('info', T('crisis.expected') + ' ' + c.expect));
    kids.push(note('warning', T('crisis.confounders') + ' ' + c.confounders));
    kids.push(note('warning', a.caveat));

    return card(crisisName(c), kids);
  }

  function crisisChart(b, c, id, cf) {
    const res = RSAIndicators.compute(id, b);
    const years = res.years.slice();
    const expected = years.map(() => null);
    const lo = years.map(() => null), hi = years.map(() => null);
    cf.rows.forEach(r => {
      const i = years.indexOf(r.year);
      if (i < 0) return;
      expected[i] = r.expected; lo[i] = r.lower; hi[i] = r.upper;
    });
    // Anchor the counterfactual to the last pre-crisis observation so the dashed
    // line starts on the solid one instead of floating.
    const anchor = years.indexOf(cf.fittedTo);
    if (anchor >= 0) {
      expected[anchor] = res.values[anchor];
      lo[anchor] = res.values[anchor]; hi[anchor] = res.values[anchor];
    }
    const node = RSAFigs.timeSeries({
      title: RSAIndicators.label(id) + ' — ' + crisisName(c),
      subtitle: T('crisis.chartSub'),
      unit: res.unit, yLabel: res.unit,
      markers: [{ year: c.start, label: crisisName(c) }],
      series: [
        { label: T('legend.observed'), years: years, values: res.values,
          kind: 'observed', colour: '#4fb98a' },
        { label: T('crisis.counterfactualShort'), years: years, values: expected,
          kind: 'forecast', colour: '#6ba3e0',
          bands: [{ lower: lo, upper: hi, opacity: 0.14 }] }
      ]
    }, { width: 860, height: 400 });
    return figure(RSAIndicators.label(id) + ' — ' + crisisName(c), node, T('crisis.chartSub'));
  }

  function crisisCrossCountry(crisisId) {
    const id = S.crisisIndicator || 'importUnitValue';
    const rows = RSACrisis.crossCountry(crisisId, S.db, balOpts(), id);
    if (!rows.length) return card(T('crisis.crossCountry'), [note('info', T('lbl.noData'))]);
    const top = rows.slice(0, 15);
    const node = RSAFigs.bars({
      title: T('crisis.crossCountry') + ' — ' + RSAIndicators.label(id),
      subtitle: T('crisis.crossSub'),
      unit: '%', suffix: '%',
      rows: top.map(r => ({
        label: r.name, value: r.changePct,
        colour: r.beyondNormalVariation ? '#e0705c' : '#8a968f',
        title: r.name + ': ' + RSAi18n.num(r.changePct, 1) + '%' +
               (r.beyondNormalVariation ? ' (beyond normal variation)' : ' (within normal variation)')
      }))
    }, { width: 660, labelWidth: 190 });

    return card(T('crisis.crossCountry'), [
      figure(T('crisis.crossCountry'), node, T('crisis.crossSub')),
      table(null, [T('lbl.country'), T('crisis.before'), T('crisis.during'), T('crisis.changePct'),
                   T('crisis.beyondNormal')],
        top.map(r => [r.name, RSAi18n.num(r.pre, 1), RSAi18n.num(r.during, 1),
                      (r.changePct > 0 ? '+' : '') + RSAi18n.num(r.changePct, 1) + '%',
                      r.beyondNormalVariation == null ? '—'
                        : (r.beyondNormalVariation ? T('lbl.yes') : T('lbl.no'))]),
        [false, true, true, true, false]),
      note('info', T('crisis.crossNote')),
      h('div', { class: 'controls' }, [
        h('button', { text: T('lbl.downloadCsv'), onclick: () => {
          const c = RSACrisis.get(crisisId);
          const L = ['# crisis impact by country: ' + c.name,
                     '# indicator,' + q2(RSAIndicators.get(id).label),
                     '# window,' + c.start + '-' + c.end,
                     '# pre-window,' + (c.start - c.preYears) + '-' + (c.start - 1),
                     '# database,' + q2(S.db) + ',basis,' + q2(S.basis),
                     '# NOTE,association around a dated window - not causal identification',
                     '# generated,' + new Date().toISOString(), '',
                     'iso3,country,region,pre_mean,during_mean,change_pct,beyond_normal_variation'];
          rows.forEach(r => L.push([r.iso3, q2(r.name), q2(r.region), round4(r.pre),
                                    round4(r.during), round4(r.changePct),
                                    r.beyondNormalVariation == null ? '' : r.beyondNormalVariation].join(',')));
          downloadText(L.join('\n'), 'crisis-' + crisisId + '-' + id + '.csv', 'text/csv');
        } })
      ])
    ]);
  }

  function crisisRecommendations(analyses) {
    const rec = RSACrisis.recommendations(analyses);
    const kids = [h('p', { class: 'muted', text: rec.note })];
    rec.items.forEach(r => kids.push(finding('info', r.label, r.detail,
      r.addresses.length ? T('crisis.addresses') + ': ' + r.addresses.join(', ') : null)));
    kids.push(note('warning', T('crisis.recCaveat')));
    return card(T('crisis.recommendations'), kids);
  }

  /* The report the section ends with. Built from the same analysis objects the
   * panel displays, so the document and the screen cannot disagree. */
  function crisisReportCard(analyses, b) {
    const gen = h('button', { class: 'primary', text: T('crisis.buildReport') });
    const out = h('div');
    gen.addEventListener('click', () => {
      out.innerHTML = '';
      const rec = RSACrisis.recommendations(analyses);
      const rep = buildCrisisReport(analyses, rec, b);
      out.appendChild(h('div', { class: 'controls' }, [
        h('button', { text: 'HTML (print to PDF)', onclick: () => {
          const w = window.open('', '_blank');
          w.document.write(RSAReport.toHtml(rep));
          w.document.close();
        } }),
        h('button', { text: 'Markdown', onclick: () => downloadText(RSAReport.toMarkdown(rep),
          slug(b.label) + '-crisis-report.md', 'text/markdown') }),
        h('button', { text: 'Word (.doc)', onclick: () => downloadText(RSAReport.toWord(rep),
          slug(b.label) + '-crisis-report.doc', 'application/msword') }),
        h('button', { text: 'LaTeX', onclick: () => downloadText(RSAReport.toLatex(rep),
          slug(b.label) + '-crisis-report.tex', 'text/x-tex') }),
        h('button', { text: 'JSON', onclick: () => downloadText(
          JSON.stringify({ report: rep, analyses: analyses }, null, 2),
          slug(b.label) + '-crisis-report.json', 'application/json') })
      ]));
      rep.sections.forEach(s => {
        const kids = [];
        s.blocks.forEach(blk => { const n = renderBlock(blk); if (n) kids.push(n); });
        out.appendChild(card(s.title, kids));
      });
    });
    return card(T('crisis.report'), [
      h('p', { class: 'muted', text: T('crisis.reportLede') }),
      h('div', { class: 'controls' }, [gen]),
      out
    ]);
  }

  function buildCrisisReport(analyses, rec, b) {
    const prov = RSA.provenance();
    const rep = {
      meta: {
        title: T('crisis.title') + ' — ' + b.label,
        subtitle: b.db + ' · ' + basisShort(),
        generated: new Date().toISOString(),
        platformVersion: RSA_VERSION,
        dataExtracted: prov.extracted
      },
      sections: []
    };
    const push = (id, title, blocks) => rep.sections.push({ id: id, title: title, blocks: blocks });

    push('summary', T('crisis.repSummary'), [
      { type: 'p', text: T('crisis.repSummaryText', { n: analyses.length, sel: b.label }) },
      { type: 'note', level: 'warning', text: T('crisis.method') },
      { type: 'table', caption: T('crisis.repOverview'),
        columns: [T('crisis.event'), T('crisis.window'), T('crisis.repEffects'),
                  T('crisis.beyondNormal')],
        rows: analyses.map(a => {
          const real = a.findings.filter(f => f.severity !== 'info').length;
          const beyond = Object.keys(a.counterfactual)
            .filter(k => a.counterfactual[k].ok && a.counterfactual[k].anyOutsideInterval);
          return [crisisName(a.crisis), a.crisis.start + '–' + a.crisis.end, real,
                  beyond.length ? beyond.map(k => RSAIndicators.label(k)).join(', ') : T('lbl.no')];
        }) }
    ]);

    push('method', T('sec.methodology'), [
      { type: 'p', text: T('crisis.repMethod') },
      { type: 'equation', id: 'chow', label: 'Chow test for a structural break',
        equation: 'F = [ (RSS_p - (RSS_1 + RSS_2)) / k ] / [ (RSS_1 + RSS_2) / (n - 2k) ]',
        latex: 'F=\\frac{(RSS_p-(RSS_1+RSS_2))/k}{(RSS_1+RSS_2)/(n-2k)}',
        unit: '—',
        variables: [
          { sym: 'RSS_p', def: 'residual sum of squares, pooled regression', unit: '—' },
          { sym: 'RSS_1, RSS_2', def: 'residual sums of squares either side of the break', unit: '—' },
          { sym: 'k', def: 'parameters per regime (intercept and linear trend, so 2)', unit: '—' },
          { sym: 'n', def: 'total observations', unit: '—' }
        ],
        interpretation: 'Tests whether the level and trend differ either side of the crisis date. ' +
          'Distributed F(k, n − 2k) under the null of no break.',
        limitations: 'The break date is fixed by the historical record rather than estimated, which ' +
          'is the correct procedure here but means the test cannot find a break at a date nobody ' +
          'proposed. It assumes a linear trend and independent errors, neither of which is exactly ' +
          'true of these series.' },
      { type: 'equation', id: 'cf', label: 'Counterfactual deviation',
        equation: 'deviation_t = actual_t - E[y_t | pre-crisis data]',
        latex: '\\delta_t = y_t - \\hat{y}_t^{\\,\\text{pre}}',
        unit: 'series unit',
        variables: [
          { sym: 'y_t', def: 'observed value in crisis year t', unit: 'series unit' },
          { sym: 'yhat_t', def: 'projection from a model fitted only to pre-crisis data', unit: 'series unit' }
        ],
        interpretation: 'The estimated shock: how far the series moved from what its own prior ' +
          'behaviour implied. Reported against the projection’s 95% prediction interval.',
        limitations: 'A deviation inside the interval is not evidence of an effect. The interval ' +
          'covers innovation uncertainty only, so it is if anything too narrow, which makes an ' +
          '"outside the interval" verdict easier to obtain than it should be.' }
    ]);

    analyses.forEach(a => {
      const blocks = [];
      blocks.push({ type: 'p', text: crisisChannel(a.crisis) });
      if (a.preWarning) blocks.push({ type: 'note', level: 'error', text: a.preWarning });
      blocks.push({ type: 'table', caption: T('crisis.tblWindows'),
        columns: [T('ctl.indicator'), T('lbl.unit'), T('crisis.before'), T('crisis.during'),
                  T('crisis.changePct'), T('crisis.after')],
        rows: a.rows.map(r => [r.label, r.unit,
          r.pre == null ? '—' : RSAi18n.num(r.pre, 1),
          r.during == null ? '—' : RSAi18n.num(r.during, 1),
          r.changePct == null ? '—' : (r.changePct > 0 ? '+' : '') + RSAi18n.num(r.changePct, 1) + '%',
          r.post == null ? '—' : RSAi18n.num(r.post, 1)]) });

      Object.keys(a.counterfactual).forEach(k => {
        const cf = a.counterfactual[k];
        if (!cf.ok) return;
        blocks.push({ type: 'table',
          caption: T('crisis.counterfactual') + ' — ' + RSAIndicators.label(k) +
                   ' (' + cf.model + ', ' + cf.fittedFrom + '–' + cf.fittedTo + ')',
          columns: [T('lbl.year'), T('crisis.actual'), T('crisis.expected'), '95% lo', '95% hi',
                    T('crisis.deviation'), T('crisis.beyondNormal')],
          rows: cf.rows.map(r => [r.year, RSAi18n.num(r.actual, 1), RSAi18n.num(r.expected, 1),
            RSAi18n.num(r.lower, 1), RSAi18n.num(r.upper, 1),
            (r.deviation > 0 ? '+' : '') + RSAi18n.num(r.deviation, 1),
            r.outsideInterval ? T('lbl.yes') : T('lbl.no')]) });
        blocks.push({ type: 'note', level: cf.anyOutsideInterval ? 'warning' : 'info', text: cf.verdict });
      });

      const brRows = Object.keys(a.breaks).filter(k => a.breaks[k].ok).map(k => {
        const br = a.breaks[k];
        return [RSAIndicators.label(k), RSAi18n.num(br.F, 3), br.df1 + ', ' + br.df2,
                RSAi18n.num(br.pValue, 4), br.significant ? T('lbl.yes') : T('lbl.no')];
      });
      if (brRows.length) {
        blocks.push({ type: 'table', caption: T('crisis.chow') + ' (' + a.crisis.start + ')',
          columns: [T('ctl.indicator'), 'F', 'df', 'p', T('crisis.significant')], rows: brRows });
      }

      a.findings.forEach(f => blocks.push({ type: 'finding',
        level: f.severity === 'high' ? 'warning' : 'info',
        title: f.title, text: f.text, meta: T('crisis.evidence') + ': ' + f.evidence }));

      blocks.push({ type: 'note', level: 'info', text: T('crisis.expected') + ' ' + a.crisis.expect });
      blocks.push({ type: 'note', level: 'warning', text: T('crisis.confounders') + ' ' + a.crisis.confounders });
      push('crisis-' + a.crisis.id, crisisName(a.crisis), blocks);
    });

    push('recommendations', T('crisis.recommendations'), [
      { type: 'p', text: rec.note },
      { type: 'list', items: rec.items.map(r => r.label + ' — ' + r.detail) },
      { type: 'note', level: 'warning', text: T('crisis.recCaveat') }
    ]);

    push('limits', T('crisis.repLimits'), [
      { type: 'list', items: [
        T('crisis.lim1'), T('crisis.lim2'), T('crisis.lim3'), T('crisis.lim4'), T('crisis.lim5')
      ] },
      { type: 'table', caption: T('crisis.repManifest'), columns: ['Field', 'Value'],
        rows: [['Platform', 'Rice Statistics for Africa v' + RSA_VERSION],
               ['Selection', b.label], ['Database', b.db], ['Basis', b.basis],
               ['Trade series', 'FAOSTAT item ' + (b.tradeItem || '—')],
               ['Data extracted', prov.extracted],
               ['Generated', new Date().toISOString()],
               ['Crises analysed', analyses.map(a => a.crisis.id).join(', ')]] }
    ]);

    return rep;
  }

  /* ---------------------------------------------------------- data used
   *
   * Every variable the platform reads, per source, with units and coverage; plus
   * every equation in one place. Coverage counts are computed from what actually
   * loaded rather than transcribed, so the dictionary cannot drift away from the
   * data it describes.
   */
  function renderDataUsed() {
    const el = $('#p-datused');
    el.innerHTML = '';
    const cov = RSADataDict.coverage();
    if (S.trendVar == null) S.trendVar = 'production';
    if (S.trendScope == null) S.trendScope = 'countries';

    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('data.title') }),
      h('p', { text: T('data.lede') })
    ]));

    el.appendChild(h('div', { class: 'controls' }, [
      h('button', { class: 'primary', text: T('data.dlDict'), onclick: () => downloadText(
        RSADataDict.toCsv(), 'rsa-data-dictionary.csv', 'text/csv') }),
      h('button', { text: T('data.dlEq'), onclick: () => downloadText(
        RSADataDict.equationsToCsv(), 'rsa-equations.csv', 'text/csv') }),
      h('button', { text: 'Markdown', onclick: () => downloadText(
        RSADataDict.toMarkdown(), 'rsa-data-used.md', 'text/markdown') }),
      h('button', { text: 'JSON', onclick: () => downloadText(
        RSADataDict.toJson(), 'rsa-data-used.json', 'application/json') }),
      h('button', { text: T('data.dlAll'), onclick: downloadAllSeries })
    ]));

    el.appendChild(trendsMatrixCard());

    // One card per source.
    RSADataDict.SOURCES.forEach(s => {
      const c = cov[s.id] || {};
      const kids = [
        h('div', { class: 'kpis' }, [
          kpi(T('data.item'), s.item, null, 'observed'),
          kpi(T('data.coverage'), (c.countries != null ? c.countries : '—') + '', c.years, 'observed'),
          kpi(T('data.variables'), String(s.variables.length), null, 'observed')
        ]),
        note('info', T('data.basis') + ': ' + s.basis),
        table(null, [T('data.element'), T('data.variable'), T('data.symbol'), T('lbl.unit'), T('data.note')],
          s.variables.map(v => [v.code, v.name, v.symbol, v.unit, v.note || '—']),
          [false, false, false, false, false])
      ];
      if (c.missing && c.missing !== 'none') {
        kids.push(note('warning', T('data.notCovered') + ': ' + c.missing));
      }
      kids.push(h('div', { class: 'muted' }, [
        document.createTextNode(T('data.bulk') + ': '),
        h('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.url })
      ]));
      kids.push(h('div', { class: 'muted' }, [
        document.createTextNode(T('data.portal') + ': '),
        h('a', { href: s.portal.indexOf('http') === 0 ? s.portal : '#',
                 target: '_blank', rel: 'noopener', text: s.portal })
      ]));
      el.appendChild(card(s.db + ' — ' + s.dataset, kids));
    });

    // Derived series.
    el.appendChild(card(T('data.derived'), [
      h('p', { class: 'muted', text: T('data.derivedNote') }),
      table(null, [T('data.variable'), T('data.symbol'), T('lbl.unit'), T('data.derivation')],
        RSADataDict.DERIVED.map(d => [d.name, d.symbol, d.unit, d.from]))
    ]));

    // Equations, grouped.
    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('data.equations') })]));
    const eqs = RSADataDict.equations();
    const groups = [];
    eqs.forEach(e => { if (groups.indexOf(e.group) < 0) groups.push(e.group); });
    groups.forEach(g => {
      const kids = [];
      eqs.filter(e => e.group === g).forEach(e => {
        kids.push(h('div', { class: 'eq' }, [
          h('h4', { text: e.label }),
          h('div', { class: 'formula', text: e.equation }),
          (function () {
            const dl = h('dl');
            (e.variables || []).forEach(v => {
              dl.appendChild(h('dt', { text: v.sym }));
              dl.appendChild(h('dd', { text: v.def + (v.unit && v.unit !== '-' ? ' (' + v.unit + ')' : '') }));
            });
            return dl;
          })(),
          e.note ? h('p', { class: 'muted', text: e.note }) : null,
          h('p', { class: 'interp', html: '<b>' + escapeHtml(T('data.interp')) + '.</b> ' + escapeHtml(e.interpretation) }),
          h('p', { class: 'limit', html: '<b>' + escapeHtml(T('data.limits')) + '.</b> ' + escapeHtml(e.limitations) }),
          e.source ? h('p', { class: 'muted', text: T('data.source') + ': ' + e.source }) : null
        ].filter(Boolean)));
      });
      el.appendChild(card(g, kids));
    });

    // References.
    el.appendChild(card(T('data.references'), [
      h('ol', {}, RSAVanOort.REFERENCES.map(r => h('li', { style: 'margin-bottom:8px' }, [
        h('span', { text: r.text + (r.doi ? ' doi:' + r.doi : '') }),
        r.role ? h('div', { class: 'muted', text: r.role }) : null
      ].filter(Boolean))))
    ]));
  }

  /* ---------------------------------------------- variable trends by source
   *
   * The reproducibility table: one variable, every country and region, both
   * databases, across the whole record. This is what makes a published figure
   * checkable against this platform without downloading anything -- pick the
   * variable, find the country, read the year.
   *
   * Two things are stated rather than glossed. The record is 1961-2024, not
   * 1960-2026: FAOSTAT begins in 1961 and the last observed year is 2024, so
   * columns outside that are absent rather than filled. And FAOSTAT production
   * is PADDY while USDA is MILLED, so the two columns are not the same
   * measurement -- shown side by side precisely so the gap is visible.
   */
  const TREND_DECADES = [1961, 1970, 1980, 1990, 2000, 2010, 2020];

  function trendsMatrixCard() {
    const I = RSAIndicators;
    const VARS = ['production', 'area', 'yield', 'imports', 'exports', 'consumption',
                  'population', 'ppc', 'cpc', 'ssr', 'idr', 'cpcFood', 'ssrFbs'];
    const host = h('div', {});

    const paint = () => {
      host.innerHTML = '';
      const id = S.trendVar;
      const d = I.get(id);
      const years = TREND_DECADES.concat([RSA.state.fao.years[RSA.state.fao.years.length - 1]])
        .filter((y, i, a) => a.indexOf(y) === i);

      const rowsFor = (kind) => {
        const items = kind === 'regions'
          ? RSA.regions().map(r => ({ label: r, sel: { kind: 'region', id: r } }))
              .concat([{ label: T('sel.africa'), sel: { kind: 'africa' } }])
          : RSA.countries().map(c => ({ label: c.name, iso: c.iso3,
                                        sel: { kind: 'country', id: c.iso3 } }));
        return items.map(it => {
          const cells = [it.label + (it.iso ? ' (' + it.iso + ')' : '')];
          ['fao', 'usda'].forEach(db => {
            let r = null;
            try {
              r = I.compute(id, RSA.balance(db, it.sel, { basis: S.basis || 'milled',
                                                          standardizedTrade: S.stdTrade !== false }));
            } catch (e) { r = null; }
            years.forEach(y => {
              if (!r) { cells.push('—'); return; }
              const i = r.years.indexOf(y);
              const v = i < 0 ? null : r.values[i];
              cells.push(v == null ? '—' : f(v, (d && d.unit === '%') ? 1 : 0));
            });
          });
          return cells;
        });
      };

      const head = [T('tbl.country')]
        .concat(years.map(y => 'FAO ' + y))
        .concat(years.map(y => 'USDA ' + y));

      host.appendChild(h('p', { class: 'muted', text:
        (d ? d.label + ' — ' + (d.unitLabel || d.unit) : id) +
        ' · ' + T('data.trendBasis').replace('{0}', S.basis || 'milled') }));
      host.appendChild(h('div', { class: 'scroll-y' },
        [table(null, head, rowsFor(S.trendScope), { sticky: true })]));
      host.appendChild(h('p', { class: 'muted small', text: T('data.trendNote') }));
    };

    const varSel = h('select', { id: 'c-trendvar', onchange: e => { S.trendVar = e.target.value; paint(); } },
      VARS.map(v => h('option', { value: v, text: I.label(v), selected: v === S.trendVar })));
    const scopeSel = h('select', { id: 'c-trendscope', onchange: e => { S.trendScope = e.target.value; paint(); } },
      [h('option', { value: 'countries', text: T('data.scopeCountries'),
                     selected: S.trendScope === 'countries' }),
       h('option', { value: 'regions', text: T('data.scopeRegions'),
                     selected: S.trendScope === 'regions' })]);

    const controls = h('div', { class: 'controls' }, [
      h('label', { for: 'c-trendvar', text: T('data.variable') }), varSel,
      h('label', { for: 'c-trendscope', text: T('data.scope') }), scopeSel,
      h('button', { text: T('data.dlTrend'), onclick: () => downloadTrendMatrix() })
    ]);

    paint();
    return card(T('data.trendTitle'), [h('p', { text: T('data.trendLede') }), controls, host]);
  }

  /* The same matrix as a CSV, at annual resolution rather than by decade, so a
   * reader can check any year rather than only the ones the table has room for. */
  function downloadTrendMatrix() {
    const I = RSAIndicators;
    const id = S.trendVar;
    const d = I.get(id);
    const q = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const yrs = RSA.state.fao.years;
    const L = ['# Rice Statistics for Africa v' + RSA_VERSION + ' — trends by source',
               '# variable,' + q(id) + ',' + q(d ? d.labelEn || d.label : id) + ',unit,' + q(d ? d.unit : ''),
               '# basis,' + q(S.basis || 'milled') + ',trade_item,' + (S.stdTrade !== false ? 30 : 31),
               '# observed record,' + yrs[0] + '-' + yrs[yrs.length - 1],
               '# NOTE,FAOSTAT production is PADDY; USDA PSD is MILLED. The columns are not the same measurement.',
               '# data extracted,' + RSA.state.meta.extracted,
               '', 'scope,code,name,source,' + yrs.join(',')];
    const emit = (scope, code, name, sel) => {
      ['fao', 'usda'].forEach(db => {
        let r = null;
        try { r = I.compute(id, RSA.balance(db, sel, { basis: S.basis || 'milled',
                                                       standardizedTrade: S.stdTrade !== false })); }
        catch (e) { return; }
        if (!r) return;
        const vals = yrs.map(y => {
          const i = r.years.indexOf(y);
          const v = i < 0 ? null : r.values[i];
          return v == null ? '' : Math.round(v * 1e6) / 1e6;
        });
        if (vals.every(v => v === '')) return;
        L.push([scope, code, q(name), db === 'fao' ? 'FAOSTAT' : 'USDA PSD'].concat(vals).join(','));
      });
    };
    RSA.countries().forEach(c => emit('country', c.iso3, c.nameEn || c.name, { kind: 'country', id: c.iso3 }));
    RSA.regions().forEach(r => emit('region', r, r, { kind: 'region', id: r }));
    emit('continent', 'AFR', 'Africa (all reporting countries)', { kind: 'africa' });
    downloadText(L.join('\n'), 'rsa-trends-' + id + '.csv', 'text/csv');
  }

  /* Bundles every observed series for every country into one CSV. This is the
   * download a researcher actually wants: the whole thing, in long format, with
   * source and unit on every row. */
  function downloadAllSeries() {
    const I = RSAIndicators;
    const q = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const L = ['# Rice Statistics for Africa — all observed series, long format',
               '# database,' + q(bal().db) + ',basis,' + q(S.basis) +
                 ',trade_item,' + (S.stdTrade !== false ? 30 : 31),
               '# data extracted,' + RSA.state.meta.extracted,
               '# generated,' + new Date().toISOString(),
               '# NOTE,derived series are marked in the kind column', '',
               'iso3,country,region,year,variable,value,unit,kind,source'];
    const ids = ['production', 'area', 'yield', 'imports', 'exports', 'importValue', 'exportValue',
                 'population', 'consumption', 'ppc', 'cpc', 'cpcFood', 'foodUse', 'kcalRice',
                 'ssr', 'ssrFood', 'idr', 'icr', 'ntr', 'pcb', 'importBill', 'importUnitValue'];
    const OBSERVED = { production: 1, area: 1, yield: 1, imports: 1, exports: 1,
                       importValue: 1, exportValue: 1, population: 1, cpcFood: 1,
                       foodUse: 1, kcalRice: 1 };
    RSA.countries().forEach(c => {
      const b = bal({ kind: 'country', id: c.iso3 });
      ids.forEach(id => {
        const d = I.get(id);
        if (!d) return;
        const r = I.compute(id, b);
        r.values.forEach((v, i) => {
          if (v == null || !isFinite(v)) return;
          L.push([c.iso3, q(c.name), q(c.region), r.years[i], id, Math.round(v * 1e6) / 1e6,
                  q(r.unit), OBSERVED[id] ? 'observed' : 'derived',
                  q(d.fbs ? 'FAOSTAT FBS' : b.db)].join(','));
        });
      });
    });
    downloadText(L.join('\n'), 'rsa-all-series-long.csv', 'text/csv');
  }

  /* ------------------------------------------------- West Africa model
   *
   * The van Oort et al. (2015) framework applied to each West African country and
   * to the region as a whole.
   */
  function renderWestAfrica() {
    const el = $('#p-westafrica');
    el.innerHTML = '';

    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('wa.title') }),
      h('p', { text: T('wa.lede') })
    ]));
    el.appendChild(note('info', T('wa.method')));

    const ctl = h('div', { class: 'controls' }, [
      field(T('ctl.target'), selectEl('wa-year',
        [2030, 2035, 2040, 2045, 2050].map(y => [String(y), String(y)]),
        String(S.waYear || 2035), v => { S.waYear = Number(v); renderWestAfrica(); })),
      field(T('wa.diet'), selectEl('wa-diet',
        RSAVanOort.DIET_SCENARIOS.map(d => [d.id, RSAi18n.get() === 'fr' ? d.labelFr : d.label]),
        S.waDiet || 'trend', v => { S.waDiet = v; renderWestAfrica(); }))
    ]);
    el.appendChild(ctl);

    const host = h('div', { class: 'spinner', text: T('lbl.computing') });
    el.appendChild(host);

    setTimeout(() => {
      host.classList.remove('spinner');
      host.innerHTML = '';
      const year = S.waYear || 2035;
      const diet = S.waDiet || 'trend';

      // Region first, then each country.
      const region = RSAVanOort.run({ kind: 'custom', ids: WEST_AFRICA },
        { targetYear: year, dbKey: S.db });
      const perCountry = WEST_AFRICA.map(iso => ({
        iso: iso, name: RSA.country(iso).name,
        res: RSAVanOort.run({ kind: 'country', id: iso }, { targetYear: year, dbKey: S.db })
      }));

      S.waRegion = region; S.waCountries = perCountry; S.waDietSel = diet;

      if (region.ok) host.appendChild(waRegionCard(region, diet));
      else host.appendChild(note('error', T('wa.regionFailed') + ' ' + region.reason));

      host.appendChild(waCountryTable(perCountry, diet, year));
      host.appendChild(waScenarioChart(perCountry, diet));
      host.appendChild(waValidationCard());
      host.appendChild(waReportCard(region, perCountry, diet, year));
    }, 30);
  }

  function waScenarioLabel(id) {
    const s = RSAVanOort.YIELD_SCENARIOS.filter(x => x.id === id)[0];
    if (!s) return id;
    return RSAi18n.get() === 'fr' ? s.labelFr : s.label;
  }

  function waRegionCard(r, diet) {
    const kids = [];
    kids.push(h('div', { class: 'kpis' }, [
      kpi(T('wa.baseYear'), String(r.baseYear), null, 'observed'),
      kpi(T('wa.baselinePC'), f(r.baseline.pcRatio, 2), null, 'observed'),
      kpi(T('lbl.production'), tonnes(r.baseline.productionMilled), null, 'observed'),
      kpi(T('lbl.consumption'), tonnes(r.baseline.consumption), null, 'observed'),
      kpi(T('wa.perCapita'), f(r.baseline.perCapita, 1) + ' kg', r.baseline.perCapitaYear, 'observed'),
      kpi(T('lbl.population'), (r.baseline.population / 1e6).toFixed(1) + 'M', null, 'observed')
    ]));
    kids.push(h('div', { class: 'muted', text: T('wa.pcSource') + ': ' + r.baseline.perCapitaSource }));

    const rows = r.rows.filter(x => x.dietScenario === diet);
    kids.push(table(T('wa.tblRegion') + ' — ' + r.targetYear,
      [T('wa.yieldScenario'), T('wa.yieldAt'), T('lbl.production'), T('lbl.consumption'),
       'P/C', T('lbl.imports'), T('wa.areaNeeded'), T('wa.expansionFactor'), T('lbl.selfSufficient')],
      rows.map(x => x.available
        ? [waScenarioLabel(x.yieldScenario), f(x.yield, 0) + ' kg/ha', tonnes(x.production),
           tonnes(x.consumption), f(x.pcRatio, 2), tonnes(x.imports),
           RSAi18n.num(x.areaNeeded / 1000, 0) + ' kha',
           '×' + f(x.areaExpansionFactor, 2), x.selfSufficient ? T('lbl.yes') : T('lbl.no')]
        : [waScenarioLabel(x.yieldScenario), T('wa.unavailable'), '—', '—', '—', '—', '—', '—', '—']),
      [false, true, true, true, true, true, true, true, false]));

    kids.push(note('info', T('wa.popGrowth', {
      f: f(r.target.populationGrowthFactor, 2), y: r.targetYear })));
    r.caveats.forEach(c => kids.push(note('warning', c)));
    return card(T('wa.region'), kids);
  }

  function waCountryTable(perCountry, diet, year) {
    const rows = [];
    perCountry.forEach(c => {
      if (!c.res.ok) { rows.push([c.name, T('wa.noModel'), '—', '—', '—', '—', '—', '—']); return; }
      const base = c.res.baseline;
      const get = id => (c.res.rows.filter(x => x.yieldScenario === id && x.dietScenario === diet)[0] || {});
      const none = get('none'), trend = get('trend'), p1 = get('plus1'), p2 = get('plus2'), p80 = get('pct80');
      rows.push([
        c.name,
        f(base.pcRatio, 2),
        none.available ? f(none.pcRatio, 2) : '—',
        trend.available ? (f(trend.pcRatio, 2) + (trend.trendCollapse ? ' ⚠' : '')) : '—',
        p1.available ? f(p1.pcRatio, 2) : '—',
        p2.available ? f(p2.pcRatio, 2) : '—',
        p80.available ? f(p80.pcRatio, 2) : T('wa.na'),
        trend.available ? '×' + f(trend.areaExpansionFactor, 2) : '—'
      ]);
    });
    return card(T('wa.tblCountries') + ' — ' + year, [
      h('div', { class: 'scroll' }, [table(null,
        [T('lbl.country'), 'P/C ' + T('wa.baseYear'), waScenarioLabel('none'), waScenarioLabel('trend'),
         waScenarioLabel('plus1'), waScenarioLabel('plus2'), waScenarioLabel('pct80'),
         T('wa.areaFactorTrend')],
        rows, [false, true, true, true, true, true, true, true])]),
      note('info', T('wa.tblNote')),
      (function () {
        const collapsed = perCountry.filter(c => c.res.ok && (c.res.rows.filter(
          x => x.yieldScenario === 'trend' && x.dietScenario === diet && x.trendCollapse)[0]));
        return collapsed.length
          ? note('warning', '⚠ ' + T('wa.collapseNote', { list: collapsed.map(c => c.name).join(', ') }))
          : null;
      })(),
      h('div', { class: 'controls' }, [
        h('button', { text: T('lbl.downloadCsv'), onclick: () => downloadWaCsv(perCountry, year) })
      ])
    ]);
  }

  function downloadWaCsv(perCountry, year) {
    const q = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const L = ['# van Oort et al. (2015) model applied to West Africa',
               '# reference,van Oort P.A.J. et al. (2015) Global Food Security 5:39-49 doi:10.1016/j.gfs.2015.01.002',
               '# milling rate,' + RSAVanOort.MILLING_RATE + ' (the paper Eq. 2)',
               '# target year,' + year,
               '# database,' + q(bal().db),
               '# NOTE,aggregate form - no rainfed/irrigated split outside the paper countries',
               '# NOTE,80% of potential requires Global Yield Gap Atlas simulations',
               '# generated,' + new Date().toISOString(), '',
               'iso3,country,base_year,base_area_ha,base_yield_kgha,base_pc_ratio,' +
               'yield_scenario,diet_scenario,yield_kgha,production_t_milled,consumption_t,' +
               'pc_ratio,imports_t,area_needed_ha,area_expansion_factor,self_sufficient,available'];
    perCountry.forEach(c => {
      if (!c.res.ok) { L.push([c.iso, q(c.name), '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'no: ' + q(c.res.reason)].join(',')); return; }
      const b = c.res.baseline;
      c.res.rows.forEach(x => {
        L.push([c.iso, q(c.name), c.res.baseYear, round4(b.area), round4(b.yield), round4(b.pcRatio),
                x.yieldScenario, x.dietScenario,
                x.available ? round4(x.yield) : '', x.available ? round4(x.production) : '',
                x.available ? round4(x.consumption) : '', x.available ? round4(x.pcRatio) : '',
                x.available ? round4(x.imports) : '', x.available ? round4(x.areaNeeded) : '',
                x.available ? round4(x.areaExpansionFactor) : '',
                x.available ? (x.selfSufficient ? 'yes' : 'no') : '',
                x.available ? 'yes' : 'no'].join(','));
      });
    });
    downloadText(L.join('\n'), 'west-africa-vanoort-' + year + '.csv', 'text/csv');
  }

  function waScenarioChart(perCountry, diet) {
    const ok = perCountry.filter(c => c.res.ok);
    if (!ok.length) return card(T('wa.chart'), [note('info', T('lbl.noData'))]);
    const node = RSAFigs.bars({
      title: T('wa.chart'),
      subtitle: T('wa.chartSub'),
      unit: 'ratio', reference: 1,
      rows: ok.map(c => {
        const r = c.res.rows.filter(x => x.yieldScenario === 'trend' && x.dietScenario === diet)[0];
        return { label: c.name, value: r && r.available ? r.pcRatio : null,
                 colour: r && r.available && r.pcRatio >= 1 ? '#3f9e75' : '#c9803f',
                 title: c.name + ': P/C ' + (r && r.available ? r.pcRatio.toFixed(2) : 'n/a') };
      }).filter(r => r.value != null)
    }, { width: 680, labelWidth: 190 });
    return card(T('wa.chart'), [figure(T('wa.chart'), node, T('wa.chartSub'))]);
  }

  function waValidationCard() {
    const v = RSAVanOort.validate();
    return card(T('wa.validation'), [
      h('p', { class: 'muted', text: v.note }),
      table(null, [T('lbl.country'), T('wa.publishedPC'), T('wa.recomputedPC'), T('wa.agrees'),
                   T('wa.publishedScenarios')],
        v.rows.map(r => [r.name, f(r.publishedPCRatio2012, 2), f(r.recomputedFromPaperTable1, 2),
          r.agrees ? T('lbl.yes') : T('lbl.no'),
          Object.keys(r.publishedScenarios).map(k => k + ' ' + r.publishedScenarios[k]).join(', ')]),
        [false, true, true, false, false]),
      note('info', T('wa.validationNote'))
    ]);
  }

  function waReportCard(region, perCountry, diet, year) {
    const gen = h('button', { class: 'primary', text: T('wa.buildReport') });
    const out = h('div');
    gen.addEventListener('click', () => {
      out.innerHTML = '';
      const rep = buildWaReport(region, perCountry, diet, year);
      out.appendChild(h('div', { class: 'controls' }, [
        h('button', { text: 'HTML (print to PDF)', onclick: () => {
          const w = window.open('', '_blank'); w.document.write(RSAReport.toHtml(rep)); w.document.close();
        } }),
        h('button', { text: 'Word (.doc)', onclick: () => downloadText(RSAReport.toWord(rep),
          'west-africa-vanoort-report.doc', 'application/msword') }),
        h('button', { text: 'Markdown', onclick: () => downloadText(RSAReport.toMarkdown(rep),
          'west-africa-vanoort-report.md', 'text/markdown') }),
        h('button', { text: 'LaTeX', onclick: () => downloadText(RSAReport.toLatex(rep),
          'west-africa-vanoort-report.tex', 'text/x-tex') }),
        h('button', { text: 'JSON', onclick: () => downloadText(
          JSON.stringify({ report: rep, region: region, countries: perCountry }, null, 2),
          'west-africa-vanoort-report.json', 'application/json') })
      ]));
      rep.sections.forEach(s => {
        const kids = [];
        s.blocks.forEach(b => { const n = renderBlock(b); if (n) kids.push(n); });
        out.appendChild(card(s.title, kids));
      });
    });
    return card(T('wa.report'), [
      h('p', { class: 'muted', text: T('wa.reportLede') }),
      h('div', { class: 'controls' }, [gen]),
      out
    ]);
  }

  function buildWaReport(region, perCountry, diet, year) {
    const prov = RSA.provenance();
    const ok = perCountry.filter(c => c.res.ok);
    const dietLabel = (RSAVanOort.DIET_SCENARIOS.filter(d => d.id === diet)[0] || {}).label || diet;
    const rep = {
      meta: {
        title: 'Rice self-sufficiency in West Africa to ' + year +
               ' — the van Oort et al. (2015) framework',
        subtitle: bal().db + ' · milling rate ' + RSAVanOort.MILLING_RATE + ' · ' + dietLabel,
        generated: new Date().toISOString(),
        platformVersion: RSA_VERSION,
        dataExtracted: prov.extracted
      },
      sections: []
    };
    const push = (id, title, blocks) => rep.sections.push({ id: id, title: title, blocks: blocks });

    /* ---- summary */
    const trendRows = ok.map(c => {
      const r = c.res.rows.filter(x => x.yieldScenario === 'trend' && x.dietScenario === diet)[0];
      return { name: c.name, pc: r && r.available ? r.pcRatio : null,
               factor: r && r.available ? r.areaExpansionFactor : null };
    }).filter(r => r.pc != null);
    const selfSuff = trendRows.filter(r => r.pc >= 1);
    const regionTrend = region.ok
      ? region.rows.filter(x => x.yieldScenario === 'trend' && x.dietScenario === diet)[0] : null;

    push('summary', 'Executive summary', [
      { type: 'p', text:
        'This report applies the rice self-sufficiency framework of van Oort et al. (2015) to the ' +
        'sixteen countries of West Africa and to the region as a whole, with a horizon of ' + year +
        '. The framework is a biophysical accounting identity: production is harvested area times ' +
        'yield, consumption is population times per-capita consumption, and self-sufficiency is ' +
        'their ratio P/C. Its contribution is the scenario structure around that identity — how ' +
        'much additional area would be required to reach P/C = 1 under different assumptions about ' +
        'yield growth and dietary change, with yield growth bounded by an agronomic ceiling rather ' +
        'than left free.' },
      { type: 'kpis', items: [
        { label: 'Countries modelled', value: ok.length + ' of ' + WEST_AFRICA.length, kind: 'observed' },
        { label: 'Region P/C, baseline', value: region.ok ? f(region.baseline.pcRatio, 2) : '—',
          year: region.ok ? region.baseYear : '', kind: 'observed' },
        { label: 'Region P/C at ' + year + ', recent trend',
          value: regionTrend && regionTrend.available ? f(regionTrend.pcRatio, 2) : '—', kind: 'scenario' },
        { label: 'Self-sufficient at ' + year,
          value: selfSuff.length + ' of ' + trendRows.length, kind: 'scenario' },
        { label: 'Diet scenario', value: dietLabel, kind: 'assumption' },
        { label: 'Milling rate', value: String(RSAVanOort.MILLING_RATE), kind: 'assumption' }
      ] },
      { type: 'finding',
        level: selfSuff.length === 0 ? 'warning' : 'info',
        title: selfSuff.length === 0
          ? 'On recent yield trends, no West African country reaches self-sufficiency by ' + year
          : selfSuff.length + ' of ' + trendRows.length + ' countries reach self-sufficiency by ' + year,
        text: selfSuff.length === 0
          ? 'This reproduces the central finding of van Oort et al. (2015) for their eight-country ' +
            'set: "with the current trends in yield, consumption, and population growth, none of ' +
            'the countries can achieve rice self-sufficiency in 2025 without additional area ' +
            'expansion." The arithmetic is not subtle — population is growing, per-capita rice ' +
            'consumption is growing in most of the region, and yield growth of roughly 100 kg/ha/yr ' +
            'is not enough to outrun both.'
          : 'Countries reaching P/C at or above 1: ' + selfSuff.map(r => r.name).join(', ') + '.' },
      { type: 'note', level: 'warning', text:
        'Self-sufficiency is not food security. A country can reach P/C = 1 and still have ' +
        'households unable to afford rice, and a low-P/C country with reliable foreign exchange may ' +
        'be entirely food-secure (Clapp, 2017). P/C measures the source of supply, not access to it.' }
    ]);

    /* ---- method */
    push('method', 'Model and equations', [
      { type: 'p', text:
        'The framework is that of van Oort et al. (2015), Global Food Security 5, 39-49. Production ' +
        'is calculated from harvested area and yield, separately for rainfed and irrigated systems ' +
        'where the split is known; milled production is 0.65 of unmilled; consumption is population ' +
        'times per-capita consumption; and yield increases are bounded at 80% of the biophysical ' +
        'potential following Cassman (2001).' },
      { type: 'equation', id: 'eq1', label: 'Eq. 1 — Production of unmilled rice',
        equation: 'P_unmilled = HA_rf x Y_rf + HA_ir x Y_ir',
        latex: 'P_{\\mathrm{unmilled}} = HA_{rf}Y_{rf} + HA_{ir}Y_{ir}', unit: '1000 t',
        variables: [
          { sym: 'HA_rf, HA_ir', def: 'harvested area, rainfed and irrigated', unit: '1000 ha' },
          { sym: 'Y_rf, Y_ir', def: 'yield, unmilled at 14% moisture', unit: 't/ha' }
        ],
        interpretation: 'The separation matters because actual yields and potentials are much ' +
          'higher under irrigation.',
        limitations: 'Run here in aggregate form for countries outside the paper\'s set, because ' +
          'the rainfed/irrigated split requires the SPAM land-cover map and GYGA simulations.',
        source: 'van Oort et al. (2015), Eq. 1' },
      { type: 'equation', id: 'eq2', label: 'Eq. 2 — Milled production',
        equation: 'P_milled = 0.65 x P_unmilled',
        latex: 'P_{\\mathrm{milled}} = 0.65\\,P_{\\mathrm{unmilled}}', unit: '1000 t',
        variables: [{ sym: '0.65', def: 'milling conversion; 30-40% of weight is removed as husk and bran', unit: '-' }],
        interpretation: 'Consumption is conventionally expressed in milled rice, so production must be too.',
        limitations: 'The platform elsewhere uses FAO\'s 0.67. This section uses 0.65 so results are ' +
          'comparable with the published ones.',
        source: 'van Oort et al. (2015), Eq. 2' },
      { type: 'equation', id: 'eq3', label: 'Eq. 3 — Domestic consumption',
        equation: 'C_milled = Population x Per-capita consumption',
        latex: 'C_{\\mathrm{milled}} = N \\times \\mathrm{cpc}', unit: '1000 t',
        variables: [
          { sym: 'N', def: 'population, UN medium variant', unit: 'millions' },
          { sym: 'cpc', def: 'per-capita consumption of milled rice', unit: 'kg/person/yr' }
        ],
        interpretation: 'Consumption is demographic rather than extrapolated, which is what makes ' +
          'the projection robust: population to 2050 is far better known than any economic variable.',
        limitations: 'Per-capita consumption is taken from the FAOSTAT Food Balance Sheet where ' +
          'available. Where it is not, apparent utilization is used, which overstates diet wherever ' +
          're-export goes unrecorded.',
        source: 'van Oort et al. (2015), Eq. 3' },
      { type: 'equation', id: 'eq45', label: 'Eqs. 4-5 — Scenario production and required area',
        equation: "C_milled = 0.65[(HA_rf + dHA_rf)(Y_rf + dY_rf) + (HA_ir + dHA_ir)(Y_ir + dY_ir)]\n" +
                  "dHA_ir = [C_milled/0.65 - (HA_rf + dHA_rf)(Y_rf + dY_rf)]/(Y_ir + dY_ir) - HA_ir",
        latex: null, unit: '1000 ha',
        variables: [{ sym: 'dHA, dY', def: 'changes in harvested area and yield', unit: '1000 ha, t/ha' }],
        interpretation: 'Fix three of the four changes and the fourth is determined. This is how the ' +
          'area required for full self-sufficiency is obtained.',
        limitations: 'Says nothing about whether that area exists, what it currently supports, or ' +
          'what converting it would cost.',
        source: 'van Oort et al. (2015), Eqs. 4-5' },
      { type: 'equation', id: 'eq67', label: 'Eqs. 6-7 — Cropping intensity',
        equation: 'dA_ir = dHA_ir / CI_ir ;  max{dHA_ir} = A_ir (2.0 - CI_ir)',
        latex: null, unit: '1000 ha',
        variables: [{ sym: 'CI', def: 'cropping intensity, crops per year', unit: '-' }],
        interpretation: 'Harvested area can exceed physical area where two crops are grown a year. ' +
          'Intensification on existing irrigated land is capped at two crops.',
        limitations: 'CI_rf = 1 throughout: the paper found no double cropping in rainfed systems. ' +
          'Triple cropping is excluded as unrealistic at scale.',
        source: 'van Oort et al. (2015), Eqs. 6-7' },
      { type: 'equation', id: 'eq89', label: 'Eqs. 8-9 — Exploitable yield ceiling',
        equation: 'max{dY_rf} = 0.8 Yw_rf - Ya_rf ;  max{dY_ir} = 0.8 Yp_ir - Ya_ir',
        latex: '\\max\\{\\Delta Y\\} = 0.8\\,Y_{\\mathrm{pot}} - Y_a', unit: 't/ha',
        variables: [
          { sym: 'Yw', def: 'water-limited yield potential (rainfed benchmark)', unit: 't/ha' },
          { sym: 'Yp', def: 'yield potential (irrigated benchmark)', unit: 't/ha' },
          { sym: '0.8', def: 'exploitable fraction: beyond ~80% of potential the cost of further ' +
                             'yield gain generally exceeds the return', unit: '-' }
        ],
        interpretation: 'The ceiling is what stops the scenarios becoming arithmetic fantasies. ' +
          'Yields cannot simply be assumed upward without bound.',
        limitations: 'Yw and Yp are ORYZA2000 simulations from the Global Yield Gap Atlas and are ' +
          'not derivable from public statistics. For the four West African countries the paper ' +
          'covers, the ceiling is reconstructed from its published Table 2; for the other twelve it ' +
          'is unavailable and the 80% scenarios are reported as not computable.',
        source: 'van Oort et al. (2015), Eqs. 8-9; Cassman (2001)' },
      { type: 'table', caption: 'Scenario grid',
        columns: ['Yield scenario', 'Definition'],
        rows: RSAVanOort.YIELD_SCENARIOS.map(s => [s.label, s.note]) },
      { type: 'table', caption: 'Diet scenarios',
        columns: ['Diet scenario', 'Definition'],
        rows: RSAVanOort.DIET_SCENARIOS.map(s => [s.label, s.note]) }
    ]);

    /* ---- data */
    push('data', 'Data used', [
      { type: 'p', text: 'Every series is listed with its source, element code and unit in the ' +
        'platform\'s Data Used section, which is downloadable in full.' },
      { type: 'table', caption: 'Sources for this model',
        columns: ['Quantity', 'Source', 'Unit'],
        rows: [
          ['Harvested area', bal().db + ' (FAOSTAT item 27 element 5312 / USDA attribute 004)', 'ha'],
          ['Yield, unmilled', bal().db, 'kg/ha'],
          ['Population', 'FAOSTAT / UN World Population Prospects, medium variant', 'persons'],
          ['Per-capita consumption', 'FAOSTAT Food Balance Sheets, element 645 (milled)', 'kg/capita/yr'],
          ['Exploitable ceiling', 'Reconstructed from van Oort et al. (2015) Table 2', 'kg/ha'],
          ['Rainfed/irrigated area', 'van Oort et al. (2015) Table 5, four countries only', '1000 ha']
        ] },
      { type: 'note', level: 'info', text: 'Data extracted ' + prov.extracted + '.' }
    ]);

    /* ---- regional results */
    if (region.ok) {
      const rrows = region.rows.filter(x => x.dietScenario === diet);
      push('region', 'West Africa as a region', [
        { type: 'p', text:
          'The region is treated as a single accounting unit: areas, production and populations are ' +
          'summed and the ratio formed from the totals.' },
        { type: 'table', caption: 'West Africa, ' + year + ', ' + dietLabel,
          columns: ['Yield scenario', 'Yield (kg/ha)', 'Production (milled)', 'Consumption',
                    'P/C', 'Imports', 'Area needed', 'Expansion factor', 'Self-sufficient'],
          rows: rrows.map(x => x.available
            ? [waScenarioLabel(x.yieldScenario), f(x.yield, 0), tonnes(x.production),
               tonnes(x.consumption), f(x.pcRatio, 2), tonnes(x.imports),
               f(x.areaNeeded / 1000, 0) + ' kha', '×' + f(x.areaExpansionFactor, 2),
               x.selfSufficient ? 'yes' : 'no']
            : [waScenarioLabel(x.yieldScenario), 'not computable', '—', '—', '—', '—', '—', '—', '—']) },
        { type: 'note', level: 'warning', text:
          'A regional ratio can look adequate while individual countries within it are far from ' +
          'self-sufficient: a surplus in one nets against a deficit in another that no trade route ' +
          'may actually connect. Read the country table alongside this one.' }
      ].concat(region.caveats.map(c => ({ type: 'note', level: 'warning', text: c }))));
    }

    /* ---- country results */
    const countryBlocks = [
      { type: 'table', caption: 'P/C by country and yield scenario, ' + year + ', ' + dietLabel,
        columns: ['Country', 'P/C baseline', 'No yield increase', 'Recent trend', '+1 t/ha',
                  '+2 t/ha', '80% of potential', 'Area factor, trend'],
        rows: perCountry.map(c => {
          if (!c.res.ok) return [c.name, 'model could not be run', '—', '—', '—', '—', '—', '—'];
          const g = id => (c.res.rows.filter(x => x.yieldScenario === id && x.dietScenario === diet)[0] || {});
          const t = g('trend'), p80 = g('pct80');
          return [c.name, f(c.res.baseline.pcRatio, 2),
                  g('none').available ? f(g('none').pcRatio, 2) : '—',
                  t.available ? f(t.pcRatio, 2) : '—',
                  g('plus1').available ? f(g('plus1').pcRatio, 2) : '—',
                  g('plus2').available ? f(g('plus2').pcRatio, 2) : '—',
                  p80.available ? f(p80.pcRatio, 2) : 'n/a',
                  t.available ? '×' + f(t.areaExpansionFactor, 2) : '—'];
        }) },
      { type: 'note', level: 'info', text:
        'The 80%-of-potential column is available only for Burkina Faso, Ghana, Mali and Nigeria — ' +
        'the West African countries van Oort et al. covered. For the other twelve it requires ' +
        'Global Yield Gap Atlas simulations that do not exist in public statistics, and is reported ' +
        'as not available rather than estimated.' },
      { type: 'table', caption: 'Baseline by country',
        columns: ['Country', 'Base year', 'Area (ha)', 'Yield (kg/ha)', 'Per-capita consumption (kg)',
                  'Population', 'P/C'],
        rows: ok.map(c => [c.name, c.res.baseYear, f(c.res.baseline.area, 0),
          f(c.res.baseline.yield, 0), f(c.res.baseline.perCapita, 1),
          (c.res.baseline.population / 1e6).toFixed(2) + 'M', f(c.res.baseline.pcRatio, 2)]) }
    ];
    push('countries', 'Results by country', countryBlocks);

    /* ---- discussion, drawing on the paper */
    push('discussion', 'Discussion', [
      { type: 'p', text:
        'Van Oort et al. framed the problem as a decision space with three levers: raise yields, ' +
        'raise imports, or expand area. For a given population, diet and yield level, any linear ' +
        'combination of area and imports can meet demand; if population or per-capita consumption ' +
        'grows, either imports or area must grow unless yields do. The trade-off is explicit and ' +
        'political: reducing import dependence generally requires area expansion, and limiting area ' +
        'expansion generally requires remaining dependent on international markets.' },
      { type: 'p', text:
        'Their yield-gap assessment found actual yields averaging only 38% of potential across ' +
        'simulated African sites, with relative yields lowest in rainfed upland and lowland systems ' +
        '(average 0.27) and highest in irrigated dry-season systems (0.55). The exception was the ' +
        'Nile Delta at about 80% of potential — which is why Egypt was included as a benchmark for ' +
        'a country where the gap is already closed. Large gaps mean large headroom, but closing them ' +
        'requires on-the-ground work on the socioeconomic and biophysical constraints, not merely ' +
        'the observation that a gap exists (van Ittersum et al., 2013; Sumberg, 2012).' },
      { type: 'p', text:
        'Their central negative result is the one that matters most for policy: achieving 80% of ' +
        'biophysical potential by the horizon would require yield growth rates substantially higher ' +
        'than those observed, and higher than those achieved during the Asian green revolution. ' +
        'Where the present analysis reproduces that pattern for West Africa, the implication is the ' +
        'same — self-sufficiency through yield alone is not on the current trajectory, and the ' +
        'realistic question is what combination of yield, area and continued imports a country is ' +
        'willing to accept.' },
      { type: 'p', text:
        'Diet is the underrated term. The paper found per-capita consumption rising 7-9% a year in ' +
        'Burkina Faso and Mali over 2000-2012, and 4-5% in Ghana and Nigeria. A country whose ' +
        'per-capita consumption is climbing that fast is chasing a moving target: the difference ' +
        'between the current-diet and trend-diet columns in the tables above is frequently larger ' +
        'than the difference between yield scenarios.' },
      { type: 'note', level: 'warning', text:
        'This is a biophysical accounting framework. It contains no prices, no costs, no behavioural ' +
        'response and no trade model. It answers "how much area would be needed", not "would that be ' +
        'wise", "could it be afforded", or "what would be lost". Van Oort et al. were explicit that ' +
        'further economic analysis of the area-versus-imports trade-off was needed; that remains true.' }
    ]);

    /* ---- validation */
    const v = RSAVanOort.validate();
    push('validation', 'Validation against the published results', [
      { type: 'p', text: v.note },
      { type: 'table', caption: 'Paper Table 1 arithmetic, recomputed',
        columns: ['Country', 'Published P/C 2012', 'Recomputed from published P and C', 'Agrees'],
        rows: v.rows.map(r => [r.name, f(r.publishedPCRatio2012, 2),
          f(r.recomputedFromPaperTable1, 2), r.agrees ? 'yes' : 'no']) },
      { type: 'table', caption: 'Published Table 4 P/C, 2025, no area expansion, current diet',
        columns: ['Country', 'No yield increase', 'Trend 07-12', '+1 t/ha', '+2 t/ha', '80% of potential'],
        rows: v.rows.map(r => [r.name, r.publishedScenarios.noYield, r.publishedScenarios.trend,
          r.publishedScenarios.plus1, r.publishedScenarios.plus2, r.publishedScenarios.pct80]) },
      { type: 'note', level: 'warning', text:
        'The scenario columns are shown for reference and are NOT reproduced by this platform. They ' +
        'rest on a rainfed/irrigated split and on ORYZA2000 yield potentials from the Global Yield ' +
        'Gap Atlas, neither of which is held here. What is reproduced is the framework, the ' +
        'equations and the P/C definition.' }
    ]);

    /* ---- limitations and references */
    push('limits', 'Limitations', [
      { type: 'list', items: (region.ok ? region.caveats : []).concat([
        'The horizon is ' + year + '; the paper used 2025, chosen as meaningful for policymakers. ' +
        'Longer horizons carry greater uncertainty in population growth, available area and climate ' +
        'impacts, which is why the paper deliberately kept the horizon near.',
        'No climate change effect is modelled. The paper noted that climate impacts on African rice ' +
        'had not been clearly quantified; that is still largely true.',
        'Post-harvest losses and processing quality are not modelled, although Laborte et al. (2012) ' +
        'identify loss reduction as one of five routes to closing a production gap.'
      ]) },
      { type: 'table', caption: 'Reproducibility', columns: ['Field', 'Value'],
        rows: [['Platform', 'Rice Statistics for Africa v' + RSA_VERSION],
               ['Model', 'van Oort et al. (2015)'],
               ['Milling rate', String(RSAVanOort.MILLING_RATE)],
               ['Database', bal().db], ['Target year', String(year)],
               ['Diet scenario', dietLabel],
               ['Data extracted', prov.extracted],
               ['Generated', new Date().toISOString()]] }
    ]);

    push('references', 'References', [
      { type: 'list', items: RSAVanOort.REFERENCES.map(r =>
        r.text + (r.doi ? ' doi:' + r.doi : '') + (r.role ? ' — ' + r.role : '')) }
    ]);

    return rep;
  }

  /* ------------------------------------------------------------- sources */

  function renderSources() {
    const el = $('#p-sources');
    el.innerHTML = '';
    const prov = RSA.provenance();

    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('fresh.title') })]));
    el.appendChild(freshnessCard());

    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('sec.provenance') })]));
    el.appendChild(card('Official sources, as extracted', [
      table(null, ['Database', 'Dataset', 'Published', 'Items and elements', 'URL'],
        prov.sources.map(s => [s.db, s.dataset, s.published, s.items + '; ' + s.elements, s.url])),
      note('info', 'Data extracted ' + prov.extracted + '. Rebuild from the official sources with ' +
        'tools/build-data.ps1.')
    ]));

    el.appendChild(card('Why the two databases are never merged', [
      h('p', { class: 'muted', text:
        'FAOSTAT reports rice production as paddy on a calendar year, and rice trade as milled rice. ' +
        'USDA PSD reports production, trade, consumption and stocks all on a milled basis, on a ' +
        'market year, with its own independent estimation and its own published milling rate. The ' +
        'two disagree, sometimes substantially. Averaging them would produce a number belonging to ' +
        'neither source and traceable to nothing, so the platform keeps them apart and lets the ' +
        'disagreement be visible — it is itself evidence about how uncertain the underlying quantity is.' })
    ]));

    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('sec.quality') })]));
    const rows = RSA.countries().map(c => {
      const q = RSA.quality(S.db, c.iso3, { from: 1990 });
      if (!q) return null;
      return [c.name, q.score, f(100 * q.components.completeness, 0), f(100 * q.components.continuity, 0),
              f(100 * q.components.recency, 0), f(100 * q.components.consistency, 0),
              q.detail.lastProductionYear || '—', q.detail.interiorGaps];
    }).filter(Boolean).sort((a, b) => a[1] - b[1]);
    el.appendChild(card('Quality score, 1990 onward', [
      h('div', { class: 'scroll-y' }, [table(null,
        ['Country', 'Score', 'Completeness', 'Continuity', 'Recency', 'Consistency',
         'Last production year', 'Interior gaps'], rows,
        [false, true, true, true, true, true, true, true])]),
      note('info', 'Score = 0.40 completeness + 0.20 continuity + 0.20 recency + 0.20 consistency, ' +
        'each on 0–1. Consistency checks whether area × yield reproduces reported production. This ' +
        'measures the shape of the data, not whether the underlying statistics are true.')
    ]));

    if (prov.issues && prov.issues.length) {
      el.appendChild(card('Validation issues found in the extract', [
        table(null, ['Country', 'Year', 'Field', 'Issue', 'Value', 'Expected'],
          prov.issues.slice(0, 200).map(i => [i.iso3, i.year, i.field, i.kind, i.value, i.expected || '—'])),
        note('info', 'These are integrity checks on the extract, reported rather than silently ' +
          'corrected. Identity failures on very small production values are rounding in the source.')
      ]));
    }

    el.appendChild(h('div', { class: 'section-h' }, [h('h2', { text: T('sec.methodology') })]));
    ['ppc', 'cpc', 'ssr', 'idr', 'icr', 'ntr', 'pcb', 'pcg'].forEach(id => {
      const d = RSAIndicators.get(id);
      el.appendChild(h('div', { class: 'eq' }, [
        h('h4', { text: d.label + '  ' }),
        h('div', { class: 'formula', text: d.equation }),
        (() => {
          const dl = h('dl');
          d.variables.forEach(v => {
            dl.appendChild(h('dt', { text: v.sym }));
            dl.appendChild(h('dd', { text: v.def + (v.unit && v.unit !== '—' ? ' (' + v.unit + ')' : '') }));
          });
          return dl;
        })(),
        h('p', { class: 'interp', html: '<b>Interpretation.</b> ' + escapeHtml(d.interpretation) }),
        h('p', { class: 'limit', html: '<b>Limitations.</b> ' + escapeHtml(d.limitations) }),
        d.source ? h('p', { class: 'muted', text: 'Source: ' + d.source }) : null
      ].filter(Boolean)));
    });

    el.appendChild(card('Country registry and groupings', [
      table(null, ['Country', 'ISO3', 'M49', 'FAOSTAT code', 'USDA code', 'UN subregion', 'Blocs'],
        RSA.countries().map(c => [c.name, c.iso3, c.m49, c.faoCode, c.psdCode || '—', c.region,
          c.blocs.join(', ') || '—'])),
      note('info', RSA.blocs().map(b => b.label + ': ' + b.note).join(' '))
    ]));
  }

  /* Reports what the scheduled updater last found. The state file is written by
   * tools/auto-update.ps1; if it is absent the updater has never run, and the
   * card says so rather than implying the data is fresh. */
  function freshnessCard() {
    const prov = RSA.provenance();
    const body = h('div');

    body.appendChild(table(null, ['Source', 'Dataset', T('fresh.extracted')],
      prov.sources.map(s => [s.db, s.dataset, RSAi18n.date(s.published)])));
    body.appendChild(h('div', { class: 'muted',
      text: T('fresh.extracted') + ': ' + RSAi18n.date(prov.extracted) }));

    const status = h('div', { class: 'note note-info', text: T('fresh.checking') });
    body.appendChild(status);

    fetch('data/rsa-update-state.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(st => {
        if (!st) {
          status.className = 'note note-warning';
          status.textContent = T('fresh.never');
          return;
        }
        const lines = [T('fresh.lastCheck') + ': ' + RSAi18n.date(st.checked)];
        if (st.lastRebuild) lines.push(T('fresh.lastRebuild') + ': ' + RSAi18n.date(st.lastRebuild));
        status.className = 'note note-positive';
        status.textContent = T('fresh.current') + '  ' + lines.join(' · ');
        if (st.unreachable && st.unreachable.length) {
          body.appendChild(note('warning',
            'Unreachable at the last check, left at their previous version: ' +
            st.unreachable.join(', ')));
        }
      })
      .catch(() => {
        status.className = 'note note-warning';
        status.textContent = T('fresh.never');
      });

    body.appendChild(note('info',
      'Automatic update: tools\\auto-update.ps1 checks FAOSTAT, USDA PSD and Natural Earth by HTTP ' +
      'HEAD and rebuilds only when a source has actually published something new. The previous ' +
      'dataset is archived to data\\versions\\<timestamp> before every rebuild, so an analysis can ' +
      'always be re-run against the exact data it used, and a failed rebuild is rolled back rather ' +
      'than left half-written. Register a daily check with "tools\\auto-update.ps1 -Install".'));
    return card(null, [body]);
  }

  /* ------------------------------------------------------------- copilot */

  function renderCopilot() {
    const el = $('#p-copilot');
    el.innerHTML = '';
    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('copilot.title') }),
      h('p', { text: 'answers computed from the platform’s own calculations' })
    ]));
    el.appendChild(note('info', 'This assistant is rule-based. Every answer is assembled from values ' +
      'the platform has actually computed, and every answer carries an evidence trace naming the ' +
      'database, selection, indicators, equations and assumptions used. It does not generate prose ' +
      'of its own and it will say so rather than guess.'));

    const log = h('div', { class: 'chat' });
    const input = h('input', { type: 'text', style: 'flex:1;min-width:280px',
      placeholder: 'e.g. Why is Nigeria unlikely to reach self-sufficiency by 2035?' });
    const send = h('button', { class: 'primary', text: 'Ask' });

    function context() {
      const b = bal();
      let base = null;
      try { base = RSAScenarios.baseline(b, S.targetYear, {}); } catch (e) { base = null; }
      return {
        bal: b, label: b.label, dbKey: S.db, opts: { basis: S.basis },
        baseline: base && base.ok ? base : null,
        diagnosis: RSAPolicy.diagnose(b, {}),
        assumptions: ['milling rate ' + b.millingRate,
                      'scenario defaults: ' + JSON.stringify(RSAScenarios.DEFAULTS.varietyYieldGain)]
      };
    }

    function ask(q) {
      log.appendChild(h('div', { class: 'msg msg-q', text: q }));
      const thinking = h('div', { class: 'msg msg-a', text: 'Computing…' });
      log.appendChild(thinking);
      thinking.scrollIntoView({ block: 'nearest' });
      setTimeout(() => {
        const r = RSAPolicy.ask(q, context());
        thinking.remove();
        const kids = [h('div', { text: r.text })];
        if (r.evidence) {
          const e = r.evidence;
          kids.push(h('div', { class: 'evidence', html:
            '<b>Evidence trace</b><br>' +
            'database: ' + escapeHtml(e.database) + '<br>' +
            'selection: ' + escapeHtml(e.selection) + ' · basis: ' + escapeHtml(e.basis) + '<br>' +
            'period: ' + escapeHtml(e.period) + '<br>' +
            'indicators: ' + escapeHtml(e.indicators.join(', ')) + '<br>' +
            (e.equations.length ? 'equations: ' + escapeHtml(e.equations.join(' ; ')) + '<br>' : '') +
            'assumptions: ' + escapeHtml((e.assumptions || []).join('; ') || 'none') + '<br>' +
            'data extracted: ' + escapeHtml(e.extracted) + '<br>' +
            e.sources.map(escapeHtml).join('<br>') }));
        }
        if (r.suggestions) {
          const sg = h('div', { class: 'suggest' });
          r.suggestions.forEach(s => sg.appendChild(h('button', { text: s, onclick: () => ask(s) })));
          kids.push(sg);
        }
        const msg = h('div', { class: 'msg msg-a' + (r.answered ? '' : ' unanswered') }, kids);
        log.appendChild(msg);
        msg.scrollIntoView({ block: 'nearest' });
      }, 20);
    }

    send.addEventListener('click', () => { if (input.value.trim()) { ask(input.value.trim()); input.value = ''; } });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });

    el.appendChild(card(null, [
      h('div', { class: 'controls' }, [input, send]),
      h('div', { class: 'suggest' }, [
        'Why is ' + bal().label + ' unlikely to reach self-sufficiency by ' + S.targetYear + '?',
        'What would happen if rice yields increased by 20%?',
        'What is the cheapest strategy?',
        'Which countries have the highest import dependency?',
        'What is driving the import bill?',
        'When does the baseline reach 100%?'
      ].map(s => h('button', { text: s, onclick: () => ask(s) }))),
      log
    ]));
  }

  /* -------------------------------------------------------------- report */

  function renderReport() {
    const el = $('#p-report');
    el.innerHTML = '';
    el.appendChild(h('div', { class: 'section-h' }, [
      h('h2', { text: T('report.title') }),
      h('p', { text: bal().label + ' · ' + bal().db + ' · target ' + S.targetYear })
    ]));

    const status = h('div', { class: 'muted', text: 'The report assembles the full analysis: sources, ' +
      'methodology with every equation, historical trends, self-sufficiency, the rice economy, ' +
      'forecasts, policy scenarios, the least-cost path, recommendations, risks and a ' +
      'reproducibility manifest.' });
    el.appendChild(status);

    const gen = h('button', { class: 'primary', text: 'Generate report' });
    const bar = h('div', { class: 'controls' }, [gen]);
    el.appendChild(bar);
    const out = h('div');
    el.appendChild(out);

    gen.addEventListener('click', () => {
      out.innerHTML = '';
      const spin = h('div', { class: 'spinner', text: 'Generating — fitting forecast models and running scenarios…' });
      out.appendChild(spin);
      setTimeout(() => {
        const b = bal();
        const ctx = buildReportContext(b);
        const report = RSAReport.generate(ctx);
        spin.remove();

        // download bar
        out.appendChild(h('div', { class: 'controls' }, [
          h('button', { text: 'HTML (print to PDF)', onclick: () => {
            const w = window.open('', '_blank');
            w.document.write(RSAReport.toHtml(report));
            w.document.close();
          } }),
          h('button', { text: 'Word (.doc)', onclick: () => downloadText(RSAReport.toWord(report),
            slug(b.label) + '-rice-report.doc', 'application/msword') }),
          h('button', { text: 'Excel (.xls)', onclick: () => downloadText(
            RSAReport.toExcel(report, b, ctx), slug(b.label) + '-rice.xls', 'application/vnd.ms-excel') }),
          h('button', { text: 'Markdown', onclick: () => downloadText(RSAReport.toMarkdown(report),
            slug(b.label) + '-rice-report.md', 'text/markdown') }),
          h('button', { text: 'LaTeX', onclick: () => downloadText(RSAReport.toLatex(report),
            slug(b.label) + '-rice-report.tex', 'text/x-tex') }),
          h('button', { text: 'JSON', onclick: () => downloadText(RSAReport.toJson(report, b, ctx),
            slug(b.label) + '-rice-report.json', 'application/json') }),
          h('button', { text: 'CSV (series)', onclick: () => downloadText(RSAReport.toCsv(b, ctx),
            slug(b.label) + '-rice-series.csv', 'text/csv') }),
          h('button', { text: 'Manifest', onclick: () => downloadText(
            JSON.stringify(RSAReport.buildManifest(b, ctx, RSA.provenance()), null, 2),
            slug(b.label) + '-manifest.json', 'application/json') })
        ]));

        // render inline
        report.sections.forEach(s => {
          const kids = [];
          s.blocks.forEach(blk => { const n = renderBlock(blk); if (n) kids.push(n); });
          out.appendChild(card(s.title, kids));
        });
      }, 40);
    });
  }

  function buildReportContext(b) {
    const ctx = {
      bal: b, from: S.from, to: S.to, targetYear: S.targetYear,
      rampModel: S.rampModel || 'linear',
      rampTo: S.rampTo || S.targetYear,
      criterion: S.fcCrit || 'aic',
      quality: b.members.length === 1 ? RSA.quality(S.db, b.members[0], { from: 1990 }) : null,
      assumptions: RSAScenarios.DEFAULTS
    };
    ctx.diagnosis = RSAPolicy.diagnose(b, { quality: ctx.quality ? ctx.quality.score : null });

    // forecast block
    // Project to the last horizon so the report can table all five.
    const base = RSAScenarios.baseline(b, HORIZONS[HORIZONS.length - 1], {});
    if (base.ok) {
      ctx.baseline = base;
      ctx.forecast = {
        ssrPath: base.path.map(p => p.ssr),
        crossingYear: RSAScenarios.firstCrossing(base.path, 100),
        tests: [], models: [], backtest: []
      };
      ['area', 'yield', 'cpc'].forEach(k => {
        const cp = base.components[k];
        if (cp.selection && cp.selection.selected) {
          const m = cp.selection.selected;
          ctx.forecast.models.push({
            series: k, label: m.label, sigma2: m.sigma2, logLik: m.logLik,
            aic: m.aic, bic: m.bic, hqic: m.hqic, ljungBox: m.ljungBox, accuracy: m.accuracy
          });
          (cp.selection.dSelection.trace || []).forEach(t => {
            ctx.forecast.tests.push({ series: k, test: t.pp.test, specLabel: t.pp.specLabel,
              statistic: t.pp.statistic, critical: t.pp.critical, rejects5: t.pp.rejects5 });
          });
          if (!ctx.forecast.candidates) ctx.forecast.candidates = cp.selection.candidates;
        }
      });

      const P = S.params || defaultParams();
      const so = { rampTo: ctx.rampTo, rampModel: ctx.rampModel };
      ctx.scenarios = [
        RSAScenarios.scenarioArea(base, P.area, so),
        RSAScenarios.scenarioVariety(base, P.adoption, P.gain, so),
        RSAScenarios.scenarioTariff(base, P.tariff, so),
        RSAScenarios.scenarioYield(base, P.yieldImp, so),
        RSAScenarios.scenarioCombined(base, {
          areaExpansion: P.area, adoptionRate: P.adoption, varietyYieldGain: P.gain,
          yieldImprovement: P.yieldImp, tariff: P.tariff
        }, so)
      ];
      ctx.ranking = RSAPolicy.rankScenarios(ctx.scenarios, S.weights);
      ctx.optimization = RSAScenarios.optimize(base, { ssrTarget: 100 });
    }
    return ctx;
  }

  function renderBlock(b) {
    switch (b.type) {
      case 'h3': return h('h3', { text: b.text, style: 'margin:16px 0 6px' });
      case 'p': return h('p', { text: b.text });
      case 'note': return note(b.level, b.text);
      case 'finding': return finding(b.level, b.title, b.text, b.meta);
      case 'list': return h('ul', {}, b.items.map(i => h('li', { text: i })));
      case 'code': return h('div', { class: 'formula', text: b.text });
      case 'kpis': return h('div', { class: 'kpis' },
        b.items.map(i => kpi(i.label, i.value, i.year, i.kind)));
      case 'table': return table(b.caption, b.columns, b.rows);
      case 'equation': return h('div', { class: 'eq' }, [
        h('h4', { text: b.label }),
        h('div', { class: 'formula', text: b.equation }),
        (() => {
          const dl = h('dl');
          b.variables.forEach(v => {
            dl.appendChild(h('dt', { text: v.sym }));
            dl.appendChild(h('dd', { text: v.def + (v.unit && v.unit !== '—' ? ' (' + v.unit + ')' : '') }));
          });
          return dl;
        })(),
        b.note ? h('p', { class: 'muted', text: b.note }) : null,
        h('p', { class: 'interp', html: '<b>Interpretation.</b> ' + escapeHtml(b.interpretation) }),
        h('p', { class: 'limit', html: '<b>Limitations.</b> ' + escapeHtml(b.limitations) }),
        b.source ? h('p', { class: 'muted', text: 'Source: ' + b.source }) : null
      ].filter(Boolean));
      case 'chart': return reportChart(b);
      default: return null;
    }
  }

  function reportChart(b) {
    const bl = bal(), I = RSAIndicators;
    let node = null;
    try {
      if (b.chart === 'production-consumption') {
        node = RSAFigs.timeSeries({ title: b.title, unit: 't', yLabel: 'tonnes', series: [
          { label: 'Production', years: bl.years, values: bl.production, kind: 'observed', colour: '#4fb98a' },
          { label: 'Consumption', years: bl.years, values: bl.consumption, kind: 'observed', colour: '#d9944f' }
        ] }, { zeroBase: true, width: 820 });
      } else if (b.chart === 'area-yield') {
        node = RSAFigs.timeSeries({ title: b.title, unit: 'ha', yLabel: 'hectares', series: [
          { label: 'Area', years: bl.years, values: bl.area, kind: 'observed', colour: '#8d7ce0' }
        ] }, { zeroBase: true, width: 820 });
      } else if (b.chart === 'ssr-idr') {
        node = RSAFigs.timeSeries({ title: b.title, unit: '%', yLabel: 'per cent',
          reference: [{ value: 100, label: 'self-sufficiency' }], series: [
          { label: 'SSR', years: bl.years, values: I.compute('ssr', bl).values, kind: 'observed', colour: '#4fb98a' },
          { label: 'IDR', years: bl.years, values: I.compute('idr', bl).values, kind: 'observed', colour: '#e0705c' }
        ] }, { width: 820 });
      } else if (b.chart === 'import-bill') {
        node = RSAFigs.timeSeries({ title: b.title, unit: '1000 USD', yLabel: '1000 USD', series: [
          { label: 'Import bill', years: bl.years, values: I.compute('importBill', bl).values,
            kind: 'observed', colour: '#e0a35c' }
        ] }, { zeroBase: true, width: 820 });
      } else if (b.chart === 'forecast-ssr' && S.lastBaseline) {
        const base = S.lastBaseline;
        const hist = base.history.filter(p => p.ssr != null);
        const allY = hist.map(p => p.year).concat(base.path.map(p => p.year));
        node = RSAFigs.timeSeries({ title: b.title, unit: '%', yLabel: 'SSR (%)',
          reference: [{ value: 100, label: 'self-sufficiency' }], series: [
          { label: 'Observed', years: allY, values: hist.map(p => p.ssr).concat(base.path.map(() => null)),
            kind: 'observed', colour: '#4fb98a' },
          { label: 'Baseline projection', years: allY,
            values: hist.map(() => null).concat(base.path.map(p => p.ssr)),
            kind: 'forecast', colour: '#6ba3e0' }
        ] }, { width: 820 });
      } else if (b.chart === 'scenario-ssr' && S.lastScenarios) {
        node = RSAFigs.scenarioBars(RSAScenarios.compare(S.lastScenarios), { width: 760, labelWidth: 200 });
      } else if (b.chart === 'cost-effectiveness' && S.lastScenarios) {
        node = RSAFigs.costEffectiveness(RSAScenarios.compare(S.lastScenarios), { width: 700 });
      }
    } catch (e) { node = null; }
    if (!node) return h('div', { class: 'muted', text: '[figure: ' + b.title + ' — open the relevant ' +
      'panel first to populate it]' });
    return figure(b.title, node);
  }

  /* ------------------------------------------------------------ controls */

  /* Wires the label to its control with for/id. Without it the label is decorative
   * and a screen reader reads an unnamed combobox. */
  let fieldSeq = 0;
  function field(label, control) {
    if (!control.id) control.id = 'fld-' + (++fieldSeq);
    return h('div', { class: 'field' }, [h('label', { text: label, for: control.id }), control]);
  }

  function selectEl(id, options, value, onChange) {
    const s = h('select', { id: id });
    options.forEach(([v, l]) => {
      const o = h('option', { value: v, text: l });
      if (v === value) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function slider(label, min, max, value, onChange, suffix) {
    const out = h('span', { class: 'rangeval', text: Math.round(value) + (suffix || '') });
    const id = 'rng-' + (++fieldSeq);
    const r = h('input', { type: 'range', min: min, max: max, value: value, step: 1, id: id,
                           'aria-label': label });
    r.addEventListener('input', () => {
      out.textContent = r.value + (suffix || '');
      // Screen readers announce the raw number otherwise, with no unit.
      r.setAttribute('aria-valuetext', r.value + (suffix || ''));
    });
    r.addEventListener('change', () => onChange(Number(r.value)));
    r.setAttribute('aria-valuetext', value + (suffix || ''));
    return h('div', { class: 'field' }, [
      h('label', { for: id }, [document.createTextNode(label + ' '), out]), r
    ]);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function downloadText(text, filename, mime) {
    RSAFigs.triggerDownload(new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }), filename);
  }

  function basisShort() {
    return S.db === 'usda' ? 'milled (USDA native)'
      : S.basis === 'asPublished' ? 'as published' : S.basis === 'milled' ? 'milled equivalent' : 'paddy equivalent';
  }

  /* ------------------------------------------------------------ plumbing */

  const RENDER = {
    overview: renderOverview, map: renderMap, profile: renderProfile, compare: renderCompare,
    forecast: renderForecast, scenarios: renderScenarios, condition: renderCondition,
    crisis: renderCrisis,
    westafrica: renderWestAfrica, datused: renderDataUsed, sources: renderSources,
    copilot: renderCopilot, report: renderReport
  };

  function go(tab) {
    S.tab = tab;
    document.querySelectorAll('nav.tabs button').forEach(b => {
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    $('#p-' + tab).classList.add('active');
    try { RENDER[tab](); } catch (e) {
      $('#p-' + tab).innerHTML = '';
      $('#p-' + tab).appendChild(note('error', 'This panel failed to render: ' + e.message));
      console.error('[rsa] panel ' + tab + ' failed', e);
    }
    window.scrollTo(0, 0);
  }

  function invalidate() { S.cache = {}; }

  function syncSelection() {
    const sel = $('#c-sel');
    const want = S.sel.kind === 'country' ? 'c:' + S.sel.id
      : S.sel.kind === 'region' ? 'r:' + S.sel.id
      : S.sel.kind === 'bloc' ? 'b:' + S.sel.id : 'a:';
    sel.value = want;
  }

  function buildSelection() {
    const sel = $('#c-sel');
    sel.innerHTML = '';
    const gA = h('optgroup', { label: 'Aggregate' });
    gA.appendChild(h('option', { value: 'a:', text: T('sel.africa') }));
    sel.appendChild(gA);
    const gR = h('optgroup', { label: 'UN subregion' });
    RSA.regions().forEach(r => gR.appendChild(h('option', { value: 'r:' + r, text: r })));
    sel.appendChild(gR);
    const gB = h('optgroup', { label: 'Regional bloc' });
    RSA.blocs().forEach(b => gB.appendChild(h('option', { value: 'b:' + b.id, text: b.label })));
    sel.appendChild(gB);
    const gC = h('optgroup', { label: 'Country' });
    RSA.countries().slice().sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => gC.appendChild(h('option', { value: 'c:' + c.iso3, text: c.name })));
    sel.appendChild(gC);
    syncSelection();

    sel.addEventListener('change', () => {
      const v = sel.value, k = v.slice(0, 1), id = v.slice(2);
      S.sel = k === 'c' ? { kind: 'country', id: id }
        : k === 'r' ? { kind: 'region', id: id }
        : k === 'b' ? { kind: 'bloc', id: id } : { kind: 'africa' };
      invalidate(); go(S.tab);
    });
  }

  /* Full ARIA tab pattern: each tab owns an id, points at its panel with
   * aria-controls, and the panel points back with aria-labelledby. Arrow keys
   * move between tabs and Home/End jump to the ends, which is what a screen
   * reader user expects from role="tablist" -- without it the role is a promise
   * the widget does not keep. Only the selected tab is in the tab order. */
  function buildTabs() {
    const nav = $('#tabs');
    nav.innerHTML = '';
    TABS.forEach(id => {
      const selected = id === S.tab;
      const b = h('button', {
        role: 'tab', text: T('tab.' + id), id: 'tab-' + id,
        'aria-controls': 'p-' + id,
        'aria-selected': selected ? 'true' : 'false',
        tabindex: selected ? '0' : '-1'
      });
      b.dataset.tab = id;
      b.addEventListener('click', () => go(id));
      b.addEventListener('keydown', ev => {
        const i = TABS.indexOf(id);
        let next = null;
        if (ev.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
        else if (ev.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
        else if (ev.key === 'Home') next = TABS[0];
        else if (ev.key === 'End') next = TABS[TABS.length - 1];
        if (!next) return;
        ev.preventDefault();
        go(next);
        const el = document.getElementById('tab-' + next);
        if (el) el.focus();
      });
      nav.appendChild(b);
    });
    // Panels reference their tab, so a screen reader announces which panel it is.
    TABS.forEach(id => {
      const p = document.getElementById('p-' + id);
      if (p) p.setAttribute('aria-labelledby', 'tab-' + id);
    });
  }

  /* Re-labels everything the translation layer owns. Called on load and again on
   * every language change, so switching language never needs a reload and never
   * leaves half the page in the previous language. */
  function applyLanguage() {
    const set = (sel, key) => { const n = $(sel); if (n) n.textContent = T(key); };
    set('#brand-title', 'app.title');
    set('#brand-tag', 'app.tagline');
    set('#lbl-lang', 'ctl.language');
    set('#lbl-db', 'ctl.database');
    set('#lbl-basis', 'ctl.basis');
    set('#lbl-trade', 'ctl.tradeSeries');
    set('#lbl-sel', 'ctl.selection');
    set('#lbl-target', 'ctl.target');

    const opt = (sel, value, key) => {
      const o = document.querySelector(sel + ' option[value="' + value + '"]');
      if (o) o.textContent = T(key);
    };
    opt('#c-basis', 'milled', 'basis.milled');
    opt('#c-basis', 'paddy', 'basis.paddy');
    opt('#c-basis', 'asPublished', 'basis.asPublished');
    opt('#c-trade', 'std', 'trade.std');
    opt('#c-trade', 'milled31', 'trade.m31');
    opt('#c-target', 'trends', 'target.trends');

    buildTabs();
    buildSelection();
  }

  async function boot() {
    RSAi18n.init();
    try {
      await RSA.load('data/');
    } catch (e) {
      $('#boot').innerHTML = '<b>Could not load the data files.</b><br>' +
        'Serve this page over http rather than opening it from the filesystem — run serve.ps1. (' +
        escapeHtml(e.message) + ')';
      return;
    }
    const langSel = $('#c-lang');
    langSel.value = RSAi18n.get();
    langSel.addEventListener('change', e => {
      RSAi18n.set(e.target.value);
      applyLanguage();
      invalidate();
      go(S.tab);
      footerProvenance();
    });
    applyLanguage();

    $('#c-db').addEventListener('change', e => {
      S.db = e.target.value;
      $('#c-basis').disabled = (S.db === 'usda');
      invalidate(); go(S.tab); headerBadge();
    });
    $('#c-basis').addEventListener('change', e => {
      S.basis = e.target.value; invalidate(); go(S.tab); headerBadge();
    });
    $('#c-trade').addEventListener('change', e => {
      S.stdTrade = e.target.value === 'std';
      invalidate(); go(S.tab);
    });
    $('#c-target').addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'trends') {
        S.trends = true;
      } else {
        S.trends = false;
        S.targetYear = Number(v);
        if (!S.rampTo || HORIZONS.indexOf(S.rampTo) < 0) S.rampTo = S.targetYear;
      }
      invalidate();
      go(S.tab);
    });

    footerProvenance();
    headerBadge();

    $('#boot').hidden = true;
    $('#panels').hidden = false;
    go('overview');
  }

  function footerProvenance() {
    const prov = RSA.provenance();
    const cov = RSAi18n.coverage();
    $('#foot-prov').textContent =
      T('fresh.extracted') + ' ' + RSAi18n.date(prov.extracted) + ' · ' +
      prov.sources.map(s => s.db + ' ' + s.published).join(' · ') +
      ' · v' + RSA_VERSION +
      ' · ' + (cov.language === 'fr' ? 'français' : 'English') + ' ' + cov.pct + '%';
  }

  /* A version and a data-integrity state, visible without opening a panel.
   * A number on screen that nobody can date is a number nobody can check, and
   * the integrity light is what says whether the validator found anything in
   * the data currently loaded. */
  function headerBadge() {
    const el = $('#hdr-build');
    if (!el) return;
    const sweep = RSAValidate.sweep(S.db || 'fao', { basis: S.basis || 'milled' });
    const errs = sweep.errors.length, warns = sweep.warnings.length;
    // The two known broken balance sheets are understood and withheld, so they
    // are reported as handled rather than as an outstanding fault.
    const level = errs > 2 ? 'bad' : (errs > 0 || warns > 0 ? 'warn' : 'good');
    el.className = 'build-badge ' + level;
    el.textContent = 'v' + RSA_VERSION;
    el.title = 'Rice Statistics for Africa v' + RSA_VERSION +
      '\nData integrity: ' + sweep.checked + ' country balances checked, ' +
      errs + ' range error(s), ' + warns + ' warning(s).' +
      (errs ? '\nErrors are country-years where the source reports exports above production ' +
              'plus imports; the derived ratios for those years are withheld.' : '') +
      '\nOpen Data Used for the full validation report.';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
