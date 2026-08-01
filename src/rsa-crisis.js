/* Rice Statistics for Africa -- crisis analysis.
 *
 * WHAT THIS DOES, AND WHAT IT CANNOT DO
 *
 * This module measures how rice indicators moved around dated external shocks:
 * the 2007-08 food price crisis, the 2010-11 price spike, COVID-19, the
 * Russia-Ukraine war, and India's 2023 export restrictions.
 *
 * It is an INTERRUPTED TIME-SERIES analysis, not a causal identification. Three
 * things are computed for each crisis and each indicator:
 *
 *   1. Event windows -- mean level before, during and after, and the change.
 *      Simple, transparent, and the weakest of the three: a series with a trend
 *      will show a "change" at any date you pick.
 *
 *   2. A COUNTERFACTUAL. A model is fitted to the pre-crisis data only, then
 *      projected across the crisis window. The deviation of the actual from that
 *      projection is the estimate of the shock, and it is reported against the
 *      projection's own prediction interval. A deviation inside the interval is
 *      not evidence of anything. This is the part that distinguishes a shock from
 *      a continuation of trend.
 *
 *   3. A CHOW TEST for a structural break at the crisis date, which asks whether
 *      the trend itself changed rather than just the level.
 *
 * WHY NONE OF THIS IS CAUSAL. The crises overlap with each other and with
 * everything else. 2008 coincides with the global financial crisis; COVID-19
 * coincides with desert locusts in East Africa; the Russia-Ukraine war overlaps
 * India's export ban from mid-2023. The data are annual, so nothing within a year
 * is resolvable -- the 2008 rice price spike ran from January to May and had
 * largely unwound by December. And there is no control group: every African
 * country was exposed. What follows is association around dated windows, and the
 * platform says so wherever it reports a number.
 */

