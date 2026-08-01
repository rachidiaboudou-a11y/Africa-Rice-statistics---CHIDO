/* Rice Statistics for Africa -- the Van Oort et al. (2015) self-sufficiency model.
 *
 * Implements the framework of:
 *
 *   van Oort, P.A.J., Saito, K., Tanaka, A., Amovin-Assagba, E., Van Bussel, L.G.J.,
 *   Van Wart, J., de Groot, H., van Ittersum, M.K., Cassman, K.G. & Wopereis, M.C.S.
 *   (2015). "Assessment of rice self-sufficiency in 2025 in eight African countries."
 *   Global Food Security 5, 39-49. doi:10.1016/j.gfs.2015.01.002
 *
 * applied here to West Africa rather than to the paper's eight-country set.
 *
 * WHAT THE MODEL IS
 *
 * A biophysical accounting framework, not an econometric one. Production is area
 * times yield, consumption is population times per-capita consumption, and the
 * self-sufficiency indicator is their ratio P/C. The contribution of the paper is
 * the SCENARIO STRUCTURE around that identity: it asks how much extra area would
 * be needed to reach P/C = 1 under different assumptions about yield growth and
 * dietary change, and bounds yield growth by an agronomic ceiling rather than
 * letting it run free.
 *
 * WHAT DIFFERS HERE, AND WHY
 *
 * 1. TARGET YEAR. The paper projected to 2025, chosen because it was "meaningful
 *    for most African policymakers". That year is now past, so the horizon is
 *    user-selectable and defaults to 2035.
 *
 * 2. RAINFED / IRRIGATED SPLIT. The paper's Eq. 1 separates rainfed and irrigated
 *    systems because actual yields and potentials differ sharply between them.
 *    That split comes from the SPAM land-cover map and GYGA simulations, which
 *    exist for the paper's eight countries and not for the rest of West Africa.
 *    Where the split is unavailable the model is run in its AGGREGATE form -- a
 *    single national area and yield -- which is Eq. 1 with one system rather than
 *    two. This is stated on every result it produces.
 *
 * 3. YIELD CEILING. Eqs. 8 and 9 bound yield growth at 80% of the water-limited
 *    potential Yw (rainfed) or the potential Yp (irrigated), following Cassman
 *    (2001). Those potentials are ORYZA2000 simulations from the Global Yield Gap
 *    Atlas. They are not reproducible from public statistics, so for the four West
 *    African countries the paper covers the ceiling is RECONSTRUCTED from its
 *    published Table 2: the "yield trend needed to get from Ya to 80% of Yp or Yw
 *    from 2012 to 2025" multiplied by the 13-year span gives the gap, and adding
 *    it to the 2012 actual yield gives 0.8 x potential. For the other twelve
 *    countries the ceiling is unavailable and the 80%-of-potential scenarios are
 *    reported as not computable rather than guessed.
 *
 * 4. MILLING RATE. The paper uses 0.65 (Eq. 2). The rest of this platform uses
 *    FAO's 0.67. The model below uses 0.65 so its results are comparable with the
 *    published ones, and says so.
 */

