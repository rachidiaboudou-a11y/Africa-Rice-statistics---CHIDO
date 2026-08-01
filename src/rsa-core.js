/* Rice Statistics for Africa -- core data layer.
 *
 * Loads the two source databases, resolves country / region / bloc selections,
 * and assembles the rice balance sheet that every other module consumes.
 *
 * The one genuinely delicate thing in this file is PRODUCT BASIS, so it is worth
 * stating plainly up front.
 *
 * FAOSTAT reports rice production as PADDY (rough rice, item 27) but reports rice
 * trade as MILLED rice (item 31). Those are not the same commodity: milling a
 * tonne of paddy yields roughly two-thirds of a tonne of milled rice. Dividing
 * paddy production by a paddy-plus-milled-trade "consumption" figure therefore
 * mixes units, and the resulting self-sufficiency ratio is not a pure ratio of
 * like to like.
 *
 * The published literature does this anyway -- including Gassi, Gul & Cetin
 * (2025), whose Benin results this platform reproduces exactly -- because it is
 * what the raw FAOSTAT columns give you. Rather than silently "fix" their numbers
 * or silently repeat the problem, the platform carries an explicit basis setting:
 *
 *   'asPublished'  paddy production against milled trade, no conversion. Matches
 *                  Gassi et al. (2025) and most of the FAOSTAT-based literature.
 *                  SSR computed this way is NOT unit-consistent and, because
 *                  paddy overstates the edible quantity, it is biased UPWARD.
 *   'milled'       paddy production converted to milled equivalent before the
 *                  ratio is taken. Unit-consistent. The scientifically preferred
 *                  basis, and the one the platform recommends.
 *   'paddy'        milled trade converted up to paddy equivalent instead. Also
 *                  unit-consistent; useful when the question is about land and
 *                  farm-level output rather than about food on plates.
 *
 * USDA PSD does not have this problem: it reports production, trade, consumption
 * and stocks all on a milled basis, and publishes the milling rate it used.
 */

/* Bumped whenever a change alters computed output. Written into every report and
 * every reproducibility manifest, so a saved result can always be traced back to
 * the code that produced it. */
const RSA_VERSION = '1.0.0';

