/* rsa-advisor.js -- guided rice policy analysis.
 *
 * WHAT THIS IS, PLAINLY. This is a reasoning engine, not a language model. It
 * does not generate prose from a statistical model of text; it decomposes the
 * data with an exact identity, ranks what it finds against stated thresholds,
 * and assembles the explanation from that. Every sentence it produces carries
 * the numbers it came from, and the same country and window always give the
 * same answer.
 *
 * That is a deliberate choice, not a limitation worked around. The platform is
 * one self-contained file with no external requests, so there is no server to
 * hold an API key and no key that could be shipped in a public page safely. But
 * more importantly, a policy claim that cannot be traced to a number is not
 * worth making, and a chatbot that is confidently wrong about Mali's yield
 * trend would do real damage in this setting. What follows can be checked line
 * by line against the Data Used tables.
 *
 * THE CENTRAL IDENTITY. Self-sufficiency is a race between supply and demand,
 * and the decomposition is exact in logarithms rather than approximate:
 *
 *     P = A x Y                  production is area times yield
 *     C = N x c                  consumption is population times per-capita use
 *     SSR = P / C
 *
 *     ln(SSR1/SSR0) = [ln(A1/A0) + ln(Y1/Y0)] - [ln(N1/N0) + ln(c1/c0)]
 *                      \___________________/     \___________________/
 *                         supply growth              demand growth
 *
 * So a country loses self-sufficiency when population growth plus dietary
 * change outruns area expansion plus yield improvement. Which of those four
 * terms dominates is the whole of the diagnosis, and it differs sharply between
 * countries: Nigeria's problem is not Senegal's problem.
 */
