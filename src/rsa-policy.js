/* Rice Statistics for Africa -- policy scoring, recommendations, and the copilot.
 *
 * Three things live here, and all three are deliberately RULE-BASED rather than
 * learned or generative:
 *
 *   1. a transparent multi-criteria score for ranking scenarios
 *   2. a diagnostic engine that fires explicit rules against the indicators
 *   3. the Rice Policy Copilot, which answers questions by running the platform's
 *      own calculations and quoting them
 *
 * The copilot does not have a language model behind it and does not write prose
 * of its own invention. Every sentence it emits is assembled from a computed
 * value plus a fixed template, and every answer carries an evidence trace naming
 * the database, country, years, indicator, equation and assumptions used. This is
 * a design choice, not a limitation: an analyst must be able to audit a policy
 * claim back to the arithmetic, and a system that can phrase things it has not
 * computed cannot offer that guarantee.
 */

const RSAPolicy = (function () {
  'use strict';

  /* ============================================================ policy score
   *
   *   S = sum_j w_j x s_j        with sum_j w_j = 1 and each s_j in [0, 100]
   *
   * The weights are shown in the UI, editable by the user, and printed in the
   * report. There is no defensible universal weighting -- a finance ministry and
   * an environment ministry should not use the same one -- so the platform
   * refuses to hide them.
   */

  const DEFAULT_WEIGHTS = {
    ssrGain: 0.25,          // progress toward self-sufficiency
    importReduction: 0.15,  // foreign exchange saved
    cost: 0.20,             // fiscal cost, inverted
    feasibility: 0.15,      // implementation realism
    environment: 0.10,      // land and emissions pressure, inverted
    consumerWelfare: 0.15   // effect on the price of a staple
  };

  function scoreScenario(sc, context, weights) {
    weights = normaliseWeights(weights || DEFAULT_WEIGHTS);
    const ref = context || {};
    const s = {};

    // SSR gain, capped at a 50-point improvement scoring full marks.
    const gain = sc.summary.ssrChange || 0;
    s.ssrGain = clamp(100 * gain / 50, 0, 100);

    // Import reduction relative to the baseline import volume.
    const base = sc.summary.importsBaseline;
    const saving = sc.summary.importSaving;
    s.importReduction = (base && base > 0 && saving != null)
      ? clamp(100 * saving / base, 0, 100) : 0;

    // Cost, inverted and scaled against the most expensive scenario on the table
    // so the score is comparative rather than absolute.
    const maxCost = ref.maxCost || sc.summary.cost || 1;
    s.cost = maxCost > 0 ? clamp(100 * (1 - (sc.summary.cost || 0) / maxCost), 0, 100) : 100;

    // Feasibility comes straight from the scenario's own assessment.
    s.feasibility = 100 * (sc.feasibility ? sc.feasibility.score : 0.5);

    // Environment: land expansion is the pressure this platform can actually
    // observe. Yield intensification has its own footprint (fertiliser, water)
    // which is NOT captured, and the score says so.
    const areaGrowth = (sc.baseEnd && sc.baseEnd.area) ? (sc.summary.area / sc.baseEnd.area - 1) : 0;
    s.environment = clamp(100 * (1 - areaGrowth / 0.5), 0, 100);

    // Consumer welfare: a tariff raises staple prices, which is a cost to
    // consumers. Supply-side levers are neutral to slightly positive.
    const tariff = sc.tariff || 0;
    s.consumerWelfare = tariff > 0 ? clamp(100 * (1 - tariff / 0.3), 0, 100) : 90;

    let total = 0;
    Object.keys(weights).forEach(k => { total += weights[k] * (s[k] != null ? s[k] : 0); });

    return {
      scenario: sc.label,
      total: Math.round(total * 10) / 10,
      components: s,
      weights: weights,
      equation: 'S = ' + Object.keys(weights).map(k => weights[k].toFixed(2) + ' x s_' + k).join(' + '),
      caveats: [
        'The weights are a value judgement, not a finding. Change them and the ranking changes.',
        'The environment component reflects land expansion only. Fertiliser, water use and paddy ' +
        'methane emissions are not modelled.',
        'The cost component is relative to the other scenarios being compared, so a score is only ' +
        'meaningful within one comparison table.'
      ]
    };
  }

  function normaliseWeights(w) {
    let sum = 0;
    Object.keys(w).forEach(k => { sum += w[k]; });
    if (sum <= 0) return DEFAULT_WEIGHTS;
    const out = {};
    Object.keys(w).forEach(k => { out[k] = w[k] / sum; });
    return out;
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function rankScenarios(scenarios, weights) {
    const maxCost = scenarios.reduce((m, s) => Math.max(m, s.summary.cost || 0), 0);
    const scored = scenarios.map(s => ({
      scenario: s,
      score: scoreScenario(s, { maxCost: maxCost }, weights)
    }));
    scored.sort((a, b) => b.score.total - a.score.total);
    scored.forEach((r, i) => { r.rank = i + 1; });
    return scored;
  }

  /* ==================================================== diagnostic rule set
   *
   * Each rule states its condition in words, evaluates it against computed
   * indicators, and -- when it fires -- returns a finding with the evidence that
   * triggered it. Rules never fire on missing data.
   */

  const RULES = [
    {
      id: 'high-dependency',
      condition: 'IDR above 50% in the most recent year',
      test: d => d.idr != null && d.idr > 50,
      finding: d => ({
        severity: 'high',
        title: 'Heavy reliance on imported rice',
        text: 'Imports supply ' + fmt(d.idr) + '% of domestic rice utilization in ' + d.year + '. ' +
              'A supply shock or exchange-rate movement in the world rice market transmits almost ' +
              'directly into domestic availability and price.',
        evidence: ['IDR', d.year]
      }),
      recommends: ['productivity', 'seed-systems', 'irrigation', 'strategic-reserves', 'fx-risk']
    },
    {
      id: 'low-ssr',
      condition: 'SSR below 50% in the most recent year',
      test: d => d.ssr != null && d.ssr < 50,
      finding: d => ({
        severity: 'high',
        title: 'Domestic production covers less than half of utilization',
        text: 'SSR is ' + fmt(d.ssr) + '% in ' + d.year + '. Closing this gap requires production to ' +
              'grow by a factor of about ' + fmt(100 / d.ssr) + ' relative to current utilization, ' +
              'before allowing for demand growth.',
        evidence: ['SSR', d.year]
      }),
      recommends: ['productivity', 'area', 'seed-systems']
    },
    {
      id: 'demand-outpacing-supply',
      condition: 'consumption CAGR exceeds production CAGR over the last 20 years',
      test: d => d.cagrConsumption != null && d.cagrProduction != null &&
                 d.cagrConsumption > d.cagrProduction + 0.2,
      finding: d => ({
        severity: 'high',
        title: 'Demand is growing faster than production',
        text: 'Over the last 20 years utilization grew ' + fmt(d.cagrConsumption) + '% a year against ' +
              'production growth of ' + fmt(d.cagrProduction) + '% a year. On unchanged trends the ' +
              'gap widens every year, so even substantial production growth leaves self-sufficiency ' +
              'moving away.',
        evidence: ['consumption CAGR', 'production CAGR']
      }),
      recommends: ['productivity', 'seed-systems', 'demand-management']
    },
    {
      id: 'yield-stagnation',
      condition: 'yield CAGR below 1% a year over 20 years while area is growing',
      test: d => d.cagrYield != null && d.cagrYield < 1.0 && d.cagrArea != null && d.cagrArea > 1.0,
      finding: d => ({
        severity: 'medium',
        title: 'Growth is coming from land, not productivity',
        text: 'Yield has grown ' + fmt(d.cagrYield) + '% a year while area grew ' + fmt(d.cagrArea) +
              '% a year. Production is being bought with land rather than with productivity, which is ' +
              'the more expensive and less sustainable of the two routes and cannot continue ' +
              'indefinitely.',
        evidence: ['yield CAGR', 'area CAGR']
      }),
      recommends: ['seed-systems', 'irrigation', 'extension', 'soil-fertility']
    },
    {
      id: 'low-yield-level',
      condition: 'yield below 2.5 t/ha, well under the irrigated potential',
      test: d => d.yieldLevel != null && d.yieldLevel < 2500,
      finding: d => ({
        severity: 'medium',
        title: 'Yields sit far below attainable levels',
        text: 'Rice yield is ' + fmt(d.yieldLevel / 1000, 2) + ' t/ha. Irrigated rice in West Africa ' +
              'routinely achieves 4-6 t/ha, so the yield gap itself is a large untapped source of ' +
              'production that needs no additional land.',
        evidence: ['yield', d.year]
      }),
      recommends: ['seed-systems', 'irrigation', 'soil-fertility', 'extension']
    },
    {
      id: 'rising-import-bill',
      condition: 'import bill more than doubled over the last decade',
      test: d => d.importBillGrowth != null && d.importBillGrowth > 100,
      finding: d => ({
        severity: 'medium',
        title: 'The rice import bill is rising quickly',
        text: 'Spending on imported rice rose ' + fmt(d.importBillGrowth) + '% over the last decade, ' +
              'reaching ' + fmtUsd(d.importBill) + ' in ' + d.billYear + '. This is a recurring ' +
              'foreign-exchange commitment competing with every other import need.',
        evidence: ['import bill', d.billYear]
      }),
      recommends: ['productivity', 'fx-risk', 'strategic-reserves']
    },
    {
      id: 'import-collapse',
      condition: 'recorded imports fell by more than 80% over the last decade',
      test: d => d.importCollapse != null && d.importCollapse < -80,
      finding: d => ({
        severity: 'high',
        title: 'Recorded imports have collapsed — self-sufficiency is probably overstated',
        text: 'Recorded rice imports fell ' + fmt(Math.abs(d.importCollapse)) + '% between ' +
              (d.year - 10) + ' and ' + d.year + ', from ' + fmtT(d.importsThen) + ' to ' +
              fmtT(d.importsNow) + '. A fall of this size rarely means demand was replaced by ' +
              'domestic production. It is the signature of an import ban, an FX restriction or a ' +
              'border closure diverting trade into informal channels that national statistics do not ' +
              'capture. Where that is what happened, apparent consumption is understated and SSR (' +
              fmt(d.ssr) + '%) is overstated — possibly by a wide margin. Nigeria after the 2015 FX ' +
              'restrictions and the 2019 border closure is the standard case: its recorded imports ' +
              'nearly vanished while rice continued to enter overland, much of it through Benin, ' +
              'which is why Benin\'s recorded imports rose at the same time.',
        evidence: ['imports', 'SSR', d.year]
      }),
      recommends: ['data-quality', 'productivity', 'strategic-reserves']
    },
    {
      id: 're-export',
      condition: 'IDR above 100%, indicating substantial re-export',
      test: d => d.idr != null && d.idr > 100,
      finding: d => ({
        severity: 'info',
        title: 'Trade figures are distorted by re-export',
        text: 'IDR is ' + fmt(d.idr) + '% in ' + d.year + ', which is only arithmetically possible ' +
              'when a large share of imports leaves again. Apparent consumption, and therefore CPC ' +
              'and SSR, are unreliable for this country until the re-export flow is separated out.',
        evidence: ['IDR', d.year]
      }),
      recommends: ['data-quality']
    },
    {
      id: 'self-sufficient',
      condition: 'SSR at or above 100%',
      test: d => d.ssr != null && d.ssr >= 100,
      finding: d => ({
        severity: 'positive',
        title: 'Production covers domestic utilization',
        text: 'SSR is ' + fmt(d.ssr) + '% in ' + d.year + '. Domestic production meets or exceeds ' +
              'apparent utilization. Self-sufficiency is not the same as food security, and the ' +
              'relevant questions become stability, storage and affordability rather than volume.',
        evidence: ['SSR', d.year]
      }),
      recommends: ['strategic-reserves', 'market-development']
    },
    {
      id: 'provisional-final-year',
      condition: 'the most recent year departs more than 50% from the mean of the three years before it',
      test: d => d.ssrJump != null && Math.abs(d.ssrJump) > 50,
      finding: d => ({
        severity: 'high',
        title: 'The most recent year looks provisional — treat its headline figures with caution',
        text: 'SSR in ' + d.year + ' is ' + fmt(d.ssr) + '%, against an average of ' +
              fmt(d.ssrPrev3) + '% over the three preceding years — a change of ' +
              fmt(d.ssrJump) + '%. Rice production and consumption do not move that fast. The usual ' +
              'cause is that the final year of the trade file is still incomplete: FAOSTAT publishes ' +
              'trade later than production, so the newest year can carry partial import and export ' +
              'coverage, which pushes SSR sharply up or down. The headline figures on this page are ' +
              'taken from the most recent observed year and inherit that. For anything load-bearing, ' +
              'read the trend rather than the last point, or set the period to end a year earlier.',
        evidence: ['SSR', d.year, 'three-year prior mean']
      }),
      recommends: ['data-quality']
    },
    {
      id: 'thin-data',
      condition: 'data quality score below 60',
      test: d => d.quality != null && d.quality < 60,
      finding: d => ({
        severity: 'high',
        title: 'The underlying data are weak',
        text: 'The data quality score for this country is ' + d.quality + '/100. Every indicator, ' +
              'forecast and scenario on this page inherits that weakness. Treat the direction of ' +
              'travel as informative and the exact numbers as indicative only.',
        evidence: ['data quality']
      }),
      recommends: ['data-quality']
    }
  ];

  const ACTIONS = {
    'productivity': {
      label: 'Raise on-farm productivity',
      detail: 'Combine improved seed, soil fertility management, water control and mechanisation. ' +
              'Yield growth adds production without adding land and is generally the cheapest route ' +
              'per additional tonne.'
    },
    'seed-systems': {
      label: 'Strengthen the improved-seed system',
      detail: 'Certified seed multiplication, distribution and farmer demonstration. Improved ' +
              'varieties only deliver yield gains where farmers can actually obtain the seed.'
    },
    'irrigation': {
      label: 'Invest in water control and irrigation',
      detail: 'Irrigated rice yields several times rainfed yields and buffers rainfall variability. ' +
              'Capital-intensive and slow to build, so it belongs in a 10-20 year plan, not a 3-year one.'
    },
    'extension': {
      label: 'Expand agricultural extension',
      detail: 'Agronomic practice explains a large part of the gap between station and farm yields.'
    },
    'soil-fertility': {
      label: 'Address soil fertility',
      detail: 'Fertiliser access and integrated soil fertility management. Improved varieties under-'
            + 'perform on depleted soils, so this often has to come first.'
    },
    'area': {
      label: 'Expand rice area, with care',
      detail: 'Only where suitable land exists and the environmental cost is acceptable. Lowland and ' +
              'wetland conversion carries biodiversity and methane costs this platform does not model.'
    },
    'strategic-reserves': {
      label: 'Build or maintain strategic reserves',
      detail: 'Buffer stocks decouple short-run availability from world-market shocks. They address ' +
              'stability rather than self-sufficiency.'
    },
    'fx-risk': {
      label: 'Manage the foreign-exchange exposure',
      detail: 'A large recurring rice import bill is a standing currency risk. Hedging and import ' +
              'contract timing reduce exposure without changing a single hectare.'
    },
    'demand-management': {
      label: 'Look at demand as well as supply',
      detail: 'Where consumption growth outpaces any plausible production response, diversifying ' +
              'staple consumption toward domestically produced cereals may close more of the gap ' +
              'than production policy can.'
    },
    'market-development': {
      label: 'Develop milling, quality and marketing',
      detail: 'Domestic rice often loses to imports on grain quality and processing rather than on ' +
              'volume. Post-harvest investment can raise effective supply without new production.'
    },
    'data-quality': {
      label: 'Invest in the statistics themselves',
      detail: 'Agricultural surveys and trade recording. Policy built on weak numbers fails in ways ' +
              'nobody can diagnose afterwards.'
    }
  };

  /* Runs the rules against a country and returns findings plus deduplicated,
   * priority-ordered recommendations. */
  function diagnose(bal, opts) {
    opts = opts || {};
    const I = RSAIndicators;
    const ssr = I.compute('ssr', bal), idr = I.compute('idr', bal);
    const prod = I.compute('production', bal), cons = I.compute('consumption', bal);
    const yld = I.compute('yield', bal), area = I.compute('area', bal);
    const bill = I.compute('importBill', bal);

    const last = lastObs(ssr);
    const to = last ? last.year : null;
    const from = to ? to - 20 : null;

    const billLast = lastObs(bill);
    const billPrev = billLast ? valueAt(bill, billLast.year - 10) : null;

    const imports = I.compute('imports', bal);
    const impLast = lastObs(imports);
    const impPrev = impLast ? valueAt(imports, impLast.year - 10) : null;

    // Mean SSR over the three years before the most recent observation, used to
    // detect a final year that is still provisional.
    let ssrPrev3 = null;
    if (last) {
      const li = ssr.years.indexOf(last.year);
      const prior = [];
      for (let k = 1; k <= 3; k++) {
        const v = li - k >= 0 ? ssr.values[li - k] : null;
        if (v != null && isFinite(v)) prior.push(v);
      }
      if (prior.length === 3) ssrPrev3 = prior.reduce((a, b) => a + b, 0) / prior.length;
    }

    const d = {
      year: to,
      ssr: last ? last.value : null,
      idr: to ? valueAt(idr, to) : null,
      yieldLevel: to ? valueAt(yld, to) : null,
      cagrProduction: I.cagr(prod.years, prod.values, from, to),
      cagrConsumption: I.cagr(cons.years, cons.values, from, to),
      cagrYield: I.cagr(yld.years, yld.values, from, to),
      cagrArea: I.cagr(area.years, area.values, from, to),
      importBill: billLast ? billLast.value : null,
      billYear: billLast ? billLast.year : null,
      importBillGrowth: (billLast && billPrev && billPrev > 0)
        ? 100 * (billLast.value - billPrev) / billPrev : null,
      importsNow: impLast ? impLast.value : null,
      importsThen: impPrev,
      // Only meaningful when the earlier level was material; a fall from 200 t to
      // 20 t is not evidence of a policy-driven trade diversion.
      importCollapse: (impLast && impPrev != null && impPrev > 50000)
        ? 100 * (impLast.value - impPrev) / impPrev : null,
      ssrPrev3: ssrPrev3,
      ssrJump: (ssrPrev3 != null && ssrPrev3 > 1 && last)
        ? 100 * (last.value - ssrPrev3) / ssrPrev3 : null,
      quality: opts.quality != null ? opts.quality : null
    };

    const findings = [], actionIds = [];
    RULES.forEach(rule => {
      let fired = false;
      try { fired = rule.test(d); } catch (e) { fired = false; }
      if (!fired) return;
      const f = rule.finding(d);
      f.ruleId = rule.id;
      f.condition = rule.condition;
      findings.push(f);
      rule.recommends.forEach(a => { if (actionIds.indexOf(a) < 0) actionIds.push(a); });
    });

    /* Cross-database divergence is checked outside the rule table because it
     * needs both databases, which a single balance sheet does not carry. */
    let xdb = null;
    if (bal.members.length === 1) {
      try { xdb = crossDatabase(bal.members[0], opts); } catch (e) { xdb = null; }
    }
    if (xdb && xdb.imports.ratio != null && xdb.imports.ratio >= 3 && xdb.imports.usda > 100000) {
      findings.push({
        ruleId: 'database-divergence',
        condition: 'USDA estimates rice imports at three times FAOSTAT or more, in a common year',
        severity: 'high',
        title: 'The two databases disagree sharply on imports — most of the trade is unrecorded',
        text: 'In ' + xdb.year + ' FAOSTAT records ' + fmtT(xdb.imports.fao) + ' of rice imports ' +
              'while USDA PSD estimates ' + fmtT(xdb.imports.usda) + ' — a factor of ' +
              fmt(xdb.imports.ratio, 0) + '. The two agree far more closely on production (' +
              fmtT(xdb.production.fao) + ' against ' + fmtT(xdb.production.usda) + ', ' +
              fmt(xdb.production.pctDiff) + '% apart), so this is not a general disagreement about ' +
              'the country: it is specific to trade. FAOSTAT counts rice that clears customs; USDA ' +
              'estimates what the balance sheet requires. The difference is the flow that never ' +
              'appears in official trade records. ' +
              (xdb.ssr.fao != null && xdb.ssr.usda != null
                ? 'Self-sufficiency accordingly reads ' + fmt(xdb.ssr.fao) + '% on FAOSTAT against ' +
                  fmt(xdb.ssr.usda) + '% on USDA. Do not quote the FAOSTAT figure for this country ' +
                  'without saying which trade measure it rests on.'
                : ''),
        evidence: ['imports', 'production', 'SSR', xdb.year, 'both databases']
      });
      if (actionIds.indexOf('data-quality') < 0) actionIds.push('data-quality');
    }

    const severityOrder = { high: 0, medium: 1, info: 2, positive: 3 };
    findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      selection: bal.label,
      db: bal.db,
      basis: bal.basis,
      referenceYear: to,
      diagnostics: d,
      findings: findings,
      crossDatabase: xdb,
      recommendations: actionIds.map(id => Object.assign({ id: id }, ACTIONS[id])),
      rulesEvaluated: RULES.length,
      method: 'Rule-based diagnosis. Each rule states an explicit condition on computed indicators; ' +
              'a rule that fires reports the values that triggered it. No rule fires on missing data.',
      caveat: 'These are diagnostic observations and generic policy directions, not a country ' +
              'strategy. They take no account of budget, institutional capacity, political economy ' +
              'or anything specific to this country beyond the indicators listed.'
    };
  }

  /* Cross-database check.
   *
   * FAOSTAT trade is built from reported customs records. USDA PSD is an
   * analyst-constructed balance sheet in which imports are estimated to close
   * supply and demand, so it picks up flows that never cross a customs desk.
   * Where the two disagree by an order of magnitude on imports while agreeing on
   * production, the gap is not noise -- it is a direct measurement of the
   * unrecorded trade, and it is the single most useful thing this platform can
   * tell a user about a country like Nigeria.
   *
   * Comparison is done on a common milled basis and a common year. Returns null
   * whenever a like-for-like comparison is not available, rather than forcing one.
   */
  function crossDatabase(iso3, opts) {
    if (!RSA.hasSeries('fao', iso3) || !RSA.hasSeries('usda', iso3)) return null;
    const f = RSA.balance('fao', { kind: 'country', id: iso3 }, { basis: 'milled' });
    const u = RSA.balance('usda', { kind: 'country', id: iso3 }, {});

    // Latest year both databases report production AND imports.
    let year = null, fi = -1, ui = -1;
    for (let y = Math.min(f.years[f.years.length - 1], u.years[u.years.length - 1]); y >= 1990; y--) {
      const a = f.years.indexOf(y), b = u.years.indexOf(y);
      if (a < 0 || b < 0) continue;
      if (f.production[a] == null || u.production[b] == null) continue;
      if (f.imports[a] == null || u.imports[b] == null) continue;
      year = y; fi = a; ui = b;
      break;
    }
    if (year == null) return null;

    const fProd = f.production[fi], uProd = u.production[ui];
    const fImp = f.imports[fi], uImp = u.imports[ui];
    const fCons = f.consumption[fi], uCons = u.consumption[ui];

    return {
      year: year,
      production: { fao: fProd, usda: uProd,
        pctDiff: fProd > 0 ? 100 * (uProd - fProd) / fProd : null },
      imports: { fao: fImp, usda: uImp,
        pctDiff: fImp > 0 ? 100 * (uImp - fImp) / fImp : null,
        ratio: fImp > 0 ? uImp / fImp : null },
      ssr: {
        fao: (fCons && fCons > 0) ? 100 * fProd / fCons : null,
        usda: (uCons && uCons > 0) ? 100 * uProd / uCons : null
      },
      note: 'FAOSTAT trade comes from reported customs records; USDA PSD imports are estimated to ' +
            'balance supply and demand and therefore include flows customs does not see. Both are ' +
            'on a milled basis here. Neither is merged into the other.'
    };
  }

  function lastObs(res) {
    for (let i = res.values.length - 1; i >= 0; i--) {
      if (res.values[i] != null) return { year: res.years[i], value: res.values[i] };
    }
    return null;
  }

  function valueAt(res, year) {
    const i = res.years.indexOf(year);
    return i >= 0 ? res.values[i] : null;
  }

  function fmt(x, dp) {
    if (x == null || !isFinite(x)) return 'n/a';
    return x.toFixed(dp == null ? 1 : dp);
  }

  function fmtUsd(x) {
    if (x == null) return 'n/a';
    const v = x * 1000;   // series is in 1000 USD
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + ' billion';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + ' million';
    return '$' + Math.round(v).toLocaleString();
  }

  /* ========================================================= policy copilot
   *
   * Intent matching over a fixed question grammar. Anything it cannot match, it
   * says it cannot answer -- rather than guessing, which is the failure mode that
   * would make it useless for policy work.
   */

  const INTENTS = [
    {
      id: 'why-not-self-sufficient',
      match: /why.*(not|won'?t|unlikely).*(self.?sufficien|reach)/i,
      answer: ctx => {
        const d = ctx.diagnosis.diagnostics;
        const base = ctx.baseline;
        const parts = [];
        parts.push(ctx.label + ' had an SSR of ' + fmt(d.ssr) + '% in ' + d.year +
                   ', meaning domestic production covered ' + fmt(d.ssr) + '% of apparent utilization.');
        if (d.cagrConsumption != null && d.cagrProduction != null) {
          parts.push('Over the last 20 years utilization grew ' + fmt(d.cagrConsumption) +
                     '% a year while production grew ' + fmt(d.cagrProduction) + '% a year.');
          if (d.cagrConsumption > d.cagrProduction) {
            parts.push('Because demand is growing faster than supply, the gap widens on unchanged ' +
                       'trends: production has to grow faster than consumption merely to stop ' +
                       'self-sufficiency falling further.');
          }
        }
        if (base && base.ok) {
          const end = RSAScenarios.atTarget(base.path, base.targetYear);
          if (end && end.ssr != null) {
            parts.push('The baseline projection puts SSR at ' + fmt(end.ssr) + '% in ' +
                       base.targetYear + '.');
          }
          const crossing = RSAScenarios.firstCrossing(base.path, 100);
          parts.push(crossing
            ? 'On this trajectory SSR first reaches 100% in ' + crossing + '.'
            : 'Self-sufficiency is not reached under the baseline trajectory by ' + base.targetYear + '.');
        }
        return parts.join(' ');
      },
      evidence: ctx => baseEvidence(ctx, ['SSR', 'production CAGR', 'consumption CAGR', 'baseline projection'])
    },
    {
      id: 'what-if-yield',
      match: /what.*(if|happen).*(yield|productivit).*(increas|rise|grow|up|\+?\s*\d+\s*%)/i,
      answer: (ctx, q) => {
        const pct = extractPercent(q);
        if (pct == null) return 'Specify a yield increase, for example "what if rice yields increased by 20%?".';
        if (!ctx.baseline || !ctx.baseline.ok) return 'A baseline projection could not be built for ' + ctx.label + '.';
        const sc = RSAScenarios.scenarioYield(ctx.baseline, pct / 100, ctx.opts);
        return 'Raising yield ' + pct + '% above the baseline by ' + ctx.baseline.targetYear +
               ' lifts production from ' + fmtT(sc.summary.productionBaseline) + ' to ' +
               fmtT(sc.summary.production) + ', moving SSR from ' + fmt(sc.summary.ssrBaseline) +
               '% to ' + fmt(sc.summary.ssr) + '% and cutting imports by ' +
               fmtT(sc.summary.importSaving) + '. ' +
               (sc.summary.selfSufficient
                 ? 'That reaches self-sufficiency.'
                 : 'That still falls short of self-sufficiency.') +
               ' This is a scenario simulation under stated assumptions, not a prediction.';
      },
      evidence: ctx => baseEvidence(ctx, ['baseline projection', 'yield scenario', 'P = A x Y'])
    },
    {
      id: 'cheapest',
      match: /(cheap|least.?cost|lowest.?cost|most.?cost.?effective|best value)/i,
      answer: ctx => {
        if (!ctx.baseline || !ctx.baseline.ok) return 'A baseline projection could not be built for ' + ctx.label + '.';
        const opt = RSAScenarios.optimize(ctx.baseline, ctx.opts);
        if (!opt.ok) {
          return 'No combination within the stated constraints reaches SSR 100% by ' +
                 ctx.baseline.targetYear + ' for ' + ctx.label + '. ' +
                 (opt.bestAttainable
                   ? 'The most ambitious admissible package reaches ' + fmt(opt.bestAttainable.ssr) + '%.'
                   : '');
        }
        const s = opt.solution;
        return 'Under the platform\'s cost assumptions the least-cost package reaching SSR 100% by ' +
               ctx.baseline.targetYear + ' combines ' + pctFmt(s.areaExpansion) + ' area expansion, ' +
               pctFmt(s.adoptionRate) + ' improved-variety adoption and ' + pctFmt(s.yieldImprovement) +
               ' yield improvement, at an estimated ' + fmtUsdRaw(s.cost) + '. ' +
               'Those unit costs are placeholders, not national costings, so treat the composition of ' +
               'the package as more informative than its price tag.';
      },
      evidence: ctx => baseEvidence(ctx, ['optimiser', 'cost assumptions', 'land ceiling'])
    },
    {
      id: 'highest-dependency',
      match: /(which|what).*(countr|nation).*(highest|most|greatest).*(import|depend)/i,
      answer: ctx => {
        const rank = rankCountries('idr', ctx.dbKey, ctx.opts, 8, 'desc');
        if (!rank.length) return 'No comparable import dependency figures are available.';
        return 'By import dependency ratio, each measured in that country\'s own most recent ' +
               'observed year, the highest are: ' +
               rank.map(r => r.name + ' (' + fmt(r.value) + '%, ' + r.year + ')').join(', ') + '. ' +
               'Values above 100% indicate substantial re-export rather than extreme dependence. ' +
               'Reference years differ between countries because reporting is not synchronised, so ' +
               'this is a ranking of latest available positions, not of one common year.';
      },
      evidence: ctx => baseEvidence(ctx, ['IDR', 'cross-country ranking'])
    },
    {
      id: 'lowest-ssr',
      match: /(which|what).*(countr|nation).*(lowest|worst|least).*(self.?sufficien|ssr|production)/i,
      answer: ctx => {
        const rank = rankCountries('ssr', ctx.dbKey, ctx.opts, 8, 'asc');
        if (!rank.length) return 'No comparable self-sufficiency figures are available.';
        return 'By self-sufficiency ratio, each measured in that country\'s own most recent observed ' +
               'year, the lowest are: ' +
               rank.map(r => r.name + ' (' + fmt(r.value) + '%, ' + r.year + ')').join(', ') + '. ' +
               'Reference years differ between countries because reporting is not synchronised.';
      },
      evidence: ctx => baseEvidence(ctx, ['SSR', 'cross-country ranking'])
    },
    {
      id: 'import-bill',
      match: /(import bill|spend|cost).*(import|rice)|how much.*(spend|import)/i,
      answer: ctx => {
        const bill = RSAIndicators.compute('importBill', ctx.bal);
        const last = lastObs(bill);
        if (!last) return 'No import value data are available for ' + ctx.label +
          '. Import values are published by FAOSTAT only, not by USDA PSD.';
        const pc = RSAIndicators.compute('importBillPerCapita', ctx.bal);
        const pcLast = lastObs(pc);
        let cum = 0, n = 0;
        bill.values.forEach((v, i) => { if (v != null && bill.years[i] >= last.year - 9) { cum += v; n++; } });
        return ctx.label + ' spent ' + fmtUsd(last.value) + ' on rice imports in ' + last.year +
               (pcLast ? ', or about $' + fmt(pcLast.value, 2) + ' per inhabitant' : '') +
               '. Over the last ' + n + ' years the cumulative bill was ' + fmtUsd(cum) + '. ' +
               'These are current-price values, so part of any rise is world inflation.';
      },
      evidence: ctx => baseEvidence(ctx, ['import bill', 'import bill per capita'])
    },
    {
      id: 'which-variety',
      match: /(which|what).*(countr|nation).*(priorit|focus).*(variet|seed)/i,
      answer: ctx => {
        const list = RSA.countries().filter(c => !c.territory).map(c => {
          const b = RSA.balance(ctx.dbKey, { kind: 'country', id: c.iso3 }, ctx.opts);
          const y = lastObs(RSAIndicators.compute('yield', b));
          const s = lastObs(RSAIndicators.compute('ssr', b));
          return (y && s && y.value > 0) ? { name: c.name, yield: y.value, ssr: s.value } : null;
        }).filter(Boolean).filter(r => r.yield < 2500 && r.ssr < 80);
        list.sort((a, b) => a.yield - b.yield);
        if (!list.length) return 'No country in the current selection combines low yields with low self-sufficiency.';
        return 'Countries combining low yields (under 2.5 t/ha) with self-sufficiency below 80% -- ' +
               'where seed-system investment has the most headroom -- include: ' +
               list.slice(0, 8).map(r => r.name + ' (' + fmt(r.yield / 1000, 2) + ' t/ha, SSR ' +
               fmt(r.ssr) + '%)').join(', ') + '. ' +
               'This is a screening heuristic on two indicators, not an assessment of seed-sector ' +
               'readiness in any of them.';
      },
      evidence: ctx => baseEvidence(ctx, ['yield', 'SSR', 'screening rule: yield < 2.5 t/ha and SSR < 80%'])
    },
    {
      id: 'when-self-sufficient',
      match: /(when|what year).*(self.?sufficien|reach 100|100%)/i,
      answer: ctx => {
        if (!ctx.baseline || !ctx.baseline.ok) return 'A baseline projection could not be built for ' + ctx.label + '.';
        const crossing = RSAScenarios.firstCrossing(ctx.baseline.path, 100);
        if (crossing) {
          return 'On the baseline trajectory ' + ctx.label + ' first reaches SSR 100% in ' + crossing +
                 '. That is a projection of current trends with no policy change, and the ' +
                 'uncertainty around it is wide.';
        }
        const end = RSAScenarios.atTarget(ctx.baseline.path, ctx.baseline.targetYear);
        return 'Self-sufficiency is not reached under the baseline trajectory by ' +
               ctx.baseline.targetYear + '. SSR is projected at ' + fmt(end && end.ssr) + '% in that ' +
               'year. No crossing year is given because the projection does not produce one.';
      },
      evidence: ctx => baseEvidence(ctx, ['baseline projection', 'SSR'])
    },
    {
      id: 'driving-import-bill',
      match: /(what|why).*(driv|caus).*(import|bill)/i,
      answer: ctx => {
        const I = RSAIndicators;
        const qty = I.compute('imports', ctx.bal), uv = I.compute('importUnitValue', ctx.bal);
        const q1 = lastObs(qty), u1 = lastObs(uv);
        if (!q1 || !u1) return 'Import quantity and value are not both available for ' + ctx.label + '.';
        const q0 = valueAt(qty, q1.year - 10), u0 = valueAt(uv, u1.year - 10);
        if (q0 == null || u0 == null) return 'A ten-year comparison is not available for ' + ctx.label + '.';
        const dq = 100 * (q1.value - q0) / q0, du = 100 * (u1.value - u0) / u0;
        const driver = Math.abs(dq) > Math.abs(du) ? 'volume' : 'price';
        return 'Between ' + (q1.year - 10) + ' and ' + q1.year + ', import volume changed ' +
               fmt(dq) + '% and the import unit value changed ' + fmt(du) + '%. The bill is therefore ' +
               'driven mainly by ' + driver + '. Unit value is an average across grades, so a change ' +
               'in it can reflect a shift in the import mix rather than a world price movement.';
      },
      evidence: ctx => baseEvidence(ctx, ['imports', 'import unit value'])
    }
  ];

  function extractPercent(q) {
    const m = q.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]);
    const m2 = q.match(/by\s+(\d+(?:\.\d+)?)\b/);
    return m2 ? parseFloat(m2[1]) : null;
  }

  function pctFmt(x) { return (x * 100).toFixed(0) + '%'; }
  function fmtT(x) {
    if (x == null) return 'n/a';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + ' Mt';
    if (x >= 1e3) return (x / 1e3).toFixed(0) + ' kt';
    return Math.round(x) + ' t';
  }
  function fmtUsdRaw(x) {
    if (x == null) return 'n/a';
    if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + ' billion';
    if (x >= 1e6) return '$' + (x / 1e6).toFixed(0) + ' million';
    return '$' + Math.round(x).toLocaleString();
  }

  function rankCountries(indicatorId, dbKey, opts, n, dir) {
    const rows = [];
    RSA.countries().forEach(c => {
      if (!RSA.hasSeries(dbKey, c.iso3)) return;
      const b = RSA.balance(dbKey, { kind: 'country', id: c.iso3 }, opts);
      const r = RSAIndicators.compute(indicatorId, b);
      const last = lastObs(r);
      if (last) rows.push({ iso3: c.iso3, name: c.name, value: last.value, year: last.year });
    });
    rows.sort((a, b) => dir === 'asc' ? a.value - b.value : b.value - a.value);
    return rows.slice(0, n || 10);
  }

  function baseEvidence(ctx, items) {
    const prov = RSA.provenance();
    return {
      database: ctx.bal.db,
      selection: ctx.label,
      basis: ctx.bal.basis,
      period: ctx.bal.years[0] + '-' + ctx.bal.years[ctx.bal.years.length - 1],
      indicators: items,
      equations: items.map(i => {
        const ind = RSAIndicators.get(String(i).toLowerCase());
        return ind ? ind.equation : null;
      }).filter(Boolean),
      extracted: prov.extracted,
      sources: prov.sources.map(s => s.db + ' -- ' + s.dataset + ' (published ' + s.published + ')'),
      assumptions: ctx.assumptions || []
    };
  }

  /* Answers a question. Always returns an object with an evidence trace, even
   * when it declines. */
  function ask(question, ctx) {
    const q = String(question || '').trim();
    if (!q) {
      return { answered: false, text: 'Ask a question about rice production, trade, ' +
        'self-sufficiency, forecasts or policy options.', evidence: null };
    }
    for (let i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].match.test(q)) {
        let text;
        try { text = INTENTS[i].answer(ctx, q); }
        catch (e) {
          return { answered: false, intent: INTENTS[i].id,
                   text: 'That question matched but could not be answered from the current data: ' + e.message,
                   evidence: null };
        }
        return {
          answered: true,
          intent: INTENTS[i].id,
          text: text,
          evidence: INTENTS[i].evidence ? INTENTS[i].evidence(ctx) : null,
          method: 'Rule-matched question answered from the platform\'s own computed values. No ' +
                  'language model is involved and no statement is generated that is not backed by a ' +
                  'number in the evidence trace.'
        };
      }
    }
    return {
      answered: false,
      text: 'I cannot answer that from the platform\'s calculations. I answer questions about ' +
            'self-sufficiency levels and timing, import dependency and the import bill, what happens ' +
            'under a given yield or area change, the least-cost route to self-sufficiency, and ' +
            'cross-country rankings. I do not guess.',
      suggestions: [
        'Why is ' + (ctx && ctx.label ? ctx.label : 'this country') + ' unlikely to reach self-sufficiency by 2035?',
        'What would happen if rice yields increased by 20%?',
        'What is the cheapest strategy?',
        'Which countries have the highest import dependency?',
        'What is driving the import bill?',
        'When does the baseline reach 100%?'
      ],
      evidence: null
    };
  }

  return {
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
    RULES: RULES,
    ACTIONS: ACTIONS,
    INTENTS: INTENTS,
    scoreScenario: scoreScenario,
    rankScenarios: rankScenarios,
    diagnose: diagnose,
    crossDatabase: crossDatabase,
    ask: ask,
    rankCountries: rankCountries,
    lastObs: lastObs
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSAPolicy; }
