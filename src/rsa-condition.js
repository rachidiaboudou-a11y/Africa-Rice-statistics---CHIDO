/* Rice Statistics for Africa -- the self-sufficiency condition.
 *
 * Answers one question, for every country and region and for each of several
 * horizons: WHAT WOULD HAVE TO BE TRUE for this country to feed itself in rice?
 *
 * THE CONDITION
 *
 * Self-sufficiency at year T means production covers utilization:
 *
 *     P(T) >= C(T)        i.e.        A(T) x Y(T) / 1000 >= cpc(T) x N(T) / 1000
 *
 * with A harvested area (ha), Y yield (kg/ha), cpc per-capita consumption
 * (kg/capita/yr) and N population. Because production is a product of area and
 * yield, the condition defines an ISOQUANT in (area, yield) space: every point on
 * or above the curve A x Y = 1000 C satisfies it. There is no single answer to
 * "what must happen" -- there is a frontier of answers, and the useful question
 * is which point on it a country could actually reach.
 *
 * WHAT THIS SECTION REPORTS
 *
 * For each horizon, four routes to the frontier:
 *
 *   1. YIELD ONLY      hold area at its baseline path; how high must yield go?
 *   2. AREA ONLY       hold yield at its baseline path; how much land is needed?
 *   3. VARIETY ONLY    what adoption rate of improved varieties would suffice?
 *   4. LEAST-COST MIX  the cheapest admissible combination of all three.
 *
 * Each route is tested against a ceiling -- agronomic for yield, land
 * availability for area, adoption realism for varieties -- and reported as
 * feasible or not, with the BINDING CONSTRAINT named when it is not. Where no
 * route is feasible the section says so and reports the best attainable outcome
 * rather than inventing a package that reaches 100%.
 *
 * WHY THE ROUTES MATTER SEPARATELY
 *
 * They are not interchangeable in policy terms. Yield growth needs seed systems,
 * fertiliser and extension and is slow but land-sparing. Area expansion is faster
 * but converts wetland and forest, with emissions and biodiversity costs this
 * platform does not price. Reporting only a blended optimum would hide that
 * trade-off, which is the actual political choice (van Oort et al., 2015).
 */