var RSAAdvisor = (function () {
  'use strict';

  const VERSION = '1.0.0';

  /* Thresholds. Stated here rather than buried in the logic, because a reader
   * who disagrees with one should be able to see it and say so. Annual rates in
   * percent unless noted. */
  const T = {
    yieldStagnant: 1.0,      // below this, yield growth is not keeping up with anything
    yieldStrong: 3.0,        // sustained growth at this rate doubles yield in a generation
    popHigh: 2.5,            // roughly the sub-Saharan average
    dietFast: 1.5,           // per-capita consumption growth this fast is a structural shift
    areaFast: 3.0,           // area growth this fast usually means frontier expansion
    idrHigh: 50,             // half of utilization imported
    idrSevere: 75,
    ssrTarget: 100,
    reExportRatio: 1.15,     // imports > 115% of utilization implies unrecorded re-export
    volatilityHigh: 25       // coefficient of variation of yield, percent
  };

  /* ------------------------------------------------------------ utilities */

  function obs(series, years, y) {
    const i = years.indexOf(y);
    return i < 0 ? null : series[i];
  }

  /* First and last years in [from,to] where every named series is present, so
   * the decomposition compares like with like rather than silently mixing a
   * 1961 area with a 1985 population. */
  function window_(bal, fields, from, to) {
    let a = null, b = null;
    for (let i = 0; i < bal.years.length; i++) {
      const y = bal.years[i];
      if (from != null && y < from) continue;
      if (to != null && y > to) continue;
      if (!fields.every(f => bal[f][i] != null && bal[f][i] > 0)) continue;
      if (a == null) a = y;
      b = y;
    }
    return (a != null && b != null && b > a) ? { from: a, to: b } : null;
  }

  const annual = (v1, v0, n) => (100 * (Math.pow(v1 / v0, 1 / n) - 1));

  /* --------------------------------------------------- growth accounting */

  /* The exact log decomposition described in the header. Returns each term as
   * an annualised percentage, plus its share of total movement, so the caller
   * can say "yield did most of the work" with a number behind it. */
  function decompose(bal, opts) {
    opts = opts || {};
    const w = window_(bal, ['area', 'yield', 'population', 'consumption', 'production'],
                      opts.from, opts.to);
    if (!w) return { ok: false, reason: 'no year in this window has area, yield, population and consumption all present' };
    const n = w.to - w.from;
    const g = (f) => {
      const v0 = obs(bal[f], bal.years, w.from), v1 = obs(bal[f], bal.years, w.to);
      return { from: v0, to: v1, rate: annual(v1, v0, n), log: Math.log(v1 / v0) };
    };
    const A = g('area'), Y = g('yield'), N = g('population'), C = g('consumption'), P = g('production');
    // Per-capita consumption is C/N. Consumption is in TONNES and population in
    // persons, so the quotient is tonnes per person: multiply by 1000 to get the
    // kg/capita this is labelled with. The growth rate is unaffected — it is a
    // ratio — but the displayed levels are wrong by three orders of magnitude
    // without this, which is exactly the kind of error a reader would catch and
    // then rightly distrust everything else on the page.
    const cpc0 = 1000 * C.from / N.from, cpc1 = 1000 * C.to / N.to;
    const c = { from: cpc0, to: cpc1, rate: annual(cpc1, cpc0, n), log: Math.log(cpc1 / cpc0) };

    const supplyLog = A.log + Y.log;
    const demandLog = N.log + c.log;
    const ssrLog = supplyLog - demandLog;
    const total = Math.abs(A.log) + Math.abs(Y.log) + Math.abs(N.log) + Math.abs(c.log);
    const share = x => total > 0 ? +(100 * Math.abs(x) / total).toFixed(1) : 0;

    const terms = [
      { key: 'area', label: 'Harvested area', side: 'supply', rate: +A.rate.toFixed(2),
        log: A.log, share: share(A.log), from: A.from, to: A.to, unit: 'ha' },
      { key: 'yield', label: 'Yield', side: 'supply', rate: +Y.rate.toFixed(2),
        log: Y.log, share: share(Y.log), from: Y.from, to: Y.to, unit: 'kg/ha' },
      { key: 'population', label: 'Population', side: 'demand', rate: +N.rate.toFixed(2),
        log: N.log, share: share(N.log), from: N.from, to: N.to, unit: 'persons' },
      { key: 'diet', label: 'Consumption per person', side: 'demand', rate: +c.rate.toFixed(2),
        log: c.log, share: share(c.log), from: c.from, to: c.to, unit: 'kg/capita' }
    ];
    terms.sort((x, y2) => y2.share - x.share);

    return {
      ok: true, window: w, years: n,
      supplyGrowth: +(100 * (Math.exp(supplyLog / n) - 1)).toFixed(2),
      demandGrowth: +(100 * (Math.exp(demandLog / n) - 1)).toFixed(2),
      ssrGrowth: +(100 * (Math.exp(ssrLog / n) - 1)).toFixed(2),
      gap: +(100 * (Math.exp(supplyLog / n) - 1) - 100 * (Math.exp(demandLog / n) - 1)).toFixed(2),
      terms: terms,
      dominant: terms[0],
      binding: terms.filter(t => t.side === 'demand').sort((a, b) => b.log - a.log)[0],
      identity: 'ln(SSR1/SSR0) = [ln(A1/A0) + ln(Y1/Y0)] - [ln(N1/N0) + ln(c1/c0)]',
      // The identity is exact, so this residual is a check on the arithmetic,
      // not a modelling error term. It should be zero to machine precision.
      residual: +(ssrLog - (P.log - C.log)).toFixed(12)
    };
  }

  /* An endpoint decomposition over the whole record can be exactly right and
   * still useless. Benin was 15.9% self-sufficient in 1961 and 15.9% in 2024,
   * so the full-record decomposition reports supply and demand growing at
   * identical rates and a net movement of zero -- while concealing that the
   * ratio rose to 64.6% by 2010 and collapsed again. The round trip IS the
   * story, and a single pair of endpoints cannot show it.
   *
   * So the platform reports the recent window as the headline, because that is
   * the one a policy horizon acts on, and the full record beside it, and says
   * when the two disagree. */
  const RECENT_YEARS = 20;

  function decomposePeriods(bal, opts) {
    opts = opts || {};
    const full = decompose(bal, opts);
    if (!full.ok) return { ok: false, reason: full.reason };
    const span = full.window.to - full.window.from;
    const out = { ok: true, full: full, recent: null, headline: full, divergent: false };
    if (span > RECENT_YEARS + 5) {
      const recent = decompose(bal, { from: full.window.to - RECENT_YEARS, to: opts.to });
      if (recent.ok) {
        out.recent = recent;
        out.headline = recent;
        // "Disagree" means they point opposite ways, or differ by more than a
        // percentage point a year -- enough to change what one would advise.
        out.divergent = (Math.sign(recent.gap) !== Math.sign(full.gap)) ||
                        Math.abs(recent.gap - full.gap) > 1.0;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ diagnosis */

  /* Why is this country not self-sufficient? Returns ranked causes, each with
   * the evidence that raised it and what follows from it. */
  function diagnose(bal, opts) {
    opts = opts || {};
    const I = RSAIndicators;
    // Diagnose on the RECENT window: a cause that stopped operating in 1985 is
    // not a cause of today's shortfall.
    const per = decomposePeriods(bal, opts);
    const d = per.ok ? per.headline : { ok: false };
    const causes = [];
    const ssrS = I.compute('ssr', bal), idrS = I.compute('idr', bal);
    const last = (s) => { for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return { year: s.years[i], value: s.values[i] }; return null; };
    const ssr = last(ssrS), idr = last(idrS);

    if (!ssr) return { ok: false, reason: 'no self-sufficiency ratio can be computed for this selection' };

    const add = (id, severity, title, finding, implication, evidence) =>
      causes.push({ id: id, severity: severity, title: title, finding: finding,
                    implication: implication, evidence: evidence });

    if (ssr.value >= T.ssrTarget) {
      add('already', 'good', 'Already self-sufficient',
        'Self-sufficiency stands at ' + ssr.value.toFixed(1) + '% in ' + ssr.year + '.',
        'The question here is not how to reach self-sufficiency but how to hold it: check whether ' +
        'supply growth still exceeds demand growth, because a surplus narrows silently.',
        { ssr: ssr });
    }

    if (d.ok) {
      const yieldT = d.terms.filter(t => t.key === 'yield')[0];
      const areaT = d.terms.filter(t => t.key === 'area')[0];
      const popT = d.terms.filter(t => t.key === 'population')[0];
      const dietT = d.terms.filter(t => t.key === 'diet')[0];

      if (d.gap < 0) {
        add('losing-race', 'critical', 'Demand is outgrowing supply',
          'Over ' + d.window.from + '–' + d.window.to + ' supply grew ' + d.supplyGrowth +
          '% a year and demand ' + d.demandGrowth + '%, so self-sufficiency fell ' +
          Math.abs(d.ssrGrowth).toFixed(2) + '% a year.',
          'No amount of trade policy closes a gap that is being widened by the production ' +
          'identity itself. Supply growth has to exceed ' + d.demandGrowth +
          '% a year simply to stop the ratio falling further.',
          { supply: d.supplyGrowth, demand: d.demandGrowth, dominant: d.dominant.label });
      }

      if (yieldT.rate < T.yieldStagnant) {
        add('yield-stagnation', 'critical', 'Yield is stagnant',
          'Yield grew ' + yieldT.rate + '% a year over ' + d.window.from + '–' + d.window.to +
          ', from ' + Math.round(yieldT.from) + ' to ' + Math.round(yieldT.to) + ' kg/ha.',
          'Yield is the only lever that raises output without competing for land, and it is the ' +
          'one not being pulled. Where area is also constrained this is the binding cause.',
          { rate: yieldT.rate, from: yieldT.from, to: yieldT.to });
      } else if (yieldT.rate >= T.yieldStrong) {
        add('yield-strong', 'good', 'Yield is improving quickly',
          'Yield grew ' + yieldT.rate + '% a year, reaching ' + Math.round(yieldT.to) + ' kg/ha.',
          'The productivity route is already working. The question is whether it can be sustained ' +
          'as the easy gains are exhausted, and whether it is fast enough against demand.',
          { rate: yieldT.rate });
      }

      if (popT.rate >= T.popHigh) {
        add('demography', 'high', 'Demographic pressure',
          'Population grew ' + popT.rate + '% a year, adding ' +
          Math.round((popT.to - popT.from) / 1e6) + ' million people over the period.',
          'This term is essentially fixed over a policy horizon: the population of 2040 is already ' +
          'born or determined. It sets the floor that supply growth has to clear, and it is why ' +
          'per-hectare productivity matters more here than in slower-growing regions.',
          { rate: popT.rate, added: popT.to - popT.from });
      }

      if (dietT.rate >= T.dietFast) {
        add('diet-shift', 'high', 'Rice is displacing other staples',
          'Consumption per person rose ' + dietT.rate + '% a year, from ' +
          dietT.from.toFixed(1) + ' to ' + dietT.to.toFixed(1) + ' kg.',
          'Urbanisation and the convenience of rice relative to coarse grains are moving the diet. ' +
          'This is a demand-side driver that agricultural policy alone cannot reach, and it means ' +
          'the self-sufficiency target itself is a moving one.',
          { rate: dietT.rate, from: dietT.from, to: dietT.to });
      } else if (dietT.rate < 0) {
        add('diet-falling', 'info', 'Per-capita rice consumption is falling',
          'Consumption per person fell ' + Math.abs(dietT.rate) + '% a year, to ' +
          dietT.to.toFixed(1) + ' kg.',
          'Demand pressure is easing on the per-person margin, so the demand term is carried by ' +
          'population alone. Check whether this is real dietary change or an artefact of the ' +
          'apparent-consumption residual.',
          { rate: dietT.rate });
      }

      if (areaT.rate >= T.areaFast) {
        add('area-led', 'medium', 'Growth is coming from land, not productivity',
          'Area grew ' + areaT.rate + '% a year against yield at ' + yieldT.rate + '%.',
          'Expansion-led growth runs into a frontier and often into forest or rangeland. It buys ' +
          'time rather than solving the problem, and the environmental cost is not in these numbers.',
          { area: areaT.rate, yield: yieldT.rate });
      }
    }

    if (idr && idr.value >= T.idrSevere) {
      add('import-dependence', 'critical', 'Severe import dependence',
        'Imports cover ' + idr.value.toFixed(1) + '% of utilization (' + idr.year + ').',
        'At this level the rice bill is a macroeconomic exposure, not just an agricultural one: ' +
        'a world price shock transmits straight to the consumer price and the current account.',
        { idr: idr });
    } else if (idr && idr.value >= T.idrHigh) {
      add('import-dependence', 'high', 'High import dependence',
        'Imports cover ' + idr.value.toFixed(1) + '% of utilization (' + idr.year + ').',
        'More than half of the rice eaten is bought abroad, so domestic price is set largely ' +
        'offshore and the consumer is exposed to freight and exchange-rate movements.',
        { idr: idr });
    }

    if (idr && idr.value > 100 * T.reExportRatio) {
      add('re-export', 'high', 'Apparent consumption is inflated by re-export',
        'Import dependency is ' + idr.value.toFixed(1) + '%, above 100%, meaning recorded imports ' +
        'exceed recorded utilization.',
        'Rice is entering, being counted, and leaving again without being recorded as an export. ' +
        'Self-sufficiency computed on apparent consumption is therefore understated, and the ' +
        'balance-sheet SSR is the more meaningful figure for this country.',
        { idr: idr });
    }

    // Yield volatility: a mean that hides swings is a different policy problem.
    const yv = bal.yield.filter(v => v != null && v > 0);
    if (yv.length > 8) {
      const recent = yv.slice(-15);
      const m = recent.reduce((a, b) => a + b, 0) / recent.length;
      const sd = Math.sqrt(recent.reduce((a, b) => a + (b - m) * (b - m), 0) / (recent.length - 1));
      const cv = 100 * sd / m;
      if (cv >= T.volatilityHigh) {
        add('volatility', 'medium', 'Yields are highly variable',
          'The coefficient of variation of yield over the last ' + recent.length + ' years is ' +
          cv.toFixed(1) + '%.',
          'Rainfed dependence shows up here. Variability of this size means the average conceals ' +
          'years of shortfall, and it raises the return to irrigation and to water control ' +
          'relative to varietal gains alone.',
          { cv: +cv.toFixed(1) });
      }
    }

    if (per.ok && per.divergent && per.recent) {
      add('regime-change', 'high', 'The recent record differs from the long one',
        'Over ' + per.full.window.from + '–' + per.full.window.to + ' the net supply-demand gap was ' +
        per.full.gap.toFixed(2) + ' points a year; over ' + per.recent.window.from + '–' +
        per.recent.window.to + ' it was ' + per.recent.gap.toFixed(2) + '.',
        'Something changed. Reading the full record alone would give the wrong advice here: the ' +
        'diagnosis above uses the recent window, because that is the regime a policy horizon acts on.',
        { fullGap: per.full.gap, recentGap: per.recent.gap });
    }

    const order = { critical: 0, high: 1, medium: 2, info: 3, good: 4 };
    causes.sort((a, b) => order[a.severity] - order[b.severity]);
    return { ok: true, ssr: ssr, idr: idr, decomposition: d, periods: per, causes: causes,
             selection: bal.label, db: bal.db };
  }

  /* ---------------------------------------------------------- prescription */

  /* What has to happen. Grounded in the condition module rather than invented:
   * the arithmetic of what closes the gap, then the instruments that plausibly
   * deliver it, with the caveats that belong to each. */
  const INSTRUMENTS = {
    yield: [
      { id: 'irrigation', label: 'Water control and irrigation',
        why: 'Raises yield and cuts the year-to-year variability that rainfed systems carry. The ' +
             'single largest yield gap in West Africa is between rainfed lowland and irrigated systems.',
        caveat: 'Capital-intensive and slow: schemes take years to build and longer to run well. ' +
                'Maintenance and water-user governance decide whether the gain persists.' },
      { id: 'varieties', label: 'Improved and adapted varieties',
        why: 'Cheapest per hectare of the productivity levers, and adoption can move quickly where ' +
             'seed systems function.',
        caveat: 'Bounded by adoption: gains apply only to the area actually planted with them, so ' +
                'the ceiling is the seed system, not the genetics.' },
      { id: 'fertiliser', label: 'Soil fertility and fertiliser access',
        why: 'Yield response to nitrogen is steep on depleted soils, so the first increments are ' +
             'the cheapest output a system can buy.',
        caveat: 'Import-dependent and price-exposed; subsidy programmes are fiscally heavy and ' +
                'leak. Response depends on water, so it pairs with irrigation rather than substituting.' },
      { id: 'extension', label: 'Agronomy and extension',
        why: 'Much of the measured yield gap is management, not technology: transplanting, spacing, ' +
             'weeding and timing.',
        caveat: 'Slow, staff-intensive, and hard to attribute. Rarely produces a visible result ' +
                'within one political cycle.' }
    ],
    area: [
      { id: 'lowland', label: 'Developing inland valleys and lowlands',
        why: 'Large areas of suitable lowland remain undeveloped in West Africa, and they carry ' +
             'better water security than upland rice.',
        caveat: 'Land tenure disputes are the usual binding constraint, not engineering.' },
      { id: 'doubleCrop', label: 'Second cropping where water allows',
        why: 'Raises harvested area without new land, using infrastructure that already exists.',
        caveat: 'Only where irrigation is reliable; otherwise it converts one good harvest into ' +
                'two poor ones.' }
    ],
    postHarvest: [
      { id: 'milling', label: 'Milling quality and post-harvest losses',
        why: 'Raises the edible output of the same paddy and the price local rice can command. ' +
             'Broken grain from poor milling is why imported rice is often preferred.',
        caveat: 'Does not raise paddy production, so it does not appear in yield statistics at all ' +
                'while still improving the balance sheet.' }
    ],
    demand: [
      { id: 'quality', label: 'Competing on quality, not only on volume',
        why: 'Consumer preference for imported rice is partly about grain quality and consistency. ' +
             'Import substitution fails if the domestic product is not what people want to eat.',
        caveat: 'Requires the milling and grading investments above; a tariff without them raises ' +
                'the price of the staple without shifting demand.' }
    ],
    trade: [
      { id: 'tariff', label: 'Import tariffs and levies',
        why: 'Raises the domestic price, which transmits to producer incentives.',
        caveat: 'Rice is a staple: the burden falls hardest on poor urban consumers, and porous ' +
                'borders defeat high tariffs — this is precisely the Benin–Nigeria case. Treat as ' +
                'a revenue instrument with production side-effects, not a production instrument.' },
      { id: 'reserves', label: 'Strategic reserves and price stabilisation',
        why: 'Buffers the consumer against world price shocks, which is what a 2008-type event ' +
             'actually does to a high-IDR country.',
        caveat: 'Expensive to hold, easily politicised, and prone to loss in storage.' }
    ]
  };

  function prescribe(bal, opts) {
    opts = opts || {};
    const dg = diagnose(bal, opts);
    if (!dg.ok) return dg;
    const picked = [], seen = {};
    const take = (group, reason) => INSTRUMENTS[group].forEach(x => {
      if (seen[x.id]) return;
      seen[x.id] = 1;
      picked.push(Object.assign({ group: group, becauseOf: reason }, x));
    });

    const has = id => dg.causes.some(c => c.id === id);
    if (has('yield-stagnation') || has('losing-race')) take('yield', 'yield-stagnation');
    if (has('volatility')) take('yield', 'volatility');
    if (has('area-led')) take('yield', 'area-led');
    if (has('demography') || has('diet-shift')) { take('yield', 'demand-pressure'); take('area', 'demand-pressure'); }
    if (has('import-dependence')) { take('postHarvest', 'import-dependence'); take('demand', 'import-dependence'); }
    if (has('re-export')) take('trade', 're-export');
    if (has('import-dependence')) take('trade', 'import-dependence');
    if (!picked.length) { take('yield', 'general'); take('postHarvest', 'general'); }

    // What the arithmetic actually requires, from the condition module.
    let condition = null;
    try {
      condition = RSACondition.forSelection(bal.selection,
        { dbKey: bal.dbKey, basis: bal.basis });
    } catch (e) { condition = null; }

    return { ok: true, diagnosis: dg, instruments: picked, condition: condition };
  }

  /* --------------------------------------------------------------- peers */

  /* Countries that are self-sufficient, or that closed a gap, and how they did
   * it. Prescription is more credible when someone has already done it. */
  function peers(bal, opts) {
    opts = opts || {};
    const I = RSAIndicators;
    const out = [];
    RSA.countries().forEach(c => {
      if (bal.members.length === 1 && c.iso3 === bal.members[0]) return;
      let b;
      try { b = RSA.balance(bal.dbKey, { kind: 'country', id: c.iso3 }, { basis: bal.basis }); }
      catch (e) { return; }
      const s = I.compute('ssr', b).values;
      let lastV = null, lastY = null;
      for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) { lastV = s[i]; lastY = b.years[i]; break; }
      if (lastV == null) return;
      const d = decompose(b, opts);
      out.push({ iso3: c.iso3, name: c.name, ssr: lastV, year: lastY,
                 yieldGrowth: d.ok ? d.terms.filter(t => t.key === 'yield')[0].rate : null,
                 areaGrowth: d.ok ? d.terms.filter(t => t.key === 'area')[0].rate : null,
                 ssrTrend: d.ok ? d.ssrGrowth : null });
    });
    const selfSufficient = out.filter(x => x.ssr >= T.ssrTarget).sort((a, b) => b.ssr - a.ssr);
    const improving = out.filter(x => x.ssrTrend != null && x.ssrTrend > 0)
                         .sort((a, b) => b.ssrTrend - a.ssrTrend);
    return { selfSufficient: selfSufficient.slice(0, 8), improving: improving.slice(0, 8), all: out };
  }

  /* ------------------------------------------------------------- questions */

  /* The questions this section is built to answer, each mapped to what it needs
   * so the UI can offer them rather than making the reader guess. */
  const QUESTIONS = [
    { id: 'drivers', label: 'What drives self-sufficiency here?' },
    { id: 'why', label: 'Why is this country or region not self-sufficient?' },
    { id: 'what', label: 'What would it take to get there?' },
    { id: 'who', label: 'Who has succeeded, and how?' },
    { id: 'risk', label: 'What would a price or supply shock do?' }
  ];

  return {
    VERSION: VERSION,
    THRESHOLDS: T,
    INSTRUMENTS: INSTRUMENTS,
    QUESTIONS: QUESTIONS,
    RECENT_YEARS: RECENT_YEARS,
    decompose: decompose,
    decomposePeriods: decomposePeriods,
    diagnose: diagnose,
    prescribe: prescribe,
    peers: peers
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RSAAdvisor;
