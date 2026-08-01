/* Rice Statistics for Africa -- automatic report generation and export.
 *
 * Produces a complete, structured scientific report for whatever the user has
 * selected: country or group, database, basis, period, forecast horizon and
 * scenarios. The methodology section is generated from the indicator descriptors
 * and the fitted models rather than written by hand, so a report can never
 * document an equation the platform did not actually use.
 *
 * Every section is built as structured data first and rendered second, which is
 * what lets the same report come out as HTML, Markdown, LaTeX or JSON without
 * three copies of the prose drifting apart.
 */

const RSAReport = (function () {
  'use strict';

  /* ============================================================== assembly */

  function generate(ctx) {
    const t0 = Date.now();
    const bal = ctx.bal;
    const I = RSAIndicators;
    const prov = RSA.provenance();

    const report = {
      meta: {
        title: 'Rice Statistics for Africa — ' + bal.label,
        subtitle: bal.db + ' · ' + basisLabel(bal.basis) + ' basis',
        selection: bal.label,
        members: bal.members,
        database: bal.db,
        basis: bal.basis,
        period: { from: ctx.from, to: ctx.to },
        targetYear: ctx.targetYear,
        generated: new Date().toISOString(),
        platformVersion: RSA_VERSION,
        dataExtracted: prov.extracted
      },
      sections: []
    };

    const push = (id, title, blocks) => report.sections.push({ id: id, title: title, blocks: blocks });

    // ---- indicators used throughout
    const ind = {};
    ['production', 'area', 'yield', 'imports', 'exports', 'consumption', 'population',
     'ppc', 'cpc', 'ssr', 'idr', 'pcb', 'ntr', 'importBill', 'importUnitValue',
     'importBillPerCapita'].forEach(id => { ind[id] = I.compute(id, bal); });

    const desc = {};
    Object.keys(ind).forEach(k => { desc[k] = I.describe(ind[k], ctx.from, ctx.to); });

    /* -------------------------------------------------- executive summary */
    push('executive-summary', 'Executive summary', execSummary(bal, ind, desc, ctx));

    /* ------------------------------------------------- research objective */
    push('objective', 'Research objective', [
      { type: 'p', text:
        'This report assesses the state of rice self-sufficiency in ' + bal.label + ', ' +
        'characterises the structural drivers of the production–consumption gap, projects the ' +
        'trajectory of the balance sheet to ' + ctx.targetYear + ', and evaluates policy scenarios ' +
        'against the objective of raising the self-sufficiency ratio.' },
      { type: 'p', text:
        'It answers three questions in sequence. Where are we — what the observed statistics show. ' +
        'Where are we going — what current trends imply if nothing changes. What could be done — ' +
        'what combinations of area, productivity, variety adoption and trade policy would change ' +
        'the trajectory, at what cost and under what assumptions.' },
      { type: 'note', level: 'info', text:
        'The three questions are answered by three different kinds of statement — observation, ' +
        'projection and simulation — and this report labels which is which at every point. They ' +
        'carry very different evidential weight.' }
    ]);

    /* ------------------------------------------------------- data sources */
    push('data', 'Data sources', dataSection(bal, prov, ctx));

    /* --------------------------------------------------------- methodology */
    push('methodology', 'Methodology', methodologySection(bal, ind, ctx));

    /* --------------------------------------------------- historical trends */
    push('trends', 'Historical trends', trendsSection(bal, ind, desc, ctx));

    /* ------------------------------------------------------- self-sufficiency */
    push('self-sufficiency', 'Self-sufficiency and import dependency',
         ssrSection(bal, ind, desc, ctx));

    /* ---------------------------------------------------------- economy */
    push('economy', 'The rice economy', economySection(bal, ind, desc, ctx));

    /* --------------------------------------------------------- forecasting */
    if (ctx.forecast) push('forecast', 'Forecasting', forecastSection(ctx));

    /* ---------------------------------------------------------- scenarios */
    if (ctx.scenarios && ctx.scenarios.length) {
      push('scenarios', 'Policy scenarios', scenarioSection(ctx));
      push('comparison', 'Scenario comparison', comparisonSection(ctx));
    }
    if (ctx.optimization) push('least-cost', 'Least-cost path to self-sufficiency', optimizationSection(ctx));

    /* ---------------------------------------------------- recommendations */
    if (ctx.diagnosis) push('recommendations', 'Diagnosis and policy directions', diagnosisSection(ctx));

    /* ------------------------------------------------ risks and reproducibility */
    push('risks', 'Risks, uncertainty and limitations', risksSection(bal, ctx));
    push('reproducibility', 'Reproducibility', reproSection(bal, ctx, prov));

    report.meta.generationMs = Date.now() - t0;
    return report;
  }

  function basisLabel(b) {
    return b === 'asPublished' ? 'as-published (paddy production, milled trade)'
         : b === 'milled' ? 'milled equivalent'
         : 'paddy equivalent';
  }

  /* --------------------------------------------------------- sections ---- */

  function execSummary(bal, ind, desc, ctx) {
    const out = [];
    const ssrLast = desc.ssr.last, idrLast = desc.idr.last;
    const ppcLast = desc.ppc.last, cpcLast = desc.cpc.last;

    if (!ssrLast) {
      out.push({ type: 'p', text: 'No self-sufficiency figures can be computed for ' + bal.label +
        ' on the ' + bal.db + ' source within ' + ctx.from + '–' + ctx.to + '.' });
      return out;
    }

    const verdict = ssrLast.value >= 100
      ? 'is self-sufficient in rice on this measure'
      : ssrLast.value >= 80 ? 'is close to rice self-sufficiency'
      : ssrLast.value >= 50 ? 'meets most but not all of its rice needs domestically'
      : 'is substantially dependent on imported rice';

    out.push({ type: 'p', text:
      bal.label + ' ' + verdict + '. In ' + ssrLast.year + ' the self-sufficiency ratio was ' +
      f(ssrLast.value) + '%' + (idrLast ? ', with imports supplying ' + f(idrLast.value) +
      '% of apparent utilization' : '') + '. ' +
      (ppcLast && cpcLast
        ? 'Domestic production amounted to ' + f(ppcLast.value) + ' kg per person against apparent ' +
          'consumption of ' + f(cpcLast.value) + ' kg per person.'
        : '') });

    const kpis = [
      { label: 'Self-sufficiency ratio', value: f(ssrLast.value) + '%', year: ssrLast.year, kind: 'observed' },
      { label: 'Import dependency ratio', value: idrLast ? f(idrLast.value) + '%' : 'n/a', year: idrLast && idrLast.year, kind: 'observed' },
      { label: 'Per capita production', value: ppcLast ? f(ppcLast.value) + ' kg' : 'n/a', year: ppcLast && ppcLast.year, kind: 'observed' },
      { label: 'Per capita consumption', value: cpcLast ? f(cpcLast.value) + ' kg' : 'n/a', year: cpcLast && cpcLast.year, kind: 'observed' },
      { label: 'Production CAGR', value: desc.production.cagr != null ? f(desc.production.cagr) + '%/yr' : 'n/a', year: ctx.from + '–' + ctx.to, kind: 'observed' },
      { label: 'Consumption CAGR', value: desc.consumption.cagr != null ? f(desc.consumption.cagr) + '%/yr' : 'n/a', year: ctx.from + '–' + ctx.to, kind: 'observed' }
    ];
    out.push({ type: 'kpis', items: kpis });

    if (desc.production.cagr != null && desc.consumption.cagr != null) {
      const gap = desc.consumption.cagr - desc.production.cagr;
      out.push({ type: 'p', text: gap > 0
        ? 'Between ' + ctx.from + ' and ' + ctx.to + ' apparent consumption grew ' + f(desc.consumption.cagr) +
          '% a year against production growth of ' + f(desc.production.cagr) + '% a year. Demand is ' +
          'outpacing supply by ' + f(gap) + ' percentage points a year, so the gap widens on unchanged trends.'
        : 'Between ' + ctx.from + ' and ' + ctx.to + ' production grew ' + f(desc.production.cagr) +
          '% a year against consumption growth of ' + f(desc.consumption.cagr) + '% a year. Supply is ' +
          'growing faster than demand, and self-sufficiency is improving on unchanged trends.' });
    }

    if (ctx.forecast && ctx.forecast.ssrPath) {
      const cross = ctx.forecast.crossingYear;
      out.push({ type: 'finding', level: cross ? 'positive' : 'warning',
        title: cross ? 'Projected self-sufficiency year: ' + cross
                     : 'Self-sufficiency is not reached under the baseline trajectory by ' + ctx.targetYear,
        text: cross
          ? 'On the baseline projection the self-sufficiency ratio first reaches 100% in ' + cross +
            '. This is a projection of current trends with no policy change, and its uncertainty is wide.'
          : 'The baseline projection does not reach 100% by ' + ctx.targetYear + '. No crossing year is ' +
            'reported because the projection does not produce one.' });
    }

    bal.notes.forEach(n => out.push({ type: 'note', level: n.level, text: n.text }));
    return out;
  }

  function dataSection(bal, prov, ctx) {
    const out = [];
    out.push({ type: 'p', text:
      'This report draws on ' + bal.db + '. The two source databases the platform carries — FAOSTAT ' +
      'and USDA PSD — are never combined: they use different product bases, different reporting ' +
      'years and different estimation methods, and averaging them would conceal a disagreement that ' +
      'is itself informative.' });

    out.push({ type: 'table',
      caption: 'Source datasets, as extracted',
      columns: ['Database', 'Dataset', 'Items and elements', 'Published', 'URL'],
      rows: prov.sources.map(s => [s.db, s.dataset, s.items + '; ' + s.elements, s.published, s.url]) });

    out.push({ type: 'table',
      caption: 'Series used in this report',
      columns: ['Quantity', 'Source series', 'Unit', 'Basis'],
      rows: bal.dbKey === 'fao' ? (function () {
        const std = bal.tradeItem !== 31;
        const item = std ? 'item 30 "Rice, paddy (rice milled equivalent)"' : 'item 31 "Rice, milled"';
        const bs = std ? 'total rice, milled equivalent (incl. broken)' : 'milled only, excl. broken';
        return [
          ['Production', 'FAOSTAT item 27 "Rice", element 5510', 't', 'paddy (rough rice)'],
          ['Harvested area', 'FAOSTAT item 27, element 5312', 'ha', '—'],
          ['Yield', 'recomputed as production / area', 'kg/ha', 'follows production'],
          ['Imports', 'FAOSTAT ' + item + ', element 5610', 't', bs],
          ['Exports', 'FAOSTAT ' + item + ', element 5910', 't', bs],
          ['Import value', 'FAOSTAT ' + item + ', element 5622', '1000 USD', 'CIF, current prices'],
          ['Population', 'FAOSTAT element 511 (UN WPP)', 'persons', '—']
        ];
      })() : [
        ['Production', 'USDA PSD 0422110, attribute 028', '1000 t', 'milled'],
        ['Rough production', 'USDA PSD attribute 054', '1000 t', 'paddy'],
        ['Harvested area', 'USDA PSD attribute 004', '1000 ha', '—'],
        ['Imports', 'USDA PSD attribute 057', '1000 t', 'milled'],
        ['Exports', 'USDA PSD attribute 088', '1000 t', 'milled'],
        ['Domestic consumption', 'USDA PSD attribute 125', '1000 t', 'milled'],
        ['Stocks', 'USDA PSD attributes 020 / 176', '1000 t', 'milled'],
        ['Population', 'FAOSTAT element 511 (UN WPP)', 'persons', '—']
      ] });

    out.push({ type: 'note', level: 'info', text:
      'Data extracted ' + prov.extracted + '. Population is taken from FAOSTAT for both databases so ' +
      'that per-capita comparisons between them differ only in their rice numerator.' });

    if (prov.warnings && prov.warnings.length) {
      out.push({ type: 'note', level: 'warning', text: 'Pipeline warnings: ' + prov.warnings.join('; ') });
    }
    return out;
  }

  function methodologySection(bal, ind, ctx) {
    const out = [];
    out.push({ type: 'p', text:
      'Every indicator below is stated with its equation, the definition of each symbol, its unit, ' +
      'how it should be read and what it cannot support. The formulas for per capita production, per ' +
      'capita consumption, the import dependency ratio and the self-sufficiency ratio follow FAO ' +
      '(2001), Food Balance Sheets: A Handbook, as applied to Benin by Gassi, Gul & Cetin (2025).' });

    out.push({ type: 'h3', text: 'Product basis' });
    out.push({ type: 'p', text: basisExplanation(bal) });

    out.push({ type: 'h3', text: 'Indicator definitions' });
    const order = ['ppc', 'cpc', 'ssr', 'idr', 'icr', 'ntr', 'pcb', 'pcg', 'yield',
                   'importBill', 'importUnitValue'];
    order.forEach(id => {
      const d = RSAIndicators.get(id);
      if (!d) return;
      out.push({
        type: 'equation',
        id: id,
        label: d.label,
        equation: d.equation,
        latex: d.latex,
        unit: d.unit,
        variables: d.variables,
        interpretation: d.interpretation,
        limitations: d.limitations,
        source: d.source || null,
        note: d.note || null
      });
    });

    out.push({ type: 'h3', text: 'Aggregation' });
    out.push({ type: 'p', text:
      bal.members.length > 1
        ? 'Group figures are computed by summing member quantities and then forming the ratio, never ' +
          'by averaging member ratios. Yield is recomputed as total production over total area, so a ' +
          'small producer does not carry the same weight as a large one. Countries with no ' +
          'observation in a year contribute nothing to that year rather than being imputed; the ' +
          'number of reporting members is tracked per year.'
        : 'Single-country selection; no aggregation applied.' });

    if (ctx.forecast) {
      out.push({ type: 'h3', text: 'Forecasting method' });
      out.push({ type: 'p', text:
        'Forecasts follow the Box–Jenkins procedure: test for stationarity, difference as required, ' +
        'identify candidate orders from the autocorrelation and partial autocorrelation functions, ' +
        'estimate by conditional sum of squares, check residuals for white noise with the Ljung–Box ' +
        'statistic, and select on information criteria among the models that pass. Because the data ' +
        'are annual there is no seasonal cycle to model and no seasonal ARIMA is ever fitted.' });
      out.push({ type: 'equation', id: 'arima', label: 'ARIMA(p, d, q)',
        equation: 'phi(B) (1 - B)^d y_t = c + theta(B) e_t',
        latex: '\\phi(B)\\,(1-B)^d y_t = c + \\theta(B)\\,\\varepsilon_t',
        unit: '—',
        variables: [
          { sym: 'y_t', def: 'the series at time t', unit: 'series unit' },
          { sym: 'B', def: 'backshift operator, B y_t = y_{t-1}', unit: '—' },
          { sym: 'phi(B)', def: 'autoregressive operator of order p', unit: '—' },
          { sym: 'theta(B)', def: 'moving-average operator of order q', unit: '—' },
          { sym: '(1-B)^d', def: 'differencing operator of order d', unit: '—' },
          { sym: 'e_t', def: 'white-noise innovation at time t', unit: 'series unit' },
          { sym: 'c', def: 'constant; when d > 0 this is a drift term', unit: 'series unit' }
        ],
        interpretation: 'Combines regression on the series own past values with regression on past ' +
          'forecast errors, after differencing away any unit root.',
        limitations: 'Univariate. It carries no information about prices, weather, policy or anything ' +
          'else outside the series own history, and it assumes the process that generated the past ' +
          'continues to generate the future.',
        source: 'Box & Jenkins (1970); applied to Benin rice by Gassi, Gul & Cetin (2025), eq. 5' });

      out.push({ type: 'equation', id: 'interval', label: 'Prediction interval',
        equation: 'y_{T+h} in yhat_{T+h} +/- z_{alpha/2} sigma sqrt( sum_{j=0}^{h-1} psi_j^2 )',
        latex: '\\hat{y}_{T+h} \\pm z_{\\alpha/2}\\,\\sigma\\sqrt{\\textstyle\\sum_{j=0}^{h-1}\\psi_j^2}',
        unit: 'series unit',
        variables: [
          { sym: 'psi_j', def: 'MA(inf) weights of the fitted model on the level scale', unit: '—' },
          { sym: 'sigma', def: 'innovation standard deviation', unit: 'series unit' },
          { sym: 'z', def: 'standard normal quantile', unit: '—' }
        ],
        interpretation: 'The band within which the realised value would fall with the stated ' +
          'probability, if the model is correct.',
        limitations: 'Captures innovation uncertainty only. Parameter uncertainty, model-selection ' +
          'uncertainty and structural change are all excluded, so realised coverage over long ' +
          'horizons is materially lower than the nominal level.' });
    }

    if (ctx.scenarios && ctx.scenarios.length) {
      out.push({ type: 'h3', text: 'Scenario construction' });
      out.push({ type: 'p', text:
        'The baseline is built structurally rather than by extrapolating production and consumption ' +
        'separately: production is area times yield, consumption is per-capita consumption times ' +
        'population, and population comes from the UN World Population Prospects projection rather ' +
        'than from any model fitted here. Each policy lever then acts on the component it actually ' +
        'touches.' });

      const ramp = (ctx.rampModel && RSAScenarios.RAMPS[ctx.rampModel]) || RSAScenarios.RAMPS.linear;
      out.push({ type: 'p', text:
        'Every scenario is reported at ' + RSAScenarios.HORIZONS.join(', ') + '. Interventions phase ' +
        'in from the start of the projection to ' + (ctx.rampTo || ctx.targetYear) + ' under a ' +
        ramp.label.toLowerCase() + ' model, then hold at full intensity. ' + ramp.note });
      out.push({ type: 'equation', id: 'ramp', label: 'Phase-in',
        equation: 'r_t = g( (t - t_0) / (T - t_0) ),  applied as X\'_t = X_t (1 + delta x r_t)',
        latex: 'r_t = g\\!\\left(\\frac{t-t_0}{T-t_0}\\right),\\qquad X\'_t = X_t\\,(1+\\delta r_t)',
        unit: '—',
        variables: [
          { sym: 'r_t', def: 'fraction of the intervention in place at time t', unit: '—' },
          { sym: 't_0', def: 'first projected year', unit: 'year' },
          { sym: 'T', def: 'year the intervention is fully phased in', unit: 'year' },
          { sym: 'g', def: 'phase-in model: ' + Object.keys(RSAScenarios.RAMPS)
              .map(k => RSAScenarios.RAMPS[k].label).join(', '), unit: '—' },
          { sym: 'delta', def: 'full intensity of the lever', unit: '—' }
        ],
        interpretation: 'How fast a policy arrives, separated from how large it is. The two are ' +
          'independent choices and the platform makes both explicit.',
        limitations: 'A deterministic shape imposed by the analyst. Real programmes are lumpy, ' +
          'stall, and are re-budgeted; none of that is modelled.' });
      out.push({ type: 'equation', id: 'baseline', label: 'Baseline identity',
        equation: 'P_t = A_t x Y_t ;  C_t = cpc_t x N_t ;  SSR_t = 100 P_t / C_t',
        latex: 'P_t = A_t Y_t,\\quad C_t = \\mathrm{cpc}_t N_t,\\quad SSR_t = 100\\frac{P_t}{C_t}',
        unit: '—',
        variables: [
          { sym: 'A_t', def: 'projected harvested area', unit: 'ha' },
          { sym: 'Y_t', def: 'projected yield', unit: 'kg/ha' },
          { sym: 'cpc_t', def: 'projected per capita consumption', unit: 'kg/capita' },
          { sym: 'N_t', def: 'UN projected population', unit: 'persons' }
        ],
        interpretation: 'The accounting frame every scenario modifies.',
        limitations: 'A projection under no policy change, not a prediction.' });

      ctx.scenarios.forEach(sc => {
        out.push({ type: 'equation', id: 'sc-' + sc.id, label: 'Scenario: ' + sc.label,
          equation: sc.equations.join(' ;  '),
          latex: null, unit: '—',
          variables: leverVariables(sc),
          interpretation: sc.description,
          limitations: sc.disclaimer });
      });
    }

    if (ctx.optimization) {
      out.push({ type: 'h3', text: 'Optimisation problem' });
      out.push({ type: 'equation', id: 'opt', label: 'Least-cost path',
        equation: 'min K(g_A, a, g_Y) subject to SSR(' + ctx.targetYear + ') >= ' +
                  ctx.optimization.target + '%, 0 <= g_A <= g_A^max, 0 <= a <= a^max, 0 <= g_Y <= g_Y^max',
        latex: '\\min_{g_A,a,g_Y} K \\quad \\text{s.t.}\\quad SSR_{' + ctx.targetYear + '} \\ge ' +
               ctx.optimization.target + '\\%',
        unit: 'USD',
        variables: [
          { sym: 'g_A', def: 'proportional area expansion', unit: '—' },
          { sym: 'a', def: 'improved-variety adoption rate', unit: '—' },
          { sym: 'g_Y', def: 'proportional yield improvement', unit: '—' },
          { sym: 'K', def: 'total programme cost', unit: 'USD' }
        ],
        interpretation: ctx.optimization.objective,
        limitations: 'Solved by grid search with local refinement over assumed unit costs. The unit ' +
          'costs are placeholders, so the composition of the optimal package is more informative ' +
          'than its price.' });
    }
    return out;
  }

  function leverVariables(sc) {
    const v = [];
    if (sc.levers.areaExpansion) v.push({ sym: 'g_A', def: 'proportional area expansion', unit: '—' });
    if (sc.levers.adoptionRate) {
      v.push({ sym: 'a_t', def: 'improved-variety adoption rate at time t', unit: '—' });
      v.push({ sym: 'delta_Y', def: 'yield gain per adopting hectare (assumption)', unit: '—' });
    }
    if (sc.levers.yieldImprovement) v.push({ sym: 'g_Y', def: 'proportional yield improvement', unit: '—' });
    if (sc.tariff) {
      v.push({ sym: 'tau', def: 'ad valorem import tariff', unit: '—' });
      v.push({ sym: 'rho', def: 'price pass-through to domestic prices (assumption)', unit: '—' });
      v.push({ sym: 'eps_S', def: 'supply elasticity (assumption)', unit: '—' });
      v.push({ sym: 'eps_D', def: 'demand elasticity (assumption)', unit: '—' });
    }
    v.push({ sym: 'r_t', def: 'linear phase-in from the start year to the target year', unit: '—' });
    return v;
  }

  function basisExplanation(bal) {
    if (bal.dbKey !== 'fao') {
      return 'USDA PSD reports production, trade, consumption and stocks on a common milled basis, ' +
             'so no conversion is required for unit consistency. Note that USDA years are market ' +
             'years, not calendar years, and are not directly comparable to FAOSTAT.';
    }
    if (bal.basis === 'asPublished') {
      return 'Figures are computed AS PUBLISHED: FAOSTAT paddy production against FAOSTAT milled ' +
             'rice trade, with no conversion between them. This reproduces Gassi, Gul & Cetin (2025) ' +
             'and the majority of the FAOSTAT-based rice literature. It is not unit-consistent — ' +
             'paddy and milled rice are different commodities — and because paddy overstates the ' +
             'edible quantity, the self-sufficiency ratio computed this way is biased UPWARD. ' +
             'The milled basis gives the unit-consistent figure.';
    }
    if (bal.basis === 'milled') {
      return 'Paddy production has been converted to milled equivalent at a milling rate of ' +
             bal.millingRate.toFixed(2) + ' before any ratio was taken, so production and trade are ' +
             'the same commodity. This is unit-consistent and yields a lower, more conservative ' +
             'self-sufficiency ratio than the as-published convention. Actual milling outturn varies ' +
             'with variety, moisture and mill technology.';
    }
    return 'Milled trade has been converted up to paddy equivalent at a milling rate of ' +
           bal.millingRate.toFixed(2) + ', expressing the whole balance sheet at farm-gate weight. ' +
           'Unit-consistent; appropriate when the question concerns land and farm output.';
  }

  function trendsSection(bal, ind, desc, ctx) {
    const out = [];
    const rows = [];
    [['Production', 'production', 't'], ['Harvested area', 'area', 'ha'], ['Yield', 'yield', 'kg/ha'],
     ['Imports', 'imports', 't'], ['Exports', 'exports', 't'], ['Apparent consumption', 'consumption', 't'],
     ['Population', 'population', 'persons']].forEach(([label, id, unit]) => {
      const d = desc[id];
      if (!d || !d.first) return;
      rows.push([label, unit,
        d.first.year + ': ' + f(d.first.value, 0),
        d.last.year + ': ' + f(d.last.value, 0),
        d.cagr != null ? f(d.cagr) + '%' : 'n/a',
        d.max ? d.max.year + ' (' + f(d.max.value, 0) + ')' : 'n/a']);
    });
    out.push({ type: 'table', caption: 'Structural indicators, ' + ctx.from + '–' + ctx.to,
      columns: ['Quantity', 'Unit', 'First observed', 'Last observed', 'CAGR', 'Peak'], rows: rows });

    out.push({ type: 'chart', chart: 'production-consumption', title: 'Production and apparent consumption' });
    out.push({ type: 'chart', chart: 'area-yield', title: 'Harvested area and yield' });

    if (desc.yield.cagr != null && desc.area.cagr != null) {
      out.push({ type: 'p', text:
        'Between ' + ctx.from + ' and ' + ctx.to + ' harvested area grew ' + f(desc.area.cagr) +
        '% a year and yield ' + f(desc.yield.cagr) + '% a year. ' +
        (desc.area.cagr > desc.yield.cagr
          ? 'Growth has come predominantly from expanding land rather than from raising productivity, ' +
            'which is the more land- and capital-hungry of the two routes and cannot continue indefinitely.'
          : 'Growth has come predominantly from rising productivity rather than from expanding land, ' +
            'which is the more sustainable of the two routes.') });
    }
    return out;
  }

  function ssrSection(bal, ind, desc, ctx) {
    const out = [];
    out.push({ type: 'chart', chart: 'ssr-idr', title: 'Self-sufficiency and import dependency' });

    // The paper's own presentation: a five-year table.
    const years = pickYears(ind.ssr, ctx.from, ctx.to, 6);
    out.push({ type: 'table',
      caption: 'Indicators of rice self-sufficiency in ' + bal.label,
      columns: ['Year', 'PPC (kg/capita)', 'CPC (kg/capita)', 'IDR (%)', 'SSR (%)'],
      rows: years.map(y => {
        const i = ind.ssr.years.indexOf(y);
        return [y, f(ind.ppc.values[i]), f(ind.cpc.values[i]), f(ind.idr.values[i]), f(ind.ssr.values[i])];
      }) });

    const last = desc.ssr.last;
    if (last) {
      out.push({ type: 'p', text:
        'The self-sufficiency ratio ' +
        (desc.ssr.first && desc.ssr.first.value != null
          ? 'moved from ' + f(desc.ssr.first.value) + '% in ' + desc.ssr.first.year + ' to ' +
            f(last.value) + '% in ' + last.year
          : 'stood at ' + f(last.value) + '% in ' + last.year) + '. ' +
        (last.value < 100
          ? 'An SSR below 100% means domestic production does not cover apparent utilization; the ' +
            'shortfall is met from imports or from stocks.'
          : 'An SSR at or above 100% means domestic production covers apparent utilization.') });
    }

    ind.idr.flags.forEach(fl => out.push({ type: 'note', level: fl.level, text: fl.text }));

    out.push({ type: 'note', level: 'info', text:
      'Self-sufficiency is not the same thing as food security. A country can be fully self-sufficient ' +
      'and still have households unable to afford rice, and a low-SSR country with reliable export ' +
      'earnings and functioning markets may be entirely food-secure. SSR measures the source of ' +
      'supply, not access to it (Clapp 2017).' });
    return out;
  }

  function economySection(bal, ind, desc, ctx) {
    const out = [];
    if (!desc.importBill.last) {
      out.push({ type: 'p', text: 'Trade values are not available for this selection. FAOSTAT ' +
        'publishes rice import and export values; USDA PSD publishes quantities only.' });
      return out;
    }
    const bill = desc.importBill.last;
    let cum = 0, n = 0;
    ind.importBill.values.forEach((v, i) => {
      const y = ind.importBill.years[i];
      if (v != null && y >= ctx.from && y <= ctx.to) { cum += v; n++; }
    });

    out.push({ type: 'p', text:
      bal.label + ' spent ' + usd(bill.value) + ' on rice imports in ' + bill.year +
      (desc.importBillPerCapita.last
        ? ', equivalent to $' + f(desc.importBillPerCapita.last.value, 2) + ' per inhabitant' : '') +
      '. Over ' + ctx.from + '–' + ctx.to + ' the cumulative rice import bill was ' + usd(cum) +
      ' across ' + n + ' years with data.' });

    out.push({ type: 'kpis', items: [
      { label: 'Rice import bill', value: usd(bill.value), year: bill.year, kind: 'observed' },
      { label: 'Cumulative bill', value: usd(cum), year: ctx.from + '–' + ctx.to, kind: 'observed' },
      { label: 'Import unit value', value: desc.importUnitValue.last
          ? '$' + f(desc.importUnitValue.last.value, 0) + '/t' : 'n/a',
        year: desc.importUnitValue.last && desc.importUnitValue.last.year, kind: 'observed' },
      { label: 'Bill per capita', value: desc.importBillPerCapita.last
          ? '$' + f(desc.importBillPerCapita.last.value, 2) : 'n/a',
        year: desc.importBillPerCapita.last && desc.importBillPerCapita.last.year, kind: 'observed' }
    ] });

    out.push({ type: 'chart', chart: 'import-bill', title: 'What rice imports cost' });
    out.push({ type: 'note', level: 'warning', text:
      'All values are in current US dollars and are not deflated, so part of any upward trend is ' +
      'world price inflation rather than rising volume. The unit value is an average across grades ' +
      'and qualities; it is not a price quotation and it moves when the import mix changes.' });
    return out;
  }

  function forecastSection(ctx) {
    const out = [];
    const F = ctx.forecast;

    // Anything that makes the projection unreliable is stated before the
    // projection itself, not in a footnote after it.
    if (ctx.baseline && ctx.baseline.warnings) {
      ctx.baseline.warnings.forEach(w => out.push({ type: 'note', level: w.level, text: w.text }));
    }
    if (ctx.baseline && ctx.baseline.reliable === false) {
      out.push({ type: 'finding', level: 'warning',
        title: 'The baseline for this selection is not reliable',
        text: 'The projected per-capita consumption path had to be capped at a plausibility ceiling. ' +
              'Where that happens the projection is being driven by a distortion in the trade ' +
              'statistics rather than by a dietary trend, and the forecast, the scenarios and the ' +
              'least-cost package below should all be read as illustrative of the method rather than ' +
              'as findings about this country.' });
    }

    out.push({ type: 'p', text:
      'Forecasts run to ' + ctx.targetYear + '. Each component series was tested for stationarity, ' +
      'differenced as required, and fitted across a grid of ARIMA orders; models whose residuals ' +
      'failed the Ljung–Box test were excluded before selection on information criteria.' });

    if (F.tests && F.tests.length) {
      out.push({ type: 'table', caption: 'Unit root tests',
        columns: ['Series', 'Test', 'Specification', 'Statistic', '5% critical', 'Conclusion'],
        rows: F.tests.map(t => [t.series, t.test, t.specLabel, f(t.statistic, 3),
                                f(t.critical['5'], 3), t.rejects5 ? 'stationary' : 'unit root not rejected']) });
    }

    if (F.models && F.models.length) {
      out.push({ type: 'table', caption: 'Selected models and diagnostics',
        columns: ['Series', 'Model', 'sigma^2', 'log L', 'AIC', 'BIC', 'HQIC', 'Ljung–Box p', 'RMSE'],
        rows: F.models.map(m => [m.series, m.label, sci(m.sigma2), f(m.logLik, 1), f(m.aic, 2),
                                 f(m.bic, 2), f(m.hqic, 2),
                                 m.ljungBox && m.ljungBox.pValue != null ? f(m.ljungBox.pValue, 3) : 'n/a',
                                 m.accuracy ? f(m.accuracy.rmse, 1) : 'n/a']) });
    }

    if (F.candidates && F.candidates.length) {
      out.push({ type: 'table', caption: 'Candidate models considered (top by AIC)',
        columns: ['Model', 'AIC', 'BIC', 'HQIC', 'Ljung–Box p', 'Residuals white noise'],
        rows: F.candidates.slice(0, 10).map(c => [c.label, f(c.aic, 2), f(c.bic, 2), f(c.hqic, 2),
          c.ljungBox && c.ljungBox.pValue != null ? f(c.ljungBox.pValue, 3) : 'n/a',
          c.adequate ? 'yes' : 'no']) });
    }

    out.push({ type: 'chart', chart: 'forecast-ssr', title: 'Projected self-sufficiency ratio' });

    out.push({ type: 'finding',
      level: F.crossingYear ? 'positive' : 'warning',
      title: F.crossingYear
        ? 'Projected self-sufficiency year: ' + F.crossingYear
        : 'Self-sufficiency is not reached under the baseline trajectory by ' + ctx.targetYear,
      text: F.crossingYear
        ? 'The projected SSR path first reaches 100% in ' + F.crossingYear + '.'
        : 'The projected SSR path does not reach 100% within the horizon. No crossing year is stated ' +
          'because none is produced by the projection.' });

    if (F.backtest) {
      out.push({ type: 'table', caption: 'Out-of-sample performance (rolling origin)',
        columns: ['Series', 'Model RMSE', 'Benchmark RMSE', 'Skill vs random walk with drift'],
        rows: F.backtest.map(b => [b.series,
          b.model ? f(b.model.rmse, 1) : 'n/a',
          b.benchmark ? f(b.benchmark.rmse, 1) : 'n/a',
          b.skill != null ? f(100 * b.skill, 1) + '%' : 'n/a']) });
      out.push({ type: 'note', level: 'info', text:
        'Negative skill means the fitted model did not beat a random walk with drift out of sample. ' +
        'Where that is the case the benchmark should be preferred and the ARIMA treated as ' +
        'descriptive rather than predictive.' });
    }

    out.push({ type: 'note', level: 'warning', text:
      'Prediction intervals reflect innovation uncertainty only. They exclude parameter uncertainty, ' +
      'uncertainty about which model is right, and the possibility that the underlying process ' +
      'changes — which over a 25-year horizon is close to a certainty rather than a risk. Realised ' +
      'coverage is therefore lower, often much lower, than the nominal 80% or 95%.' });
    return out;
  }

  function scenarioSection(ctx) {
    const out = [];
    out.push({ type: 'note', level: 'warning', text:
      'Everything in this section is a SIMULATION under stated assumptions. None of it is a ' +
      'prediction, and none of it is causal evidence about what a policy would achieve. The value ' +
      'lies in making the arithmetic and the assumptions explicit and auditable.' });

    ctx.scenarios.forEach(sc => {
      out.push({ type: 'h3', text: sc.label });
      out.push({ type: 'p', text: sc.description });
      out.push({ type: 'kpis', items: [
        { label: 'SSR at ' + ctx.targetYear, value: f(sc.summary.ssr) + '%', kind: 'scenario' },
        { label: 'Change vs baseline', value: sig(sc.summary.ssrChange) + ' pp', kind: 'scenario' },
        { label: 'Production', value: tonnes(sc.summary.production), kind: 'scenario' },
        { label: 'Import saving', value: tonnes(sc.summary.importSaving), kind: 'scenario' },
        { label: 'Estimated cost', value: usdRaw(sc.summary.cost), kind: 'assumption' },
        { label: 'Feasibility', value: sc.feasibility ? sc.feasibility.level : 'n/a', kind: 'assumption' }
      ] });
      out.push({ type: 'code', text: sc.equations.join('\n') });

      if (sc.horizons && sc.horizons.length) {
        out.push({ type: 'table', caption: sc.label + ' — results at each horizon',
          columns: ['Year', 'Phase-in', 'SSR (%)', 'Baseline SSR (%)', 'Change (pp)',
                    'Production', 'Imports', 'Import saving', 'Self-sufficient'],
          rows: sc.horizons.map(r => r.available
            ? [r.year, pc(r.phaseIn), f(r.ssr), f(r.ssrBaseline), sig(r.ssrChange),
               tonnes(r.production), tonnes(r.imports), tonnes(r.importSaving),
               r.selfSufficient ? 'yes' : 'no']
            : [r.year, '—', '—', '—', '—', '—', '—', '—', '—']) });
      }

      (sc.warnings || []).forEach(w => out.push({ type: 'note', level: w.level, text: w.text }));
      if (sc.consumerImpact) {
        out.push({ type: 'note', level: 'warning', text: sc.consumerImpact.note });
      }
    });

    // One matrix across every scenario and horizon.
    const matrix = [];
    ctx.scenarios.forEach(sc => (sc.horizons || []).forEach(r => {
      if (!r.available) return;
      matrix.push([sc.label, r.year, f(r.ssr), sig(r.ssrChange), f(r.idr),
                   tonnes(r.production), tonnes(r.imports), tonnes(r.importSaving),
                   r.selfSufficient ? 'yes' : 'no']);
    }));
    if (matrix.length) {
      out.push({ type: 'table', caption: 'All scenarios at all horizons',
        columns: ['Scenario', 'Year', 'SSR (%)', 'vs baseline (pp)', 'IDR (%)', 'Production',
                  'Imports', 'Import saving', 'Self-sufficient'],
        rows: matrix });
    }
    return out;
  }

  function comparisonSection(ctx) {
    const out = [];
    const cmp = RSAScenarios.compare(ctx.scenarios);
    out.push({ type: 'table', caption: 'Scenario comparison at ' + ctx.targetYear,
      columns: ['Scenario', 'Area change', 'Yield change', 'Adoption', 'Tariff', 'Imports',
                'SSR (%)', 'IDR (%)', 'Cost', 'Feasibility'],
      rows: cmp.map(c => [c.scenario,
        c.areaChange != null ? pc(c.areaChange) : '—',
        c.yieldChange != null ? pc(c.yieldChange) : '—',
        c.adoption ? pc(c.adoption) : '—',
        c.tariff ? pc(c.tariff) : '—',
        tonnes(c.imports), f(c.ssr), f(c.idr), usdRaw(c.cost),
        c.feasibility ? c.feasibility.level : '—']) });

    if (ctx.ranking) {
      out.push({ type: 'h3', text: 'Policy score' });
      out.push({ type: 'table', caption: 'Multi-criteria ranking',
        columns: ['Rank', 'Scenario', 'Score', 'SSR gain', 'Import reduction', 'Cost',
                  'Feasibility', 'Environment', 'Consumer welfare'],
        rows: ctx.ranking.map(r => [r.rank, r.score.scenario, f(r.score.total, 1),
          f(r.score.components.ssrGain, 0), f(r.score.components.importReduction, 0),
          f(r.score.components.cost, 0), f(r.score.components.feasibility, 0),
          f(r.score.components.environment, 0), f(r.score.components.consumerWelfare, 0)]) });
      const w = ctx.ranking[0].score.weights;
      out.push({ type: 'p', text: 'Weights: ' +
        Object.keys(w).map(k => k + ' ' + (100 * w[k]).toFixed(0) + '%').join(', ') + '.' });
      ctx.ranking[0].score.caveats.forEach(c => out.push({ type: 'note', level: 'info', text: c }));
    }

    out.push({ type: 'chart', chart: 'scenario-ssr', title: 'SSR by scenario' });
    out.push({ type: 'chart', chart: 'cost-effectiveness', title: 'Cost against SSR gain' });
    return out;
  }

  function optimizationSection(ctx) {
    const out = [];
    const o = ctx.optimization;
    if (!o.ok) {
      out.push({ type: 'finding', level: 'warning', title: 'No feasible least-cost package',
        text: o.reason + (o.bestAttainable
          ? ' The most ambitious package within the constraints reaches SSR ' +
            f(o.bestAttainable.ssr) + '%, at an estimated ' + usdRaw(o.bestAttainable.cost) + '.'
          : '') });
      out.push({ type: 'p', text: 'Constraints applied: area expansion at most ' +
        pc(o.constraints.maxArea) + ', adoption at most ' + pc(o.constraints.maxAdoption) +
        ', yield improvement at most ' + pc(o.constraints.maxYield) + '. Land ceiling: ' +
        o.constraints.landCeiling.source + '.' });
      return out;
    }
    const s = o.solution;
    out.push({ type: 'p', text: 'Minimising total programme cost subject to reaching SSR ' +
      o.target + '% by ' + ctx.targetYear + ', the cheapest admissible combination is:' });
    out.push({ type: 'kpis', items: [
      { label: 'Area expansion', value: pc(s.areaExpansion), kind: 'scenario' },
      { label: 'Improved-variety adoption', value: pc(s.adoptionRate), kind: 'scenario' },
      { label: 'Yield improvement', value: pc(s.yieldImprovement), kind: 'scenario' },
      { label: 'Resulting SSR', value: f(s.ssr) + '%', kind: 'scenario' },
      { label: 'Estimated cost', value: usdRaw(s.cost), kind: 'assumption' }
    ] });
    out.push({ type: 'table', caption: 'Cost breakdown',
      columns: ['Component', 'Cost (USD)'],
      rows: Object.keys(s.costParts).map(k => [k, usdRaw(s.costParts[k])]) });
    out.push({ type: 'table', caption: 'Unit cost assumptions',
      columns: ['Parameter', 'Value (USD)'],
      rows: Object.keys(o.costAssumptions).map(k => [k, o.costAssumptions[k].toLocaleString()]) });
    out.push({ type: 'note', level: 'warning', text: o.disclaimer });
    out.push({ type: 'p', text: 'Search evaluated ' + o.evaluated + ' candidate packages.' });
    return out;
  }

  function diagnosisSection(ctx) {
    const out = [];
    const d = ctx.diagnosis;
    out.push({ type: 'p', text: d.method });
    d.findings.forEach(fd => out.push({ type: 'finding', level: fd.severity === 'high' ? 'warning'
      : fd.severity === 'positive' ? 'positive' : 'info', title: fd.title, text: fd.text,
      meta: 'rule: ' + fd.ruleId + ' — fires when ' + fd.condition }));
    if (d.recommendations.length) {
      out.push({ type: 'h3', text: 'Policy directions indicated' });
      out.push({ type: 'list', items: d.recommendations.map(r => r.label + ' — ' + r.detail) });
    }
    out.push({ type: 'note', level: 'warning', text: d.caveat });
    return out;
  }

  function risksSection(bal, ctx) {
    const out = [];
    out.push({ type: 'h3', text: 'What each kind of number in this report can bear' });
    out.push({ type: 'table', caption: 'Evidential status by statement type',
      columns: ['Type', 'What it is', 'What it can support'],
      rows: [
        ['Observed', 'A value reported by FAOSTAT or USDA', 'Description of the past, subject to the ' +
         'quality of national statistics'],
        ['Estimated', 'A value derived from observed values by an identity', 'The same weight as its ' +
         'inputs, no more'],
        ['Forecast', 'A model extrapolation with an interval', 'What current trends imply if nothing ' +
         'changes; NOT what will happen'],
        ['Scenario', 'An arithmetic consequence of an assumption', 'Exploration of possibilities; ' +
         'NOT a prediction and NOT causal evidence'],
        ['Assumption', 'A parameter chosen by the analyst', 'Nothing on its own; it must be justified ' +
         'externally']
      ] });

    out.push({ type: 'h3', text: 'Principal limitations' });
    out.push({ type: 'list', items: [
      'Apparent consumption (P + M − X) is not measured intake. It absorbs stock change, seed, feed, ' +
      'industrial use and waste, and it inherits every error in the production and trade statistics.',
      'Unrecorded cross-border trade is substantial in West Africa. Where re-export goes unrecorded, ' +
      'apparent consumption and per-capita consumption are overstated and SSR is understated.',
      bal.dbKey === 'fao' && bal.basis === 'asPublished'
        ? 'On the as-published basis, paddy production is compared with milled trade. The ratio is not ' +
          'unit-consistent and SSR is biased upward.'
        : 'The milling rate used for basis conversion is a single assumed figure; true outturn varies ' +
          'by variety, moisture and mill.',
      'Forecasts are univariate. They contain no information about prices, weather, conflict or policy.',
      'Scenario cost parameters are placeholders, not national costings.',
      'Tariff simulations use illustrative elasticities and model no market structure, no informal ' +
      'trade and no general-equilibrium feedback.',
      'Environmental consequences of area expansion — land-use change emissions, paddy methane, ' +
      'biodiversity, water — are not modelled at all.',
      'Distributional effects are not modelled. A policy that raises SSR may make rice less ' +
      'affordable for the poorest households.'
    ] });

    if (ctx.quality) {
      out.push({ type: 'h3', text: 'Data quality' });
      out.push({ type: 'table', caption: 'Quality score for this selection',
        columns: ['Component', 'Score', 'Weight'],
        rows: Object.keys(ctx.quality.components).map(k =>
          [k, f(100 * ctx.quality.components[k], 0), (100 * ctx.quality.weights[k]).toFixed(0) + '%'])
          .concat([['TOTAL', ctx.quality.score, '100%']]) });
    }
    return out;
  }

  function reproSection(bal, ctx, prov) {
    const manifest = buildManifest(bal, ctx, prov);
    return [
      { type: 'p', text: 'Everything needed to regenerate this report exactly is recorded below. ' +
        'The platform stores no hidden state: the same selection, basis, period and parameters ' +
        'against the same data version reproduce the same numbers.' },
      { type: 'table', caption: 'Reproducibility manifest',
        columns: ['Field', 'Value'],
        rows: Object.keys(manifest).map(k => [k, typeof manifest[k] === 'object'
          ? JSON.stringify(manifest[k]) : String(manifest[k])]) },
      { type: 'note', level: 'info', text:
        'To rebuild the underlying data from the official sources, run tools/build-data.ps1. It ' +
        'downloads from FAOSTAT and USDA PSD, records the publication date of each archive, and ' +
        'writes the JSON files this platform reads.' }
    ];
  }

  function buildManifest(bal, ctx, prov) {
    return {
      platform: 'Rice Statistics for Africa',
      version: RSA_VERSION,
      generated: new Date().toISOString(),
      dataExtracted: prov.extracted,
      sources: prov.sources.map(s => s.db + ' | ' + s.dataset + ' | published ' + s.published),
      database: bal.db,
      selection: bal.label,
      members: bal.members.join(','),
      basis: bal.basis,
      millingRate: bal.millingRate,
      periodFrom: ctx.from,
      periodTo: ctx.to,
      targetYear: ctx.targetYear,
      consumptionMethod: bal.consumptionMethod,
      scenarioAssumptions: ctx.assumptions || RSAScenarios.DEFAULTS,
      forecastCriterion: ctx.criterion || 'aic'
    };
  }

  function pickYears(res, from, to, n) {
    const avail = [];
    for (let i = 0; i < res.years.length; i++) {
      if (res.values[i] == null) continue;
      if (from != null && res.years[i] < from) continue;
      if (to != null && res.years[i] > to) continue;
      avail.push(res.years[i]);
    }
    if (avail.length <= n) return avail;
    const out = [];
    for (let i = 0; i < n - 1; i++) out.push(avail[Math.floor(i * (avail.length - 1) / (n - 1))]);
    out.push(avail[avail.length - 1]);
    return out.filter((v, i, a) => a.indexOf(v) === i);
  }

  /* ------------------------------------------------------------ formatting */

  function f(x, dp) {
    if (x == null || !isFinite(x)) return 'n/a';
    return Number(x).toLocaleString(undefined, {
      minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp });
  }
  function sig(x) { return x == null ? 'n/a' : (x > 0 ? '+' : '') + f(x); }
  function pc(x) { return x == null ? '—' : (x * 100).toFixed(1) + '%'; }
  function sci(x) { return x == null ? 'n/a' : Number(x).toExponential(2); }
  function tonnes(x) {
    if (x == null || !isFinite(x)) return 'n/a';
    if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2) + ' Mt';
    if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(0) + ' kt';
    return Math.round(x) + ' t';
  }
  function usd(x) {   // series in 1000 USD
    if (x == null || !isFinite(x)) return 'n/a';
    return usdRaw(x * 1000);
  }
  function usdRaw(x) {
    if (x == null || !isFinite(x)) return 'n/a';
    if (Math.abs(x) >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'bn';
    if (Math.abs(x) >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'm';
    if (Math.abs(x) >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'k';
    return '$' + Math.round(x);
  }

  /* ================================================================ export */

  function toMarkdown(report) {
    const L = [];
    L.push('# ' + report.meta.title);
    L.push('');
    L.push('*' + report.meta.subtitle + '*  ');
    L.push('Generated ' + report.meta.generated + ' · data extracted ' + report.meta.dataExtracted);
    L.push('');
    report.sections.forEach(s => {
      L.push('## ' + s.title);
      L.push('');
      s.blocks.forEach(b => L.push(blockToMarkdown(b)));
      L.push('');
    });
    return L.join('\n');
  }

  function blockToMarkdown(b) {
    switch (b.type) {
      case 'h3': return '### ' + b.text + '\n';
      case 'p': return b.text + '\n';
      case 'note': return '> **' + b.level.toUpperCase() + '** — ' + b.text + '\n';
      case 'finding': return '> ### ' + b.title + '\n> ' + b.text + '\n' +
        (b.meta ? '> \n> *' + b.meta + '*\n' : '');
      case 'list': return b.items.map(i => '- ' + i).join('\n') + '\n';
      case 'code': return '```\n' + b.text + '\n```\n';
      case 'kpis': return '| Indicator | Value | Period | Status |\n|---|---|---|---|\n' +
        b.items.map(i => '| ' + i.label + ' | ' + i.value + ' | ' + (i.year || '') + ' | ' + i.kind + ' |').join('\n') + '\n';
      case 'table': return (b.caption ? '**' + b.caption + '**\n\n' : '') +
        '| ' + b.columns.join(' | ') + ' |\n|' + b.columns.map(() => '---').join('|') + '|\n' +
        b.rows.map(r => '| ' + r.map(c => String(c == null ? '' : c).replace(/\|/g, '\\|')).join(' | ') + ' |').join('\n') + '\n';
      case 'equation': return '**' + b.label + '**\n\n```\n' + b.equation + '\n```\n\n' +
        'where ' + b.variables.map(v => '`' + v.sym + '` = ' + v.def + (v.unit && v.unit !== '—' ? ' (' + v.unit + ')' : '')).join('; ') + '.\n\n' +
        (b.note ? b.note + '\n\n' : '') +
        '*Interpretation.* ' + b.interpretation + '\n\n' +
        '*Limitations.* ' + b.limitations + '\n' +
        (b.source ? '\n*Source.* ' + b.source + '\n' : '');
      case 'chart': return '*[figure: ' + b.title + ']*\n';
      default: return '';
    }
  }

  function toLatex(report) {
    const esc = s => String(s == null ? '' : s)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/([&%$#_{}])/g, '\\$1')
      .replace(/~/g, '\\textasciitilde{}')
      .replace(/\^/g, '\\textasciicircum{}');
    const L = [];
    L.push('% Rice Statistics for Africa — generated ' + report.meta.generated);
    L.push('\\documentclass[11pt,a4paper]{article}');
    L.push('\\usepackage[margin=2.5cm]{geometry}\\usepackage{amsmath}\\usepackage{booktabs}');
    L.push('\\usepackage{longtable}\\usepackage[hidelinks]{hyperref}');
    L.push('\\title{' + esc(report.meta.title) + '}');
    L.push('\\date{' + esc(report.meta.generated.slice(0, 10)) + '}');
    L.push('\\begin{document}\\maketitle');
    report.sections.forEach(s => {
      L.push('\\section{' + esc(s.title) + '}');
      s.blocks.forEach(b => {
        switch (b.type) {
          case 'h3': L.push('\\subsection{' + esc(b.text) + '}'); break;
          case 'p': L.push(esc(b.text) + '\n'); break;
          case 'note': L.push('\\begin{quote}\\textbf{' + esc(b.level) + '.} ' + esc(b.text) + '\\end{quote}'); break;
          case 'finding': L.push('\\begin{quote}\\textbf{' + esc(b.title) + '.} ' + esc(b.text) + '\\end{quote}'); break;
          case 'list': L.push('\\begin{itemize}' + b.items.map(i => '\\item ' + esc(i)).join('') + '\\end{itemize}'); break;
          case 'equation':
            L.push('\\paragraph{' + esc(b.label) + '}');
            if (b.latex) L.push('\\begin{equation}' + b.latex + '\\end{equation}');
            else L.push('\\begin{verbatim}' + b.equation + '\\end{verbatim}');
            L.push('where ' + b.variables.map(v => '$' + v.sym.replace(/_/g, '_') + '$ = ' + esc(v.def)).join('; ') + '.');
            L.push('\\emph{Interpretation.} ' + esc(b.interpretation));
            L.push('\\emph{Limitations.} ' + esc(b.limitations));
            break;
          case 'table': {
            const cols = b.columns.length;
            L.push('\\begin{longtable}{' + 'l'.repeat(cols) + '}');
            if (b.caption) L.push('\\caption{' + esc(b.caption) + '}\\\\');
            L.push('\\toprule ' + b.columns.map(esc).join(' & ') + ' \\\\ \\midrule');
            b.rows.forEach(r => L.push(r.map(esc).join(' & ') + ' \\\\'));
            L.push('\\bottomrule\\end{longtable}');
            break;
          }
          case 'kpis':
            L.push('\\begin{longtable}{llll}\\toprule Indicator & Value & Period & Status \\\\ \\midrule');
            b.items.forEach(i => L.push([i.label, i.value, i.year || '', i.kind].map(esc).join(' & ') + ' \\\\'));
            L.push('\\bottomrule\\end{longtable}');
            break;
        }
      });
    });
    L.push('\\end{document}');
    return L.join('\n');
  }

  /* CSV of the underlying series, which is what most users actually want to
   * take away. Includes a provenance header. */
  function toCsv(bal, ctx) {
    const I = RSAIndicators;
    const ids = ['production', 'area', 'yield', 'imports', 'exports', 'consumption', 'population',
                 'ppc', 'cpc', 'ssr', 'idr', 'importBill'];
    const cols = ids.map(id => I.compute(id, bal));
    const L = [];
    L.push('# Rice Statistics for Africa');
    L.push('# selection,' + q(bal.label));
    L.push('# database,' + q(bal.db));
    L.push('# basis,' + q(bal.basis));
    L.push('# milling_rate,' + bal.millingRate);
    L.push('# consumption_method,' + q(bal.consumptionMethod || ''));
    L.push('# data_extracted,' + q(RSA.state.meta.extracted));
    RSA.provenance().sources.forEach(s => L.push('# source,' + q(s.db + ' | ' + s.dataset + ' | ' + s.published + ' | ' + s.url)));
    L.push('# generated,' + q(new Date().toISOString()));
    L.push('');
    L.push(['year'].concat(cols.map(c => c.id + ' (' + c.unit + ')')).map(q).join(','));
    bal.years.forEach((y, i) => {
      if (ctx && ctx.from != null && y < ctx.from) return;
      if (ctx && ctx.to != null && y > ctx.to) return;
      L.push([y].concat(cols.map(c => c.values[i] == null ? '' : round6(c.values[i]))).join(','));
    });
    return L.join('\n');
  }

  function round6(x) { return Math.round(x * 1e6) / 1e6; }
  function q(s) {
    s = String(s == null ? '' : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toJson(report, bal, ctx) {
    return JSON.stringify({
      report: report,
      manifest: buildManifest(bal, ctx, RSA.provenance()),
      series: seriesPayload(bal, ctx)
    }, null, 2);
  }

  function seriesPayload(bal, ctx) {
    const I = RSAIndicators;
    const out = { years: bal.years, indicators: {} };
    ['production', 'area', 'yield', 'imports', 'exports', 'consumption', 'population',
     'ppc', 'cpc', 'ssr', 'idr', 'importBill'].forEach(id => {
      const c = I.compute(id, bal);
      out.indicators[id] = { unit: c.unit, equation: c.equation, values: c.values };
    });
    return out;
  }

  /* Excel, as SpreadsheetML 2003. A real .xls that Excel, LibreOffice and Google
   * Sheets all open natively, with typed numeric cells and one sheet per table --
   * and, unlike a zipped .xlsx, it can be written as plain text with no compression
   * library. The first sheet carries the provenance so a spreadsheet that has been
   * emailed onward still says where its numbers came from. */
  function toExcel(report, bal, ctx) {
    const esc = s => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

    function cell(v) {
      if (v == null || v === '') return '<Cell><Data ss:Type="String"></Data></Cell>';
      const s = String(v);
      // Only treat as numeric when the whole cell is a plain number, so codes
      // like "2010-2024" stay text.
      if (/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, '')) && s.replace(/,/g, '') !== '-') {
        return '<Cell><Data ss:Type="Number">' + s.replace(/,/g, '') + '</Data></Cell>';
      }
      return '<Cell><Data ss:Type="String">' + esc(s) + '</Data></Cell>';
    }
    function row(cells) { return '<Row>' + cells.map(cell).join('') + '</Row>'; }
    function sheet(name, rows) {
      // Excel sheet names: 31 chars, no : \ / ? * [ ]
      const safe = String(name).replace(/[:\\\/?*\[\]]/g, ' ').slice(0, 31) || 'Sheet';
      return '<Worksheet ss:Name="' + esc(safe) + '"><Table>' +
             rows.map(row).join('') + '</Table></Worksheet>';
    }

    const sheets = [];
    const prov = RSA.provenance();
    const man = buildManifest(bal, ctx, prov);
    sheets.push(sheet('Provenance',
      [['Field', 'Value']].concat(Object.keys(man).map(k => [k, typeof man[k] === 'object'
        ? JSON.stringify(man[k]) : man[k]]))));

    // The full indicator series, which is the sheet people actually work in.
    const I = RSAIndicators;
    const ids = ['production', 'area', 'yield', 'imports', 'exports', 'consumption', 'population',
                 'ppc', 'cpc', 'ssr', 'idr', 'importBill'];
    const cols = ids.map(id => I.compute(id, bal));
    const dataRows = [['Year'].concat(cols.map(c => c.label + ' (' + c.unit + ')'))];
    bal.years.forEach((y, i) => {
      if (ctx && ctx.from != null && y < ctx.from) return;
      if (ctx && ctx.to != null && y > ctx.to) return;
      dataRows.push([y].concat(cols.map(c => c.values[i] == null ? '' : round6(c.values[i]))));
    });
    sheets.push(sheet('Series', dataRows));

    // Equations, so the methodology travels with the numbers.
    const eqRows = [['Indicator', 'Equation', 'Unit', 'Variables', 'Interpretation', 'Limitations']];
    ids.forEach(id => {
      const d = I.get(id);
      if (!d) return;
      eqRows.push([d.label, d.equation, d.unit,
        d.variables.map(v => v.sym + ' = ' + v.def).join('; '),
        d.interpretation, d.limitations]);
    });
    sheets.push(sheet('Equations', eqRows));

    // Every table in the report becomes its own sheet.
    let n = 0;
    report.sections.forEach(s => {
      s.blocks.forEach(b => {
        if (b.type !== 'table') return;
        n++;
        sheets.push(sheet((b.caption || s.title || ('Table ' + n)).slice(0, 28) + ' ' + n,
          [b.columns].concat(b.rows)));
      });
    });

    return '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      sheets.join('') + '</Workbook>';
  }

  /* Word, as an HTML document Word opens and converts natively. Not OOXML, but it
   * round-trips into a real .doc a researcher can edit, which is what the export
   * is actually for. */
  function toWord(report) {
    const body = toHtml(report).replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '');
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + report.meta.title + '</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->' +
      '<style>@page { size: A4; margin: 2.5cm; }' + PRINT_CSS + '</style></head><body>' +
      '<h1>' + report.meta.title + '</h1><p><i>' + report.meta.subtitle + '</i></p>' +
      '<p>Generated ' + report.meta.generated + ' &middot; data extracted ' +
      report.meta.dataExtracted + '</p>' + body + '</body></html>';
  }

  /* Standalone HTML, suitable for printing to PDF from the browser. */
  function toHtml(report, opts) {
    opts = opts || {};
    const esc = s => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const B = [];
    report.sections.forEach(s => {
      B.push('<section id="' + esc(s.id) + '"><h2>' + esc(s.title) + '</h2>');
      s.blocks.forEach(b => B.push(blockToHtml(b, esc)));
      B.push('</section>');
    });
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>' + esc(report.meta.title) + '</title><style>' + PRINT_CSS + '</style></head><body>' +
      '<header><h1>' + esc(report.meta.title) + '</h1>' +
      '<p class="sub">' + esc(report.meta.subtitle) + '</p>' +
      '<p class="meta">Generated ' + esc(report.meta.generated) +
      ' · data extracted ' + esc(report.meta.dataExtracted) +
      ' · platform version ' + esc(report.meta.platformVersion) + '</p></header>' +
      '<nav><strong>Contents</strong><ol>' +
      report.sections.map(s => '<li><a href="#' + esc(s.id) + '">' + esc(s.title) + '</a></li>').join('') +
      '</ol></nav>' + B.join('') + '</body></html>';
  }

  function blockToHtml(b, esc) {
    switch (b.type) {
      case 'h3': return '<h3>' + esc(b.text) + '</h3>';
      case 'p': return '<p>' + esc(b.text) + '</p>';
      case 'note': return '<div class="note note-' + esc(b.level) + '">' + esc(b.text) + '</div>';
      case 'finding': return '<div class="finding finding-' + esc(b.level) + '"><h4>' + esc(b.title) +
        '</h4><p>' + esc(b.text) + '</p>' + (b.meta ? '<p class="meta">' + esc(b.meta) + '</p>' : '') + '</div>';
      case 'list': return '<ul>' + b.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
      case 'code': return '<pre>' + esc(b.text) + '</pre>';
      case 'kpis': return '<div class="kpis">' + b.items.map(i =>
        '<div class="kpi kpi-' + esc(i.kind) + '"><span class="k">' + esc(i.label) + '</span>' +
        '<span class="v">' + esc(i.value) + '</span>' +
        (i.year ? '<span class="y">' + esc(i.year) + '</span>' : '') +
        '<span class="tag">' + esc(i.kind) + '</span></div>').join('') + '</div>';
      case 'table': return '<figure><table>' + (b.caption ? '<caption>' + esc(b.caption) + '</caption>' : '') +
        '<thead><tr>' + b.columns.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
        b.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></figure>';
      case 'equation': return '<div class="eq"><h4>' + esc(b.label) + '</h4>' +
        '<pre class="formula">' + esc(b.equation) + '</pre>' +
        '<dl>' + b.variables.map(v => '<dt>' + esc(v.sym) + '</dt><dd>' + esc(v.def) +
          (v.unit && v.unit !== '—' ? ' <em>(' + esc(v.unit) + ')</em>' : '') + '</dd>').join('') + '</dl>' +
        (b.note ? '<p class="note-inline">' + esc(b.note) + '</p>' : '') +
        '<p><strong>Interpretation.</strong> ' + esc(b.interpretation) + '</p>' +
        '<p><strong>Limitations.</strong> ' + esc(b.limitations) + '</p>' +
        (b.source ? '<p class="meta">Source: ' + esc(b.source) + '</p>' : '') + '</div>';
      case 'chart': return '<figure class="chart-slot" data-chart="' + esc(b.chart) + '">' +
        '<figcaption>' + esc(b.title) + '</figcaption></figure>';
      default: return '';
    }
  }

  const PRINT_CSS = `
    body { font: 11pt/1.55 Georgia, "Times New Roman", serif; color: #1a211d; max-width: 46em;
           margin: 0 auto; padding: 2.5em 1.5em 6em; }
    h1 { font-size: 1.9em; margin: 0 0 .2em; line-height: 1.2; }
    h2 { font-size: 1.3em; margin: 2.2em 0 .6em; padding-bottom: .25em;
         border-bottom: 1.5px solid #cfd8d2; }
    h3 { font-size: 1.08em; margin: 1.5em 0 .4em; }
    h4 { font-size: 1em; margin: 0 0 .3em; }
    .sub { color: #55635c; margin: 0 0 .3em; font-style: italic; }
    .meta { color: #7a867f; font-size: .85em; }
    nav { background: #f3f6f4; padding: .8em 1.2em; border-radius: 4px; font-size: .9em; }
    nav ol { margin: .4em 0 0; padding-left: 1.4em; }
    table { border-collapse: collapse; width: 100%; font-size: .84em; font-family: system-ui, sans-serif; }
    caption { text-align: left; font-weight: 600; padding-bottom: .4em; font-size: 1.05em; }
    th, td { border-bottom: 1px solid #dde4e0; padding: .38em .5em; text-align: left; vertical-align: top; }
    thead th { border-bottom: 1.5px solid #93a29a; }
    figure { margin: 1.2em 0; }
    .note { border-left: 3px solid #93a29a; background: #f5f8f6; padding: .6em .9em; margin: .9em 0;
            font-size: .92em; }
    .note-warning { border-left-color: #c9803f; background: #fdf6ef; }
    .note-error { border-left-color: #b5563d; background: #fdf1ee; }
    .finding { border: 1px solid #dde4e0; border-left: 3px solid #3f9e75; padding: .7em 1em; margin: 1em 0;
               border-radius: 3px; }
    .finding-warning { border-left-color: #c9803f; }
    .finding h4 { margin-top: 0; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .6em;
            margin: 1em 0; font-family: system-ui, sans-serif; }
    .kpi { border: 1px solid #dde4e0; border-radius: 4px; padding: .55em .7em; display: flex;
           flex-direction: column; gap: .12em; }
    .kpi .k { font-size: .72em; text-transform: uppercase; letter-spacing: .05em; color: #6b7a76; }
    .kpi .v { font-size: 1.25em; font-weight: 600; }
    .kpi .y { font-size: .74em; color: #7a867f; }
    .kpi .tag { font-size: .64em; text-transform: uppercase; letter-spacing: .06em; color: #55635c; }
    .kpi-scenario { border-left: 3px solid #5b8dd6; }
    .kpi-assumption { border-left: 3px solid #c9803f; }
    .eq { background: #f7faf8; border: 1px solid #e2eae5; border-radius: 4px; padding: .9em 1.1em;
          margin: 1em 0; }
    .formula { font-family: ui-monospace, Consolas, monospace; font-size: .92em; background: #fff;
               border: 1px solid #e2eae5; padding: .5em .7em; border-radius: 3px; overflow-x: auto; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .15em .8em; font-size: .88em; margin: .7em 0; }
    dt { font-family: ui-monospace, Consolas, monospace; font-weight: 600; }
    dd { margin: 0; }
    pre { background: #f3f6f4; padding: .6em .8em; border-radius: 3px; overflow-x: auto; font-size: .85em; }
    .chart-slot { border: 1px dashed #c3cec8; padding: 1.6em; text-align: center; color: #7a867f;
                  border-radius: 4px; font-size: .9em; }
    @media print { nav { display: none; } h2 { page-break-after: avoid; } figure, .eq { page-break-inside: avoid; } }
  `;

  return {
    generate: generate,
    toMarkdown: toMarkdown,
    toLatex: toLatex,
    toCsv: toCsv,
    toJson: toJson,
    toHtml: toHtml,
    toExcel: toExcel,
    toWord: toWord,
    buildManifest: buildManifest,
    PRINT_CSS: PRINT_CSS
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSAReport; }