const RSACondition = (function () {
  'use strict';

  /* The horizons this section reports. */
  const HORIZONS = [2030, 2035, 2045, 2050];

  const ROUTES = [
    { id: 'yield',   label: 'Yield only',        labelFr: 'Rendement seul' },
    { id: 'area',    label: 'Area only',         labelFr: 'Superficie seule' },
    { id: 'variety', label: 'Improved varieties only', labelFr: 'Variétés améliorées seules' },
    { id: 'mix',     label: 'Least-cost mix',    labelFr: 'Combinaison de moindre coût' }
  ];

  /* Ceilings. Each is an ASSUMPTION and is reported alongside any verdict that
   * depends on it, so a reader can disagree with the bound rather than with the
   * conclusion. */
  const DEFAULTS = {
    // Yield cannot exceed this multiple of the current level by the horizon.
    // Roughly 100 kg/ha/yr sustained is the observed African rice trend; tripling
    // in 25 years would be far beyond anything achieved, including in the Asian
    // green revolution.
    maxYieldFactor: 2.5,
    // Land: multiple of current rice area treated as an upper bound absent
    // country-specific land-availability data.
    maxAreaFactor: 3.0,
    // Adoption of improved varieties. Above ~80% is rare outside irrigated schemes.
    maxAdoption: 0.80,
    // Yield gain per adopting hectare.
    varietyYieldGain: 0.30
  };

  function pctFmt(x) { return x == null ? '—' : (x * 100).toFixed(0) + '%'; }

  /* --------------------------------------------------------------- core */

  /* Evaluates the condition for one selection at one horizon, given an already
   * built baseline (so the caller can build it once and reuse it). */
  function evaluate(base, year, opts) {
    opts = opts || {};
    const maxY = opts.maxYieldFactor || DEFAULTS.maxYieldFactor;
    const maxA = opts.maxAreaFactor || DEFAULTS.maxAreaFactor;
    const maxAd = opts.maxAdoption || DEFAULTS.maxAdoption;
    const vGain = opts.varietyYieldGain || DEFAULTS.varietyYieldGain;

    const pt = RSAScenarios.pointAt(base.path, year);
    if (!pt) return { year: year, available: false, reason: 'no baseline projection for ' + year };
    if (pt.consumption == null || pt.area == null || pt.yield == null ||
        !isFinite(pt.consumption) || pt.area <= 0 || pt.yield <= 0) {
      return { year: year, available: false, reason: 'baseline projection incomplete for ' + year };
    }

    const C = pt.consumption;        // tonnes
    const A = pt.area;               // ha
    const Y = pt.yield;              // kg/ha
    const P = A * Y / 1000;          // tonnes
    const ssr = 100 * P / C;
    const already = ssr >= 100;

    // The multiplier production must be scaled by to close the gap. Below 1 when
    // the country is already self-sufficient.
    const need = P > 0 ? C / P : null;

    /* Route 1 — yield only. */
    const yieldStar = C * 1000 / A;                 // kg/ha required
    const yieldGain = yieldStar / Y - 1;
    const yieldFeasible = yieldStar <= Y * maxY;

    /* Route 2 — area only. */
    const areaStar = C * 1000 / Y;                  // ha required
    const areaGain = areaStar / A - 1;
    const areaFeasible = areaStar <= A * maxA;

    /* Route 3 — improved varieties only. The yield multiplier delivered by
     * adoption a with per-hectare gain g is (1 + a*g), so the adoption needed to
     * deliver multiplier m is a = (m - 1) / g. */
    const adoptionStar = need != null ? (need - 1) / vGain : null;
    const varietyFeasible = adoptionStar != null && adoptionStar <= maxAd;

    /* Route 4 — least-cost mix, from the platform optimiser. */
    let mix = null;
    try {
      mix = RSAScenarios.optimize(base, {
        ssrTarget: 100,
        // atYear is essential: the baseline runs to the LAST horizon, so without
        // it the optimiser would answer for that year rather than for this one
        // and could report a package as feasible at 2035 that only works by 2050.
        atYear: year,
        maxAreaExpansion: maxA - 1,
        maxYieldImprovement: maxY - 1,
        maxAdoption: maxAd,
        varietyYieldGain: vGain,
        // The yield-only route tells the reader the agronomic ceiling is maxY x
        // baseline. The mix must respect the SAME ceiling on its resulting yield,
        // or the table would recommend a package whose implied yield it has just
        // declared impossible.
        maxEffectiveYieldFactor: maxY,
        rampTo: year
      });
    } catch (e) { mix = null; }

    const routes = [
      { id: 'yield', feasible: already || yieldFeasible,
        requirement: already ? 'already met'
          : 'raise yield to ' + Math.round(yieldStar) + ' kg/ha (' + pctFmt(yieldGain) + ' above baseline)',
        value: yieldStar, gain: yieldGain,
        ceiling: Y * maxY, ceilingLabel: Math.round(Y * maxY) + ' kg/ha (' + maxY + '× current)',
        binding: (!already && !yieldFeasible) ? 'agronomic yield ceiling' : null },
      { id: 'area', feasible: already || areaFeasible,
        requirement: already ? 'already met'
          : 'expand harvested area to ' + fmtHa(areaStar) + ' (' + pctFmt(areaGain) + ' above baseline)',
        value: areaStar, gain: areaGain,
        ceiling: A * maxA, ceilingLabel: fmtHa(A * maxA) + ' (' + maxA + '× current)',
        binding: (!already && !areaFeasible) ? 'land availability ceiling' : null },
      { id: 'variety', feasible: already || varietyFeasible,
        requirement: already ? 'already met'
          : (adoptionStar == null ? 'not determinable'
             : adoptionStar > 1
               // Adoption is a share of area and cannot exceed 100%. Printing
               // "1223% adoption" reads as a bug rather than as the impossibility
               // it is, so say what it actually means.
               ? 'impossible on this route alone: closing the gap with varieties only would need ' +
                 pctFmt(adoptionStar) + ' adoption, and adoption cannot exceed 100% of the area. ' +
                 'Even universal adoption at ' + pctFmt(vGain) + ' gain each raises production only ' +
                 (1 + vGain).toFixed(2) + '×, against the ' + need.toFixed(2) + '× required'
               : 'reach ' + pctFmt(adoptionStar) + ' improved-variety adoption at ' +
                 pctFmt(vGain) + ' yield gain each'),
        value: adoptionStar, gain: adoptionStar,
        ceiling: maxAd, ceilingLabel: pctFmt(maxAd) + ' adoption',
        binding: (!already && !varietyFeasible) ? 'adoption ceiling' : null },
      { id: 'mix', feasible: already || !!(mix && mix.ok),
        requirement: already ? 'already met'
          : (mix && mix.ok
              ? pctFmt(mix.solution.areaExpansion) + ' more area, ' +
                pctFmt(mix.solution.adoptionRate) + ' adoption, ' +
                pctFmt(mix.solution.yieldImprovement) + ' yield improvement'
              : 'no admissible combination reaches 100%'),
        value: mix && mix.ok ? mix.solution.cost : null,
        cost: mix && mix.ok ? mix.solution.cost : null,
        solution: mix && mix.ok ? mix.solution : null,
        binding: (!already && !(mix && mix.ok)) ? 'all levers at their ceilings' : null }
    ];

    // "Best" = cheapest feasible route. Cost is only defined for the mix, so the
    // single-lever routes are ranked by how far they sit below their ceiling --
    // a route needing 20% of its headroom is preferred to one needing 95%.
    const feasible = routes.filter(r => r.feasible && r.id !== 'mix');
    feasible.forEach(r => {
      r.strain = (r.id === 'variety')
        ? (r.value != null ? r.value / maxAd : null)
        : (r.gain != null ? r.gain / ((r.id === 'yield' ? maxY : maxA) - 1) : null);
    });
    feasible.sort((a, b) => (a.strain == null ? 9 : a.strain) - (b.strain == null ? 9 : b.strain));

    let best = null, bestReason = null;
    if (already) {
      best = { id: 'none', label: 'Condition already met' };
      bestReason = 'Projected production already covers projected utilization at this horizon.';
    } else if (mix && mix.ok) {
      best = routes.filter(r => r.id === 'mix')[0];
      bestReason = 'The least-cost combination is preferred: it spreads the requirement across ' +
        'levers rather than pushing any single one to its limit.';
    } else if (feasible.length) {
      best = feasible[0];
      bestReason = 'No admissible combination reaches 100%, but this single route does, using ' +
        pctFmt(feasible[0].strain) + ' of its available headroom.';
    } else {
      bestReason = 'No route reaches self-sufficiency at this horizon within the stated ceilings.';
    }

    return {
      year: year, available: true,
      baseline: { area: A, yield: Y, production: P, consumption: C, ssr: ssr,
                  population: pt.population, cpc: pt.cpc },
      alreadySelfSufficient: already,
      productionGap: already ? 0 : C - P,
      requiredMultiplier: need,
      routes: routes,
      best: best,
      bestReason: bestReason,
      anyFeasible: already || routes.some(r => r.feasible),
      bindingConstraints: routes.filter(r => r.binding).map(r => r.binding),
      ceilings: { maxYieldFactor: maxY, maxAreaFactor: maxA, maxAdoption: maxAd,
                  varietyYieldGain: vGain }
    };
  }

  function fmtHa(x) {
    if (x == null || !isFinite(x)) return '—';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + ' Mha';
    if (x >= 1e3) return Math.round(x / 1e3) + ' kha';
    return Math.round(x) + ' ha';
  }

  /* Runs every horizon for one selection. */
  function forSelection(sel, opts) {
    opts = opts || {};
    const dbKey = opts.dbKey || 'fao';
    const basis = opts.basis || 'milled';
    let bal, base;
    try {
      bal = RSA.balance(dbKey, sel, { basis: basis, standardizedTrade: opts.standardizedTrade !== false });
      base = RSAScenarios.baseline(bal, HORIZONS[HORIZONS.length - 1], {});
    } catch (e) {
      return { ok: false, reason: 'could not build a baseline: ' + e.message };
    }
    if (!base.ok) return { ok: false, reason: base.reason };

    const years = (opts.horizons || HORIZONS).map(y => evaluate(base, y, opts));
    // The first horizon at which the condition is met without intervention.
    const crossing = RSAScenarios.firstCrossing(base.path, 100);

    return {
      ok: true,
      selection: RSA.selectionLabel(sel),
      members: bal.members,
      db: bal.db,
      basis: bal.basis,
      baselineCrossing: crossing,
      baselineReliable: base.reliable !== false,
      baselineWarnings: base.warnings || [],
      years: years,
      caveats: [
        'The condition is evaluated against a BASELINE PROJECTION, not against observed data. ' +
        'Area, yield and per-capita consumption are each projected from their own history; ' +
        'population comes from the UN medium variant. Everything downstream inherits that ' +
        'projection\'s uncertainty, which widens sharply with horizon.',
        'The ceilings are assumptions, not measurements. A route reported as infeasible is ' +
        'infeasible UNDER THOSE BOUNDS; change the bound and the verdict changes. Every verdict ' +
        'names the ceiling it was tested against.',
        'Costs cover the modelled programmes only and rest on placeholder unit costs. They exclude ' +
        'irrigation capital, land acquisition, and the environmental cost of converting land.',
        'Reaching P/C = 1 is not the same as food security, and may not be economically optimal. ' +
        'A country that could import rice cheaply and export something else may be better off doing ' +
        'so (Clapp, 2017).'
      ]
    };
  }

  /* Scans every country, returning one row per country per horizon. This is the
   * matrix the section leads with.
   *
   * Synchronous version, kept for tests and for callers that genuinely want to
   * block. Fitting a baseline costs roughly 100 ms per country, so scanning all
   * 55 takes about five seconds -- do NOT call this on the UI thread. */
  function scanAll(opts) {
    opts = opts || {};
    const out = [];
    RSA.countries().forEach(c => {
      if (opts.skipTerritories && c.territory) return;
      const r = forSelection({ kind: 'country', id: c.iso3 }, opts);
      out.push({ iso3: c.iso3, name: c.name, region: c.region, result: r });
    });
    return out;
  }

  /* Chunked version for the UI. Yields to the browser between batches so the
   * spinner animates, progress is visible and clicks are still handled. Without
   * this the page locks solid for about seven seconds and looks crashed.
   *
   * Returns a promise; calls onProgress(done, total, name) as it goes. */
  function scanAllAsync(opts, onProgress, chunkSize) {
    opts = opts || {};
    const list = RSA.countries().filter(c => !(opts.skipTerritories && c.territory));
    const size = chunkSize || 3;
    const out = [];
    return new Promise(resolve => {
      let i = 0;
      function step() {
        const end = Math.min(i + size, list.length);
        for (; i < end; i++) {
          const c = list[i];
          let r;
          try { r = forSelection({ kind: 'country', id: c.iso3 }, opts); }
          catch (e) { r = { ok: false, reason: 'model error: ' + e.message }; }
          out.push({ iso3: c.iso3, name: c.name, region: c.region, result: r });
        }
        if (onProgress) onProgress(i, list.length, list[Math.min(i, list.length - 1)].name);
        if (i < list.length) setTimeout(step, 0);
        else resolve(out);
      }
      step();
    });
  }

  /* Same treatment for the regional scan, which costs about 1.7 s on its own. */
  function scanRegionsAsync(opts, onProgress) {
    opts = opts || {};
    const scopes = [{ id: 'africa', name: 'Africa (all reporting countries)', sel: { kind: 'africa' } }]
      .concat(RSA.regions().map(rg => ({ id: rg, name: rg, sel: { kind: 'region', id: rg } })))
      .concat(RSA.blocs().map(b => ({ id: b.id, name: b.label, bloc: true,
                                      sel: { kind: 'bloc', id: b.id } })));
    const out = [];
    return new Promise(resolve => {
      let i = 0;
      function step() {
        const s = scopes[i];
        let r;
        try { r = forSelection(s.sel, opts); }
        catch (e) { r = { ok: false, reason: 'model error: ' + e.message }; }
        out.push({ id: s.id, name: s.name, bloc: s.bloc, result: r });
        i++;
        if (onProgress) onProgress(i, scopes.length, s.name);
        if (i < scopes.length) setTimeout(step, 0);
        else resolve(out);
      }
      step();
    });
  }

  /* Regional aggregates, including the whole continent. */
  function scanRegions(opts) {
    opts = opts || {};
    const out = [];
    out.push({ id: 'africa', name: 'Africa (all reporting countries)',
               result: forSelection({ kind: 'africa' }, opts) });
    RSA.regions().forEach(rg => {
      out.push({ id: rg, name: rg, result: forSelection({ kind: 'region', id: rg }, opts) });
    });
    RSA.blocs().forEach(b => {
      out.push({ id: b.id, name: b.label, bloc: true,
                 result: forSelection({ kind: 'bloc', id: b.id }, opts) });
    });
    return out;
  }

  /* A compact verdict for the matrix cell. */
  function verdict(yr) {
    if (!yr.available) return { code: 'na', label: '—' };
    if (yr.alreadySelfSufficient) return { code: 'met', label: 'already met' };
    if (!yr.anyFeasible) return { code: 'none', label: 'not reachable' };
    if (yr.best && yr.best.id === 'mix') return { code: 'mix', label: 'least-cost mix' };
    if (yr.best) return { code: yr.best.id, label: yr.best.id };
    return { code: 'none', label: 'not reachable' };
  }

  return {
    HORIZONS: HORIZONS,
    ROUTES: ROUTES,
    DEFAULTS: DEFAULTS,
    evaluate: evaluate,
    forSelection: forSelection,
    scanAll: scanAll,
    scanRegions: scanRegions,
    scanAllAsync: scanAllAsync,
    scanRegionsAsync: scanRegionsAsync,
    verdict: verdict,
    fmtHa: fmtHa
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSACondition; }
