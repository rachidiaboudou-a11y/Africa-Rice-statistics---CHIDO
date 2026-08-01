/* Rice Statistics for Africa -- scenario and policy simulation engine.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * Everything in this file is a SIMULATION under stated assumptions. None of it is
 * a prediction, none of it is causal inference, and no number produced here is
 * evidence about what a policy would actually do. The engine takes a projected
 * baseline, applies an arithmetic rule chosen by the user, and reports what the
 * accounting identity gives back. Its value is in making the arithmetic and the
 * assumptions explicit, not in forecasting policy outcomes.
 *
 * HOW THE BASELINE IS BUILT
 *
 * Rather than extrapolating production and consumption independently -- which
 * lets the two drift apart for no modelled reason, and which hides the single
 * most certain driver in the whole problem -- the baseline is built structurally:
 *
 *     production_t     = area_t x yield_t
 *     consumption_t    = cpc_t x population_t
 *     SSR_t            = 100 x production_t / consumption_t
 *
 * Area, yield and per-capita consumption are each projected from their own
 * history. Population comes from the UN World Population Prospects projection
 * already carried in the dataset, so the demographic term is not extrapolated at
 * all -- it is taken from the demographers.
 *
 * This is what makes the scenarios meaningful: area expansion acts on area,
 * variety adoption and irrigation act on yield, and trade policy acts through
 * price on both. Each lever moves the component it actually touches.
 */