const RSA = (function () {
  'use strict';

  // FAO's default paddy -> milled conversion (FAO, Food Balance Sheets handbook,
  // 2001). Real milling outturn varies by variety, moisture and mill technology,
  // roughly 0.60-0.70; USDA publishes a country-specific rate which this module
  // prefers whenever the USDA module is the active source.
  const DEFAULT_MILLING_RATE = 0.67;

  const state = {
    fao: null,
    usda: null,
    meta: null,
    registry: null,
    geo: null,
    loaded: false
  };

  /* ---------------------------------------------------------------- loading */

  async function load(base) {
    if (state.loaded) return state;
    base = base || 'data/';
    const [meta, fao, usda, registry] = await Promise.all([
      fetch(base + 'rsa-meta.json').then(r => r.json()),
      fetch(base + 'rsa-fao.json').then(r => r.json()),
      fetch(base + 'rsa-usda.json').then(r => r.json()),
      fetch(base + 'rsa-registry.json').then(r => r.json())
    ]);
    state.meta = meta;
    state.fao = fao;
    state.usda = usda;
    state.registry = registry;
    // Boundaries are optional: the platform is fully usable without them, so a
    // missing or unreachable geo file degrades to the schematic map rather than
    // failing the whole load.
    try {
      state.geo = await fetch(base + 'rsa-geo.json').then(r => r.ok ? r.json() : null);
    } catch (e) { state.geo = null; }
    state.loaded = true;
    return state;
  }

  // Test entry point: inject already-parsed objects instead of fetching.
  function inject(meta, fao, usda, registry, geo) {
    state.meta = meta; state.fao = fao; state.usda = usda;
    state.registry = registry; state.geo = geo || null; state.loaded = true;
    return state;
  }

  /* ------------------------------------------------------------- geography */

  function countries() { return state.registry.slice(); }

  function country(iso3) {
    return state.registry.find(c => c.iso3 === iso3) || null;
  }

  function regions() {
    const seen = [];
    state.registry.forEach(c => { if (seen.indexOf(c.region) < 0) seen.push(c.region); });
    return seen.sort();
  }

  function blocs() {
    return Object.keys(state.meta.blocs).map(k => ({
      id: k, label: state.meta.blocs[k].label, note: state.meta.blocs[k].note
    }));
  }

  // Resolves a selection into a concrete list of ISO3 codes.
  //   {kind:'country', id:'BEN'}  {kind:'region', id:'Western Africa'}
  //   {kind:'bloc', id:'ECOWAS'}  {kind:'africa'}  {kind:'custom', ids:[...]}
  /* Resolve a selection to member ISO3 codes, keeping only codes the registry
   * actually knows. A typo'd code used to pass straight through, so balance()
   * returned a correctly-shaped all-null series labelled with the typo -- a
   * silent wrong answer rather than a refusal. Unknown members come back
   * separately so the caller can say so instead of drawing an empty chart. */
  function resolveDetailed(sel) {
    if (!sel) return { members: [], unknown: [], validKind: false };
    const known = id => state.registry.some(c => c.iso3 === id);
    const sift = ids => {
      const members = [], unknown = [];
      ids.forEach(id => (known(id) ? members : unknown).push(id));
      return { members: members, unknown: unknown, validKind: true };
    };
    switch (sel.kind) {
      case 'country': return sift([sel.id]);
      case 'custom':  return sift((sel.ids || []).slice());
      case 'region': {
        const m = state.registry.filter(c => c.region === sel.id).map(c => c.iso3);
        return { members: m, unknown: m.length ? [] : [sel.id], validKind: true };
      }
      case 'bloc': {
        const m = state.registry.filter(c => c.blocs.indexOf(sel.id) >= 0).map(c => c.iso3);
        return { members: m, unknown: m.length ? [] : [sel.id], validKind: true };
      }
      case 'africa':  return { members: state.registry.map(c => c.iso3), unknown: [], validKind: true };
      default:        return { members: [], unknown: [], validKind: false };
    }
  }

  function resolve(sel) { return resolveDetailed(sel).members; }

  function selectionLabel(sel) {
    if (!sel) return '';
    switch (sel.kind) {
      case 'country': { const c = country(sel.id); return c ? c.name : sel.id; }
      case 'region':  return sel.id;
      case 'bloc':    return (state.meta.blocs[sel.id] || {}).label || sel.id;
      case 'africa':  return 'Africa (all reporting countries)';
      case 'custom':  return 'Custom group (' + (sel.ids || []).length + ' countries)';
      default:        return '';
    }
  }

  /* --------------------------------------------------------------- series */

  function db(name) { return name === 'usda' ? state.usda : state.fao; }

  // Raw series straight out of a source database, with its provenance attached.
  function series(dbName, iso3, field) {
    const d = db(dbName);
    const s = d.series[iso3];
    if (!s || !s[field]) return null;
    const years = (field === 'population') ? d.popYears : d.years;
    return {
      db: d.db,
      iso3: iso3,
      field: field,
      unit: d.units[field] || '',
      years: years.slice(),
      values: s[field].slice(),
      extracted: d.extracted
    };
  }

  function hasSeries(dbName, iso3) {
    const d = db(dbName);
    return !!(d.series && d.series[iso3]);
  }

  /* -------------------------------------------------- the rice balance sheet
   *
   * Everything downstream -- indicators, forecasts, scenarios, the report --
   * reads this one structure, so it is the single place where units, basis and
   * missing-data policy are decided.
   *
   * Returned quantities are all in TONNES on the requested basis, population in
   * PERSONS, and every year carries a flag saying whether the observation was
   * reported, derived, or absent.
   */
  const BASES = ['asPublished', 'milled', 'paddy'];

  function balance(dbName, sel, opts) {
    opts = opts || {};
    const basis = BASES.indexOf(opts.basis) >= 0 ? opts.basis : 'asPublished';
    const rate = opts.millingRate > 0 ? opts.millingRate : DEFAULT_MILLING_RATE;
    const res = resolveDetailed(sel);
    const isoList = res.members;
    const d = db(dbName);
    const years = d.years.slice();
    const n = years.length;

    const out = {
      db: d.db,
      dbKey: dbName,
      selection: sel,
      label: selectionLabel(sel),
      members: isoList.slice(),
      // Selection validity, so an empty chart can be explained rather than shown
      // blank: `unknown` lists codes or group names the registry does not have.
      unknownMembers: res.unknown.slice(),
      selectionValid: res.validKind && res.unknown.length === 0 && isoList.length > 0,
      basis: basis,
      millingRate: rate,
      years: years,
      production: new Array(n).fill(null),
      imports: new Array(n).fill(null),
      exports: new Array(n).fill(null),
      consumption: new Array(n).fill(null),
      area: new Array(n).fill(null),
      yield: new Array(n).fill(null),
      population: new Array(n).fill(null),
      importValue: new Array(n).fill(null),
      exportValue: new Array(n).fill(null),
      stocksChange: new Array(n).fill(null),
      reporting: new Array(n).fill(0),      // how many members reported production
      // Years where exports exceeded production plus imports, so apparent
      // utilization came out negative and every ratio built on it was withheld.
      brokenBalanceYears: [],
      notes: [],
      unit: 't',
      populationUnit: 'persons',
      consumptionMethod: null,
      tradeItem: null
    };

    if (!res.validKind) {
      out.notes.push({
        level: 'error',
        text: 'Selection kind "' + (sel && sel.kind) + '" is not recognised, so no countries ' +
              'were selected and every series below is empty.'
      });
    } else if (res.unknown.length) {
      out.notes.push({
        level: 'error',
        text: 'Not in the registry, so excluded from this selection: ' + res.unknown.join(', ') +
              '. Check the code against the list in RSA.countries().'
      });
    }

    /* Which FAOSTAT trade series to use.
     *
     * DEFAULT: item 30, "Rice, paddy (rice milled equivalent)" -- FAOSTAT's
     * STANDARDIZED total rice trade aggregate, covering husked, milled and broken
     * rice expressed on one basis.
     *
     * The alternative, item 31 "Rice, milled", is what Gassi et al. (2025) use and
     * what this platform used to default to. That was wrong for most of Africa.
     * Item 31 EXCLUDES BROKEN RICE, and broken rice is the staple import across
     * much of West Africa -- it is what Senegalese thieboudienne is made from.
     * The consequence is not marginal:
     *
     *   Senegal, 2024 imports    item 31:    38,651 t
     *                            item 30: 1,387,262 t
     *                            USDA PSD: ~1,400,000 t
     *
     * Item 31 understated Senegal's rice imports thirty-six fold and put its
     * self-sufficiency ratio near 99% instead of the mid-forties. Item 30 agrees
     * with USDA's independent estimate to within a few per cent.
     *
     * So item 30 is the default because it is the one that measures rice imports.
     * Item 31 remains selectable, because reproducing the published Benin results
     * requires it -- but it is now an explicit choice rather than a silent one.
     */
    const stdTrade = opts.standardizedTrade !== false;
    const impField = (dbName === 'fao' && stdTrade) ? 'importsStd' : 'imports';
    const expField = (dbName === 'fao' && stdTrade) ? 'exportsStd' : 'exports';
    const impValField = (dbName === 'fao' && stdTrade) ? 'importValueStd' : 'importValue';
    const expValField = (dbName === 'fao' && stdTrade) ? 'exportValueStd' : 'exportValue';
    out.tradeItem = (dbName === 'fao') ? (stdTrade ? 30 : 31) : null;

    // USDA consumption: its own estimate, or the same apparent-utilization
    // identity FAOSTAT forces on us. Default to the identity so the two
    // databases are compared on the same definition.
    const usdaReported = !!opts.usdaReportedConsumption;

    for (let i = 0; i < n; i++) {
      let P = null, M = null, X = null, A = null, Pop = null, IV = null, XV = null, RC = null, DC = null;

      for (let k = 0; k < isoList.length; k++) {
        const iso = isoList[k];
        const s = d.series[iso];
        if (!s) continue;

        // ---- production, converted to the requested basis
        let p = null;
        if (dbName === 'fao') {
          p = s.production[i];                        // tonnes, PADDY
          /* Eleven African countries -- Libya, Tunisia, Botswana, Namibia, Lesotho,
           * Cabo Verde, Equatorial Guinea, Sao Tome, Djibouti, Eritrea, Seychelles
           * -- grow no rice at all, so FAOSTAT carries no production row for them
           * rather than a row of zeros. Left as missing, every ratio built on
           * production comes out null and they vanish from maps and rankings,
           * which reads as "no data" when the truth is "no rice".
           *
           * Where a country has NO production observation anywhere in the record
           * but DOES report rice trade, production is taken as zero. That is a
           * derived value, not an observed one, and it is flagged as such. It is
           * not applied to countries that merely have a gap in an otherwise
           * populated series -- those really are missing. */
          if (p == null && growsNoRice(d, iso) && s[impField][i] != null) {
            p = 0;
            out.derivedZeroProduction = true;
          }
          if (p != null) {
            if (basis === 'milled') p = p * rate;     // paddy -> milled
            // 'asPublished' and 'paddy' both leave paddy production alone
          }
        } else {
          // USDA: production (028) is already milled, in 1000 t.
          const milled = s.production[i];
          const rough = s.roughProduction[i];
          const cRate = (s.millingRate && s.millingRate[i] != null && s.millingRate[i] > 0)
            ? s.millingRate[i] / 10000 : rate;
          if (basis === 'paddy') {
            p = (rough != null) ? rough * 1000 : (milled != null ? milled * 1000 / cRate : null);
          } else {
            p = (milled != null) ? milled * 1000 : null;
          }
        }

        // ---- trade, converted to the requested basis
        let m = null, x = null;
        if (dbName === 'fao') {
          m = s[impField][i];                          // tonnes, MILLED
          x = s[expField][i];
          if (basis === 'paddy') {
            if (m != null) m = m / rate;
            if (x != null) x = x / rate;
          }
          // 'asPublished' and 'milled' both leave milled trade alone
        } else {
          m = s.imports[i] != null ? s.imports[i] * 1000 : null;
          x = s.exports[i] != null ? s.exports[i] * 1000 : null;
          if (basis === 'paddy') {
            const cRate = (s.millingRate && s.millingRate[i] != null && s.millingRate[i] > 0)
              ? s.millingRate[i] / 10000 : rate;
            if (m != null) m = m / cRate;
            if (x != null) x = x / cRate;
          }
        }

        // ---- area, values, population, USDA-only extras
        let a = null;
        if (dbName === 'fao') {
          a = s.area[i];
          IV = addNullable(IV, s[impValField][i]);
          XV = addNullable(XV, s[expValField][i]);
        } else {
          a = s.area[i] != null ? s.area[i] * 1000 : null;   // 1000 ha -> ha
          const bs = s.beginStocks[i], es = s.endStocks[i];
          if (bs != null && es != null) RC = addNullable(RC, (es - bs) * 1000);
          if (usdaReported && s.consumption[i] != null) {
            let c = s.consumption[i] * 1000;
            if (basis === 'paddy') {
              const cRate = (s.millingRate && s.millingRate[i] != null && s.millingRate[i] > 0)
                ? s.millingRate[i] / 10000 : rate;
              c = c / cRate;
            }
            DC = addNullable(DC, c);
          }
        }

        // Population always comes from FAOSTAT's UN WPP series: USDA PSD does not
        // publish population, and using one demographic source for both databases
        // keeps per-capita comparisons about rice rather than about demography.
        const fs = state.fao.series[iso];
        if (fs) {
          const pi = state.fao.popYears.indexOf(years[i]);
          if (pi >= 0 && fs.population[pi] != null) Pop = addNullable(Pop, fs.population[pi] * 1000);
        }

        if (p != null) out.reporting[i]++;
        P = addNullable(P, p);
        M = addNullable(M, m);
        X = addNullable(X, x);
        A = addNullable(A, a);
      }

      out.production[i] = P;
      out.imports[i] = M;
      out.exports[i] = X;
      out.area[i] = A;
      out.population[i] = Pop;
      out.importValue[i] = IV;
      out.exportValue[i] = XV;
      out.stocksChange[i] = RC;

      // Yield is a ratio and must be recomputed from the aggregated numerator and
      // denominator -- averaging member yields would weight a 200 ha producer the
      // same as a 3 Mha one.
      if (A != null && A > 0 && P != null) {
        // Yield is always expressed on the production basis in use, kg/ha.
        out.yield[i] = P * 1000 / A;
      }

      // Consumption.
      if (dbName === 'usda' && usdaReported && DC != null) {
        out.consumption[i] = DC;
        out.consumptionMethod = 'USDA reported domestic consumption (attribute 125)';
      } else if (P != null && M != null) {
        // Apparent utilization, excluding stock change -- the FAO (2001)
        // definition the Gassi et al. formulas rest on. A missing export figure
        // is treated as zero, which is what FAOSTAT's own suppression convention
        // implies and what the source paper's arithmetic requires; the flag
        // below records it so the platform can say so.
        const supply = P + M - (X != null ? X : 0);
        /* A negative apparent utilization is not a lean year, it is a broken
         * balance sheet: the country cannot have exported more rice than it grew
         * and bought. FAOSTAT carries a handful of these -- Kenya in 1992 reports
         * exports of 175,541 t against production of 29,616 t and imports of
         * 59,597 t, which used to yield an SSR of -34.3%, an import dependency of
         * -69.0% and a per-capita consumption of -3.5 kg, all plotted as fact.
         *
         * Every ratio here divides by this quantity, so leaving it null is what
         * makes the whole family of indicators drop out together for that year
         * rather than each inventing its own nonsense. The year is recorded so
         * the platform can say WHICH years it withheld and why. */
        if (supply > 0) {
          out.consumption[i] = supply;
        } else if (supply < 0) {
          out.brokenBalanceYears.push({ year: years[i], supply: supply,
                                        production: P, imports: M, exports: X || 0 });
        }
        out.consumptionMethod = 'apparent utilization: P + M - X, excluding stock change (FAO 2001)';
      }
    }

    if (out.brokenBalanceYears.length) {
      const yrs = out.brokenBalanceYears.map(b => b.year).join(', ');
      out.notes.push({
        level: 'warning',
        text: 'Withheld as unusable: ' + yrs + '. In ' +
              (out.brokenBalanceYears.length === 1 ? 'that year' : 'those years') +
              ' the source reports exports exceeding production plus imports, so apparent ' +
              'utilization is negative and every ratio resting on it — self-sufficiency, ' +
              'import dependency, consumption per capita — would be meaningless. The ' +
              'underlying production and trade figures are still shown; only the derived ' +
              'ratios are suppressed.'
      });
      if (typeof RSAValidate !== 'undefined') {
        RSAValidate.logWarning('balance',
          out.label + ' (' + dbName + '): negative apparent utilization in ' + yrs,
          { selection: out.label, db: dbName, years: out.brokenBalanceYears });
      }
    }

    // Keep any selection-validity note raised above: it is the most important
    // thing on the object when it fires, and assigning over it would drop it.
    out.notes = out.notes.concat(basisNotes(dbName, basis, rate, stdTrade, usdaReported));

    if (out.derivedZeroProduction) {
      out.notes.push({
        level: 'info',
        text: 'This selection includes at least one country that grows no rice at all, for which ' +
              'FAOSTAT carries no production row rather than a row of zeros. Production has been ' +
              'taken as zero in years where rice imports are reported, so the country appears with a ' +
              'self-sufficiency ratio of 0% rather than as missing data. That zero is DERIVED, not ' +
              'observed.'
      });
    }

    /* An aggregate summed over a changing set of reporting countries manufactures
     * growth that has nothing to do with rice. If the number of members actually
     * reporting production moves across the window, say so -- part of any rise in
     * the series is then composition, not production. */
    if (isoList.length > 1) {
      let minRep = Infinity, maxRep = 0, firstRep = null, lastRep = null;
      for (let i = 0; i < n; i++) {
        const r = out.reporting[i];
        if (r === 0) continue;
        if (firstRep == null) firstRep = { year: years[i], n: r };
        lastRep = { year: years[i], n: r };
        if (r < minRep) minRep = r;
        if (r > maxRep) maxRep = r;
      }
      if (firstRep && maxRep > minRep) {
        out.notes.push({
          level: 'warning',
          text: 'Aggregate composition changes over the period: between ' + minRep + ' and ' + maxRep +
                ' of the ' + isoList.length + ' selected countries report production in any given ' +
                'year (' + firstRep.n + ' in ' + firstRep.year + ', ' + lastRep.n + ' in ' +
                lastRep.year + '). Part of any change in the aggregate is therefore a change in which ' +
                'countries are counted, not in how much rice was grown. Compare countries ' +
                'individually where this matters.'
        });
      }
      out.reportingRange = { min: minRep === Infinity ? 0 : minRep, max: maxRep,
                             first: firstRep, last: lastRep, members: isoList.length };
    }
    return out;
  }

  function addNullable(acc, v) {
    if (v == null) return acc;
    return (acc == null) ? v : acc + v;
  }

  /* True when a country has no rice production observation anywhere in the
   * record -- it does not grow rice, as distinct from having a gap in a series
   * that is otherwise populated. Cached, since it is checked per country-year. */
  const _noRice = {};
  function growsNoRice(d, iso) {
    const key = d.db + '|' + iso;
    if (_noRice[key] != null) return _noRice[key];
    const s = d.series[iso];
    let any = false;
    if (s && s.production) {
      for (let i = 0; i < s.production.length; i++) {
        if (s.production[i] != null && s.production[i] > 0) { any = true; break; }
      }
    }
    _noRice[key] = !any;
    return _noRice[key];
  }

  function basisNotes(dbName, basis, rate, stdTrade, usdaReported) {
    const notes = [];
    if (dbName === 'fao') {
      if (basis === 'asPublished') {
        notes.push({
          level: 'warning',
          text: 'Basis: as published. Production is paddy (FAOSTAT item 27); trade is milled rice ' +
                '(item 31). The ratio is therefore not unit-consistent, and SSR is biased upward ' +
                'because paddy overstates the edible quantity. This reproduces Gassi, Gul & Cetin ' +
                '(2025) and the bulk of the FAOSTAT-based literature. Switch to the milled basis ' +
                'for a unit-consistent figure.'
        });
      } else if (basis === 'milled') {
        notes.push({
          level: 'info',
          text: 'Basis: milled equivalent. Paddy production multiplied by a milling rate of ' +
                rate.toFixed(2) + ' before the ratio is taken, so production and trade are on the ' +
                'same commodity. Unit-consistent; SSR is lower than the as-published figure.'
        });
      } else {
        notes.push({
          level: 'info',
          text: 'Basis: paddy equivalent. Milled trade divided by a milling rate of ' + rate.toFixed(2) +
                ' so that trade is expressed at farm-gate weight. Unit-consistent.'
        });
      }
      notes.push({
        level: stdTrade ? 'info' : 'warning',
        text: stdTrade
          ? 'Trade series: FAOSTAT item 30, "Rice, paddy (rice milled equivalent)" -- the ' +
            'standardized TOTAL rice trade aggregate, covering husked, milled and broken rice on a ' +
            'single basis. This is the series that measures rice trade.'
          : 'Trade series: FAOSTAT item 31, "Rice, milled" -- the series used by Gassi et al. (2025), ' +
            'selected here for replication. It EXCLUDES BROKEN RICE, which is the dominant imported ' +
            'form across much of West Africa, so rice imports are understated and self-sufficiency ' +
            'overstated -- for Senegal in 2024 by a factor of about thirty-six. Use item 30 for ' +
            'anything other than reproducing that paper.'
      });
    } else {
      notes.push({
        level: 'info',
        text: 'USDA PSD reports production, trade, consumption and stocks all on a milled basis, so ' +
              'no conversion is needed for unit consistency. Years are MARKET years, not calendar ' +
              'years, and are not directly comparable to FAOSTAT calendar years.'
      });
      notes.push({
        level: usdaReported ? 'info' : 'warning',
        text: usdaReported
          ? 'Consumption: USDA\'s own domestic consumption estimate, which incorporates stock change ' +
            'and is not a residual.'
          : 'Consumption: computed as P + M - X to match the FAO (2001) definition used on the ' +
            'FAOSTAT side. This ignores USDA\'s stock data and its own consumption estimate; it is ' +
            'chosen so the two databases are compared on one definition rather than two.'
      });
    }
    return notes;
  }

  /* ------------------------------------------------- food balance sheets
   *
   * The only source here that separates what is EATEN from what merely enters
   * the country. Apparent utilization (P + M - X) counts feed, seed, losses,
   * processing, industrial use and stock building as if they were consumption;
   * the FBS splits them out.
   *
   * Two things to know. Everything is in PADDY equivalent, so it is converted to
   * the requested basis before use. And coverage is partial -- 43 of 55 countries
   * and 2010-2023 only. Benin, the country of the reference paper, is absent from
   * the current release, so callers must handle null.
   */
  function fbsAvailable(iso3) {
    const f = state.fao.fbs;
    return !!(f && f.series && f.series[iso3]);
  }

  function foodBalance(sel, opts) {
    opts = opts || {};
    const f = state.fao.fbs;
    if (!f || !f.series) return null;
    const isoList = resolve(sel);
    const covered = isoList.filter(iso => f.series[iso]);
    if (!covered.length) {
      return { available: false, members: isoList, covered: [], missing: isoList.slice(),
               reason: 'no FAOSTAT Food Balance Sheet coverage for this selection' };
    }

    const basis = BASES.indexOf(opts.basis) >= 0 ? opts.basis : 'milled';
    const rate = opts.millingRate > 0 ? opts.millingRate : DEFAULT_MILLING_RATE;
    // The pipeline has already normalised both food-balance releases onto a
    // MILLED basis, so no conversion is needed for the milled basis. Paddy and
    // as-published need converting up.
    const k = (basis === 'milled') ? 1 : (1 / rate);

    const years = f.years.slice();
    const n = years.length;
    const out = {
      available: true,
      years: years,
      members: isoList,
      covered: covered,
      missing: isoList.filter(iso => !f.series[iso]),
      basis: basis,
      millingRate: rate,
      sourceBasis: f.basis,
      note: f.note,
      // The balance sheet's OWN production and trade lines, as distinct from the
      // production and trade matrices. These are the reconciled series, and they
      // are what the AfricaRice / CARD country pages publish, so exposing them is
      // what makes those pages reproducible here. See indicator `ssrFbs`.
      production: new Array(n).fill(null),
      imports: new Array(n).fill(null),
      exports: new Array(n).fill(null),
      food: new Array(n).fill(null),
      domesticSupply: new Array(n).fill(null),
      feed: new Array(n).fill(null),
      seed: new Array(n).fill(null),
      losses: new Array(n).fill(null),
      processing: new Array(n).fill(null),
      otherUses: new Array(n).fill(null),
      stockVariation: new Array(n).fill(null),
      population: new Array(n).fill(null),
      foodPerCapita: new Array(n).fill(null),
      kcalPerCapitaDay: new Array(n).fill(null)
    };

    const TONNE_FIELDS = ['production', 'imports', 'exports',
                          'food', 'domesticSupply', 'feed', 'seed', 'losses',
                          'processing', 'otherUses', 'stockVariation'];

    for (let i = 0; i < n; i++) {
      let pop = null, kcalW = null, kcalN = null;
      covered.forEach(iso => {
        const s = f.series[iso];
        TONNE_FIELDS.forEach(fld => {
          const v = s[fld] ? s[fld][i] : null;
          if (v == null) return;
          out[fld][i] = (out[fld][i] == null ? 0 : out[fld][i]) + v * 1000 * k;   // 1000 t -> t
        });
        // Population for the same year, so a group per-capita figure is a real
        // weighted average rather than a mean of country means.
        const pi = state.fao.popYears.indexOf(years[i]);
        const fs = state.fao.series[iso];
        if (pi >= 0 && fs && fs.population[pi] != null) {
          pop = (pop == null ? 0 : pop) + fs.population[pi] * 1000;
          const kc = s.kcalPerCapitaDay ? s.kcalPerCapitaDay[i] : null;
          if (kc != null) {
            kcalW = (kcalW == null ? 0 : kcalW) + kc * fs.population[pi] * 1000;
            kcalN = (kcalN == null ? 0 : kcalN) + fs.population[pi] * 1000;
          }
        }
      });
      out.population[i] = pop;
      if (out.food[i] != null && pop) out.foodPerCapita[i] = out.food[i] * 1000 / pop;
      if (kcalW != null && kcalN) out.kcalPerCapitaDay[i] = kcalW / kcalN;
    }
    return out;
  }

  /* Compares apparent utilization against food-balance-sheet food use for the
   * same years. The ratio is a direct measure of how much of what the trade
   * statistics call "consumption" is not food -- and, where re-export goes
   * unrecorded, of how badly apparent consumption overstates the diet. */
  function consumptionCheck(sel, opts) {
    const b = balance('fao', sel, opts);
    const fb = foodBalance(sel, opts);
    if (!fb || !fb.available) {
      return { available: false, reason: fb ? fb.reason : 'no food balance sheet data' };
    }
    const rows = [];
    fb.years.forEach((y, i) => {
      const bi = b.years.indexOf(y);
      if (bi < 0) return;
      const apparent = b.consumption[bi];
      const food = fb.food[i];
      const supply = fb.domesticSupply[i];
      if (apparent == null || food == null) return;
      rows.push({
        year: y,
        apparent: apparent,
        fbsDomesticSupply: supply,
        fbsFood: food,
        ratioApparentToFood: food > 0 ? apparent / food : null,
        nonFoodShare: (supply && supply > 0) ? 1 - food / supply : null,
        apparentPerCapita: (b.population[bi]) ? apparent * 1000 / b.population[bi] : null,
        foodPerCapita: fb.foodPerCapita[i],
        kcalPerCapitaDay: fb.kcalPerCapitaDay[i]
      });
    });
    const last = rows.length ? rows[rows.length - 1] : null;
    return {
      available: rows.length > 0,
      rows: rows,
      last: last,
      basis: b.basis,
      note: 'Apparent utilization (P + M - X) is not food consumption. The food balance sheet ' +
            'separates food use from feed, seed, losses, processing, industrial use and stock ' +
            'change. Where the ratio is far above 1, either a large share of supply is genuinely ' +
            'non-food, or trade is under-recorded -- most often unrecorded re-export inflating ' +
            'apparent consumption.'
    };
  }

  /* -------------------------------------------------------- data quality */

  // A transparent 0-100 score. The components are deliberately simple and are
  // all shown to the user; this is a completeness-and-consistency indicator, not
  // a judgement about whether the underlying statistics are true.
  function quality(dbName, iso3, opts) {
    opts = opts || {};
    const d = db(dbName);
    const s = d.series[iso3];
    if (!s) return null;

    const from = opts.from != null ? opts.from : d.years[0];
    const to = opts.to != null ? opts.to : d.years[d.years.length - 1];
    const i0 = d.years.indexOf(from), i1 = d.years.indexOf(to);
    const fields = dbName === 'fao'
      ? ['production', 'area', 'imports']
      : ['production', 'area', 'imports', 'consumption'];

    let cells = 0, filled = 0, gaps = 0, lastYear = null;
    fields.forEach(f => {
      const v = s[f];
      if (!v) return;
      let prevFilled = false;
      for (let i = i0; i <= i1; i++) {
        cells++;
        if (v[i] != null) {
          filled++; prevFilled = true;
          if (f === 'production') lastYear = d.years[i];
        } else if (prevFilled) {
          gaps++;   // interior gap: worse than a series that simply starts late
        }
      }
    });

    const completeness = cells ? filled / cells : 0;
    const continuity = cells ? 1 - Math.min(1, gaps / Math.max(1, filled)) : 0;
    const recencyGap = lastYear == null ? 99 : (to - lastYear);
    const recency = Math.max(0, 1 - recencyGap / 10);

    // Consistency: does area x yield reproduce production?
    let checked = 0, consistent = 0;
    if (s.area && s.yield && s.production) {
      for (let i = i0; i <= i1; i++) {
        const a = s.area[i], y = s.yield[i], p = s.production[i];
        if (a != null && y != null && p != null && p > 0) {
          checked++;
          const implied = dbName === 'fao' ? a * y / 1000 : a * y;
          if (Math.abs(implied - p) / p <= 0.02) consistent++;
        }
      }
    }
    const consistency = checked ? consistent / checked : 1;

    const score = 100 * (0.40 * completeness + 0.20 * continuity + 0.20 * recency + 0.20 * consistency);
    return {
      iso3: iso3, db: d.db, from: from, to: to,
      score: Math.round(score),
      components: {
        completeness: round(completeness, 3),
        continuity: round(continuity, 3),
        recency: round(recency, 3),
        consistency: round(consistency, 3)
      },
      detail: {
        cellsExpected: cells, cellsObserved: filled, interiorGaps: gaps,
        lastProductionYear: lastYear, identityChecked: checked, identityPassed: consistent
      },
      weights: { completeness: 0.40, continuity: 0.20, recency: 0.20, consistency: 0.20 }
    };
  }

  /* ------------------------------------------------------------- utilities */

  function round(x, dp) {
    if (x == null || !isFinite(x)) return null;
    const f = Math.pow(10, dp == null ? 2 : dp);
    return Math.round(x * f) / f;
  }

  function yearIndex(dbName, year) { return db(dbName).years.indexOf(year); }

  // Trims leading/trailing nulls off a (years, values) pair and reports whether
  // anything is missing in the middle -- most estimators need to know.
  function compact(years, values) {
    let a = 0, b = values.length - 1;
    while (a <= b && values[a] == null) a++;
    while (b >= a && values[b] == null) b--;
    if (a > b) return { years: [], values: [], interiorGaps: 0, complete: false };
    const yy = [], vv = [];
    let gaps = 0;
    for (let i = a; i <= b; i++) {
      yy.push(years[i]);
      vv.push(values[i]);
      if (values[i] == null) gaps++;
    }
    return { years: yy, values: vv, interiorGaps: gaps, complete: gaps === 0 };
  }

  function provenance() {
    return {
      extracted: state.meta.extracted,
      sources: state.meta.sources,
      window: state.meta.window,
      countries: state.meta.countries,
      issues: state.meta.issues,
      warnings: state.meta.warnings
    };
  }

  return {
    DEFAULT_MILLING_RATE: DEFAULT_MILLING_RATE,
    BASES: BASES,
    load: load,
    inject: inject,
    state: state,
    countries: countries,
    country: country,
    regions: regions,
    blocs: blocs,
    resolve: resolve,
    selectionLabel: selectionLabel,
    series: series,
    hasSeries: hasSeries,
    balance: balance,
    foodBalance: foodBalance,
    fbsAvailable: fbsAvailable,
    consumptionCheck: consumptionCheck,
    quality: quality,
    yearIndex: yearIndex,
    compact: compact,
    provenance: provenance,
    round: round
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSA; }
