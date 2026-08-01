/* Rice Statistics for Africa -- data dictionary.
 *
 * Every variable the platform reads, grouped by source, with its element code,
 * unit, product basis, coverage and the caveat that applies to it. This is the
 * authoritative statement of what the platform is built on: if a number appears
 * anywhere in the platform, the series behind it is listed here.
 *
 * The dictionary is DECLARED here but VERIFIED against the loaded data at render
 * time -- coverage counts, year ranges and country counts are computed from what
 * actually loaded, not transcribed. A dictionary that can drift away from the
 * data it describes is worse than none.
 */

const RSADataDict = (function () {
  'use strict';

  const SOURCES = [
    {
      id: 'fao-prod',
      db: 'FAOSTAT',
      dataset: 'Production: Crops and livestock products',
      url: 'https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_Africa.zip',
      portal: 'https://www.fao.org/faostat/en/#data/QCL',
      item: 'item 27 "Rice" (CPC 0113)',
      basis: 'PADDY (rough rice). FAOSTAT dropped the word "paddy" from the label in its 2023 ' +
             'revision; the series is unchanged and is still rough rice.',
      variables: [
        { code: '5312', name: 'Area harvested', symbol: 'HA', unit: 'ha',
          note: 'Land actually harvested, not planted. Double-cropped land counts once per harvest.' },
        { code: '5412', name: 'Yield', symbol: 'Ya', unit: 'kg/ha',
          note: 'Paddy yield. Recomputed by the platform for aggregates as total production over ' +
                'total area, never as a mean of country yields.' },
        { code: '5510', name: 'Production', symbol: 'P', unit: 't',
          note: 'Paddy production. Converted to milled by the active product basis.' }
      ]
    },
    {
      id: 'fao-trade',
      db: 'FAOSTAT',
      dataset: 'Trade: Crops and livestock products',
      url: 'https://bulks-faostat.fao.org/production/Trade_CropsLivestock_E_Africa.zip',
      portal: 'https://www.fao.org/faostat/en/#data/TCL',
      item: 'item 30 "Rice, paddy (rice milled equivalent)" by default; item 31 "Rice, milled" optional',
      basis: 'Item 30 is the STANDARDIZED TOTAL rice trade aggregate in milled equivalent, covering ' +
             'husked, milled and broken rice. Item 31 covers milled rice only and EXCLUDES BROKEN ' +
             'RICE, which is the dominant imported form across much of West Africa -- using it ' +
             'understated Senegal\'s 2024 imports thirty-six fold.',
      variables: [
        { code: '5610', name: 'Import quantity', symbol: 'M', unit: 't' },
        { code: '5910', name: 'Export quantity', symbol: 'X', unit: 't',
          note: 'Includes re-exports of previously imported rice, which are not separated out.' },
        { code: '5622', name: 'Import value', symbol: 'V^M', unit: '1000 USD',
          note: 'CIF, current prices, not deflated.' },
        { code: '5922', name: 'Export value', symbol: 'V^X', unit: '1000 USD', note: 'FOB, current prices.' }
      ]
    },
    {
      id: 'fao-pop',
      db: 'FAOSTAT',
      dataset: 'Population (UN World Population Prospects, as disseminated by FAOSTAT)',
      url: 'https://bulks-faostat.fao.org/production/Population_E_Africa.zip',
      portal: 'https://www.fao.org/faostat/en/#data/OA',
      item: 'Population - Est. & Proj.',
      basis: 'Persons. Used for BOTH databases, so per-capita comparisons between FAOSTAT and USDA ' +
             'differ only in their rice numerator, not in demography.',
      variables: [
        { code: '511', name: 'Total population, both sexes', symbol: 'N', unit: '1000 persons',
          note: 'Values beyond the last census-anchored year are UN medium-variant projections, ' +
                'not observations. The projection is what makes the scenario engine\'s ' +
                'consumption path demographic rather than extrapolated.' }
      ]
    },
    {
      id: 'fao-fbs',
      db: 'FAOSTAT',
      dataset: 'Food Balance Sheets (current, 2010-) and Historic (-2013), joined',
      url: 'https://bulks-faostat.fao.org/production/FoodBalanceSheets_E_Africa.zip',
      portal: 'https://www.fao.org/faostat/en/#data/FBS',
      item: 'item 2807 "Rice and products" (current); item 2805 "Rice (Milled Equivalent)" (historic)',
      basis: 'Normalised to MILLED throughout. The historic release is already milled; the current ' +
             'release is PADDY and is multiplied by 0.67. Verified on the 2010-13 overlap, where ' +
             'the ratio between the two is 0.67-0.71 across Senegal, Nigeria, Ghana and Madagascar.',
      variables: [
        { code: '5142', name: 'Food', symbol: 'F', unit: '1000 t',
          note: 'Rice allocated to human food, as distinct from total domestic supply.' },
        { code: '645', name: 'Food supply quantity', symbol: 'CPC^food', unit: 'kg/capita/yr',
          note: 'THE measure comparable to published per-capita rice consumption. Apparent ' +
                'utilization is not that measure.' },
        { code: '5301', name: 'Domestic supply quantity', symbol: '-', unit: '1000 t' },
        { code: '5521', name: 'Feed', symbol: '-', unit: '1000 t' },
        { code: '5527', name: 'Seed', symbol: '-', unit: '1000 t' },
        { code: '5123', name: 'Losses', symbol: '-', unit: '1000 t' },
        { code: '5131', name: 'Processing', symbol: '-', unit: '1000 t' },
        { code: '5154', name: 'Other uses (non-food)', symbol: '-', unit: '1000 t' },
        { code: '5072/5074', name: 'Stock variation', symbol: '-', unit: '1000 t' },
        { code: '664', name: 'Food supply', symbol: 'K', unit: 'kcal/capita/day',
          note: 'Not rescaled by the milling conversion: it is already an energy measure.' }
      ]
    },
    {
      id: 'usda-psd',
      db: 'USDA PSD',
      dataset: 'Production, Supply and Distribution -- grains and pulses',
      url: 'https://apps.fas.usda.gov/psdonline/downloads/psd_grains_pulses_csv.zip',
      portal: 'https://apps.fas.usda.gov/psdonline/app/index.html#/app/advQuery',
      item: 'commodity 0422110 "Rice, Milled"',
      basis: 'MILLED throughout, with paddy available separately. Years are MARKET years, not ' +
             'calendar years, and are not directly comparable to FAOSTAT. Imports are ESTIMATED to ' +
             'balance supply and demand rather than counted at customs, which is why USDA sees ' +
             'flows FAOSTAT does not -- for Nigeria in 2023 by a factor of 23.',
      variables: [
        { code: '028', name: 'Production', symbol: 'P', unit: '1000 t', note: 'Milled.' },
        { code: '054', name: 'Rough production', symbol: '-', unit: '1000 t', note: 'Paddy.' },
        { code: '004', name: 'Area harvested', symbol: 'HA', unit: '1000 ha' },
        { code: '057', name: 'Imports', symbol: 'M', unit: '1000 t' },
        { code: '088', name: 'Exports', symbol: 'X', unit: '1000 t' },
        { code: '125', name: 'Domestic consumption', symbol: 'C', unit: '1000 t',
          note: 'An independent USDA estimate, not a residual. The platform can use either this or ' +
                'the FAO identity P + M - X, and defaults to the identity so the two databases are ' +
                'compared on one definition.' },
        { code: '020', name: 'Beginning stocks', symbol: '-', unit: '1000 t' },
        { code: '176', name: 'Ending stocks', symbol: '-', unit: '1000 t' },
        { code: '184', name: 'Yield', symbol: '-', unit: 't/ha', note: 'Milled basis.' },
        { code: '182', name: 'Milling rate', symbol: 'r', unit: 'ratio x 10000',
          note: 'USDA publishes its own country-specific rate, which the platform prefers over the ' +
                'FAO default when the USDA source is active.' }
      ]
    },
    {
      id: 'naturalearth',
      db: 'Natural Earth',
      dataset: '1:110m Admin 0 - Countries',
      url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
      portal: 'https://www.naturalearthdata.com/',
      item: 'country boundary polygons',
      basis: 'Public domain. Coordinates rounded to 2 decimal places (~1.1 km at the equator); ' +
             'outer rings only. Boundaries are as published by Natural Earth -- the platform takes ' +
             'no position on any contested border.',
      variables: [
        { code: '-', name: 'Country outline', symbol: '-', unit: 'degrees (lon, lat)' },
        { code: '-', name: 'Island centroid', symbol: '-', unit: 'degrees',
          note: 'Six small island states fall below the 1:110m rendering threshold and are carried ' +
                'as point markers rather than dropped from the map.' }
      ]
    },
    {
      id: 'vanoort',
      db: 'van Oort et al. (2015)',
      dataset: 'Assessment of rice self-sufficiency in 2025 in eight African countries',
      url: 'https://doi.org/10.1016/j.gfs.2015.01.002',
      portal: 'Global Food Security 5, 39-49',
      item: 'published parameter tables',
      basis: 'Transcribed from the paper for the four West African countries it covers ' +
             '(Burkina Faso, Ghana, Mali, Nigeria). Used only in the West Africa model section.',
      variables: [
        { code: 'Table 5', name: 'Existing rainfed physical area', symbol: 'A_rf', unit: '1000 ha' },
        { code: 'Table 5', name: 'Existing irrigated physical area', symbol: 'A_ir', unit: '1000 ha' },
        { code: 'Table 2', name: 'Yield trend 2007-2012, rainfed', symbol: '-', unit: 'kg/ha/yr' },
        { code: 'Table 2', name: 'Yield trend 2007-2012, irrigated', symbol: '-', unit: 'kg/ha/yr' },
        { code: 'Table 2', name: 'Trend needed to reach 80% of potential', symbol: '-', unit: 'kg/ha/yr',
          note: 'Used to reconstruct the exploitable ceiling 0.8 x Yp or 0.8 x Yw, which is ' +
                'otherwise an ORYZA2000 simulation not derivable from public statistics.' },
        { code: 'Table 1', name: 'Per-capita consumption 2012 and 2025', symbol: '-', unit: 'kg/capita/yr' },
        { code: 'Table 4', name: 'Published P/C by scenario', symbol: 'P/C', unit: 'ratio',
          note: 'Held for validation only; not used in any computation.' }
      ]
    }
  ];

  /* Derived series: computed by the platform, not read from any source. Listed
   * because a reader tracing a number needs to know which are which. */
  const DERIVED = [
    { name: 'Apparent consumption', symbol: 'C', unit: 't', from: 'P + M - X (FAO 2001)' },
    { name: 'Milled production', symbol: 'P^milled', unit: 't', from: 'paddy production x milling rate' },
    { name: 'Self-sufficiency ratio', symbol: 'SSR', unit: '%', from: '100 P^milled / C' },
    { name: 'Import dependency ratio', symbol: 'IDR', unit: '%', from: '100 M / C' },
    { name: 'Per capita production', symbol: 'PPC', unit: 'kg/capita', from: '1000 P / N' },
    { name: 'Per capita consumption (trade-based)', symbol: 'CPC', unit: 'kg/capita', from: '1000 C / N' },
    { name: 'Import unit value', symbol: 'UV', unit: 'USD/t', from: '1000 V^M / M' },
    { name: 'Zero production for non-rice-growing countries', symbol: 'P = 0', unit: 't',
      from: 'DERIVED, not observed: where a country has no production row anywhere in the record ' +
            'but reports rice imports, production is taken as zero so it appears at SSR 0% rather ' +
            'than as missing data' }
  ];

  /* Runtime verification: counts computed from what actually loaded. */
  function coverage() {
    const fao = RSA.state.fao, usda = RSA.state.usda, geo = RSA.state.geo;
    const fbs = fao.fbs || {};
    const countCovered = (series) => series ? Object.keys(series).length : 0;
    return {
      'fao-prod':   { countries: countCovered(fao.series),
                      years: fao.years[0] + '-' + fao.years[fao.years.length - 1] },
      'fao-trade':  { countries: countCovered(fao.series),
                      years: fao.years[0] + '-' + fao.years[fao.years.length - 1] },
      'fao-pop':    { countries: countCovered(fao.series),
                      years: fao.popYears[0] + '-' + fao.popYears[fao.popYears.length - 1] },
      'fao-fbs':    { countries: (fbs.covered || []).length,
                      years: fbs.years ? fbs.years[0] + '-' + fbs.years[fbs.years.length - 1] : '-',
                      missing: (fbs.missing || []).join(', ') || 'none' },
      'usda-psd':   { countries: countCovered(usda.series),
                      years: usda.years[0] + '-' + usda.years[usda.years.length - 1] },
      'naturalearth': { countries: geo && geo.shapes ? Object.keys(geo.shapes).length : 0,
                        years: 'n/a' },
      'vanoort':    { countries: Object.keys(RSAVanOort.PAPER).length + ' of 16 West African',
                      years: 'baseline 2012, horizon 2025' }
    };
  }

  /* Every equation the platform uses, in one place, assembled from the indicator
   * descriptors plus the models. The indicator equations are read from the
   * descriptors rather than restated, so they cannot drift. */
  function equations() {
    const out = [];
    const ids = ['ppc', 'cpc', 'cpcFood', 'ssr', 'ssrFood', 'idr', 'icr', 'ntr', 'pcb', 'pcg',
                 'yield', 'foodUse', 'importBill', 'importUnitValue', 'importBillPerCapita',
                 'tradeBalanceValue', 'kcalRice'];
    ids.forEach(id => {
      const d = RSAIndicators.get(id);
      if (!d) return;
      out.push({ group: 'Indicator', id: id, label: d.label, equation: d.equation,
                 latex: d.latex, unit: d.unit, variables: d.variables,
                 interpretation: d.interpretation, limitations: d.limitations,
                 source: d.source || null, note: d.note || null });
    });

    out.push({ group: 'Forecasting', id: 'arima', label: 'ARIMA(p, d, q)',
      equation: 'phi(B) (1 - B)^d y_t = c + theta(B) e_t',
      latex: '\\phi(B)(1-B)^d y_t = c + \\theta(B)\\varepsilon_t', unit: '-',
      variables: [
        { sym: 'phi(B)', def: 'autoregressive operator of order p', unit: '-' },
        { sym: 'theta(B)', def: 'moving-average operator of order q', unit: '-' },
        { sym: '(1-B)^d', def: 'differencing operator', unit: '-' },
        { sym: 'e_t', def: 'white-noise innovation', unit: 'series unit' }
      ],
      interpretation: 'Box-Jenkins univariate forecasting. Estimated by conditional sum of squares; ' +
        'stationarity and invertibility checked on the actual polynomial roots.',
      limitations: 'Univariate: no prices, weather, policy or conflict. Annual data, so no seasonal ' +
        'component is ever fitted.',
      source: 'Box & Jenkins (1970)' });

    out.push({ group: 'Forecasting', id: 'interval', label: 'Prediction interval',
      equation: 'yhat_{T+h} +/- z sigma sqrt( sum_{j=0}^{h-1} psi_j^2 )',
      latex: '\\hat{y}_{T+h}\\pm z_{\\alpha/2}\\sigma\\sqrt{\\sum_{j=0}^{h-1}\\psi_j^2}',
      unit: 'series unit',
      variables: [{ sym: 'psi_j', def: 'MA(inf) weights on the level scale', unit: '-' },
                  { sym: 'sigma', def: 'innovation standard deviation', unit: 'series unit' }],
      interpretation: 'Gaussian interval from the psi-weights.',
      limitations: 'Innovation uncertainty only -- excludes parameter and model-selection ' +
        'uncertainty and structural change, so realised coverage is below nominal.' });

    out.push({ group: 'Scenario', id: 'baseline', label: 'Structural baseline',
      equation: 'P_t = A_t x Y_t ;  C_t = cpc_t x N_t ;  SSR_t = 100 P_t / C_t',
      latex: 'P_t=A_tY_t,\\quad C_t=\\mathrm{cpc}_tN_t', unit: '-',
      variables: [{ sym: 'A_t', def: 'projected harvested area', unit: 'ha' },
                  { sym: 'Y_t', def: 'projected yield', unit: 'kg/ha' },
                  { sym: 'N_t', def: 'UN projected population', unit: 'persons' }],
      interpretation: 'Each policy lever acts on the component it actually touches.',
      limitations: 'A projection under no policy change, not a prediction.' });

    out.push({ group: 'Scenario', id: 'ramp', label: 'Phase-in',
      equation: "r_t = g((t - t0)/(T - t0)) ;  X'_t = X_t (1 + delta r_t)",
      latex: "r_t=g\\!\\left(\\tfrac{t-t_0}{T-t_0}\\right)", unit: '-',
      variables: [{ sym: 'g', def: 'linear, logistic, back-loaded, front-loaded or step', unit: '-' },
                  { sym: 'delta', def: 'full intensity of the lever', unit: '-' }],
      interpretation: 'Separates how fast a policy arrives from how large it is.',
      limitations: 'A deterministic shape imposed by the analyst.' });

    out.push({ group: 'Scenario', id: 'tariff', label: 'Tariff transmission',
      equation: "dP = tau x rho ;  A' = A(1 + eps^A_S dP) ;  Y' = Y(1 + eps^Y_S dP) ;  C' = C(1 + eps_D dP)",
      latex: '\\Delta P=\\tau\\rho', unit: '-',
      variables: [{ sym: 'tau', def: 'ad valorem tariff', unit: '-' },
                  { sym: 'rho', def: 'price pass-through (assumption)', unit: '-' },
                  { sym: 'eps_S, eps_D', def: 'supply and demand elasticities (assumptions)', unit: '-' }],
      interpretation: 'Tariff acts through price on producer incentive and consumer demand, not ' +
        'mechanically on production.',
      limitations: 'Comparative static. Illustrative elasticities, no market structure, no informal ' +
        'trade, no general equilibrium.' });

    out.push({ group: 'Optimisation', id: 'leastcost', label: 'Least-cost path',
      equation: 'min K(g_A, a, g_Y) s.t. SSR(T) >= S*, 0 <= g_A <= g_A^max, 0 <= a <= a^max, 0 <= g_Y <= g_Y^max',
      latex: '\\min_{g_A,a,g_Y}K\\ \\text{s.t.}\\ SSR_T\\ge S^*', unit: 'USD',
      variables: [{ sym: 'K', def: 'total programme cost', unit: 'USD' }],
      interpretation: 'Cheapest admissible combination reaching the target.',
      limitations: 'Unit costs are placeholders, not national costings.' });

    out.push({ group: 'Crisis', id: 'chow', label: 'Chow test for a structural break',
      equation: 'F = [(RSS_p - (RSS_1 + RSS_2))/k] / [(RSS_1 + RSS_2)/(n - 2k)]',
      latex: 'F=\\frac{(RSS_p-(RSS_1+RSS_2))/k}{(RSS_1+RSS_2)/(n-2k)}', unit: '-',
      variables: [{ sym: 'k', def: 'parameters per regime (intercept and trend)', unit: '-' }],
      interpretation: 'Tests whether level and trend differ either side of a dated shock.',
      limitations: 'Break date fixed in advance; assumes linear trend and independent errors.' });

    out.push({ group: 'Crisis', id: 'counterfactual', label: 'Counterfactual deviation',
      equation: 'delta_t = y_t - E[y_t | pre-crisis data]',
      latex: '\\delta_t=y_t-\\hat{y}_t^{\\,\\mathrm{pre}}', unit: 'series unit',
      variables: [{ sym: 'yhat', def: 'projection from a model fitted only before the crisis', unit: 'series unit' }],
      interpretation: 'The estimated shock, judged against the projection\'s 95% interval.',
      limitations: 'A deviation inside the interval is not evidence of an effect.' });

    // van Oort model, Eqs. 1-9.
    [['1', 'Production of unmilled rice', 'P_unmilled = HA_rf x Y_rf + HA_ir x Y_ir',
      'Harvested area times yield, separately for rainfed and irrigated systems.'],
     ['2', 'Milled production', 'P_milled = 0.65 x P_unmilled',
      'Milling removes 30-40% of the weight; the paper uses 0.65.'],
     ['3', 'Domestic consumption', 'C_milled = Population x Per-capita consumption',
      'Consumption is demographic, not extrapolated.'],
     ['4', 'Scenario production', "C_milled = 0.65[(HA_rf + dHA_rf)(Y_rf + dY_rf) + (HA_ir + dHA_ir)(Y_ir + dY_ir)]",
      'Production matched to consumption with changes in area and yield.'],
     ['5', 'Required irrigated area', "dHA_ir = [C_milled/0.65 - (HA_rf + dHA_rf)(Y_rf + dY_rf)]/(Y_ir + dY_ir) - HA_ir",
      'Fix three of the four changes and the fourth is determined.'],
     ['6', 'Physical from harvested area', 'dA_ir = dHA_ir / CI_ir',
      'Cropping intensity converts harvested area to physical area. CI_rf = 1 throughout.'],
     ['7', 'Maximum double-cropping expansion', 'max{dHA_ir} = A_ir (2.0 - CI_ir)',
      'At most two rice crops a year on existing irrigated land; one in Egypt.'],
     ['8', 'Maximum rainfed yield increase', 'max{dY_rf} = 0.8 Yw_rf - Ya_rf',
      'Bounded by 80% of the water-limited potential.'],
     ['9', 'Maximum irrigated yield increase', 'max{dY_ir} = 0.8 Yp_ir - Ya_ir',
      'Bounded by 80% of the potential yield.']
    ].forEach(([n, label, eq, interp]) => {
      out.push({ group: 'van Oort et al. (2015)', id: 'vo' + n,
        label: 'Eq. ' + n + ' — ' + label, equation: eq, latex: null, unit: '-',
        variables: [
          { sym: 'HA', def: 'harvested area (rf = rainfed, ir = irrigated)', unit: '1000 ha' },
          { sym: 'A', def: 'physical area', unit: '1000 ha' },
          { sym: 'Ya', def: 'actual yield, unmilled at 14% moisture', unit: 't/ha' },
          { sym: 'Yw', def: 'water-limited yield potential (rainfed benchmark)', unit: 't/ha' },
          { sym: 'Yp', def: 'yield potential (irrigated benchmark)', unit: 't/ha' },
          { sym: 'CI', def: 'cropping intensity', unit: 'crops/yr' }
        ],
        interpretation: interp,
        limitations: 'Biophysical accounting only: no prices, costs, behaviour or trade response. ' +
          'Yw and Yp are ORYZA2000 simulations from the Global Yield Gap Atlas.',
        source: 'van Oort et al. (2015), Global Food Security 5, 39-49' });
    });

    return out;
  }

  /* ------------------------------------------------------------- exports */

  function toCsv() {
    const L = ['# Rice Statistics for Africa — data dictionary',
               '# generated,' + new Date().toISOString(),
               '# data extracted,' + RSA.state.meta.extracted, '',
               'source_db,dataset,item,element_code,variable,symbol,unit,basis,note,url'];
    const q = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    SOURCES.forEach(s => s.variables.forEach(v => {
      L.push([s.db, s.dataset, s.item, v.code, v.name, v.symbol, v.unit, s.basis, v.note || '', s.url]
        .map(q).join(','));
    }));
    DERIVED.forEach(d => {
      L.push(['DERIVED', 'computed by the platform', '', '', d.name, d.symbol, d.unit, '', d.from, '']
        .map(q).join(','));
    });
    return L.join('\n');
  }

  function equationsToCsv() {
    const L = ['# Rice Statistics for Africa — equations and models',
               '# generated,' + new Date().toISOString(), '',
               'group,id,label,equation,unit,variables,interpretation,limitations,source'];
    const q = s => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    equations().forEach(e => {
      L.push([e.group, e.id, e.label, e.equation, e.unit,
              (e.variables || []).map(v => v.sym + ' = ' + v.def + (v.unit && v.unit !== '-' ? ' [' + v.unit + ']' : '')).join('; '),
              e.interpretation, e.limitations, e.source || ''].map(q).join(','));
    });
    return L.join('\n');
  }

  function toJson() {
    return JSON.stringify({
      generated: new Date().toISOString(),
      dataExtracted: RSA.state.meta.extracted,
      platformVersion: RSA_VERSION,
      sources: SOURCES,
      derived: DERIVED,
      coverage: coverage(),
      equations: equations(),
      references: RSAVanOort.REFERENCES
    }, null, 2);
  }

  function toMarkdown() {
    const L = ['# Rice Statistics for Africa — Data Used', '',
               'Generated ' + new Date().toISOString() +
               ' · data extracted ' + RSA.state.meta.extracted, ''];
    const cov = coverage();
    SOURCES.forEach(s => {
      const c = cov[s.id] || {};
      L.push('## ' + s.db + ' — ' + s.dataset, '');
      L.push('- **Item:** ' + s.item);
      L.push('- **Basis:** ' + s.basis);
      L.push('- **Coverage:** ' + (c.countries || '?') + ' countries, ' + (c.years || '?'));
      if (c.missing) L.push('- **Not covered:** ' + c.missing);
      L.push('- **Bulk file:** ' + s.url);
      L.push('- **Portal:** ' + s.portal, '');
      L.push('| Element | Variable | Symbol | Unit | Note |');
      L.push('|---|---|---|---|---|');
      s.variables.forEach(v => L.push('| ' + v.code + ' | ' + v.name + ' | `' + v.symbol + '` | ' +
        v.unit + ' | ' + (v.note || '') + ' |'));
      L.push('');
    });
    L.push('## Derived series', '', '| Variable | Symbol | Unit | Derivation |', '|---|---|---|---|');
    DERIVED.forEach(d => L.push('| ' + d.name + ' | `' + d.symbol + '` | ' + d.unit + ' | ' + d.from + ' |'));
    L.push('', '## Equations', '');
    equations().forEach(e => {
      L.push('### ' + e.label + '  *(' + e.group + ')*', '', '```', e.equation, '```', '');
      L.push('where ' + (e.variables || []).map(v => '`' + v.sym + '` = ' + v.def).join('; ') + '.', '');
      L.push('*Interpretation.* ' + e.interpretation, '');
      L.push('*Limitations.* ' + e.limitations, '');
      if (e.source) L.push('*Source.* ' + e.source, '');
    });
    L.push('## References', '');
    RSAVanOort.REFERENCES.forEach(r => L.push('- ' + r.text + (r.doi ? ' doi:' + r.doi : '') +
      (r.role ? '  \n  *' + r.role + '*' : '')));
    return L.join('\n');
  }

  return {
    SOURCES: SOURCES,
    DERIVED: DERIVED,
    coverage: coverage,
    equations: equations,
    toCsv: toCsv,
    equationsToCsv: equationsToCsv,
    toJson: toJson,
    toMarkdown: toMarkdown
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSADataDict; }