const RSAScenarios = (function () {
  'use strict';

  /* ---------------------------------------------------------- assumptions
   *
   * Every default below is an ASSUMPTION, not a measurement. They are declared
   * in one place, they are all user-editable, and the report prints them with
   * their provenance so a reader can disagree with a specific number rather than
   * with the whole exercise.
   */
  const DEFAULTS = {
    // Yield gain from adopting improved varieties, as a proportion. The range in
    // the African rice literature is wide; AfricaRice NERICA evaluations and the
    // Van Oort et al. (2015) yield-gap work sit broadly in this band.
    varietyYieldGain: { conservative: 0.15, moderate: 0.30, ambitious: 0.50 },

    // Speed of adoption: proportion of the target adoption level reached per year
    // once a programme starts.
    adoptionSpeed: { conservative: 0.05, moderate: 0.10, ambitious: 0.20 },

    // Price transmission: share of a border tariff that reaches the domestic
    // producer price. Never 1 in practice -- trader margins, transport and
    // informal cross-border flows absorb much of it, and porous borders in West
    // Africa absorb a great deal.
    tariffPassThrough: 0.50,

    // Supply and demand elasticities. These are illustrative defaults, NOT
    // estimates for any particular country. Anyone using the tariff scenario for
    // real work must replace them with estimates for their own market.
    supplyElasticityArea: 0.20,     // % area response to a 1% producer price rise
    supplyElasticityYield: 0.10,    // % yield response (input intensification)
    demandElasticity: -0.25,        // % consumption response to a 1% consumer price rise

    // Unit costs, USD. Placeholders whose only job is to make the least-cost
    // optimiser well-posed. They must be replaced with national costings before
    // any figure leaves this platform as advice.
    costPerHaExpansion: 2000,       // bringing one additional ha into rice
    costPerHaVarietyProgramme: 120, // seed system + extension, per ha reached
    costPerHaYieldProgramme: 450,   // irrigation/fertiliser/mechanisation, per ha
    tariffAdminCostShare: 0.05,     // administration, as a share of revenue

    // Land ceiling: multiple of current rice area treated as the plausible upper
    // bound on expansion when no land-use data is available for the country.
    landCeilingMultiple: 3.0,

    // Upper bound on projected per-capita rice consumption, MILLED basis, kg per
    // person per year. No national population on record eats this much rice: the
    // highest sustained national averages -- Bangladesh, Myanmar, Viet Nam, Lao
    // PDR -- sit around 150-200 kg milled. 250 is set deliberately above all of
    // them so the guard only ever catches genuinely impossible paths.
    //
    // This matters because apparent consumption (P + M - X) is inflated wherever
    // re-export goes unrecorded. Benin is the extreme case: its measured CPC ran
    // from 17 kg in 2010 to 148 kg in 2022, and extrapolating that trend to 2040
    // gives over 450 kg per person -- an artefact of the trade statistics, not a
    // dietary forecast. Left unguarded, that single number propagates into every
    // consumption, SSR and scenario figure on the page.
    cpcCeilingMilled: 250
  };

  /* ================================================== baseline construction */

  /* Projects one component series to `toYear` using the Box-Jenkins selector,
   * falling back to a drift benchmark when ARIMA cannot be fitted or its
   * residuals are not white noise. Returns the path plus how it was obtained,
   * because the report has to say. */
  function projectComponent(years, values, toYear, opts) {
    opts = opts || {};
    const c = compactSeries(years, values);
    if (c.values.length < 12) {
      return { ok: false, reason: 'fewer than 12 usable observations' };
    }
    const lastYear = c.years[c.years.length - 1];
    const h = toYear - lastYear;
    if (h <= 0) return { ok: false, reason: 'target year is inside the observed sample' };

    let method = null, path = null, intervals = null, model = null, sel = null;

    if (opts.method !== 'drift') {
      try {
        sel = RSATsa.selectModel(c.values, { criterion: opts.criterion || 'aic', maxP: 3, maxQ: 3 });
        if (sel && sel.selected && !sel.warning) {
          const f = RSATsa.forecast(sel.selected, h, { levels: [0.80, 0.95] });
          path = f.mean;
          intervals = f.intervals;
          model = sel.selected.label;
          method = 'ARIMA (Box-Jenkins)';
        }
      } catch (e) { /* fall through to the benchmark */ }
    }

    if (!path) {
      const rw = RSATsa.rwDrift(c.values);
      path = rw.forecast(h);
      model = rw.label;
      method = 'random walk with drift';
    }

    const outYears = [];
    for (let i = 1; i <= h; i++) outYears.push(lastYear + i);
    return {
      ok: true,
      years: outYears,
      values: path,
      intervals: intervals,
      method: method,
      model: model,
      lastObserved: { year: lastYear, value: c.values[c.values.length - 1] },
      selection: sel
    };
  }

  function compactSeries(years, values) {
    const yy = [], vv = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] == null) continue;
      yy.push(years[i]); vv.push(values[i]);
    }
    // Interior gaps break the recursion an ARIMA needs; keep only the longest
    // uninterrupted run ending at the most recent observation.
    let start = yy.length - 1;
    while (start > 0 && yy[start] - yy[start - 1] === 1) start--;
    return { years: yy.slice(start), values: vv.slice(start) };
  }

  /* Builds the projected baseline for a selection. */
  function baseline(bal, targetYear, opts) {
    opts = opts || {};
    const ind = RSAIndicators;
    const years = bal.years;

    const cpcSeries = ind.compute('cpc', bal).values;
    const areaP = projectComponent(years, bal.area, targetYear, opts);
    const yieldP = projectComponent(years, bal.yield, targetYear, opts);
    const cpcP = projectComponent(years, cpcSeries, targetYear, opts);

    if (!areaP.ok || !yieldP.ok || !cpcP.ok) {
      return {
        ok: false,
        reason: 'baseline cannot be built: ' +
          [!areaP.ok ? 'area (' + areaP.reason + ')' : null,
           !yieldP.ok ? 'yield (' + yieldP.reason + ')' : null,
           !cpcP.ok ? 'per capita consumption (' + cpcP.reason + ')' : null]
          .filter(Boolean).join('; ')
      };
    }

    // Population from the UN projection already in the dataset -- not forecast.
    const popYears = RSA.state.fao.popYears;
    const members = bal.members;
    const pop = {};
    areaP.years.forEach(y => {
      const pi = popYears.indexOf(y);
      if (pi < 0) return;
      let total = 0, any = false;
      members.forEach(iso => {
        const s = RSA.state.fao.series[iso];
        if (s && s.population[pi] != null) { total += s.population[pi] * 1000; any = true; }
      });
      if (any) pop[y] = total;
    });

    // ---- plausibility guard on projected per-capita consumption
    //
    // The projection is a trend extrapolation, and a trend fitted to a series
    // that is itself distorted will happily run off into dietary impossibility.
    // Rather than publish that, the path is capped at a documented ceiling and
    // the capping is reported -- an explicit, labelled modelling constraint, not
    // a silent correction.
    const ceilingMilled = opts.cpcCeiling != null ? opts.cpcCeiling : DEFAULTS.cpcCeilingMilled;
    // On a paddy or as-published basis the same amount of food carries more
    // weight, so the ceiling has to be expressed on the basis in use.
    const rate = bal.millingRate || 0.67;
    const cpcCeiling = (bal.dbKey === 'fao' && bal.basis !== 'milled')
      ? ceilingMilled / rate : ceilingMilled;

    const cappedYears = [];
    const cpcRaw = cpcP.values.slice();
    for (let i = 0; i < cpcP.values.length; i++) {
      if (cpcP.values[i] != null && cpcP.values[i] > cpcCeiling) {
        cappedYears.push(cpcP.years[i]);
        cpcP.values[i] = cpcCeiling;
      }
    }

    // Historical re-export distortion: if IDR ever exceeded 100%, apparent
    // consumption for this selection is not a consumption measure at all.
    const idrHist = RSAIndicators.compute('idr', bal).values;
    const reExportYears = [];
    bal.years.forEach((y, i) => { if (idrHist[i] != null && idrHist[i] > 100) reExportYears.push(y); });

    const path = [];
    for (let i = 0; i < areaP.years.length; i++) {
      const y = areaP.years[i];
      const A = Math.max(0, areaP.values[i]);
      const Y = Math.max(0, yieldP.values[i]);
      const cpc = Math.max(0, cpcP.values[i]);
      const N = pop[y] != null ? pop[y] : null;
      const P = A * Y / 1000;                       // ha x kg/ha -> t
      const C = N != null ? cpc * N / 1000 : null;  // kg/capita x persons -> t
      path.push({
        year: y, area: A, yield: Y, production: P,
        cpc: cpc, population: N, consumption: C,
        ssr: (C && C > 0) ? 100 * P / C : null,
        imports: (C != null) ? Math.max(0, C - P) : null,
        idr: (C && C > 0) ? 100 * Math.max(0, C - P) / C : null
      });
    }

    // Observed tail, so charts can join history to projection without a gap.
    const history = [];
    for (let i = 0; i < years.length; i++) {
      if (bal.production[i] == null && bal.consumption[i] == null) continue;
      history.push({
        year: years[i], area: bal.area[i], yield: bal.yield[i],
        production: bal.production[i], consumption: bal.consumption[i],
        population: bal.population[i],
        cpc: cpcSeries[i],
        ssr: (bal.consumption[i] && bal.consumption[i] > 0)
          ? 100 * bal.production[i] / bal.consumption[i] : null,
        observed: true
      });
    }

    const warnings = [];
    if (cappedYears.length) {
      warnings.push({
        level: 'error',
        text: 'The projected per-capita consumption path exceeded ' + cpcCeiling.toFixed(0) +
              ' kg/capita/year in ' + cappedYears.length + ' year(s) (from ' + cappedYears[0] +
              ') and has been CAPPED at that ceiling. The unconstrained trend reached ' +
              Math.max.apply(null, cpcRaw.filter(v => v != null)).toFixed(0) + ' kg/capita, which no ' +
              'population on record consumes. This is a signal that the apparent-consumption series ' +
              'for this selection is distorted — most often by unrecorded re-export — and that the ' +
              'consumption, import and SSR projections below should be treated as unreliable rather ' +
              'than merely uncertain.'
      });
    }
    if (reExportYears.length) {
      warnings.push({
        level: 'warning',
        text: 'Import dependency exceeded 100% in ' + reExportYears.length + ' historical year(s) (' +
              reExportYears[0] + '–' + reExportYears[reExportYears.length - 1] + '), which means ' +
              'recorded imports exceeded domestic utilization and a large share of imports was ' +
              're-exported. Apparent consumption is not a consumption measure under those conditions, ' +
              'so every per-capita and self-sufficiency figure built on it inherits the distortion.'
      });
    }

    return {
      ok: true,
      label: bal.label,
      db: bal.db,
      basis: bal.basis,
      targetYear: targetYear,
      history: history,
      path: path,
      components: { area: areaP, yield: yieldP, cpc: cpcP },
      cpcCeiling: cpcCeiling,
      cpcCapped: cappedYears,
      cpcUnconstrained: cpcRaw,
      reExportYears: reExportYears,
      warnings: warnings,
      reliable: cappedYears.length === 0,
      populationSource: 'UN World Population Prospects medium variant, as disseminated by FAOSTAT ' +
        '(a projection, not a forecast produced by this platform)',
      structure: 'production = area x yield; consumption = per-capita consumption x population; ' +
        'SSR = 100 x production / consumption',
      caveat: 'A projection of current trends under no policy change. It is not a prediction of what ' +
        'will happen, and its uncertainty widens sharply with horizon.'
    };
  }

  /* ================================================== the scenario library */

  /* The horizons every scenario reports against. A single target year hides the
   * shape of a policy: an intervention that reaches self-sufficiency by 2050 but
   * does nothing before 2040 is a different proposition from one that delivers
   * steadily, and only a multi-horizon table shows the difference. */
  const HORIZONS = [2030, 2035, 2040, 2045, 2050];

  function atTarget(path, year) {
    for (let i = 0; i < path.length; i++) if (path[i].year === year) return path[i];
    return path.length ? path[path.length - 1] : null;
  }

  /* ------------------------------------------------------- phase-in models
   *
   * How fast an intervention arrives matters as much as how large it is, and a
   * straight line is only one of several defensible shapes. `progress` is the
   * fraction of the way from the start year to the target year; the model maps
   * it to the fraction of the intervention actually in place.
   *
   *   linear       constant effort. The neutral default.
   *   logistic     slow start, rapid middle, saturating tail. This is the shape
   *                technology adoption actually follows (Griliches 1957 on hybrid
   *                maize, and the diffusion literature since), so it is the right
   *                default for improved-variety adoption specifically.
   *   backloaded   quadratic. Long lead time before anything lands -- irrigation
   *                schemes and other capital works behave this way.
   *   frontloaded  square-root. Quick early gains that then flatten, typical of
   *                extension and agronomic advice reaching the easiest farmers first.
   *   immediate    a step change at the start year. Almost never realistic; useful
   *                as an upper bound on what timing alone can contribute.
   */
  const RAMPS = {
    linear:      { label: 'Linear', fn: x => x,
                   note: 'Constant effort from the start year to the target year.' },
    logistic:    { label: 'Logistic (S-curve)', fn: x => logistic(x, 10),
                   note: 'Slow start, rapid middle, saturating tail — the shape technology ' +
                         'adoption follows in practice. Recommended for variety adoption.' },
    backloaded:  { label: 'Back-loaded (quadratic)', fn: x => x * x,
                   note: 'Little effect until late. Fits capital works such as irrigation, where ' +
                         'construction precedes any yield.' },
    frontloaded: { label: 'Front-loaded (square root)', fn: x => Math.sqrt(x),
                   note: 'Rapid early gains that then flatten. Fits extension reaching the most ' +
                         'accessible farmers first.' },
    immediate:   { label: 'Immediate step', fn: () => 1,
                   note: 'Full intervention from year one. Not realistic; useful only as an upper ' +
                         'bound on what timing alone can contribute.' }
  };

  function logistic(x, k) {
    const raw = t => 1 / (1 + Math.exp(-k * (t - 0.5)));
    const lo = raw(0), hi = raw(1);
    return (raw(x) - lo) / (hi - lo);
  }

  function rampFactor(progress, model) {
    const m = RAMPS[model] || RAMPS.linear;
    return Math.max(0, Math.min(1, m.fn(Math.max(0, Math.min(1, progress)))));
  }

  /* Applies multipliers to a baseline path and recomputes the identity.
   * The intervention phases in from its start year to `rampTo` under the chosen
   * model, and holds at full intensity thereafter -- so a path that runs past the
   * target year keeps the policy in place rather than switching it off. */
  function applyLevers(base, levers, opts) {
    opts = opts || {};
    const startYear = opts.startYear || (base.path.length ? base.path[0].year : null);
    const targetYear = opts.rampTo || base.targetYear;
    const span = Math.max(1, targetYear - startYear);
    const model = opts.rampModel || 'linear';

    const out = base.path.map(pt => {
      const raw = opts.instant ? 1 : (pt.year - startYear) / span;
      const progress = opts.instant ? 1 : rampFactor(raw, model);
      const areaMult = 1 + (levers.areaExpansion || 0) * progress;
      const yieldMult = 1 + effectiveYieldGain(levers, progress);
      const demandMult = 1 + (levers.demandShift || 0) * progress;

      const A = pt.area * areaMult;
      const Y = pt.yield * yieldMult;
      const P = A * Y / 1000;
      const C = pt.consumption != null ? pt.consumption * demandMult : null;
      return {
        year: pt.year,
        area: A, yield: Y, production: P,
        population: pt.population,
        cpc: pt.population ? C * 1000 / pt.population : null,
        consumption: C,
        ssr: (C && C > 0) ? 100 * P / C : null,
        imports: (C != null) ? Math.max(0, C - P) : null,
        idr: (C && C > 0) ? 100 * Math.max(0, C - P) / C : null,
        progress: progress,
        baselineProduction: pt.production,
        baselineConsumption: pt.consumption,
        baselineSsr: pt.ssr
      };
    });
    return out;
  }

  function effectiveYieldGain(levers, progress) {
    // Variety adoption and general productivity investment both raise yield.
    // They are combined multiplicatively rather than added, so stacking two
    // 30% levers gives 69% rather than 60% -- and, more importantly, so that
    // stacking many levers cannot exceed physical possibility as fast.
    const variety = (levers.adoptionRate || 0) * (levers.varietyYieldGain || 0);
    const productivity = (levers.yieldImprovement || 0);
    return ((1 + variety) * (1 + productivity) - 1) * progress;
  }

  /* --- Scenario 1: area expansion ------------------------------------- */
  function scenarioArea(base, expansion, opts) {
    opts = opts || {};
    const path = applyLevers(base, { areaExpansion: expansion }, opts);
    const end = atTarget(path, base.targetYear);
    const b = atTarget(base.path, base.targetYear);
    const addedHa = end.area - b.area;
    const ceiling = landCeiling(base, opts);
    return decorate({
      id: 'area', label: 'Area expansion',
      description: 'Rice harvested area grows ' + pctFmt(expansion) + ' above the baseline trajectory by ' +
        base.targetYear + ', phased in linearly.',
      levers: { areaExpansion: expansion },
      path: path, base: base, end: end, baseEnd: b,
      equations: ['A\'_t = A_t x (1 + g_A x r_t)', 'P\'_t = A\'_t x Y_t'],
      cost: addedHa * (opts.costPerHaExpansion || DEFAULTS.costPerHaExpansion),
      costBasis: 'additional hectares x cost per hectare brought into rice production',
      feasibility: feasibilityArea(end.area, ceiling),
      warnings: areaWarnings(end.area, ceiling, expansion)
    });
  }

  function pctFmt(x) { return (x * 100).toFixed(0) + '%'; }

  function landCeiling(base, opts) {
    opts = opts || {};
    if (opts.landCeilingHa > 0) return { ha: opts.landCeilingHa, source: 'user-specified' };
    const b = atTarget(base.path, base.targetYear);
    const mult = opts.landCeilingMultiple || DEFAULTS.landCeilingMultiple;
    return {
      ha: b.area * mult,
      source: 'assumed ceiling of ' + mult.toFixed(1) + ' x baseline rice area -- a placeholder, ' +
              'not a land-availability assessment for this country'
    };
  }

  function feasibilityArea(areaHa, ceiling) {
    const use = areaHa / ceiling.ha;
    if (use <= 0.6) return { level: 'plausible', score: 1, text: 'well inside the assumed land ceiling' };
    if (use <= 0.9) return { level: 'demanding', score: 0.6, text: 'approaching the assumed land ceiling' };
    if (use <= 1.0) return { level: 'strained', score: 0.3, text: 'at the assumed land ceiling' };
    return { level: 'implausible', score: 0, text: 'exceeds the assumed land ceiling' };
  }

  function areaWarnings(areaHa, ceiling, pct) {
    const w = [];
    if (areaHa > ceiling.ha) {
      w.push({
        level: 'error',
        text: 'The area required exceeds the assumed land ceiling (' + fmtHa(ceiling.ha) + '). ' +
              'Area expansion alone cannot deliver this outcome. ' + ceiling.source + '.'
      });
    }
    if (pct > 0.5) {
      w.push({
        level: 'warning',
        text: 'Expansion above 50% typically means converting wetland, forest or grazing land. ' +
              'The greenhouse-gas, biodiversity and water costs of that conversion are NOT modelled ' +
              'here and can be large; paddy expansion in particular raises methane emissions.'
      });
    }
    return w;
  }

  function fmtHa(x) {
    if (x >= 1e6) return (x / 1e6).toFixed(2) + ' Mha';
    if (x >= 1e3) return (x / 1e3).toFixed(0) + ' kha';
    return Math.round(x) + ' ha';
  }

  /* --- Scenario 2: improved variety adoption --------------------------- */
  function scenarioVariety(base, adoptionRate, yieldGain, opts) {
    opts = opts || {};
    const gain = yieldGain != null ? yieldGain : DEFAULTS.varietyYieldGain.moderate;
    const path = applyLevers(base, { adoptionRate: adoptionRate, varietyYieldGain: gain }, opts);
    const end = atTarget(path, base.targetYear);
    const b = atTarget(base.path, base.targetYear);
    return decorate({
      id: 'variety', label: 'Improved variety adoption',
      description: pctFmt(adoptionRate) + ' of rice area under improved varieties by ' + base.targetYear +
        ', each adopting hectare yielding ' + pctFmt(gain) + ' more.',
      levers: { adoptionRate: adoptionRate, varietyYieldGain: gain },
      path: path, base: base, end: end, baseEnd: b,
      equations: ["Y'_t = Y_t x (1 + a_t x delta_Y)", "P'_t = A_t x Y'_t"],
      cost: end.area * adoptionRate * (opts.costPerHaVarietyProgramme || DEFAULTS.costPerHaVarietyProgramme),
      costBasis: 'hectares reached by the seed and extension programme x cost per hectare',
      feasibility: adoptionRate <= 0.4
        ? { level: 'plausible', score: 1, text: 'adoption in this range has precedent in African rice systems' }
        : adoptionRate <= 0.7
          ? { level: 'demanding', score: 0.5, text: 'requires a sustained, well-funded seed system' }
          : { level: 'strained', score: 0.2, text: 'adoption above 70% is rare outside irrigated schemes' },
      warnings: [{
        level: 'info',
        text: 'The yield gain per adopting hectare is an assumption (' + pctFmt(gain) + '), not an ' +
              'estimate for this country. On-station gains routinely exceed on-farm gains by a wide ' +
              'margin, so a farm-level figure should be used where one exists.'
      }]
    });
  }

  /* --- Scenario 3: import tariff --------------------------------------- */
  /* Deliberately NOT "a tariff creates production". The chain modelled is:
   *
   *   tariff -> border price -> (pass-through) -> domestic price
   *          -> producer incentive -> area and yield response (supply elasticities)
   *          -> production
   *   and     -> consumer price -> consumption response (demand elasticity)
   *
   * Every link is an elasticity the user can change, and the whole thing is a
   * comparative-static exercise with no dynamics, no market structure and no
   * general-equilibrium feedback.
   */
  function scenarioTariff(base, tariff, opts) {
    opts = opts || {};
    const pass = opts.tariffPassThrough != null ? opts.tariffPassThrough : DEFAULTS.tariffPassThrough;
    const esArea = opts.supplyElasticityArea != null ? opts.supplyElasticityArea : DEFAULTS.supplyElasticityArea;
    const esYield = opts.supplyElasticityYield != null ? opts.supplyElasticityYield : DEFAULTS.supplyElasticityYield;
    const ed = opts.demandElasticity != null ? opts.demandElasticity : DEFAULTS.demandElasticity;

    const priceRise = tariff * pass;                 // proportional domestic price change
    const levers = {
      areaExpansion: esArea * priceRise,
      yieldImprovement: esYield * priceRise,
      demandShift: ed * priceRise
    };
    const path = applyLevers(base, levers, opts);
    const end = atTarget(path, base.targetYear);
    const b = atTarget(base.path, base.targetYear);

    // Fiscal: revenue is collected on what is still imported after the response.
    const unitValue = opts.importUnitValue || null;   // USD/t, from the economy module
    const revenue = (unitValue && end.imports != null) ? end.imports * unitValue * tariff : null;

    const s = decorate({
      id: 'tariff', label: 'Import tariff',
      description: 'An ad valorem rice import tariff of ' + pctFmt(tariff) + ', of which ' +
        pctFmt(pass) + ' passes through to domestic prices.',
      levers: levers,
      path: path, base: base, end: end, baseEnd: b,
      equations: [
        'dP^dom = tau x rho',
        "A'_t = A_t x (1 + eps^A_S x dP^dom)",
        "Y'_t = Y_t x (1 + eps^Y_S x dP^dom)",
        "C'_t = C_t x (1 + eps_D x dP^dom)"
      ],
      cost: 0,
      costBasis: 'a tariff raises revenue rather than costing budget; the cost falls on consumers',
      revenue: revenue,
      feasibility: { level: 'plausible', score: 0.8, text: 'administratively straightforward; WTO and ' +
        'regional customs-union commitments may constrain the rate' },
      warnings: [
        { level: 'warning',
          text: 'This is a comparative-static simulation, not a causal prediction. The elasticities ' +
                '(supply ' + esArea + '/' + esYield + ', demand ' + ed + ') are illustrative defaults, ' +
                'not estimates for this country. Replace them before using any number here.' },
        { level: 'warning',
          text: 'Rice is a staple. A ' + pctFmt(tariff) + ' tariff raises the price of a food that poor ' +
                'households spend a large share of income on. The consumer welfare loss and its ' +
                'distributional incidence are NOT modelled here and may exceed the production gain.' },
        { level: 'info',
          text: 'Where borders are porous -- much of West Africa -- a high tariff diverts trade into ' +
                'informal channels rather than raising domestic prices, so both the production ' +
                'response and the revenue shown here would be overstated.' }
      ]
    });
    s.consumerImpact = {
      priceRise: priceRise,
      consumptionChange: (end.consumption != null && b.consumption != null)
        ? (end.consumption - b.consumption) : null,
      note: 'Consumption falls because the price rises. That is a welfare loss to consumers, not a ' +
            'gain in self-sufficiency, even though it raises the SSR ratio by shrinking its denominator.'
    };
    return s;
  }

  /* --- Scenario 4: productivity / yield improvement -------------------- */
  function scenarioYield(base, pct, opts) {
    opts = opts || {};
    const path = applyLevers(base, { yieldImprovement: pct }, opts);
    const end = atTarget(path, base.targetYear);
    const b = atTarget(base.path, base.targetYear);
    return decorate({
      id: 'yield', label: 'Productivity improvement',
      description: 'Rice yield rises ' + pctFmt(pct) + ' above baseline by ' + base.targetYear +
        ' through irrigation, fertiliser, mechanisation, agronomy and extension.',
      levers: { yieldImprovement: pct },
      path: path, base: base, end: end, baseEnd: b,
      equations: ["Y'_t = Y_t x (1 + g_Y x r_t)", "P'_t = A_t x Y'_t"],
      cost: end.area * (opts.costPerHaYieldProgramme || DEFAULTS.costPerHaYieldProgramme) * (pct / 0.30),
      costBasis: 'per-hectare programme cost scaled by the size of the yield gain sought ' +
        '(reference point: a 30% gain at the full per-hectare cost)',
      feasibility: pct <= 0.25
        ? { level: 'plausible', score: 1, text: 'within the observed range of sustained yield growth' }
        : pct <= 0.5
          ? { level: 'demanding', score: 0.5, text: 'requires irrigation investment at scale' }
          : { level: 'strained', score: 0.2, text: 'approaches the agronomic yield ceiling for most ' +
              'African rainfed rice systems' },
      warnings: pct > 0.5 ? [{
        level: 'warning',
        text: 'Gains above 50% generally require irrigation, which is capital-intensive, slow to build ' +
              'and water-constrained. The cost figure here does not capture irrigation capital cost.'
      }] : []
    });
  }

  /* --- Scenario 5: combined strategy ----------------------------------- */
  function scenarioCombined(base, levers, opts) {
    opts = opts || {};
    const L = {
      areaExpansion: levers.areaExpansion || 0,
      adoptionRate: levers.adoptionRate || 0,
      varietyYieldGain: levers.varietyYieldGain != null ? levers.varietyYieldGain : DEFAULTS.varietyYieldGain.moderate,
      yieldImprovement: levers.yieldImprovement || 0,
      demandShift: 0
    };
    let priceRise = 0;
    if (levers.tariff) {
      const pass = opts.tariffPassThrough != null ? opts.tariffPassThrough : DEFAULTS.tariffPassThrough;
      priceRise = levers.tariff * pass;
      L.areaExpansion += (opts.supplyElasticityArea != null ? opts.supplyElasticityArea : DEFAULTS.supplyElasticityArea) * priceRise;
      L.yieldImprovement = (1 + L.yieldImprovement) *
        (1 + (opts.supplyElasticityYield != null ? opts.supplyElasticityYield : DEFAULTS.supplyElasticityYield) * priceRise) - 1;
      L.demandShift = (opts.demandElasticity != null ? opts.demandElasticity : DEFAULTS.demandElasticity) * priceRise;
    }

    const path = applyLevers(base, L, opts);
    const end = atTarget(path, base.targetYear);
    const b = atTarget(base.path, base.targetYear);
    const ceiling = landCeiling(base, opts);
    const cost = combinedCost(end, b, L, levers, opts);

    return decorate({
      id: 'combined', label: 'Combined strategy',
      description: describeCombined(L, levers, base.targetYear),
      levers: L, tariff: levers.tariff || 0,
      path: path, base: base, end: end, baseEnd: b,
      equations: [
        "A'_t = A_t x (1 + g_A x r_t)",
        "Y'_t = Y_t x (1 + a_t x delta_Y) x (1 + g_Y x r_t)",
        "P'_t = A'_t x Y'_t",
        "C'_t = cpc_t x N_t x (1 + eps_D x tau x rho)"
      ],
      cost: cost.total,
      costBreakdown: cost.parts,
      costBasis: 'sum of the per-lever costs, each computed as in its own scenario',
      feasibility: feasibilityArea(end.area, ceiling),
      warnings: areaWarnings(end.area, ceiling, L.areaExpansion)
        .concat(levers.tariff ? [{ level: 'warning', text: 'Includes a tariff: see the consumer ' +
          'welfare caveats in the tariff scenario.' }] : [])
    });
  }

  function describeCombined(L, raw, targetYear) {
    const parts = [];
    if (L.areaExpansion) parts.push(pctFmt(L.areaExpansion) + ' more area');
    if (raw.adoptionRate) parts.push(pctFmt(raw.adoptionRate) + ' improved-variety adoption');
    if (raw.yieldImprovement) parts.push(pctFmt(raw.yieldImprovement) + ' yield improvement');
    if (raw.tariff) parts.push('a ' + pctFmt(raw.tariff) + ' import tariff');
    return (parts.length ? parts.join(', ') : 'no intervention') + ', all phased in by ' + targetYear + '.';
  }

  function combinedCost(end, baseEnd, L, raw, opts) {
    const parts = {};
    const addedHa = Math.max(0, end.area - baseEnd.area);
    parts.areaExpansion = addedHa * (opts.costPerHaExpansion || DEFAULTS.costPerHaExpansion);
    parts.varietyProgramme = end.area * (raw.adoptionRate || 0) *
      (opts.costPerHaVarietyProgramme || DEFAULTS.costPerHaVarietyProgramme);
    parts.yieldProgramme = end.area * (opts.costPerHaYieldProgramme || DEFAULTS.costPerHaYieldProgramme) *
      ((raw.yieldImprovement || 0) / 0.30);
    let total = 0;
    Object.keys(parts).forEach(k => { total += parts[k]; });
    return { total: total, parts: parts };
  }

  /* ---------------------------------------------------------- decoration */

  /* Results at every horizon, not just the target year. */
  function horizonRows(scenario) {
    return HORIZONS.map(y => {
      const p = pointAt(scenario.path, y);
      const b = pointAt(scenario.base.path, y);
      if (!p || !b) return { year: y, available: false };
      return {
        year: y,
        available: true,
        ssr: p.ssr,
        ssrBaseline: b.ssr,
        ssrChange: (p.ssr != null && b.ssr != null) ? p.ssr - b.ssr : null,
        idr: p.idr,
        production: p.production,
        productionBaseline: b.production,
        consumption: p.consumption,
        imports: p.imports,
        importsBaseline: b.imports,
        importSaving: (b.imports != null && p.imports != null) ? b.imports - p.imports : null,
        area: p.area,
        yield: p.yield,
        population: p.population,
        phaseIn: p.progress,
        selfSufficient: p.ssr != null && p.ssr >= 100
      };
    });
  }

  /* Exact-year lookup. Returns null rather than the nearest year, so a horizon
   * beyond the projection is reported as unavailable instead of silently
   * answered with a different year's number. */
  function pointAt(path, year) {
    for (let i = 0; i < path.length; i++) if (path[i].year === year) return path[i];
    return null;
  }

  function decorate(s) {
    const end = s.end, baseEnd = s.baseEnd;
    s.horizons = horizonRows(s);
    s.summary = {
      targetYear: s.base.targetYear,
      ssr: end.ssr,
      ssrBaseline: baseEnd.ssr,
      ssrChange: (end.ssr != null && baseEnd.ssr != null) ? end.ssr - baseEnd.ssr : null,
      idr: end.idr,
      production: end.production,
      productionBaseline: baseEnd.production,
      productionChange: end.production - baseEnd.production,
      imports: end.imports,
      importsBaseline: baseEnd.imports,
      importSaving: (baseEnd.imports != null && end.imports != null) ? baseEnd.imports - end.imports : null,
      area: end.area,
      yield: end.yield,
      cost: s.cost,
      selfSufficient: end.ssr != null && end.ssr >= 100
    };
    s.crossingYear = firstCrossing(s.path, 100);
    s.kind = 'scenario-simulation';
    s.disclaimer = 'Scenario simulation under stated assumptions. Not a forecast and not a causal ' +
      'estimate of policy impact.';
    return s;
  }

  function firstCrossing(path, threshold) {
    for (let i = 0; i < path.length; i++) {
      if (path[i].ssr != null && path[i].ssr >= threshold) return path[i].year;
    }
    return null;
  }

  /* ==================================================== least-cost optimiser
   *
   *   minimise   K(g_A, a, g_Y)  =  c_A dA + c_V a A' + c_Y A' (g_Y / 0.30)
   *   subject to SSR(target year) >= S*
   *              0 <= g_A <= g_A^max      (land ceiling)
   *              0 <= a   <= a^max        (adoption ceiling)
   *              0 <= g_Y <= g_Y^max      (agronomic ceiling)
   *              K <= B                   (budget, when one is given)
   *
   * Solved by a coarse grid followed by local refinement. The problem is small,
   * the objective is cheap, and a grid is auditable in a way a black-box solver
   * is not -- which matters more here than the last decimal of optimality.
   */
  function optimize(base, opts) {
    opts = opts || {};
    const target = opts.ssrTarget != null ? opts.ssrTarget : 100;
    /* The year the constraint is evaluated at. Defaults to the baseline's own
     * target year, but a caller asking "what would it take by 2035?" against a
     * baseline projected to 2050 must be able to say so -- otherwise the optimiser
     * silently answers a different question from the one asked, and returns a
     * package that only reaches the target at the later date. */
    const atYear = opts.atYear || base.targetYear;
    const ceiling = landCeiling(base, opts);
    const bEnd = pointAt(base.path, atYear) || atTarget(base.path, base.targetYear);
    const maxArea = opts.maxAreaExpansion != null ? opts.maxAreaExpansion
      : Math.max(0, ceiling.ha / bEnd.area - 1);
    const maxAdopt = opts.maxAdoption != null ? opts.maxAdoption : 0.80;
    const maxYield = opts.maxYieldImprovement != null ? opts.maxYieldImprovement : 0.60;
    const budget = opts.budget || null;
    const gain = opts.varietyYieldGain != null ? opts.varietyYieldGain : DEFAULTS.varietyYieldGain.moderate;
    /* Variety adoption and productivity investment both raise yield and combine
     * multiplicatively (see effectiveYieldGain). Capping each lever separately is
     * therefore not enough: 80% adoption at +30% stacked on a +150% productivity
     * gain implies 3.10x baseline yield even though both levers sit inside their
     * own bounds. The binding agronomic constraint is on the RESULTING yield, so
     * bound the product too, and default it to the productivity cap so a caller
     * that says "yield may at most rise 150%" gets exactly that. */
    const maxEffYieldFactor = opts.maxEffectiveYieldFactor != null
      ? opts.maxEffectiveYieldFactor : (1 + maxYield);

    let best = null;
    const evaluated = [];
    let rejectedByYieldCeiling = 0;

    function withinYieldCeiling(a, gY) {
      return (1 + a * gain) * (1 + gY) <= maxEffYieldFactor + 1e-9;
    }

    function evaluate(gA, a, gY) {
      if (!withinYieldCeiling(a, gY)) { rejectedByYieldCeiling++; return null; }
      const levers = { areaExpansion: gA, adoptionRate: a, varietyYieldGain: gain, yieldImprovement: gY };
      const path = applyLevers(base, levers, opts);
      const end = pointAt(path, atYear) || atTarget(path, base.targetYear);
      if (!end || end.ssr == null) return null;
      const cost = combinedCost(end, bEnd, levers, levers, opts);
      const feasible = end.ssr >= target && (!budget || cost.total <= budget);
      return { gA: gA, a: a, gY: gY, ssr: end.ssr, cost: cost.total, parts: cost.parts,
               feasible: feasible, end: end, path: path, levers: levers };
    }

    function search(gAs, as, gYs) {
      gAs.forEach(gA => as.forEach(a => gYs.forEach(gY => {
        const r = evaluate(gA, a, gY);
        if (!r) return;
        evaluated.push({ gA: gA, a: a, gY: gY, ssr: r.ssr, cost: r.cost, feasible: r.feasible });
        if (!r.feasible) return;
        if (!best || r.cost < best.cost) best = r;
      })));
    }

    const grid = (max, n) => {
      const out = [];
      for (let i = 0; i <= n; i++) out.push(max * i / n);
      return out;
    };
    search(grid(maxArea, 10), grid(maxAdopt, 10), grid(maxYield, 10));

    if (best) {
      // Local refinement around the incumbent.
      const fine = (c, max, step) => {
        const out = [];
        for (let v = Math.max(0, c - step * 2); v <= Math.min(max, c + step * 2) + 1e-9; v += step / 2) out.push(v);
        return out;
      };
      search(fine(best.gA, maxArea, maxArea / 10),
             fine(best.a, maxAdopt, maxAdopt / 10),
             fine(best.gY, maxYield, maxYield / 10));
    }

    if (!best) {
      // Report how close the most ambitious admissible package gets, so the
      // answer is "not reachable, and here is the best available" rather than
      // a blank.
      // The most ambitious package that is actually admissible: every lever at its
      // bound, then productivity trimmed back so the COMBINED yield still respects
      // the agronomic ceiling (otherwise this reports an unattainable yield).
      const capYield = Math.max(0, Math.min(maxYield, maxEffYieldFactor / (1 + maxAdopt * gain) - 1));
      const maxed = evaluate(maxArea, maxAdopt, capYield);
      return {
        ok: false,
        target: target,
        atYear: atYear,
        reason: 'No combination within the stated constraints reaches SSR ' + target + '% by ' +
                atYear + '.',
        bestAttainable: maxed ? {
          ssr: maxed.ssr, cost: maxed.cost,
          levers: { areaExpansion: maxArea, adoptionRate: maxAdopt, yieldImprovement: capYield }
        } : null,
        constraints: { maxArea: maxArea, maxAdoption: maxAdopt, maxYield: maxYield,
                       maxEffectiveYieldFactor: maxEffYieldFactor,
                       rejectedByYieldCeiling: rejectedByYieldCeiling,
                       budget: budget, landCeiling: ceiling },
        evaluated: evaluated.length,
        objective: 'minimise total programme cost subject to SSR >= ' + target + '%',
        disclaimer: 'Optimisation over assumed cost parameters. The ranking of strategies is only as ' +
          'good as those assumptions.'
      };
    }

    const scenario = scenarioCombined(base, {
      areaExpansion: best.gA, adoptionRate: best.a,
      varietyYieldGain: gain, yieldImprovement: best.gY
    }, opts);

    return {
      ok: true,
      target: target,
      solution: {
        areaExpansion: best.gA, adoptionRate: best.a, yieldImprovement: best.gY,
        varietyYieldGain: gain,
        cost: best.cost, costParts: best.parts, ssr: best.ssr,
        // The yield this package actually implies, so the reader can check it
        // against the agronomic ceiling rather than against the lever bounds.
        effectiveYieldFactor: (1 + best.a * gain) * (1 + best.gY)
      },
      scenario: scenario,
      atYear: atYear,
      constraints: { maxArea: maxArea, maxAdoption: maxAdopt, maxYield: maxYield,
                     maxEffectiveYieldFactor: maxEffYieldFactor,
                     rejectedByYieldCeiling: rejectedByYieldCeiling,
                     budget: budget, landCeiling: ceiling },
      evaluated: evaluated.length,
      frontier: buildFrontier(evaluated),
      objective: 'minimise c_A x dA + c_V x a x A + c_Y x A x (g_Y / 0.30) subject to SSR(' +
                 atYear + ') >= ' + target + '%',
      costAssumptions: {
        costPerHaExpansion: opts.costPerHaExpansion || DEFAULTS.costPerHaExpansion,
        costPerHaVarietyProgramme: opts.costPerHaVarietyProgramme || DEFAULTS.costPerHaVarietyProgramme,
        costPerHaYieldProgramme: opts.costPerHaYieldProgramme || DEFAULTS.costPerHaYieldProgramme
      },
      disclaimer: 'The cost parameters are placeholders, not national costings. The least-cost package ' +
        'shown is the cheapest under THOSE numbers; substitute real costs before drawing any policy ' +
        'conclusion from the ranking.'
    };
  }

  /* Cost/SSR frontier: for each achievable SSR band, the cheapest package found. */
  function buildFrontier(evaluated) {
    const bands = {};
    evaluated.forEach(e => {
      const band = Math.round(e.ssr / 5) * 5;
      if (!bands[band] || e.cost < bands[band].cost) bands[band] = e;
    });
    return Object.keys(bands).map(k => bands[k]).sort((a, b) => a.ssr - b.ssr);
  }

  /* ==================================================== scenario comparison */

  function compare(scenarios) {
    return scenarios.filter(Boolean).map(s => ({
      scenario: s.label,
      description: s.description,
      targetYear: s.summary.targetYear,
      areaChange: s.summary.area && s.baseEnd.area ? (s.summary.area / s.baseEnd.area - 1) : null,
      yieldChange: s.summary.yield && s.baseEnd.yield ? (s.summary.yield / s.baseEnd.yield - 1) : null,
      adoption: s.levers.adoptionRate || 0,
      tariff: s.tariff || 0,
      production: s.summary.production,
      imports: s.summary.imports,
      importSaving: s.summary.importSaving,
      ssr: s.summary.ssr,
      ssrChange: s.summary.ssrChange,
      idr: s.summary.idr,
      cost: s.summary.cost,
      costPerSsrPoint: (s.summary.cost && s.summary.ssrChange > 0)
        ? s.summary.cost / s.summary.ssrChange : null,
      selfSufficient: s.summary.selfSufficient,
      crossingYear: s.crossingYear,
      feasibility: s.feasibility,
      warnings: s.warnings.length
    }));
  }

  return {
    DEFAULTS: DEFAULTS,
    HORIZONS: HORIZONS,
    RAMPS: RAMPS,
    rampFactor: rampFactor,
    horizonRows: horizonRows,
    pointAt: pointAt,
    projectComponent: projectComponent,
    baseline: baseline,
    applyLevers: applyLevers,
    scenarioArea: scenarioArea,
    scenarioVariety: scenarioVariety,
    scenarioTariff: scenarioTariff,
    scenarioYield: scenarioYield,
    scenarioCombined: scenarioCombined,
    optimize: optimize,
    compare: compare,
    atTarget: atTarget,
    firstCrossing: firstCrossing,
    landCeiling: landCeiling
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSAScenarios; }