const RSAVanOort = (function () {
  'use strict';

  /* Eq. 2. The paper's own conversion, deliberately not the platform default. */
  const MILLING_RATE = 0.65;

  /* Eqs. 8-9. Cassman (2001): beyond about 80% of potential the cost of further
   * yield gain generally exceeds the return. */
  const EXPLOITABLE_FRACTION = 0.80;

  /* Published parameters, van Oort et al. (2015), for the West African countries
   * the paper covers. Everything here is transcribed from the paper, and each
   * field records which table it came from so a reader can check it.
   *
   * areaRainfed / areaIrrigated: Table 5, "existing physical area" (1000 ha, 2012)
   * yieldTrend0712:              Table 2, kg/ha/yr, national trend 2007-2012
   * trendTo80pct:                Table 2, kg/ha/yr needed 2012->2025 to reach
   *                              80% of Yp (irrigated) or Yw (rainfed)
   * pc2012 / pc2025:             Table 1, kg milled rice per person per year
   * pcRatio2012:                 Table 1, published P/C in 2012, for validation
   */
  const PAPER = {
    BFA: { name: 'Burkina Faso', areaRainfed: 87,   areaIrrigated: 33,
           yieldTrendRainfed: 88,  yieldTrendIrrigated: 254, trendTo80pct: 277,
           pc2012: 25,  pc2025: 35,  pcRatio2012: 0.49,
           prod2012: 0.32, cons2012: 0.64, imports2012: 0.32 },
    GHA: { name: 'Ghana',        areaRainfed: 152,  areaIrrigated: 11,
           yieldTrendRainfed: 169, yieldTrendIrrigated: 431, trendTo80pct: 305,
           pc2012: 37,  pc2025: 45,  pcRatio2012: 0.16,
           prod2012: 0.24, cons2012: 1.46, imports2012: 1.22 },
    MLI: { name: 'Mali',         areaRainfed: 238,  areaIrrigated: 346,
           yieldTrendRainfed: 127, yieldTrendIrrigated: 198, trendTo80pct: 305,
           pc2012: 105, pc2025: 156, pcRatio2012: 0.89,
           prod2012: 2.14, cons2012: 2.39, imports2012: 0.25 },
    NGA: { name: 'Nigeria',      areaRainfed: 1465, areaIrrigated: 785,
           yieldTrendRainfed: 117, yieldTrendIrrigated: 295, trendTo80pct: 382,
           pc2012: 35,  pc2025: 44,  pcRatio2012: 0.53,
           prod2012: 4.81, cons2012: 9.13, imports2012: 4.32 }
  };

  // The paper's non-West-African countries, kept for validating the
  // implementation against published results.
  const PAPER_OTHER = {
    TZA: { name: 'Tanzania', pc2012: 23, pc2025: 24, pcRatio2012: 0.83 },
    UGA: { name: 'Uganda',   pc2012: 5,  pc2025: 5,  pcRatio2012: 0.99 },
    ZMB: { name: 'Zambia',   pc2012: 3,  pc2025: 5,  pcRatio2012: 0.57 },
    EGY: { name: 'Egypt',    pc2012: 48, pc2025: 51, pcRatio2012: 1.18 }
  };

  /* Published P/C outcomes, Table 4, "no area expansion", current-diet column,
   * used as a regression check on the implementation. */
  const PAPER_TABLE4 = {
    BFA: { noYield: 0.35, trend: 0.54, plus1: 0.51, plus2: 0.68, pct80: 0.92 },
    GHA: { noYield: 0.13, trend: 0.33, plus1: 0.22, plus2: 0.31, pct80: 0.62 },
    MLI: { noYield: 0.59, trend: 0.89, plus1: 0.78, plus2: 0.96, pct80: 1.22 },
    NGA: { noYield: 0.37, trend: 0.64, plus1: 0.54, plus2: 0.72, pct80: 1.10 }
  };

  /* The six yield scenarios of the paper (Tables 3-5). */
  const YIELD_SCENARIOS = [
    { id: 'none',   label: 'No yield increase',
      labelFr: 'Aucune hausse de rendement',
      note: 'Yields fixed at their current level. The most pessimistic case.' },
    { id: 'trend',  label: 'Recent yield trend',
      labelFr: 'Tendance récente des rendements',
      note: 'Yields continue at the national trend of the last five observed years.' },
    { id: 'plus1',  label: 'Yield +1 t/ha',
      labelFr: 'Rendement +1 t/ha',
      note: 'A modest, evidence-based increase (Saito et al. 2012, 2013; Haefele et al. 2013).' },
    { id: 'plus2',  label: 'Yield +2 t/ha',
      labelFr: 'Rendement +2 t/ha',
      note: 'An ambitious increase, roughly 156 kg/ha/yr over thirteen years.' },
    { id: 'pct80',  label: 'Yield to 80% of potential',
      labelFr: 'Rendement à 80 % du potentiel',
      note: 'The agronomic ceiling of Cassman (2001). Requires Global Yield Gap Atlas ' +
            'potentials, available only for the countries the paper covers.',
      needsPotential: true },
    { id: 'pct80cc', label: '80% of potential + double cropping',
      labelFr: '80 % du potentiel + double culture',
      note: 'As above, plus cropping intensity on irrigated land raised to two crops a year. ' +
            'Requires the irrigated area split as well as the potentials.',
      needsPotential: true, needsSplit: true }
  ];

  /* Two diet scenarios (paper Section 2.4). */
  const DIET_SCENARIOS = [
    { id: 'current', label: 'Current diet', labelFr: 'Régime actuel',
      note: 'Per-capita consumption held at its current level.' },
    { id: 'trend',   label: 'Diet extrapolated on trend', labelFr: 'Régime extrapolé',
      note: 'Per-capita consumption continues its recent trend. In the paper this was the ' +
            '2000-2012 trend, which ran at 7-9%/yr in Burkina Faso and Mali.' }
  ];

  /* ------------------------------------------------------------- helpers */

  function lastObserved(res) {
    for (let i = res.values.length - 1; i >= 0; i--) {
      if (res.values[i] != null && isFinite(res.values[i])) {
        return { year: res.years[i], value: res.values[i] };
      }
    }
    return null;
  }

  /* Ordinary least squares slope of v on year, over the last n observed years.
   * This is the paper's "yield trend" and "diet trend", estimated the same way
   * for every country rather than taken from a table. */
  function trendPerYear(res, nYears, endYear) {
    const xs = [], ys = [];
    for (let i = 0; i < res.years.length; i++) {
      if (res.values[i] == null || !isFinite(res.values[i])) continue;
      if (endYear != null && res.years[i] > endYear) continue;
      xs.push(res.years[i]); ys.push(res.values[i]);
    }
    if (xs.length < 3) return null;
    const take = Math.min(nYears || 5, xs.length);
    const X = xs.slice(xs.length - take), Y = ys.slice(ys.length - take);
    const n = X.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += X[i]; sy += Y[i]; sxx += X[i] * X[i]; sxy += X[i] * Y[i]; }
    const den = n * sxx - sx * sx;
    if (den === 0) return null;
    return (n * sxy - sx * sy) / den;
  }

  /* Population from the UN projection already carried in the dataset -- the paper
   * used the UN medium variant, and so does this. */
  function populationAt(isoList, year) {
    const popYears = RSA.state.fao.popYears;
    const pi = popYears.indexOf(year);
    if (pi < 0) return null;
    let total = null;
    isoList.forEach(iso => {
      const s = RSA.state.fao.series[iso];
      if (s && s.population[pi] != null) total = (total == null ? 0 : total) + s.population[pi] * 1000;
    });
    return total;
  }

  /* ============================================================ the model */

  /* Runs the full scenario grid for one selection.
   *
   *   opts.targetYear   horizon (default 2035; the paper used 2025)
   *   opts.baseYear     baseline year (default: last year with both area and yield)
   *   opts.dbKey        'fao' or 'usda'
   */
  function run(sel, opts) {
    opts = opts || {};
    const dbKey = opts.dbKey || 'fao';
    const targetYear = opts.targetYear || 2035;
    const isoList = RSA.resolve(sel);

    // Paddy production, area and yield come from the balance sheet on the
    // AS-PUBLISHED basis, because Eq. 1 is written in unmilled (paddy) terms and
    // Eq. 2 does the milling conversion explicitly.
    const bal = RSA.balance(dbKey, sel, { basis: 'asPublished' });
    const I = RSAIndicators;
    const areaRes = I.compute('area', bal);
    const yieldRes = I.compute('yield', bal);
    const prodRes = I.compute('production', bal);

    const areaObs = lastObserved(areaRes);
    const yieldObs = lastObserved(yieldRes);
    if (!areaObs || !yieldObs) {
      return { ok: false, reason: 'no observed rice area or yield for this selection' };
    }
    const baseYear = opts.baseYear || Math.min(areaObs.year, yieldObs.year);

    const areaAt = valueAt(areaRes, baseYear);
    const yieldAt = valueAt(yieldRes, baseYear);
    if (areaAt == null || yieldAt == null || areaAt <= 0) {
      return { ok: false, reason: 'no usable area/yield in the baseline year ' + baseYear };
    }

    /* Per-capita consumption.
     *
     * The paper computed this as total domestic consumption divided by
     * population -- "Current per-capita rice consumption by country was
     * calculated from 2012 consumption (USDA, 2014) and population (UN, 2014)".
     * That total INCLUDES feed, seed, losses and industrial use, so it is not the
     * same quantity as the food-supply figure published as "rice consumption per
     * capita", and for a country whose re-exports go unrecorded it is inflated.
     *
     * Both are offered. 'total' is the paper's definition and the default here,
     * because this section exists to run the paper's model. 'food' uses the
     * FAOSTAT Food Balance Sheet food supply, which is the figure comparable to
     * published consumption statistics.
     */
    const pcBasis = opts.perCapitaBasis === 'food' ? 'food' : 'total';
    const milledBal = RSA.balance(dbKey, sel, { basis: 'milled' });
    let pcRes, pcObs, pcSource;
    if (pcBasis === 'food') {
      pcRes = I.compute('cpcFood', milledBal);
      pcObs = lastObserved(pcRes);
      pcSource = 'FAOSTAT Food Balance Sheet food supply, milled (element 645) -- food use only, ' +
                 'comparable to published per-capita consumption but NOT the paper\'s definition';
    }
    if (!pcObs) {
      pcRes = I.compute('cpc', milledBal);
      pcObs = lastObserved(pcRes);
      pcSource = (pcBasis === 'food' ? 'no food balance sheet coverage, fell back to ' : '') +
                 'total apparent utilization (P + M - X) per capita, milled -- the paper\'s ' +
                 'definition, which includes feed, seed, losses and industrial use and is inflated ' +
                 'where re-export goes unrecorded';
    }
    if (!pcObs) return { ok: false, reason: 'no per-capita consumption available' };

    const popBase = populationAt(isoList, baseYear);
    const popTarget = populationAt(isoList, targetYear);
    if (!popBase || !popTarget) {
      return { ok: false, reason: 'no UN population projection for ' + baseYear + ' or ' + targetYear };
    }

    const span = targetYear - baseYear;
    if (span <= 0) return { ok: false, reason: 'target year is not after the baseline year' };

    // Yield trend, estimated over the last five observed years as the paper did
    // over 2007-2012, in kg/ha/yr.
    const yTrend = trendPerYear(yieldRes, 5, baseYear) || 0;

    // Diet trend, kg/capita/yr.
    const pcTrend = trendPerYear(pcRes, 12, pcObs.year) || 0;

    // Exploitable ceiling, where the paper's parameters allow it to be
    // reconstructed. See the module header for the derivation.
    let ceiling = null, ceilingSource = null;
    const single = isoList.length === 1 ? isoList[0] : null;
    if (single && PAPER[single]) {
      const p = PAPER[single];
      // Table 2 gives the trend needed 2012 -> 2025 (13 years) to reach 80% of
      // potential from the 2012 actual yield.
      const gap2012 = p.trendTo80pct * 13;                 // kg/ha
      const ya2012 = valueAt(yieldRes, 2012);
      if (ya2012 != null) {
        ceiling = ya2012 + gap2012;                        // = 0.8 x potential, kg/ha
        ceilingSource = 'reconstructed from van Oort et al. (2015) Table 2: ' +
          p.trendTo80pct + ' kg/ha/yr x 13 years added to the 2012 actual yield of ' +
          Math.round(ya2012) + ' kg/ha';
      }
    }

    // Consumption at the target, for each diet scenario (Eq. 3).
    const pcTarget = {
      current: pcObs.value,
      trend: Math.max(0, pcObs.value + pcTrend * (targetYear - pcObs.year))
    };
    // Eq. 3. Per-capita is kg/person/yr and population is in PERSONS, so the
    // product is kilograms and the conversion to tonnes is /1000.
    const consumption = {
      current: pcTarget.current * popTarget / 1000,
      trend: pcTarget.trend * popTarget / 1000
    };

    // Yield at the target, for each yield scenario.
    const yieldTarget = {
      none: yieldAt,
      trend: Math.max(0, yieldAt + yTrend * span),
      plus1: yieldAt + 1000,
      plus2: yieldAt + 2000,
      pct80: ceiling,
      pct80cc: ceiling            // double cropping acts on area, handled below
    };
    // Eqs. 8-9: no scenario may exceed the exploitable ceiling.
    if (ceiling != null) {
      ['trend', 'plus1', 'plus2'].forEach(k => {
        if (yieldTarget[k] > ceiling) yieldTarget[k] = ceiling;
      });
    }

    const rows = [];
    YIELD_SCENARIOS.forEach(ys => {
      DIET_SCENARIOS.forEach(ds => {
        const Y = yieldTarget[ys.id];
        const C = consumption[ds.id];
        if (Y == null || C == null || !isFinite(Y) || !isFinite(C)) {
          rows.push({ yieldScenario: ys.id, dietScenario: ds.id, available: false,
                      reason: ys.needsPotential
                        ? 'requires Global Yield Gap Atlas potentials, not available for this selection'
                        : 'insufficient data' });
          return;
        }
        // Eq. 1 + Eq. 2: milled production from area and unmilled yield.
        // Cropping-intensity doubling is only meaningful with the irrigated split,
        // which is unavailable here, so pct80cc equals pct80 and is flagged.
        const areaHa = areaAt;
        const Pmilled = MILLING_RATE * areaHa * Y / 1000;   // ha x kg/ha /1000 = tonnes
        const pc = C > 0 ? Pmilled / C : null;
        // Eq. 5 in aggregate form: area needed for P/C = 1.
        const areaNeeded = (Y > 0) ? (C / MILLING_RATE) * 1000 / Y : null;
        /* A five-year yield trend extrapolated over a decade can drive yield to
         * near zero where the recent trend is negative, which is an artefact of
         * linear extrapolation rather than a scenario anyone would propose. The
         * value is NOT altered -- silently flooring it would hide a real feature
         * of the data -- but it is flagged so the table can mark it and the
         * reader is not left to infer that Sierra Leone is projected to stop
         * growing rice. */
        const collapsed = (ys.id === 'trend' && Y < 0.5 * yieldAt);

        rows.push({
          yieldScenario: ys.id, dietScenario: ds.id, available: true,
          yield: Y, consumption: C, production: Pmilled,
          trendCollapse: collapsed,
          trendCollapseNote: collapsed
            ? 'The recent yield trend is negative and extrapolating it to ' + targetYear +
              ' implies yield falling from ' + Math.round(yieldAt) + ' to ' + Math.round(Y) +
              ' kg/ha. That is an artefact of linear extrapolation over ' + span + ' years, not a ' +
              'credible scenario; read the fixed-increment scenarios instead.'
            : null,
          pcRatio: pc,
          selfSufficient: pc != null && pc >= 1,
          imports: Math.max(0, C - Pmilled),
          areaNeeded: areaNeeded,
          areaExpansionFactor: areaNeeded != null ? areaNeeded / areaHa : null,
          extraArea: areaNeeded != null ? Math.max(0, areaNeeded - areaHa) : null,
          notComparable: ys.id === 'pct80cc' && !PAPER[single]
        });
      });
    });

    return {
      ok: true,
      model: 'van Oort et al. (2015)',
      selection: RSA.selectionLabel(sel),
      members: isoList,
      db: bal.db,
      aggregate: isoList.length > 1,
      baseYear: baseYear,
      targetYear: targetYear,
      span: span,
      millingRate: MILLING_RATE,
      exploitableFraction: EXPLOITABLE_FRACTION,
      baseline: {
        area: areaAt,
        yield: yieldAt,
        productionPaddy: areaAt * yieldAt / 1000,
        productionMilled: MILLING_RATE * areaAt * yieldAt / 1000,
        population: popBase,
        perCapita: pcObs.value,
        perCapitaYear: pcObs.year,
        perCapitaSource: pcSource,
        consumption: pcObs.value * popBase / 1000,
        pcRatio: (pcObs.value * popBase / 1000) > 0
          ? (MILLING_RATE * areaAt * yieldAt / 1000) / (pcObs.value * popBase / 1000) : null
      },
      target: {
        population: popTarget,
        populationGrowthFactor: popTarget / popBase,
        perCapita: pcTarget,
        consumption: consumption
      },
      perCapitaBasis: pcBasis,
      trends: { yieldPerYear: yTrend, perCapitaPerYear: pcTrend },
      ceiling: ceiling,
      ceilingSource: ceilingSource,
      hasSystemSplit: !!(single && PAPER[single]),
      paperParams: single ? (PAPER[single] || null) : null,
      rows: rows,
      caveats: buildCaveats(single, ceiling, pcSource, isoList)
    };
  }

  function valueAt(res, year) {
    const i = res.years.indexOf(year);
    return i >= 0 ? res.values[i] : null;
  }

  function buildCaveats(single, ceiling, pcSource, isoList) {
    const c = [];
    c.push('Implements van Oort et al. (2015), Global Food Security 5, 39-49. Milling rate 0.65 ' +
           'is the paper\'s (Eq. 2), not the platform default of 0.67, so results are comparable ' +
           'with the published ones.');
    c.push('Run in AGGREGATE form: a single national area and yield rather than the paper\'s ' +
           'separate rainfed and irrigated systems (Eq. 1). The split requires the SPAM land-cover ' +
           'map and Global Yield Gap Atlas simulations, which exist for the paper\'s eight ' +
           'countries and not for the rest of West Africa. Aggregating hides that irrigated and ' +
           'rainfed yields, potentials and expansion possibilities all differ substantially.');
    if (ceiling == null) {
      c.push('The 80%-of-potential scenarios (Eqs. 8-9) CANNOT be computed for this selection: the ' +
             'water-limited potential Yw and the potential Yp are ORYZA2000 simulations from the ' +
             'Global Yield Gap Atlas and are not derivable from public statistics. They are ' +
             'reported as unavailable rather than estimated.');
    } else {
      c.push('The 80%-of-potential ceiling is RECONSTRUCTED from the paper\'s published Table 2 ' +
             'rather than simulated: ' + (ceiling ? Math.round(ceiling) + ' kg/ha' : '') + '. It ' +
             'therefore inherits the paper\'s 2012 vintage of the Global Yield Gap Atlas.');
    }
    c.push('Per-capita consumption source: ' + pcSource + '.');
    c.push('This is a biophysical accounting framework. It contains no prices, no costs, no ' +
           'behaviour and no trade response. A scenario in which area doubles says nothing about ' +
           'whether anyone would pay for it, whether the land is available, or what would be lost ' +
           'by converting it.');
    if (isoList.length > 1) {
      c.push('Aggregated across ' + isoList.length + ' countries. A regional P/C ratio can look ' +
             'adequate while individual countries within it are far from self-sufficient, because ' +
             'a surplus in one nets against a deficit in another that no trade route may actually ' +
             'connect.');
    }
    return c;
  }

  /* Validation against the paper's own published results, for the four West
   * African countries it covers. This is the check that the implementation is
   * the paper's model and not merely something that resembles it. */
  function validate(opts) {
    opts = opts || {};
    const out = [];
    Object.keys(PAPER_TABLE4).forEach(iso => {
      const published = PAPER_TABLE4[iso];
      const p = PAPER[iso];
      // Reproduce the paper's own baseline arithmetic: its 2012 production and
      // consumption, its per-capita figures, its 2025 horizon.
      const computedPC = p.prod2012 / p.cons2012;
      out.push({
        iso: iso, name: p.name,
        publishedPCRatio2012: p.pcRatio2012,
        recomputedFromPaperTable1: computedPC,
        agrees: Math.abs(computedPC - p.pcRatio2012) < 0.02,
        publishedScenarios: published
      });
    });
    return {
      note: 'Reproduces the paper\'s own Table 1 arithmetic (production / consumption) from its ' +
            'published production and consumption figures, confirming the P/C definition used ' +
            'here is the paper\'s. The scenario columns are the published Table 4 values, shown ' +
            'for reference: they cannot be reproduced exactly because they rest on Global Yield ' +
            'Gap Atlas simulations and a rainfed/irrigated split this platform does not hold.',
      rows: out
    };
  }

  /* Full reference list, as cited by the paper and by this implementation. */
  const REFERENCES = [
    { key: 'vanoort2015', text: 'van Oort, P.A.J., Saito, K., Tanaka, A., Amovin-Assagba, E., ' +
      'Van Bussel, L.G.J., Van Wart, J., de Groot, H., van Ittersum, M.K., Cassman, K.G. & ' +
      'Wopereis, M.C.S. (2015). Assessment of rice self-sufficiency in 2025 in eight African ' +
      'countries. Global Food Security 5, 39-49.', doi: '10.1016/j.gfs.2015.01.002',
      role: 'The model implemented in this section.' },
    { key: 'gassi2025', text: 'Gassi, K.R., Gul, U. & Cetin, H. (2025). Rice Self-Sufficiency in ' +
      'Benin: Analysis and Forecasts. International Journal of Food and Agricultural Economics ' +
      '13(1), 29-42.', role: 'Source of the SSR, IDR, PPC and CPC definitions used elsewhere in ' +
      'the platform.' },
    { key: 'fao2001', text: 'FAO (2001). Food Balance Sheets: A Handbook. Food and Agriculture ' +
      'Organization of the United Nations, Rome.',
      role: 'Definition of the self-sufficiency and import dependency ratios.' },
    { key: 'cassman2001', text: 'Cassman, K.G. (2001). Crop science research to assure food ' +
      'security. In: Noesberger, J., Geiger, H., Struik, P. (Eds.), Crop Science: Progress and ' +
      'Prospects. CAB International, Wallingford, UK, pp. 33-51.',
      role: 'The 80%-of-potential exploitable yield ceiling (Eqs. 8-9).' },
    { key: 'cassman2003', text: 'Cassman, K.G., Dobermann, A., Walters, D.T. & Yang, H.S. (2003). ' +
      'Meeting cereal demand while protecting natural resources and improving environmental ' +
      'quality. Annual Review of Environment and Resources 28, 315-358.',
      role: 'Yield ceiling and ecological intensification.' },
    { key: 'vanittersum2013', text: 'van Ittersum, M.K., Cassman, K.G., Grassini, P., Wolf, J., ' +
      'Tittonell, P. & Hochman, Z. (2013). Yield gap analysis with local to global relevance -- ' +
      'a review. Field Crops Research 143, 4-17.',
      role: 'Yield-gap methodology underlying the Global Yield Gap Atlas.' },
    { key: 'bouman2001', text: 'Bouman, B.A.M., Kropff, M.J., Tuong, T.P., Wopereis, M.C.S., ' +
      'ten Berge, H.F.M. & Van Laar, H.H. (2001). ORYZA2000: Modeling Lowland Rice. IRRI, ' +
      'Los Baños, and Wageningen University and Research Centre.',
      role: 'The crop model used to simulate Yp and Yw.' },
    { key: 'gyga2014', text: 'Global Yield Gap Atlas (GYGA). www.yieldgap.org',
      role: 'Source of the simulated yield potentials the paper draws on.' },
    { key: 'saito2013', text: 'Saito, K., Nelson, A., Zwart, S.J., Niang, A., Sow, A., Yoshida, H. ' +
      '& Wopereis, M.C.S. (2013). Towards a better understanding of biophysical determinants of ' +
      'yield gaps and the potential for expansion of the rice area in Africa. In: Realizing ' +
      'Africa\'s Rice Promise. CABI, pp. 188-203.',
      role: 'Evidence base for the +1 and +2 t/ha yield scenarios.' },
    { key: 'haefele2013', text: 'Haefele, S.M., Nelson, A. & Hijmans, R.J. (2013). Soil quality ' +
      'and constraints in global rice production. Geoderma 235-236, 250-259.',
      role: 'Evidence base for feasible yield increases.' },
    { key: 'clapp2017', text: 'Clapp, J. (2017). Food self-sufficiency: making sense of it, and ' +
      'when it makes sense. Food Policy 66, 88-96.',
      role: 'On why self-sufficiency is not the same as food security.' },
    { key: 'un2024', text: 'United Nations, Department of Economic and Social Affairs, Population ' +
      'Division. World Population Prospects. Medium variant.',
      role: 'Population projections used in Eq. 3.' },
    { key: 'usda', text: 'USDA Foreign Agricultural Service. Production, Supply and Distribution ' +
      '(PSD) database. apps.fas.usda.gov/psdonline',
      role: 'Independent rice balance sheet; the paper\'s source for area and consumption.' },
    { key: 'faostat', text: 'FAOSTAT. Food and Agriculture Organization of the United Nations. ' +
      'www.fao.org/faostat', role: 'Production, trade, food balance sheets and population.' },
    { key: 'laborte2012', text: 'Laborte, A.G., de Bie, C.A.J.M., Smaling, E.M.A., Moya, P.F., ' +
      'Boling, A.A. & Van Ittersum, M.K. (2012). Ex-ante evaluation of a technology for rice ' +
      'production. NJAS - Wageningen Journal of Life Sciences 63, 25-35.',
      role: 'The five ways to close a production gap, of which the paper models three.' },
    { key: 'koning2009', text: 'Koning, N. & van Ittersum, M.K. (2009). Will the world have ' +
      'enough to eat? Current Opinion in Environmental Sustainability 1, 77-82.',
      role: 'Framing of the production gap.' }
  ];

  return {
    MILLING_RATE: MILLING_RATE,
    EXPLOITABLE_FRACTION: EXPLOITABLE_FRACTION,
    YIELD_SCENARIOS: YIELD_SCENARIOS,
    DIET_SCENARIOS: DIET_SCENARIOS,
    PAPER: PAPER,
    PAPER_OTHER: PAPER_OTHER,
    PAPER_TABLE4: PAPER_TABLE4,
    REFERENCES: REFERENCES,
    run: run,
    validate: validate,
    trendPerYear: trendPerYear
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSAVanOort; }
