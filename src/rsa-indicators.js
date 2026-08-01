/* Rice Statistics for Africa -- indicator library.
 *
 * Every indicator is a self-describing object: the equation, the definition of
 * each symbol, the unit, how to read the number, and what it cannot tell you.
 * The report generator renders the methodology section straight out of these
 * descriptors, so there is exactly one statement of each formula in the codebase
 * and the documentation cannot drift away from the arithmetic.
 *
 * The four food-security indicators (PPC, CPC, SSR, IDR) follow FAO (2001), Food
 * Balance Sheets: A Handbook, as applied by Gassi, Gul & Cetin (2025) to Benin.
 * Their exact published values are reproduced by the test suite.
 *
 * A note on SSR + IDR. On these definitions the two sum to 100% only when exports
 * are zero:
 *
 *     SSR + IDR = 100 x (P + M) / (P + M - X)
 *
 * so a large re-exporter shows IDR far above 100%. Benin in 2010 is the textbook
 * case -- IDR 351.71% -- because it imported rice largely to re-export it to
 * Nigeria. That is a property of the definition, not a data error, and the
 * platform says so wherever IDR exceeds 100%.
 */

const RSAIndicators = (function () {
  'use strict';

  const T = 't';
  const KGC = 'kg/capita';
  const PCT = '%';

  /* Small helpers over aligned arrays. Missing input -> missing output, never a
   * zero and never a silently dropped year. */

  function mapPair(a, b, fn) {
    const n = Math.min(a.length, b.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = (a[i] == null || b[i] == null) ? null : fn(a[i], b[i]);
    }
    return out;
  }

  function safeDiv(num, den) {
    if (num == null || den == null) return null;
    if (den === 0) return null;          // never Infinity: an undefined ratio is missing, not huge
    return num / den;
  }

  /* Pulls a food-balance-sheet series and aligns it to the balance sheet's own
   * year vector. Returns all-null where the selection has no FBS coverage, so a
   * chart renders empty rather than the platform inventing a figure. */
  function fbsSeries(bal, field) {
    const out = new Array(bal.years.length).fill(null);
    if (typeof RSA === 'undefined' || !RSA.foodBalance) return out;
    let fb = null;
    try {
      fb = RSA.foodBalance(bal.selection, { basis: bal.basis, millingRate: bal.millingRate });
    } catch (e) { return out; }
    if (!fb || !fb.available || !fb[field]) return out;
    for (let i = 0; i < bal.years.length; i++) {
      const j = fb.years.indexOf(bal.years[i]);
      if (j >= 0) out[i] = fb[field][j];
    }
    return out;
  }

  function growth(v) {
    const out = new Array(v.length).fill(null);
    for (let i = 1; i < v.length; i++) {
      if (v[i] == null || v[i - 1] == null || v[i - 1] === 0) continue;
      out[i] = 100 * (v[i] - v[i - 1]) / Math.abs(v[i - 1]);
    }
    return out;
  }

  /* Compound annual growth rate between the first and last observed values.
   * Undefined if either endpoint is non-positive -- a CAGR through zero or a
   * sign change has no meaning, and returning one would be a fabrication. */
  function cagr(years, v, from, to) {
    let i0 = -1, i1 = -1;
    for (let i = 0; i < v.length; i++) {
      if (v[i] == null) continue;
      if (from != null && years[i] < from) continue;
      if (to != null && years[i] > to) continue;
      if (i0 < 0) i0 = i;
      i1 = i;
    }
    if (i0 < 0 || i1 <= i0) return null;
    const v0 = v[i0], v1 = v[i1], span = years[i1] - years[i0];
    if (v0 <= 0 || v1 <= 0 || span <= 0) return null;
    return 100 * (Math.pow(v1 / v0, 1 / span) - 1);
  }

  /* ------------------------------------------------------- the descriptors */

  const INDICATORS = {

    /* ---- production ---- */
    production: {
      id: 'production', label: 'Rice production', category: 'Production', unit: T,
      equation: 'P_t',
      latex: 'P_t',
      variables: [{ sym: 'P_t', def: 'domestic rice production in year t', unit: 't' }],
      interpretation: 'Total quantity of rice produced domestically. On the FAOSTAT source this is ' +
        'paddy (rough rice) unless a milled basis has been selected; on USDA PSD it is milled rice.',
      limitations: 'National production statistics for smallholder cereals are estimates, often built ' +
        'from area frames and yield surveys of varying quality. Revisions of 10% or more between ' +
        'FAOSTAT vintages are not unusual for African rice.',
      compute: b => b.production.slice()
    },

    area: {
      id: 'area', label: 'Rice harvested area', category: 'Land', unit: 'ha',
      equation: 'A_t',
      latex: 'A_t',
      variables: [{ sym: 'A_t', def: 'area of rice harvested in year t', unit: 'ha' }],
      interpretation: 'Land actually harvested, not land planted. Area lost to flood, drought or ' +
        'conflict is excluded, so harvested area falls in bad years even when planting did not.',
      limitations: 'Double-cropped land is counted once per harvest, so harvested area can exceed ' +
        'physical rice land in irrigated systems.',
      compute: b => b.area.slice()
    },

    yield: {
      id: 'yield', label: 'Rice yield', category: 'Productivity', unit: 'kg/ha',
      equation: 'Y_t = P_t / A_t',
      latex: 'Y_t = \\frac{P_t}{A_t}',
      variables: [
        { sym: 'Y_t', def: 'rice yield in year t', unit: 'kg/ha' },
        { sym: 'P_t', def: 'domestic rice production in year t', unit: 't' },
        { sym: 'A_t', def: 'rice harvested area in year t', unit: 'ha' }
      ],
      interpretation: 'Output per hectare harvested. For an aggregate of several countries this is ' +
        'recomputed as total production over total area, not averaged across countries.',
      limitations: 'Expressed on whichever product basis is active. A paddy yield is roughly 1.5 times ' +
        'the milled yield of the same field, so yields are only comparable within one basis.',
      compute: b => b.yield.slice()
    },

    /* ---- trade ---- */
    imports: {
      id: 'imports', label: 'Rice imports', category: 'Trade', unit: T,
      equation: 'M_t',
      latex: 'M_t',
      variables: [{ sym: 'M_t', def: 'quantity of rice imported in year t', unit: 't' }],
      interpretation: 'Rice entering the country through recorded trade channels.',
      limitations: 'Unrecorded cross-border flows are substantial in West Africa; recorded imports ' +
        'understate true supply where informal re-export is common.',
      compute: b => b.imports.slice()
    },

    exports: {
      id: 'exports', label: 'Rice exports', category: 'Trade', unit: T,
      equation: 'X_t',
      latex: 'X_t',
      variables: [{ sym: 'X_t', def: 'quantity of rice exported in year t', unit: 't' }],
      interpretation: 'Rice leaving the country, including re-exports of previously imported rice.',
      limitations: 'Re-exports are not separated from exports of domestic production. For entrepot ' +
        'economies this materially distorts every ratio built on net trade.',
      compute: b => b.exports.slice()
    },

    netTrade: {
      id: 'netTrade', label: 'Net rice trade', category: 'Trade', unit: T,
      equation: 'NT_t = X_t - M_t',
      latex: 'NT_t = X_t - M_t',
      variables: [
        { sym: 'NT_t', def: 'net trade position in year t', unit: 't' },
        { sym: 'X_t', def: 'exports in year t', unit: 't' },
        { sym: 'M_t', def: 'imports in year t', unit: 't' }
      ],
      interpretation: 'Positive means a net exporter, negative a net importer.',
      limitations: 'Says nothing about the scale of either flow: a country trading 1 Mt each way and ' +
        'one trading nothing both show zero.',
      compute: b => mapPair(b.exports, b.imports, (x, m) => x - m)
    },

    /* ---- consumption / supply ---- */
    consumption: {
      id: 'consumption', label: 'Rice consumption (apparent utilization)', category: 'Consumption', unit: T,
      equation: 'C_t = P_t + M_t - X_t',
      latex: 'C_t = P_t + M_t - X_t',
      variables: [
        { sym: 'C_t', def: 'domestic supply available for utilization in year t', unit: 't' },
        { sym: 'P_t', def: 'domestic production in year t', unit: 't' },
        { sym: 'M_t', def: 'imports in year t', unit: 't' },
        { sym: 'X_t', def: 'exports in year t', unit: 't' }
      ],
      interpretation: 'Domestic utilization excluding stock variation, following FAO (2001). This is ' +
        'the denominator of both SSR and IDR.',
      limitations: 'This is APPARENT consumption, not measured intake. It absorbs stock building and ' +
        'drawdown, seed, feed, industrial use and waste, and it inherits every error in production ' +
        'and trade. Where stocks move sharply it can swing without any change in what people eat.',
      compute: b => b.consumption.slice()
    },

    population: {
      id: 'population', label: 'Population', category: 'Population', unit: 'persons',
      equation: 'N_t',
      latex: 'N_t',
      variables: [{ sym: 'N_t', def: 'total population in year t', unit: 'persons' }],
      interpretation: 'Total population, both sexes, from UN World Population Prospects as ' +
        'disseminated by FAOSTAT. Used for both databases so per-capita comparisons differ only in ' +
        'their rice numerator.',
      limitations: 'Values beyond the last census-anchored year are UN projections on the medium ' +
        'variant, not observations.',
      compute: b => b.population.slice()
    },

    /* ---- the four FAO (2001) food-security indicators ---- */
    ppc: {
      id: 'ppc', label: 'Per capita production (PPC)', category: 'Food security', unit: KGC,
      equation: 'PPC_t = 1000 x P_t / N_t',
      latex: 'PPC_t = \\frac{1000 \\, P_t}{N_t}',
      variables: [
        { sym: 'PPC_t', def: 'per capita rice production in year t', unit: 'kg/capita' },
        { sym: 'P_t', def: 'domestic rice production in year t', unit: 't' },
        { sym: 'N_t', def: 'total population in year t', unit: 'persons' }
      ],
      note: 'The factor 1000 converts tonnes to kilograms.',
      interpretation: 'The quantity of rice produced domestically per inhabitant. Read against PPC to ' +
        'see how much of what people consume the country grows itself.',
      limitations: 'A national average. It says nothing about who has access to the rice, and on the ' +
        'as-published basis it is a paddy figure, not edible rice.',
      source: 'FAO (2001); Gassi, Gul & Cetin (2025), eq. 1',
      compute: b => mapPair(b.production, b.population, (p, n) => safeDiv(1000 * p, n))
    },

    cpc: {
      id: 'cpc', label: 'Per capita consumption (CPC)', category: 'Food security', unit: KGC,
      equation: 'CPC_t = 1000 x (P_t + M_t - X_t) / N_t',
      latex: 'CPC_t = \\frac{1000 \\, (P_t + M_t - X_t)}{N_t}',
      variables: [
        { sym: 'CPC_t', def: 'per capita rice consumption in year t', unit: 'kg/capita' },
        { sym: 'P_t', def: 'domestic production in year t', unit: 't' },
        { sym: 'M_t', def: 'imports in year t', unit: 't' },
        { sym: 'X_t', def: 'exports in year t', unit: 't' },
        { sym: 'N_t', def: 'total population in year t', unit: 'persons' }
      ],
      interpretation: 'Average rice available per inhabitant per year, combining domestic production ' +
        'with net imports.',
      limitations: 'Availability, not intake. Because it is built on apparent utilization it is ' +
        'inflated for countries whose exports are under-recorded, which is why Benin\'s CPC reads ' +
        'near 150 kg/capita -- far above plausible dietary intake -- once its re-exports to Nigeria ' +
        'stopped being captured in the export column.',
      source: 'FAO (2001); Gassi, Gul & Cetin (2025), eq. 2',
      // Same guard as SSR and IDR: a negative apparent utilization is not a
      // negative amount of rice eaten, it is an unusable balance sheet.
      compute: b => mapPair(b.consumption, b.population,
        (c, n) => (c > 0 ? safeDiv(1000 * c, n) : null))
    },

    ssr: {
      id: 'ssr', label: 'Self-sufficiency ratio (SSR)', category: 'Food security', unit: PCT,
      equation: 'SSR_t = 100 x Production(milled)_t / (Production(milled)_t + Imports_t - Exports_t)',
      latex: 'SSR_t = \\frac{P^{\\text{milled}}_t}{P^{\\text{milled}}_t + M_t - X_t} \\times 100',
      variables: [
        { sym: 'SSR_t', def: 'rice self-sufficiency ratio in year t', unit: '%' },
        { sym: 'P(milled)_t', def: 'domestic rice production in year t, MILLED basis', unit: 't' },
        { sym: 'M_t', def: 'rice imports in year t, milled basis', unit: 't' },
        { sym: 'X_t', def: 'rice exports in year t, milled basis', unit: 't' }
      ],
      note: 'The FAO (2001) definition, stated on a MILLED basis throughout: production, imports and ' +
            'exports must all be the same commodity for the ratio to mean anything. FAOSTAT publishes ' +
            'production as paddy, so on the milled and paddy bases the platform converts before ' +
            'forming the ratio. Both of those bases give the SAME SSR, because multiplying numerator ' +
            'and denominator by the milling rate leaves the ratio unchanged; they differ only in the ' +
            'per-capita quantities. The as-published basis does NOT convert, and is the one case ' +
            'where this equation does not hold as written.',
      interpretation: 'The share of domestic utilization met from domestic production. ' +
        'SSR > 100%: production exceeds domestic utilization. SSR = 100%: approximate ' +
        'self-sufficiency. SSR < 100%: domestic production does not cover utilization and the ' +
        'shortfall is met from imports or stocks.',
      limitations: 'Self-sufficiency is not the same as food security: a country can be fully ' +
        'self-sufficient and still have hungry people, and a low-SSR country with reliable foreign ' +
        'exchange may be perfectly food-secure (Clapp 2017). On the as-published basis the ratio is ' +
        'not unit-consistent and is biased upward.',
      source: 'FAO (2001); Gassi, Gul & Cetin (2025), eq. 4',
      /* Routed through RSA.selfSufficiency so the formula exists in exactly one
       * place. Consumption here IS P + M - X, already withheld by balance()
       * where it came out non-positive, so this reduces to 100 x P / C. */
      compute: b => mapPair(b.production, b.consumption,
        (p, c) => RSA.selfSufficiency(p, c - p, 0))
    },

    idr: {
      id: 'idr', label: 'Import dependency ratio (IDR)', category: 'Food security', unit: PCT,
      equation: 'IDR_t = 100 x Imports_t / (Production(milled)_t + Imports_t - Exports_t)',
      latex: 'IDR_t = \\frac{M_t}{P^{\\text{milled}}_t + M_t - X_t} \\times 100',
      variables: [
        { sym: 'IDR_t', def: 'import dependency ratio in year t', unit: '%' },
        { sym: 'M_t', def: 'rice imports in year t, milled basis', unit: 't' },
        { sym: 'P(milled)_t', def: 'domestic rice production in year t, MILLED basis', unit: 't' },
        { sym: 'X_t', def: 'rice exports in year t, milled basis', unit: 't' }
      ],
      note: 'Shares the denominator of SSR, so the same basis rule applies.',
      interpretation: 'The share of domestic utilization supplied by imports. Higher means greater ' +
        'reliance on foreign supply.',
      limitations: 'Because the denominator is net of exports, IDR exceeds 100% for re-exporting ' +
        'countries: imports can be larger than what stays in the country. SSR + IDR = 100% only when ' +
        'exports are zero. Benin 2010 (IDR 351.71%) is the standard illustration.',
      source: 'FAO (2001); Gassi, Gul & Cetin (2025), eq. 3',
      /* Shares SSR's denominator, so it must share SSR's guard. A non-positive
       * apparent utilization made this return -69.0% for Kenya in 1992 while the
       * SSR beside it was correctly blank -- the two indicators disagreeing about
       * whether the same balance sheet was usable. */
      compute: b => mapPair(b.imports, b.consumption,
        (m, c) => (c > 0 ? safeDiv(100 * m, c) : null))
    },

    /* ---- food-balance-sheet measures ----
     *
     * These come from FAOSTAT's Food Balance Sheets rather than from the trade
     * identity, and they are the numbers that correspond to published per-capita
     * rice consumption. Apparent utilization counts feed, seed, losses,
     * processing, industrial use and stock building as though people ate them;
     * the food balance sheet does not.
     */
    cpcFood: {
      id: 'cpcFood', label: 'Per capita food consumption (FBS)', category: 'Food security', unit: KGC,
      equation: 'CPC^food_t = Food supply quantity_t  (FAOSTAT Food Balance Sheet, element 645)',
      latex: 'CPC^{\\text{food}}_t',
      variables: [
        { sym: 'CPC^food_t', def: 'rice available for human food per inhabitant in year t, milled basis',
          unit: 'kg/capita/yr' }
      ],
      note: 'Reported on a MILLED basis. This is the figure comparable to published rice consumption ' +
            'statistics and to the AfricaRice country pages.',
      interpretation: 'How much rice is actually available to eat per person, after feed, seed, ' +
        'losses, processing, industrial use and stock change have been taken out of the balance ' +
        'sheet. Where this differs sharply from the trade-based CPC, the difference is the part of ' +
        'apparent utilization that was never food — most often unrecorded re-export.',
      limitations: 'Availability at national level, not measured intake, and it says nothing about ' +
        'distribution between households. Coverage is partial: some countries are absent from both ' +
        'food balance sheet releases. Two releases with different methodologies are joined at 2013.',
      source: 'FAOSTAT Food Balance Sheets, element 645',
      fbs: true,
      compute: b => fbsSeries(b, 'foodPerCapita')
    },

    foodUse: {
      id: 'foodUse', label: 'Rice used as food (FBS)', category: 'Food security', unit: T,
      equation: 'F_t  (FAOSTAT Food Balance Sheet, element 5142)',
      latex: 'F_t',
      variables: [{ sym: 'F_t', def: 'quantity of rice allocated to human food in year t', unit: 't' }],
      interpretation: 'The food component of the balance sheet, as distinct from total domestic ' +
        'supply. For Senegal in 2022 domestic supply was 3.25 Mt but food use only 2.15 Mt.',
      limitations: 'A residual within the balance sheet, so it absorbs the errors of every other ' +
        'line in it.',
      source: 'FAOSTAT Food Balance Sheets, element 5142',
      fbs: true,
      compute: b => fbsSeries(b, 'food')
    },

    ssrFood: {
      id: 'ssrFood', label: 'Self-sufficiency vs food use (SSR-food)', category: 'Food security', unit: PCT,
      equation: 'SSR^food_t = 100 x Production(milled)_t / Food use_t',
      latex: 'SSR^{\\text{food}}_t = \\frac{P^{\\text{milled}}_t}{F_t}\\times 100',
      variables: [
        { sym: 'SSR^food_t', def: 'production as a share of rice actually eaten', unit: '%' },
        { sym: 'P(milled)_t', def: 'domestic production, milled basis', unit: 't' },
        { sym: 'F_t', def: 'rice used as food', unit: 't' }
      ],
      interpretation: 'What share of the rice people actually eat the country could grow itself. ' +
        'This differs from the standard SSR because the standard denominator is total utilization, ' +
        'which includes non-food uses and, where re-export goes unrecorded, rice that left the ' +
        'country. For an entrepot economy this is the more meaningful of the two.',
      limitations: 'NOT the FAO self-sufficiency definition, which uses domestic supply as the ' +
        'denominator. Reported alongside SSR rather than instead of it, and the two answer different ' +
        'questions. Requires food balance sheet coverage.',
      fbs: true,
      compute: b => {
        const food = fbsSeries(b, 'food');
        return mapPair(b.production, food, (p, f) => safeDiv(100 * p, f));
      }
    },

    /* The SSR as the Coalition for African Rice Development publishes it on the
     * AfricaRice country pages (riceforafrica.net). Same FAO (2001) formula as
     * `ssr`, but every term is taken from INSIDE the Food Balance Sheet rather
     * than from the trade matrix.
     *
     * That single choice is the whole reason the platform's SSR and the CARD
     * country pages disagree, and the disagreement can be large. FBS trade is
     * the balanced series -- reconciled against supply and utilization, with
     * re-exports and stock movements resolved -- whereas the trade matrix is
     * what customs reported. For Senegal in 2023 the matrix gives imports of
     * 1,302,312 t; the balance sheet gives 1,566,460 t, and CARD publishes
     * 1,559,000 t. Reproducing them therefore requires the FBS route.
     *
     * Verified against the published pages: Senegal 2023 40.66% vs CARD 40.7%,
     * Nigeria 99.92% vs CARD 99.9%. Both inside a rounding step. */
    ssrFbs: {
      id: 'ssrFbs', label: 'Self-sufficiency, balance-sheet basis (CARD convention)',
      category: 'Food security', unit: PCT,
      equation: 'SSR^FBS_t = 100 x P^FBS_t / (P^FBS_t + M^FBS_t - X^FBS_t)',
      latex: 'SSR^{\\text{FBS}}_t = \\frac{P^{\\text{FBS}}_t}' +
             '{P^{\\text{FBS}}_t + M^{\\text{FBS}}_t - X^{\\text{FBS}}_t}\\times 100',
      variables: [
        { sym: 'P^FBS_t', def: 'production as carried in the food balance sheet, milled basis', unit: 't' },
        { sym: 'M^FBS_t', def: 'imports as carried in the food balance sheet', unit: 't' },
        { sym: 'X^FBS_t', def: 'exports as carried in the food balance sheet', unit: 't' }
      ],
      note: 'This is the series to use when checking the platform against the AfricaRice / CARD ' +
            'country pages at riceforafrica.net. It is the same FAO formula as SSR; only the ' +
            'source of the trade terms differs.',
      interpretation: 'Self-sufficiency measured on the reconciled balance sheet. Where this and ' +
        'the trade-matrix SSR diverge, the gap is unrecorded re-export or a stock movement that ' +
        'the balance sheet has resolved and the customs series has not. Benin is the clearest ' +
        'case in Africa: rice enters, is counted as an import, and leaves again for Nigeria ' +
        'without ever being recorded as an export.',
      limitations: 'Requires food balance sheet coverage, which is incomplete: Benin, Mali, Togo ' +
        'and Sudan are entirely absent from the current FAOSTAT release, so for those countries ' +
        'this series stops in 2013 where the historic release ends. It is also a later and less ' +
        'frequently updated series than the trade matrix.',
      source: 'FAOSTAT Food Balance Sheets, elements 5511 / 5611 / 5911',
      fbs: true,
      compute: b => {
        const P = fbsSeries(b, 'production');
        const M = fbsSeries(b, 'imports');
        const X = fbsSeries(b, 'exports');
        const out = new Array(b.years.length).fill(null);
        // Same canonical function as `ssr`; only the source of the terms differs.
        for (let i = 0; i < out.length; i++) out[i] = RSA.selfSufficiency(P[i], M[i], X[i]);
        return out;
      }
    },

    kcalRice: {
      id: 'kcalRice', label: 'Calories from rice', category: 'Food security', unit: 'kcal/capita/day',
      equation: 'K_t  (FAOSTAT Food Balance Sheet, element 664)',
      latex: 'K_t',
      variables: [{ sym: 'K_t', def: 'dietary energy supplied by rice per person per day', unit: 'kcal/capita/day' }],
      interpretation: 'How much of the diet rice actually carries. A country where rice supplies 700 ' +
        'kcal/day has a very different exposure to a rice price shock than one where it supplies 50.',
      limitations: 'Energy availability, not intake, and it ignores distribution entirely.',
      source: 'FAOSTAT Food Balance Sheets, element 664',
      fbs: true,
      compute: b => fbsSeries(b, 'kcalPerCapitaDay')
    },

    /* ---- further balance-sheet indicators ---- */
    icr: {
      id: 'icr', label: 'Import coverage ratio (ICR)', category: 'Food security', unit: 'ratio',
      equation: 'ICR_t = P_t / M_t',
      latex: 'ICR_t = \\frac{P_t}{M_t}',
      variables: [
        { sym: 'ICR_t', def: 'import coverage ratio in year t', unit: 'ratio' },
        { sym: 'P_t', def: 'domestic production in year t', unit: 't' },
        { sym: 'M_t', def: 'imports in year t', unit: 't' }
      ],
      interpretation: 'How many tonnes the country grows for each tonne it imports. Above 1 means ' +
        'domestic production is the larger source.',
      limitations: 'Undefined when imports are zero, and unstable when they are small; read it ' +
        'alongside SSR rather than instead of it.',
      compute: b => mapPair(b.production, b.imports, (p, m) => safeDiv(p, m))
    },

    ntr: {
      id: 'ntr', label: 'Net trade ratio (NTR)', category: 'Trade', unit: 'index (-1 to 1)',
      equation: 'NTR_t = (X_t - M_t) / (X_t + M_t)',
      latex: 'NTR_t = \\frac{X_t - M_t}{X_t + M_t}',
      variables: [
        { sym: 'NTR_t', def: 'net trade ratio in year t', unit: 'index' },
        { sym: 'X_t', def: 'exports in year t', unit: 't' },
        { sym: 'M_t', def: 'imports in year t', unit: 't' }
      ],
      interpretation: 'Bounded on [-1, 1]. -1 is a pure importer, +1 a pure exporter, 0 balanced ' +
        'two-way trade. Being scale-free it compares countries of very different size.',
      limitations: 'Undefined when a country neither imports nor exports. A value near zero can mean ' +
        'either balanced large flows or no trade at all.',
      compute: b => mapPair(b.exports, b.imports, (x, m) => (x + m === 0) ? null : (x - m) / (x + m))
    },

    pcb: {
      id: 'pcb', label: 'Production-consumption balance (PCB)', category: 'Food security', unit: T,
      equation: 'PCB_t = P_t - C_t',
      latex: 'PCB_t = P_t - C_t',
      variables: [
        { sym: 'PCB_t', def: 'production-consumption balance in year t', unit: 't' },
        { sym: 'P_t', def: 'domestic production in year t', unit: 't' },
        { sym: 'C_t', def: 'apparent utilization in year t', unit: 't' }
      ],
      interpretation: 'The absolute rice deficit (negative) or surplus (positive). Where SSR gives the ' +
        'proportion, PCB gives the tonnage a policy actually has to close.',
      limitations: 'Since C = P + M - X by construction, PCB reduces to X - M. It is presented ' +
        'separately because the deficit framing is what scenario work needs, but it carries no ' +
        'information beyond net trade.',
      compute: b => mapPair(b.production, b.consumption, (p, c) => p - c)
    },

    pcg: {
      id: 'pcg', label: 'Per capita production-consumption gap (PCG)', category: 'Food security', unit: KGC,
      equation: 'PCG_t = PPC_t - CPC_t',
      latex: 'PCG_t = PPC_t - CPC_t',
      variables: [
        { sym: 'PCG_t', def: 'per capita production-consumption gap in year t', unit: 'kg/capita' },
        { sym: 'PPC_t', def: 'per capita production in year t', unit: 'kg/capita' },
        { sym: 'CPC_t', def: 'per capita consumption in year t', unit: 'kg/capita' }
      ],
      interpretation: 'How many kilograms per person per year must come from outside domestic ' +
        'production. Useful for communicating a deficit at household scale.',
      limitations: 'Meaningful ONLY when production and consumption are on the same product basis. ' +
        'On the as-published FAOSTAT basis the two terms are different commodities -- paddy against ' +
        'milled -- and the difference is not a real quantity of anything. Switch to the milled basis ' +
        'before quoting this indicator.',
      requiresConsistentBasis: true,
      compute: b => {
        const ppc = INDICATORS.ppc.compute(b);
        const cpc = INDICATORS.cpc.compute(b);
        return mapPair(ppc, cpc, (a, c) => a - c);
      }
    },

    /* ---- per-capita land and productivity ---- */
    ppcArea: {
      id: 'ppcArea', label: 'Rice area per capita', category: 'Land', unit: 'ha/1000 capita',
      equation: 'APC_t = 1000 x A_t / N_t',
      latex: 'APC_t = \\frac{1000 \\, A_t}{N_t}',
      variables: [
        { sym: 'APC_t', def: 'rice harvested area per thousand inhabitants', unit: 'ha/1000 capita' },
        { sym: 'A_t', def: 'rice harvested area in year t', unit: 'ha' },
        { sym: 'N_t', def: 'total population in year t', unit: 'persons' }
      ],
      interpretation: 'Whether rice land is keeping pace with population. A falling series means area ' +
        'growth is slower than population growth, so yield must rise just to stand still.',
      limitations: 'Ignores land quality, irrigation and cropping intensity.',
      compute: b => mapPair(b.area, b.population, (a, n) => safeDiv(1000 * a, n))
    },

    /* ---- the rice economy ---- */
    importBill: {
      id: 'importBill', label: 'Rice import bill', category: 'Economy', unit: '1000 USD',
      equation: 'IB_t = V^M_t',
      latex: 'IB_t = V^M_t',
      variables: [{ sym: 'V^M_t', def: 'reported CIF value of rice imports in year t', unit: '1000 USD' }],
      interpretation: 'What the country spent on imported rice, in current US dollars, as reported to ' +
        'FAOSTAT. This is the foreign exchange rice import dependence actually costs.',
      limitations: 'Current prices, not deflated: part of any upward trend is world inflation. ' +
        'Available on the FAOSTAT source only -- USDA PSD publishes quantities, not values.',
      compute: b => b.importValue.slice()
    },

    importUnitValue: {
      id: 'importUnitValue', label: 'Rice import unit value', category: 'Economy', unit: 'USD/t',
      equation: 'UV_t = 1000 x V^M_t / M_t',
      latex: 'UV_t = \\frac{1000 \\, V^M_t}{M_t}',
      variables: [
        { sym: 'UV_t', def: 'implied import unit value in year t', unit: 'USD/t' },
        { sym: 'V^M_t', def: 'value of rice imports in year t', unit: '1000 USD' },
        { sym: 'M_t', def: 'quantity of rice imports in year t', unit: 't' }
      ],
      interpretation: 'The average CIF price paid per tonne of imported rice. The closest thing to an ' +
        'import price the trade data supports.',
      limitations: 'A unit value, not a price: it mixes rice grades and qualities, and shifts in the ' +
        'import mix move it independently of any world price change. Do not treat it as a quotation.',
      compute: b => mapPair(b.importValue, b.imports, (v, m) => safeDiv(1000 * v, m))
    },

    importBillPerCapita: {
      id: 'importBillPerCapita', label: 'Rice import bill per capita', category: 'Economy', unit: 'USD/capita',
      equation: 'IBPC_t = 1000 x V^M_t / N_t',
      latex: 'IBPC_t = \\frac{1000 \\, V^M_t}{N_t}',
      variables: [
        { sym: 'IBPC_t', def: 'rice import bill per inhabitant', unit: 'USD/capita' },
        { sym: 'V^M_t', def: 'value of rice imports in year t', unit: '1000 USD' },
        { sym: 'N_t', def: 'total population in year t', unit: 'persons' }
      ],
      interpretation: 'The annual foreign-exchange cost of imported rice per inhabitant.',
      limitations: 'Current USD, undeflated, and not adjusted for purchasing power.',
      compute: b => mapPair(b.importValue, b.population, (v, n) => safeDiv(1000 * v, n))
    },

    tradeBalanceValue: {
      id: 'tradeBalanceValue', label: 'Rice trade balance', category: 'Economy', unit: '1000 USD',
      equation: 'TB_t = V^X_t - V^M_t',
      latex: 'TB_t = V^X_t - V^M_t',
      variables: [
        { sym: 'TB_t', def: 'rice trade balance in year t', unit: '1000 USD' },
        { sym: 'V^X_t', def: 'value of rice exports in year t', unit: '1000 USD' },
        { sym: 'V^M_t', def: 'value of rice imports in year t', unit: '1000 USD' }
      ],
      interpretation: 'Net foreign exchange earned (positive) or spent (negative) on rice.',
      limitations: 'Current prices. Export values include re-exports, which for entrepot economies ' +
        'offset imports that never fed anyone locally.',
      compute: b => {
        const n = b.importValue.length;
        const out = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
          const m = b.importValue[i], x = b.exportValue[i];
          if (m == null && x == null) continue;
          out[i] = (x == null ? 0 : x) - (m == null ? 0 : m);
        }
        return out;
      }
    }
  };

  /* ---------------------------------------------------------------- access */

  /* Descriptors with localised labels -- see get() for why the localisation
   * lives here rather than at each call site. */
  function list(category) {
    return Object.keys(INDICATORS)
      .filter(id => !category || INDICATORS[id].category === category)
      .map(id => get(id));
  }

  function categories() {
    const out = [];
    Object.keys(INDICATORS).forEach(id => {
      const c = INDICATORS[id].category;
      if (out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }

  /* Returns the descriptor with `label` ALREADY LOCALISED.
   *
   * Callers reach for `get(id).label` far more naturally than for `label(id)`,
   * and every place that did so silently rendered English. Rather than police
   * that at ~40 call sites, the localisation is applied here, so the obvious
   * thing to write is also the correct one. `labelEn` keeps the English name
   * for exports, CSV headers and the reproducibility manifest, which must stay
   * readable by whoever receives the file regardless of the UI language. */
  function get(id) {
    const ind = INDICATORS[id];
    if (!ind) return null;
    const loc = label(id);
    if (loc === ind.label) return ind;
    // A shallow copy, not Object.create: a prototype view would hide every field
    // from Object.keys and JSON.stringify, and descriptors get serialised into
    // the data dictionary and the reproducibility manifest.
    return Object.assign({}, ind, { label: loc, labelEn: ind.label });
  }

  /* Localised unit for DISPLAY only.
   *
   * The raw `unit` field stays untouched because formatting logic compares it
   * as a literal (`unit === '%'` decides decimal places in several places).
   * Localising it in place would silently change number formatting the moment
   * the language changed, which is a far worse bug than an untranslated unit. */
  const UNIT_KEYS = {
    't': 'unit.t', 'ha': 'unit.ha', 'kg/ha': 'unit.kgha',
    'kg/capita': 'unit.kgcap', '%': 'unit.pct'
  };
  function unitLabel(unit) {
    if (typeof RSAi18n === 'undefined' || !unit) return unit || '';
    const key = UNIT_KEYS[unit];
    return (key && RSAi18n.has(key)) ? RSAi18n.t(key) : unit;
  }

  /* Localised name of an indicator group ("Trade", "Food security", ...). */
  function categoryLabel(cat) {
    if (typeof RSAi18n === 'undefined') return cat;
    const key = 'cat.' + cat;
    return RSAi18n.has(key) ? RSAi18n.t(key) : cat;
  }

  /* Localised display label. Falls back to the English label when no translation
   * exists, so an untranslated indicator shows its real name rather than a key.
   * The underlying `label` field is left alone: exports, CSV headers and the
   * reproducibility manifest stay in English so a file is readable by whoever
   * receives it, regardless of the language it was generated in. */
  function label(id) {
    if (typeof RSAi18n === 'undefined') return (INDICATORS[id] || {}).label || id;
    const key = 'ind.' + id;
    return RSAi18n.has(key) ? RSAi18n.t(key) : ((INDICATORS[id] || {}).label || id);
  }

  /* Computes one indicator over a balance sheet and returns it with everything
   * needed to plot, tabulate, caption and cite it. */
  function compute(id, bal) {
    const ind = INDICATORS[id];
    if (!ind) throw new Error('unknown indicator: ' + id);
    const values = ind.compute(bal);
    const flags = [];

    if (ind.requiresConsistentBasis && bal.basis === 'asPublished' && bal.dbKey === 'fao') {
      flags.push({
        level: 'warning',
        text: ind.label + ' subtracts a milled quantity from a paddy quantity on the as-published ' +
              'basis and is not interpretable. Switch to the milled basis.'
      });
    }
    if (id === 'idr') {
      const over = [];
      for (let i = 0; i < values.length; i++) if (values[i] != null && values[i] > 100) over.push(bal.years[i]);
      if (over.length) {
        flags.push({
          level: 'info',
          text: 'IDR exceeds 100% in ' + over.length + ' year(s) (' + summariseYears(over) + '). This ' +
                'means recorded imports exceed domestic utilization, which happens when a country ' +
                're-exports a large share of what it imports. It is a property of the FAO definition, ' +
                'not a data error.'
        });
      }
    }
    if (id === 'ssr' && bal.dbKey === 'fao' && bal.basis === 'asPublished') {
      flags.push({
        level: 'warning',
        text: 'SSR on the as-published basis divides paddy production by a denominator containing ' +
              'milled trade, and is biased upward. The milled basis gives roughly ' +
              (RSA.DEFAULT_MILLING_RATE * 100).toFixed(0) + '% of this value where trade is small.'
      });
    }

    return {
      id: id,
      // Localised for display; labelEn kept so exports stay language-independent.
      label: label(id),
      labelEn: ind.label,
      unit: ind.unit,
      unitLabel: unitLabel(ind.unit),
      category: ind.category,
      categoryLabel: categoryLabel(ind.category),
      equation: ind.equation,
      latex: ind.latex,
      variables: ind.variables,
      interpretation: ind.interpretation,
      limitations: ind.limitations,
      source: ind.source || null,
      years: bal.years.slice(),
      values: values,
      db: bal.db,
      basis: bal.basis,
      selection: bal.label,
      flags: flags.concat(bal.notes || [])
    };
  }

  function summariseYears(ys) {
    if (ys.length <= 6) return ys.join(', ');
    return ys[0] + '-' + ys[ys.length - 1] + ', ' + ys.length + ' years';
  }

  /* Descriptive statistics for a computed indicator, used by the report and the
   * country profile. */
  function describe(res, from, to) {
    const ys = res.years, vs = res.values;
    let first = null, last = null, min = null, max = null, sum = 0, n = 0;
    for (let i = 0; i < vs.length; i++) {
      if (vs[i] == null) continue;
      if (from != null && ys[i] < from) continue;
      if (to != null && ys[i] > to) continue;
      if (first == null) first = { year: ys[i], value: vs[i] };
      last = { year: ys[i], value: vs[i] };
      if (min == null || vs[i] < min.value) min = { year: ys[i], value: vs[i] };
      if (max == null || vs[i] > max.value) max = { year: ys[i], value: vs[i] };
      sum += vs[i]; n++;
    }
    return {
      first: first, last: last, min: min, max: max,
      mean: n ? sum / n : null,
      observations: n,
      cagr: cagr(ys, vs, from, to),
      growth: growth(vs)
    };
  }

  return {
    INDICATORS: INDICATORS,
    list: list,
    categories: categories,
    get: get,
    label: label,
    categoryLabel: categoryLabel,
    unitLabel: unitLabel,
    compute: compute,
    describe: describe,
    cagr: cagr,
    growth: growth,
    safeDiv: safeDiv
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSAIndicators; }
