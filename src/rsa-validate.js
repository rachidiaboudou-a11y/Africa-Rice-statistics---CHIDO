/* rsa-validate.js -- data validation, plausibility ranges and calculation logging.
 *
 * Three jobs, deliberately kept apart:
 *
 *   1. VALIDATION   -- is this dataset structurally usable at all? Wrong shape,
 *                      missing fields, ragged arrays, non-numeric entries. A
 *                      dataset that fails here must not reach the engines.
 *   2. RANGE CHECKS -- are the numbers agronomically and economically possible?
 *                      A yield of 40 t/ha is well-formed and impossible. These
 *                      are warnings, not errors: the data may be right and the
 *                      range too narrow, so nothing is silently discarded.
 *   3. LOGGING      -- when a calculation fails, record WHY, with enough context
 *                      to reproduce it, instead of returning null into a chart
 *                      and leaving the reader to guess.
 *
 * The ranges below are not decoration. Each cites the evidence that sets it, so
 * that when a value trips one the reader can judge whether the datum or the
 * bound is wrong. They are drawn from the observed African record 1961-2024 plus
 * the agronomic literature (van Oort et al. 2015 for yield ceilings; FAO food
 * balance sheets for per-capita supply).
 */
var RSAValidate = (function () {
  'use strict';

  const VERSION = '1.0.0';

  /* ---------------------------------------------------------------- ranges */

  /* min/max are HARD bounds: outside them the value is almost certainly an
   * error of unit or of entry. lo/hi are SOFT bounds: outside them the value is
   * unusual and worth a second look, but real cases exist. */
  const RANGES = {
    production: {
      unit: 't', min: 0, max: 60e6, lo: 0, hi: 20e6,
      why: 'Africa\'s largest producer (Egypt, Nigeria, Madagascar) has never exceeded ~10 Mt ' +
           'paddy. 60 Mt is set well above any national figure so that only a unit error trips it.'
    },
    area: {
      unit: 'ha', min: 0, max: 12e6, lo: 0, hi: 6e6,
      why: 'Nigeria harvests ~4.6 Mha, the largest in Africa. A country-level figure above ' +
           '12 Mha would exceed the arable land of every African state bar a handful.'
    },
    yield: {
      unit: 'kg/ha', min: 10, max: 14000, lo: 400, hi: 11000,
      why: 'Quoted on a PADDY basis; a milled-basis observation is converted up before it is ' +
           'tested. Egypt is the world leader at ~9,500 kg/ha, van Oort et al. (2015) put the ' +
           'irrigated water-limited potential in West Africa at 7,000-11,000, and no field ' +
           'system anywhere exceeds ~14,000. The floor is deliberately far below the soft ' +
           'bound: a total crop failure is real, not an error. USDA records Chad in 1984 -- ' +
           'the Sahel drought -- at 1,000 t off 31,000 ha, i.e. 48 kg/ha. Below 10 kg/ha, ' +
           'though, the number is a unit error (t/ha entered as kg/ha) rather than a harvest.'
    },
    imports: {
      unit: 't', min: 0, max: 12e6, lo: 0, hi: 5e6,
      why: 'Nigeria at the peak of its import era took ~3.4 Mt. 12 Mt exceeds any African ' +
           'national import on record.'
    },
    exports: {
      unit: 't', min: 0, max: 12e6, lo: 0, hi: 3e6,
      why: 'Only Egypt and the entrepot economies export at scale, and never above ~1.5 Mt.'
    },
    population: {
      unit: 'persons', min: 1e4, max: 3e9, lo: 5e4, hi: 1.5e9,
      why: 'Seychelles is the smallest African state at ~1e5. The upper bound admits ' +
           'continental aggregates (Africa passed 1.4 billion in 2023) but not a unit error.'
    },
    ssr: {
      unit: '%', min: 0, max: 100000, lo: 0, hi: 400,
      why: 'The FAO ratio is unbounded above: a large exporter with negligible imports can ' +
           'exceed 100%. Egypt reaches ~180%. Values above 400% are possible only where ' +
           'exports approach domestic supply, which is worth flagging, and a NEGATIVE ratio ' +
           'means exports exceeded production plus imports -- an impossible balance sheet.'
    },
    cpc: {
      unit: 'kg/capita/yr', min: 0, max: 400, lo: 0.1, hi: 180,
      why: 'Guinea-Bissau and Sierra Leone are the African maxima at ~110-130 kg. Asian ' +
           'maxima reach ~150. Above 180 kg/capita almost always signals unrecorded ' +
           're-export inflating apparent consumption, as it does for Benin.'
    },
    millingRate: {
      unit: 'ratio', min: 0.55, max: 0.80, lo: 0.60, hi: 0.72,
      why: 'FAO uses 0.67, CARD/AfricaRice 0.667, van Oort et al. (2015) 0.65. The physical ' +
           'range for head-rice plus brokens is roughly 0.60-0.72; outside 0.55-0.80 the ' +
           'number is not a milling rate.'
    },
    kcalRice: {
      unit: 'kcal/capita/day', min: 0, max: 2500, lo: 0, hi: 1200,
      why: 'Rice supplies ~790 kcal/day in Senegal, among the highest in Africa. Total dietary ' +
           'energy supply is ~2,000-3,500 kcal/day, so rice alone above 2,500 is impossible.'
    }
  };

  /* ------------------------------------------------------------ error log */

  const LOG_LIMIT = 500;
  const log = [];
  let seq = 0;

  function record(level, area, message, context) {
    // Bounded: a failure inside a loop over 55 countries x 64 years must not be
    // able to exhaust memory. The counter keeps the true total visible.
    seq++;
    if (log.length >= LOG_LIMIT) log.shift();
    log.push({
      seq: seq, level: level, area: area, message: message,
      context: context || null, at: new Date().toISOString()
    });
    return log[log.length - 1];
  }

  const logError = (area, msg, ctx) => record('error', area, msg, ctx);
  const logWarning = (area, msg, ctx) => record('warning', area, msg, ctx);
  const logInfo = (area, msg, ctx) => record('info', area, msg, ctx);

  function entries(level) {
    return level ? log.filter(e => e.level === level) : log.slice();
  }
  function counts() {
    const c = { error: 0, warning: 0, info: 0, total: seq, retained: log.length };
    log.forEach(e => { c[e.level] = (c[e.level] || 0) + 1; });
    return c;
  }
  function clear() { log.length = 0; seq = 0; }

  /* Wrap a calculation so a throw becomes a logged, inspectable failure rather
   * than either an exception that blanks a panel or a silent null in a chart. */
  function guard(area, fn, fallback, context) {
    try {
      const v = fn();
      if (typeof v === 'number' && !isFinite(v)) {
        logError(area, 'calculation produced a non-finite value (' + String(v) + ')', context);
        return fallback;
      }
      return v;
    } catch (e) {
      logError(area, 'calculation threw: ' + (e && e.message ? e.message : String(e)), context);
      return fallback;
    }
  }

  /* ------------------------------------------------------- range checking */

  function checkValue(field, value, context) {
    const r = RANGES[field];
    if (!r) return null;
    if (value == null) return null;
    if (typeof value !== 'number' || !isFinite(value)) {
      return { field: field, value: value, severity: 'error',
               message: field + ' is not a finite number', range: r, context: context || null };
    }
    if (value < r.min || value > r.max) {
      return { field: field, value: value, severity: 'error',
               message: field + ' = ' + value + ' ' + r.unit + ' is outside the possible range [' +
                        r.min + ', ' + r.max + ']', range: r, context: context || null };
    }
    if (value < r.lo || value > r.hi) {
      return { field: field, value: value, severity: 'warning',
               message: field + ' = ' + value + ' ' + r.unit + ' is outside the usual range [' +
                        r.lo + ', ' + r.hi + ']', range: r, context: context || null };
    }
    return null;
  }

  function checkSeries(field, years, values, context) {
    const out = [];
    if (!values) return out;
    for (let i = 0; i < values.length; i++) {
      const f = checkValue(field, values[i], Object.assign({ year: years ? years[i] : i }, context || {}));
      if (f) out.push(f);
    }
    return out;
  }

  /* --------------------------------------------------- dataset validation */

  const REQUIRED_SERIES = ['production', 'area', 'imports', 'exports', 'population'];

  /* Structural validation of a dataset in the shape the platform loads, or of
   * one a user supplies. Returns {ok, errors, warnings, summary} -- never
   * throws, because the caller is usually trying to decide whether it CAN
   * proceed, and an exception would answer a different question. */
  function validateDataset(ds, opts) {
    opts = opts || {};
    const errors = [], warnings = [];
    const label = opts.label || 'dataset';
    // Declared up here because done() is called from the early-return paths
    // below, before the counting loop runs. A `let` beside that loop would put
    // these in the temporal dead zone on exactly the failure paths that matter.
    let cells = 0, present = 0;

    if (!ds || typeof ds !== 'object') {
      errors.push({ code: 'not-an-object', message: label + ' is not an object' });
      return done();
    }
    if (!Array.isArray(ds.years) || !ds.years.length) {
      errors.push({ code: 'no-years', message: label + ' has no years array' });
      return done();
    }
    const n = ds.years.length;

    // Years must be integers, strictly increasing, with no gaps: every series is
    // indexed positionally against this axis, so a duplicate or an out-of-order
    // year silently misaligns every value after it.
    for (let i = 0; i < n; i++) {
      const y = ds.years[i];
      if (typeof y !== 'number' || !isFinite(y) || Math.floor(y) !== y) {
        errors.push({ code: 'bad-year', message: 'year at index ' + i + ' is not an integer: ' + y });
      } else if (i > 0 && y <= ds.years[i - 1]) {
        errors.push({ code: 'year-order',
                      message: 'years are not strictly increasing at index ' + i +
                               ' (' + ds.years[i - 1] + ' then ' + y + ')' });
      } else if (i > 0 && y !== ds.years[i - 1] + 1) {
        warnings.push({ code: 'year-gap',
                        message: 'gap in the year axis between ' + ds.years[i - 1] + ' and ' + y +
                                 '; positional indexing assumes a dense axis' });
      }
    }

    const series = ds.series || {};
    const isos = Object.keys(series);
    if (!isos.length) {
      errors.push({ code: 'no-series', message: label + ' contains no country series' });
      return done();
    }

    isos.forEach(iso => {
      const s = series[iso];
      if (!s || typeof s !== 'object') {
        errors.push({ code: 'bad-series', message: iso + ' is not an object' });
        return;
      }
      if (!/^[A-Z]{3}$/.test(iso)) {
        warnings.push({ code: 'iso-format', message: '"' + iso + '" is not an ISO3 alpha-3 code' });
      }
      REQUIRED_SERIES.forEach(field => {
        const v = s[field];
        if (v === undefined) {
          warnings.push({ code: 'missing-field', message: iso + ' has no "' + field + '" series' });
          return;
        }
        if (!Array.isArray(v)) {
          errors.push({ code: 'not-an-array', message: iso + '.' + field + ' is not an array' });
          return;
        }
        // A ragged array is the most dangerous defect here: it does not throw,
        // it just shifts every value against the wrong year.
        if (v.length !== n) {
          errors.push({ code: 'length-mismatch',
                        message: iso + '.' + field + ' has ' + v.length + ' entries but the year ' +
                                 'axis has ' + n });
          return;
        }
        for (let i = 0; i < v.length; i++) {
          cells++;
          const x = v[i];
          if (x == null) continue;
          present++;
          if (typeof x !== 'number' || !isFinite(x)) {
            errors.push({ code: 'non-numeric',
                          message: iso + '.' + field + '[' + ds.years[i] + '] = ' + JSON.stringify(x) });
          } else if (x < 0) {
            errors.push({ code: 'negative',
                          message: iso + '.' + field + '[' + ds.years[i] + '] is negative: ' + x });
          }
        }
      });
    });

    function done() {
      const ok = errors.length === 0;
      const summary = {
        label: label,
        countries: Object.keys((ds && ds.series) || {}).length,
        years: (ds && Array.isArray(ds.years)) ? ds.years.length : 0,
        span: (ds && Array.isArray(ds.years) && ds.years.length)
          ? ds.years[0] + '-' + ds.years[ds.years.length - 1] : null,
        cells: cells, present: present,
        completeness: cells ? +(100 * present / cells).toFixed(1) : null,
        errors: errors.length, warnings: warnings.length
      };
      if (!ok) logError('validation', label + ' failed validation with ' + errors.length + ' error(s)', summary);
      else if (warnings.length) logWarning('validation', label + ' passed with ' + warnings.length + ' warning(s)', summary);
      return { ok: ok, errors: errors, warnings: warnings, summary: summary };
    }
    return done();
  }

  /* --------------------------------------------- plausibility of a balance */

  /* Range-check a computed balance, plus the accounting identities that must
   * hold regardless of what the sources say. */
  function checkBalance(bal, context) {
    const findings = [];
    if (!bal || !bal.years) return findings;
    const ctx = Object.assign({ selection: bal.label, db: bal.dbKey }, context || {});

    findings.push.apply(findings, checkSeries('production', bal.years, bal.production, ctx));
    findings.push.apply(findings, checkSeries('area', bal.years, bal.area, ctx));

    /* The yield bounds are quoted on a PADDY basis, because that is how every
     * published rice yield is quoted. A milled-basis balance shifts the entire
     * distribution down by the milling rate, so checking milled yields against
     * paddy bounds would flag ~130 perfectly good country-years. Convert the
     * observation up to paddy rather than loosening the bound, which would blind
     * the check to real unit errors at the bottom of the range. */
    const toPaddy = (bal.basis === 'milled' && bal.millingRate > 0) ? (1 / bal.millingRate) : 1;
    findings.push.apply(findings,
      checkSeries('yield', bal.years, bal.yield.map(v => v == null ? null : v * toPaddy),
                  Object.assign({ quotedOn: 'paddy basis', appliedFactor: toPaddy }, ctx)));

    findings.push.apply(findings, checkSeries('imports', bal.years, bal.imports, ctx));
    findings.push.apply(findings, checkSeries('exports', bal.years, bal.exports, ctx));
    findings.push.apply(findings, checkSeries('population', bal.years, bal.population, ctx));

    const mr = checkValue('millingRate', bal.millingRate, ctx);
    if (mr) findings.push(mr);

    for (let i = 0; i < bal.years.length; i++) {
      const y = bal.years[i];
      // yield = 1000 x production / area, by definition. A mismatch means one of
      // the three was taken from a different source or basis than the others.
      if (bal.yield[i] != null && bal.area[i] > 0 && bal.production[i] != null) {
        const implied = 1000 * bal.production[i] / bal.area[i];
        if (Math.abs(implied - bal.yield[i]) > 1e-6 * Math.max(1, Math.abs(implied))) {
          findings.push({ field: 'yield', value: bal.yield[i], severity: 'error',
            message: 'yield does not equal 1000 x production / area in ' + y +
                     ' (' + bal.yield[i].toFixed(2) + ' vs ' + implied.toFixed(2) + ')',
            context: Object.assign({ year: y }, ctx) });
        }
      }
      // Domestic supply cannot be negative: exports above production plus
      // imports is not a lean year, it is a broken balance sheet.
      if (bal.production[i] != null && bal.imports[i] != null) {
        const supply = bal.production[i] + bal.imports[i] - (bal.exports[i] || 0);
        if (supply < 0) {
          findings.push({ field: 'ssr', value: supply, severity: 'error',
            message: 'domestic supply is negative in ' + y + ' (' + Math.round(supply) +
                     ' t): exports exceed production plus imports',
            context: Object.assign({ year: y }, ctx) });
        }
      }
    }
    findings.forEach(f => {
      if (f.severity === 'error') logError('range', f.message, f.context);
      else logWarning('range', f.message, f.context);
    });
    return findings;
  }

  /* Sweep every country in a database. Used by the test suite and by the
   * Data Used panel, so the reader can see the platform checking itself. */
  function sweep(dbKey, opts) {
    opts = opts || {};
    const out = { dbKey: dbKey, checked: 0, errors: [], warnings: [], byField: {} };
    if (typeof RSA === 'undefined' || !RSA.countries) return out;
    RSA.countries().forEach(c => {
      let bal;
      try {
        bal = RSA.balance(dbKey, { kind: 'country', id: c.iso3 },
                          { basis: opts.basis || 'milled' });
      } catch (e) {
        out.errors.push({ field: 'balance', severity: 'error', message: c.iso3 + ': ' + e.message });
        return;
      }
      out.checked++;
      checkBalance(bal, { iso3: c.iso3 }).forEach(f => {
        (f.severity === 'error' ? out.errors : out.warnings).push(f);
        out.byField[f.field] = (out.byField[f.field] || 0) + 1;
      });
    });
    return out;
  }

  return {
    VERSION: VERSION,
    RANGES: RANGES,
    REQUIRED_SERIES: REQUIRED_SERIES,
    validateDataset: validateDataset,
    checkValue: checkValue,
    checkSeries: checkSeries,
    checkBalance: checkBalance,
    sweep: sweep,
    guard: guard,
    logError: logError,
    logWarning: logWarning,
    logInfo: logInfo,
    entries: entries,
    counts: counts,
    clear: clear,
    LOG_LIMIT: LOG_LIMIT
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RSAValidate;