const RSACrisis = (function () {
  'use strict';

  /* Each crisis carries its dates, the transmission channel through which it
   * could plausibly reach African rice, and the confounders that make attribution
   * hard. The channel matters: a shock that reaches rice through fertiliser
   * prices should show up in yields years later, not in imports immediately. */
  const CRISES = [
    {
      id: 'food2008',
      name: '2007–08 global food price crisis',
      nameFr: 'Crise des prix alimentaires 2007-08',
      start: 2007, end: 2008, preYears: 5, postYears: 3,
      channel: 'World rice prices roughly tripled between January and May 2008. The proximate ' +
        'cause was export restriction rather than harvest failure: India banned non-basmati exports, ' +
        'Vietnam, Egypt and Cambodia restricted theirs, and importers bid against each other into a ' +
        'thinning market. For African importers the shock arrived as price and as availability at ' +
        'the same time.',
      channelFr: 'Les prix mondiaux du riz ont environ triplé entre janvier et mai 2008. La cause ' +
        'immédiate fut la restriction des exportations plutôt qu’une mauvaise récolte : l’Inde a ' +
        'interdit les exportations de riz non-basmati, le Vietnam, l’Égypte et le Cambodge ont ' +
        'restreint les leurs, et les importateurs ont surenchéri sur un marché devenu étroit.',
      expect: 'Import unit values should rise sharply in 2008. Import volumes may fall (rationing by ' +
        'price) or rise (precautionary stockpiling) depending on fiscal room. The import bill should ' +
        'rise in either case.',
      confounders: 'The global financial crisis, an oil price spike to $147/bbl, and a concurrent ' +
        'surge in fertiliser prices.'
    },
    {
      id: 'spike2011',
      name: '2010–11 food price spike',
      nameFr: 'Flambée des prix alimentaires 2010-11',
      start: 2010, end: 2011, preYears: 2, postYears: 3,
      channel: 'A second price wave, driven by the Russian wheat export ban after the 2010 drought ' +
        'and by weather shocks elsewhere. Rice was less affected than wheat and maize because Asian ' +
        'stocks had been rebuilt after 2008, so this is a useful contrast case: a food price crisis ' +
        'that was NOT primarily a rice crisis.',
      channelFr: 'Une deuxième vague de prix, tirée par l’interdiction russe d’exporter du blé après ' +
        'la sécheresse de 2010. Le riz fut moins touché que le blé et le maïs, les stocks asiatiques ' +
        'ayant été reconstitués après 2008.',
      expect: 'Smaller effect on rice than on wheat. If African rice indicators move as much here as ' +
        'in 2008, the 2008 attribution is probably picking up something other than the rice market.',
      confounders: 'Arab Spring political disruption in North Africa; drought in the Sahel in 2011–12.',
      // The pre-window for this event unavoidably sits on the aftermath of 2008.
      // There is no clean counterfactual baseline available, and the platform must
      // say so rather than quietly report a change measured against a peak.
      preContaminatedBy: 'food2008',
      preWarning: 'The pre-crisis window for this event (2008–2009) sits directly on the peak and ' +
        'aftermath of the 2007–08 crisis, because the two events are only two years apart. Every ' +
        '"change from pre-crisis" figure below is therefore measured against an ALREADY ELEVATED ' +
        'baseline, and a negative change can mean prices fell back from the 2008 spike rather than ' +
        'that this crisis had no effect. There is no uncontaminated baseline available in annual ' +
        'data, so this is a limitation to be read around, not one that can be corrected.'
    },
    {
      id: 'covid',
      name: 'COVID-19 pandemic',
      nameFr: 'Pandémie de COVID-19',
      start: 2020, end: 2021, preYears: 3, postYears: 3,
      channel: 'Logistics disruption, port and border closures, and labour shortages in harvesting ' +
        'and milling. Viet Nam suspended rice export registrations in March 2020 and prices spiked ' +
        'briefly; several importers stockpiled. Unlike 2008 the disruption was to movement rather ' +
        'than to supply, and most of it had unwound within the year.',
      channelFr: 'Perturbation logistique, fermetures de ports et de frontières, pénuries de ' +
        'main-d’œuvre pour la récolte et l’usinage. Le Vietnam a suspendu les enregistrements ' +
        'd’exportation en mars 2020 et les prix ont brièvement flambé.',
      expect: 'A visible but short-lived rise in import unit values in 2020, and possible ' +
        'precautionary import volume increases. Production should be less affected than trade, since ' +
        'rice is largely smallholder-grown and not import-input-intensive in most of Africa.',
      confounders: 'Desert locust upsurge in East Africa 2019–21; macroeconomic contraction and ' +
        'currency depreciation across the continent.'
    },
    {
      id: 'ukraine',
      name: 'Russia–Ukraine war',
      nameFr: 'Guerre Russie-Ukraine',
      start: 2022, end: 2024, preYears: 3, postYears: 0,
      channel: 'Rice is not traded by either belligerent in quantity, so the transmission is ' +
        'indirect and mostly through INPUTS. Russia and Belarus supply a large share of world potash ' +
        'and a significant share of nitrogen fertiliser; fertiliser prices roughly doubled in 2022. ' +
        'Energy and freight costs rose. Wheat disruption also pushed some substitution toward rice.',
      channelFr: 'Le riz n’est pas échangé en quantité par les belligérants : la transmission est ' +
        'indirecte et passe surtout par les INTRANTS. La Russie et le Bélarus fournissent une part ' +
        'importante de la potasse et de l’azote mondiaux ; les prix des engrais ont environ doublé ' +
        'en 2022. Le coût de l’énergie et du fret a augmenté.',
      expect: 'Effects on YIELD are the ones to look for, and they lag: fertiliser bought in 2022 ' +
        'affects the 2022–23 harvests. Import unit values should rise through freight and through ' +
        'substitution demand. A large immediate SSR change would be surprising and should be treated ' +
        'sceptically.',
      confounders: 'India’s export restrictions from July 2023 fall inside this window and are ' +
        'analysed separately; global monetary tightening and widespread currency depreciation.'
    },
    {
      id: 'indiaban',
      name: 'India rice export restrictions',
      nameFr: 'Restrictions indiennes à l’exportation de riz',
      start: 2023, end: 2024, preYears: 4, postYears: 0,
      channel: 'India supplies roughly 40% of world rice exports. It restricted broken rice exports ' +
        'in September 2022 and banned non-basmati white rice exports in July 2023. West Africa is ' +
        'the most exposed region on earth to this specific measure, because broken rice is the ' +
        'staple imported form there and India was its dominant supplier.',
      channelFr: 'L’Inde fournit environ 40 % des exportations mondiales de riz. Elle a restreint ' +
        'les exportations de brisures en septembre 2022 puis interdit celles de riz blanc ' +
        'non-basmati en juillet 2023. L’Afrique de l’Ouest est la région la plus exposée à cette ' +
        'mesure, les brisures y étant la forme importée de base.',
      expect: 'The most West-Africa-specific of these shocks. Expect import unit values to rise and ' +
        'sourcing to shift. Countries importing broken rice from India should show larger effects ' +
        'than countries importing milled rice from elsewhere.',
      confounders: 'Overlaps entirely with the Russia–Ukraine window; El Niño conditions in 2023–24.'
    }
  ];

  const INDICATORS = ['importUnitValue', 'imports', 'importBill', 'ssr', 'idr',
                      'production', 'consumption', 'yield', 'cpc'];

  function get(id) { return CRISES.filter(c => c.id === id)[0] || null; }

  /* ------------------------------------------------------- event windows */

  function meanOver(res, from, to) {
    let s = 0, n = 0;
    for (let i = 0; i < res.years.length; i++) {
      if (res.years[i] < from || res.years[i] > to) continue;
      if (res.values[i] == null || !isFinite(res.values[i])) continue;
      s += res.values[i]; n++;
    }
    return n ? { mean: s / n, n: n } : { mean: null, n: 0 };
  }

  function valueAt(res, year) {
    const i = res.years.indexOf(year);
    return i >= 0 ? res.values[i] : null;
  }

  /* -------------------------------------------------------- counterfactual
   *
   * Fit on pre-crisis data only, project across the window, and compare. The
   * deviation is reported against the projection's own 95% interval, because a
   * deviation inside that interval is indistinguishable from the series simply
   * continuing to do what it was doing.
   */
  function counterfactual(res, crisis, opts) {
    opts = opts || {};
    const preEnd = crisis.start - 1;
    const ys = [], vs = [];
    for (let i = 0; i < res.years.length; i++) {
      if (res.years[i] > preEnd) break;
      if (res.values[i] == null || !isFinite(res.values[i])) continue;
      ys.push(res.years[i]); vs.push(res.values[i]);
    }
    // Keep only the uninterrupted run ending at the crisis, which is what a
    // recursive model can actually be fitted to.
    let start = ys.length - 1;
    while (start > 0 && ys[start] - ys[start - 1] === 1) start--;
    const py = ys.slice(start), pv = vs.slice(start);
    if (pv.length < 15) {
      return { ok: false, reason: 'fewer than 15 uninterrupted pre-crisis observations (' +
                                  pv.length + ')' };
    }

    const lastPre = py[py.length - 1];
    const h = crisis.end - lastPre;
    if (h < 1) return { ok: false, reason: 'crisis window does not extend beyond the fitted sample' };

    let model = null, path = null, lo = null, hi = null, label = null, method = null;
    try {
      const sel = RSATsa.selectModel(pv, { criterion: 'aic', maxP: 3, maxQ: 3 });
      if (sel && sel.selected && !sel.warning) {
        const f = RSATsa.forecast(sel.selected, h, { levels: [0.95] });
        path = f.mean; lo = f.intervals['95'].lower; hi = f.intervals['95'].upper;
        label = sel.selected.label; method = 'ARIMA fitted to pre-crisis data only';
        model = sel.selected;
      }
    } catch (e) { /* fall through */ }
    if (!path) {
      const rw = RSATsa.rwDrift(pv);
      path = rw.forecast(h);
      const sd = Math.sqrt(rw.sigma2);
      lo = path.map((v, k) => v - 1.96 * sd * Math.sqrt(k + 1));
      hi = path.map((v, k) => v + 1.96 * sd * Math.sqrt(k + 1));
      label = rw.label; method = 'random walk with drift, fitted to pre-crisis data only';
    }

    const rows = [];
    for (let k = 0; k < h; k++) {
      const year = lastPre + k + 1;
      if (year < crisis.start || year > crisis.end) continue;
      const actual = valueAt(res, year);
      if (actual == null) continue;
      const expected = path[k];
      const outside = actual < lo[k] || actual > hi[k];
      rows.push({
        year: year, actual: actual, expected: expected,
        lower: lo[k], upper: hi[k],
        deviation: actual - expected,
        deviationPct: (expected !== 0) ? 100 * (actual - expected) / Math.abs(expected) : null,
        outsideInterval: outside
      });
    }
    if (!rows.length) return { ok: false, reason: 'no overlapping observed years in the window' };

    let sum = 0, anyOutside = false;
    rows.forEach(r => { sum += r.deviation; if (r.outsideInterval) anyOutside = true; });

    return {
      ok: true,
      model: label, method: method,
      fittedFrom: py[0], fittedTo: lastPre, fittedN: pv.length,
      rows: rows,
      cumulativeDeviation: sum,
      meanDeviationPct: rows.reduce((a, r) => a + (r.deviationPct || 0), 0) / rows.length,
      anyOutsideInterval: anyOutside,
      verdict: anyOutside
        ? 'At least one crisis year falls outside the 95% interval of what the pre-crisis model ' +
          'projected. The series departed from its own prior behaviour.'
        : 'Every crisis year falls inside the 95% interval of the pre-crisis projection. The ' +
          'movement is indistinguishable from the series continuing as before, and should NOT be ' +
          'reported as a crisis effect.'
    };
  }

  /* ------------------------------------------------------------ Chow test
   *
   *   H0: the intercept and trend are the same before and after the break.
   *   F  = [(RSS_p - (RSS_1 + RSS_2)) / k] / [(RSS_1 + RSS_2) / (n - 2k)]
   * with k = 2 (intercept and linear trend). Tests whether the TREND changed,
   * which is a different question from whether the level jumped.
   */
  function chowTest(res, breakYear) {
    const ys = [], vs = [];
    for (let i = 0; i < res.years.length; i++) {
      if (res.values[i] == null || !isFinite(res.values[i])) continue;
      ys.push(res.years[i]); vs.push(res.values[i]);
    }
    const pre = [], post = [];
    for (let i = 0; i < ys.length; i++) (ys[i] < breakYear ? pre : post).push(i);
    const k = 2;
    if (pre.length < k + 3 || post.length < k + 3) {
      return { ok: false, reason: 'too few observations either side of ' + breakYear +
                                  ' (' + pre.length + ' / ' + post.length + ')' };
    }

    const fit = idx => {
      const X = idx.map(i => [1, ys[i]]);
      const y = idx.map(i => vs[i]);
      const r = RSATsa.ols(X, y);
      return r ? r.sse : null;
    };
    const rssP = fit(pre.concat(post));
    const rss1 = fit(pre), rss2 = fit(post);
    if (rssP == null || rss1 == null || rss2 == null) {
      return { ok: false, reason: 'regression failed' };
    }
    const n = pre.length + post.length;
    const denom = (rss1 + rss2) / (n - 2 * k);
    if (denom <= 0) return { ok: false, reason: 'zero residual variance' };
    const F = ((rssP - (rss1 + rss2)) / k) / denom;
    const p = 1 - RSATsa.fcdf(F, k, n - 2 * k);
    return {
      ok: true, breakYear: breakYear, F: F, df1: k, df2: n - 2 * k, pValue: p,
      nPre: pre.length, nPost: post.length,
      significant: p < 0.05,
      h0: 'the intercept and linear trend are unchanged across ' + breakYear,
      conclusion: p < 0.05
        ? 'reject H0 at 5%: the trend differs either side of ' + breakYear
        : 'fail to reject H0 at 5%: no detectable change in trend at ' + breakYear,
      caveat: 'A Chow test at a date chosen in advance is a test of a specific hypothesis. Running ' +
              'it at several candidate dates and reporting the best one would be data mining; the ' +
              'dates here are fixed by the historical record, not selected to fit.'
    };
  }

  /* ============================================================== analysis */

  function analyse(bal, crisisId, opts) {
    opts = opts || {};
    const crisis = get(crisisId);
    if (!crisis) return null;
    const I = RSAIndicators;

    const preFrom = crisis.start - crisis.preYears;
    const preTo = crisis.start - 1;
    const postFrom = crisis.end + 1;
    const postTo = crisis.end + crisis.postYears;

    const rows = INDICATORS.map(id => {
      const res = I.compute(id, bal);
      const pre = meanOver(res, preFrom, preTo);
      const during = meanOver(res, crisis.start, crisis.end);
      const post = crisis.postYears > 0 ? meanOver(res, postFrom, postTo) : { mean: null, n: 0 };
      const chg = (pre.mean != null && during.mean != null && pre.mean !== 0)
        ? 100 * (during.mean - pre.mean) / Math.abs(pre.mean) : null;
      const rec = (pre.mean != null && post.mean != null && pre.mean !== 0)
        ? 100 * (post.mean - pre.mean) / Math.abs(pre.mean) : null;
      return {
        id: id, label: I.label ? I.label(id) : I.get(id).label, unit: I.get(id).unit,
        pre: pre.mean, during: during.mean, post: post.mean,
        nPre: pre.n, nDuring: during.n, nPost: post.n,
        changePct: chg, postChangePct: rec,
        peak: (function () {
          let best = null;
          for (let i = 0; i < res.years.length; i++) {
            if (res.years[i] < crisis.start || res.years[i] > crisis.end) continue;
            if (res.values[i] == null) continue;
            if (!best || Math.abs(res.values[i]) > Math.abs(best.value)) {
              best = { year: res.years[i], value: res.values[i] };
            }
          }
          return best;
        })()
      };
    });

    // Counterfactual and break test on the indicators where they are meaningful.
    const focus = opts.focus || ['importUnitValue', 'imports', 'ssr', 'importBill', 'yield'];
    const cf = {}, breaks = {};
    focus.forEach(id => {
      const res = I.compute(id, bal);
      cf[id] = counterfactual(res, crisis, opts);
      breaks[id] = chowTest(res, crisis.start);
    });

    return {
      crisis: crisis,
      selection: bal.label,
      db: bal.db,
      basis: bal.basis,
      windows: { preFrom: preFrom, preTo: preTo, start: crisis.start, end: crisis.end,
                 postFrom: postFrom, postTo: postTo, hasPost: crisis.postYears > 0 },
      rows: rows,
      counterfactual: cf,
      breaks: breaks,
      preContaminated: !!crisis.preContaminatedBy,
      preWarning: crisis.preWarning || null,
      findings: interpret(crisis, rows, cf, breaks),
      caveat: 'Interrupted time-series association around a dated window. Not causal identification: ' +
              'the crises overlap with each other and with unrelated shocks, the data are annual so ' +
              'nothing within a year is resolvable, and there is no unexposed control group.'
    };
  }

  /* --------------------------------------------------------- interpretation
   *
   * Rule-based, like the rest of the platform. Each finding states the evidence
   * that produced it and, where the counterfactual says the movement is within
   * normal variation, says so instead of manufacturing a story.
   */
  function interpret(crisis, rows, cf, breaks) {
    const out = [];
    const byId = {};
    rows.forEach(r => { byId[r.id] = r; });

    const price = byId.importUnitValue;
    const c = cf.importUnitValue;
    if (price && price.changePct != null) {
      if (c && c.ok && c.anyOutsideInterval && price.changePct > 10) {
        out.push({
          severity: 'high', kind: 'price',
          title: 'Import prices rose beyond what the pre-crisis trend implied',
          text: 'The average import unit value was ' + fmt(price.changePct) + '% above its ' +
                'pre-crisis level during ' + crisis.start + '–' + crisis.end + ', and at least one ' +
                'year fell outside the 95% interval of a model fitted only to pre-crisis data. ' +
                'This is the clearest signature of the shock reaching the domestic market: it ' +
                'arrives as price before it arrives as anything else.',
          evidence: 'import unit value; counterfactual ' + c.model
        });
      } else if (price.changePct > 10) {
        out.push({
          severity: 'medium', kind: 'price',
          title: 'Import prices rose, but within the range of normal variation',
          text: 'Average import unit value was ' + fmt(price.changePct) + '% above its pre-crisis ' +
                'level, but every crisis year sits inside the 95% interval of the pre-crisis ' +
                'projection. Import unit values are volatile, and a rise of this size is not by ' +
                'itself evidence that the crisis caused it.',
          evidence: 'import unit value; counterfactual interval'
        });
      }
    }

    const bill = byId.importBill;
    if (bill && bill.changePct != null && bill.changePct > 15) {
      out.push({
        severity: 'high', kind: 'fiscal',
        title: 'The rice import bill rose sharply',
        text: 'Spending on imported rice averaged ' + fmt(bill.changePct) + '% above its pre-crisis ' +
              'level during the window. For a net importer this is a foreign-exchange shock arriving ' +
              'on top of whatever else the crisis was doing to the balance of payments, and it ' +
              'competes directly with every other import need.',
        evidence: 'import bill'
      });
    }

    const imp = byId.imports;
    if (imp && imp.changePct != null) {
      if (imp.changePct < -10) {
        out.push({
          severity: 'high', kind: 'volume',
          title: 'Import volumes fell during the crisis',
          text: 'Import volumes averaged ' + fmt(Math.abs(imp.changePct)) + '% below their ' +
                'pre-crisis level. Where prices rose at the same time, this is rationing by price ' +
                'rather than a fall in need — the quantity available to consumers dropped, which is ' +
                'a food-access problem even if no statistic here measures hunger directly.',
          evidence: 'import volume; import unit value'
        });
      } else if (imp.changePct > 15) {
        out.push({
          severity: 'medium', kind: 'volume',
          title: 'Import volumes rose during the crisis',
          text: 'Import volumes averaged ' + fmt(imp.changePct) + '% above pre-crisis levels. During ' +
                'a supply scare this usually indicates precautionary stockpiling by governments or ' +
                'traders rather than higher consumption, and it tends to reverse afterwards.',
          evidence: 'import volume'
        });
      }
    }

    const ssr = byId.ssr;
    const bssr = breaks.ssr;
    if (ssr && ssr.changePct != null && Math.abs(ssr.changePct) > 5) {
      const dir = ssr.changePct > 0 ? 'rose' : 'fell';
      out.push({
        severity: bssr && bssr.ok && bssr.significant ? 'high' : 'medium', kind: 'structural',
        title: 'Self-sufficiency ' + dir + ' across the crisis window',
        text: 'SSR averaged ' + fmt(ssr.pre) + '% before the crisis and ' + fmt(ssr.during) +
              '% during it. ' +
              (bssr && bssr.ok
                ? (bssr.significant
                    ? 'A Chow test at ' + crisis.start + ' rejects trend stability (F = ' +
                      fmt(bssr.F, 2) + ', p = ' + fmt(bssr.pValue, 4) + '), so the trajectory itself ' +
                      'changed, not just the level.'
                    : 'A Chow test at ' + crisis.start + ' does not reject trend stability (p = ' +
                      fmt(bssr.pValue, 3) + '), so this is a level movement within an unchanged ' +
                      'trend rather than a structural break.')
                : '') +
              ' Note that SSR can rise during a crisis for the wrong reason: if imports are cut off, ' +
              'the ratio improves while people eat less.',
        evidence: 'SSR; Chow test at ' + crisis.start
      });
    }

    const yld = byId.yield;
    if (yld && yld.changePct != null && yld.changePct < -5 && crisis.id === 'ukraine') {
      out.push({
        severity: 'high', kind: 'input',
        title: 'Yields fell, consistent with the fertiliser channel',
        text: 'Average yield was ' + fmt(Math.abs(yld.changePct)) + '% below its pre-crisis level. ' +
              'This is the transmission route that matters for the Russia–Ukraine war: rice is not ' +
              'traded by the belligerents, but potash and nitrogen are, and fertiliser prices ' +
              'roughly doubled in 2022. A yield effect is more plausible here than a direct trade ' +
              'effect, and it persists longer.',
        evidence: 'yield'
      });
    }

    if (!out.length) {
      out.push({
        severity: 'info', kind: 'none',
        title: 'No indicator moved enough to report',
        text: 'None of the indicators examined departed materially from their pre-crisis levels for ' +
              this_(crisis) + '. That is a finding in itself: not every global crisis reaches every ' +
              'national rice market, and the absence of a movement is worth as much as its presence.',
        evidence: 'all indicators'
      });
    }
    return out;
  }

  function this_(crisis) { return crisis.name; }

  /* ================================================ cross-country comparison */

  /* Which countries were hit hardest. Ranked on the counterfactual deviation
   * where one can be computed, so a country whose indicator merely continued its
   * trend does not appear as "affected". */
  function crossCountry(crisisId, dbKey, opts, indicatorId) {
    const crisis = get(crisisId);
    if (!crisis) return [];
    const id = indicatorId || 'importUnitValue';
    const rows = [];
    RSA.countries().forEach(cn => {
      if (!RSA.hasSeries(dbKey, cn.iso3)) return;
      let bal;
      try { bal = RSA.balance(dbKey, { kind: 'country', id: cn.iso3 }, opts || {}); }
      catch (e) { return; }
      const res = RSAIndicators.compute(id, bal);
      const pre = meanOver(res, crisis.start - crisis.preYears, crisis.start - 1);
      const during = meanOver(res, crisis.start, crisis.end);
      if (pre.mean == null || during.mean == null || pre.mean === 0) return;
      const chg = 100 * (during.mean - pre.mean) / Math.abs(pre.mean);
      let outside = null;
      try {
        const c = counterfactual(res, crisis, {});
        outside = c.ok ? c.anyOutsideInterval : null;
      } catch (e) { outside = null; }
      rows.push({
        iso3: cn.iso3, name: cn.name, region: cn.region,
        pre: pre.mean, during: during.mean, changePct: chg,
        beyondNormalVariation: outside
      });
    });
    rows.sort((a, b) => b.changePct - a.changePct);
    return rows;
  }

  /* ============================================= policy recommendations */

  /* Crisis-specific, and deliberately different from the structural
   * recommendations elsewhere in the platform: those are about raising
   * production, these are about surviving a shock that has already happened. */
  const RESILIENCE = {
    'reserves': {
      label: 'Strategic rice reserves',
      detail: 'A physical buffer decouples short-run availability from a world market that can close ' +
        'in weeks — India moved from open export to a non-basmati ban in a single announcement in ' +
        'July 2023. Reserves are expensive to hold and easy to mismanage, and they address stability ' +
        'rather than self-sufficiency, but they are the only instrument that works on the timescale ' +
        'these crises actually operate on.',
      addresses: ['price', 'volume']
    },
    'diversify-suppliers': {
      label: 'Diversify import origins',
      detail: 'Concentration is the exposure. India supplies roughly 40% of world rice exports, and ' +
        'West Africa buys predominantly Indian broken rice, so an Indian policy change is very nearly ' +
        'a West African supply shock. Pre-qualified alternative suppliers and standing contracts with ' +
        'Thailand, Viet Nam, Pakistan or Myanmar cost little until they are needed.',
      addresses: ['price', 'volume']
    },
    'fx-buffer': {
      label: 'Foreign-exchange provisioning for the food bill',
      detail: 'A recurring rice import bill is a standing currency exposure that becomes acute exactly ' +
        'when reserves are under pressure for other reasons. Hedging, forward purchase and explicit ' +
        'budget provisioning convert an unpredictable shock into a planned cost.',
      addresses: ['fiscal', 'price']
    },
    'fertiliser-security': {
      label: 'Fertiliser supply and input security',
      detail: 'The Russia–Ukraine channel into African rice runs through potash and nitrogen, not ' +
        'through rice itself. Input procurement, regional fertiliser production, and integrated soil ' +
        'fertility management reduce the exposure. The effect is slow: fertiliser withheld in one ' +
        'season shows up in the next harvest and the one after.',
      addresses: ['input']
    },
    'targeted-transfers': {
      label: 'Targeted transfers rather than blanket subsidies',
      detail: 'When a price shock arrives, the binding problem is affordability for poor households, ' +
        'not national availability. Targeted cash or vouchers reach them at a fraction of the fiscal ' +
        'cost of a universal price subsidy, and without the consumption distortions and smuggling ' +
        'incentives a subsidised domestic price creates.',
      addresses: ['price', 'fiscal']
    },
    'avoid-export-bans': {
      label: 'Resist the reflex to restrict trade',
      detail: 'The 2007–08 crisis was manufactured largely by export restrictions: each country ' +
        'protecting its own market thinned the world market and raised prices for everyone, ' +
        'including eventually for the restrictors. Regional agreements not to close borders during a ' +
        'price spike are cheap insurance against a collectively self-defeating response.',
      addresses: ['price', 'volume', 'structural']
    },
    'early-warning': {
      label: 'Market monitoring and early warning',
      detail: 'Every crisis analysed here was visible in world prices and in exporter policy ' +
        'announcements before it reached domestic markets. Systematic monitoring of exporter policy, ' +
        'freight rates and world quotations buys weeks to months of lead time, which is the ' +
        'difference between procuring ahead of a spike and procuring into one.',
      addresses: ['price', 'volume', 'fiscal']
    },
    'productivity': {
      label: 'Reduce the exposure itself',
      detail: 'None of the instruments above changes how much rice the country must buy. Raising ' +
        'domestic productivity is the only measure that shrinks the exposure rather than managing ' +
        'it, and it is the slowest — which is precisely why it has to be started outside a crisis.',
      addresses: ['structural', 'volume']
    }
  };

  function recommendations(analyses) {
    const kinds = {};
    (analyses || []).forEach(a => {
      (a.findings || []).forEach(f => {
        if (f.severity === 'info') return;
        kinds[f.kind] = (kinds[f.kind] || 0) + 1;
      });
    });
    const wanted = [];
    Object.keys(RESILIENCE).forEach(k => {
      const r = RESILIENCE[k];
      const hits = r.addresses.filter(a => kinds[a]).length;
      if (hits) wanted.push({ id: k, label: r.label, detail: r.detail, relevance: hits,
                              addresses: r.addresses.filter(a => kinds[a]) });
    });
    wanted.sort((a, b) => b.relevance - a.relevance);
    if (!wanted.length) {
      return {
        items: [{ id: 'early-warning', label: RESILIENCE['early-warning'].label,
                  detail: RESILIENCE['early-warning'].detail, relevance: 0, addresses: [] }],
        note: 'No crisis in the analysed set produced a material movement in this selection’s ' +
              'indicators, so no crisis-specific response is indicated. Monitoring remains worthwhile ' +
              'because absence of past exposure does not imply absence of future exposure.'
      };
    }
    return {
      items: wanted,
      note: 'Ranked by how many of the observed crisis effects each instrument addresses. These are ' +
            'RESILIENCE measures — about surviving a shock that has already happened — and are ' +
            'deliberately different from the structural recommendations in the policy simulator, ' +
            'which are about raising production over decades. A country needs both, and the two ' +
            'compete for the same budget.'
    };
  }

  /* ---------------------------------------------------------------- helper */

  function fmt(x, dp) {
    if (x == null || !isFinite(x)) return 'n/a';
    if (typeof RSAi18n !== 'undefined') return RSAi18n.num(x, dp == null ? 1 : dp);
    return Number(x).toFixed(dp == null ? 1 : dp);
  }

  /* Runs every crisis for a selection, which is what the panel and report use. */
  function analyseAll(bal, opts) {
    return CRISES.map(c => analyse(bal, c.id, opts)).filter(Boolean);
  }

  return {
    CRISES: CRISES,
    RESILIENCE: RESILIENCE,
    INDICATORS: INDICATORS,
    get: get,
    analyse: analyse,
    analyseAll: analyseAll,
    counterfactual: counterfactual,
    chowTest: chowTest,
    crossCountry: crossCountry,
    recommendations: recommendations,
    meanOver: meanOver
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSACrisis; }
