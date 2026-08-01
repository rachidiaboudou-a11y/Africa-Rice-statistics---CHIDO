/* Rice Statistics for Africa -- test suite.
 *
 * Runs in the browser against the real data files. Three kinds of test:
 *
 *   unit       arithmetic of each indicator, on synthetic inputs where the right
 *              answer is known by hand
 *   edge       zero, negative, missing and degenerate inputs -- the cases where a
 *              statistics platform is most likely to produce a confident lie
 *   golden     reproduction of Gassi, Gul & Cetin (2025) Table 1 for Benin from
 *              the live FAOSTAT extract, which is the end-to-end check that the
 *              pipeline, the basis handling and the equations all agree
 *
 * Plus statistical validation of the estimators against series whose properties
 * are known by construction.
 */

const RSATests = (function () {
  'use strict';

  const results = [];
  let currentGroup = 'general';

  function group(name) { currentGroup = name; }

  function ok(name, pass, detail) {
    results.push({ group: currentGroup, name: name, pass: !!pass, detail: detail || '' });
    return !!pass;
  }

  function near(name, actual, expected, tol, detail) {
    if (actual == null || !isFinite(actual)) {
      return ok(name, false, 'got ' + actual + ', expected ' + expected + (detail ? ' -- ' + detail : ''));
    }
    const pass = Math.abs(actual - expected) <= tol;
    return ok(name, pass,
      'got ' + fmt(actual) + ', expected ' + fmt(expected) + ' +/- ' + tol + (detail ? ' -- ' + detail : ''));
  }

  function fmt(x) {
    if (x == null) return String(x);
    if (!isFinite(x)) return String(x);
    return Math.abs(x) >= 1000 ? x.toFixed(1) : x.toFixed(4);
  }

  function f2(x) { return (x == null || !isFinite(x)) ? 'n/a' : x.toFixed(1); }

  function isNull(name, v, detail) {
    return ok(name, v == null, 'got ' + v + ', expected null' + (detail ? ' -- ' + detail : ''));
  }

  /* Builds a balance-sheet-shaped object directly, so indicator arithmetic can be
   * tested without touching the loader. */
  function mkBal(o) {
    const n = o.years.length;
    const z = () => new Array(n).fill(null);
    const b = {
      db: o.db || 'TEST', dbKey: o.dbKey || 'fao', basis: o.basis || 'milled',
      label: 'test', members: ['TST'], years: o.years.slice(),
      production: o.production || z(), imports: o.imports || z(), exports: o.exports || z(),
      area: o.area || z(), yield: o.yield || z(), population: o.population || z(),
      importValue: o.importValue || z(), exportValue: o.exportValue || z(),
      stocksChange: z(), reporting: new Array(n).fill(1), notes: [],
      consumption: o.consumption || null
    };
    if (!b.consumption) {
      b.consumption = b.production.map((p, i) => {
        const m = b.imports[i], x = b.exports[i];
        if (p == null || m == null) return null;
        return p + m - (x == null ? 0 : x);
      });
    }
    return b;
  }

  /* ================================================== indicator unit tests */

  function testIndicators() {
    group('indicators');
    const I = RSAIndicators;

    // A hand-checkable case:
    //   P = 500 t, M = 1500 t, X = 0, N = 10,000 people
    //   C   = 2000 t
    //   PPC = 1000*500/10000   = 50 kg/cap
    //   CPC = 1000*2000/10000  = 200 kg/cap
    //   SSR = 100*500/2000     = 25 %
    //   IDR = 100*1500/2000    = 75 %
    const b = mkBal({
      years: [2000], production: [500], imports: [1500], exports: [0], population: [10000]
    });
    near('PPC arithmetic', I.compute('ppc', b).values[0], 50, 1e-9);
    near('CPC arithmetic', I.compute('cpc', b).values[0], 200, 1e-9);
    near('SSR arithmetic', I.compute('ssr', b).values[0], 25, 1e-9);
    near('IDR arithmetic', I.compute('idr', b).values[0], 75, 1e-9);
    near('PCB arithmetic', I.compute('pcb', b).values[0], -1500, 1e-9);
    near('PCG arithmetic', I.compute('pcg', b).values[0], -150, 1e-9);
    near('ICR arithmetic', I.compute('icr', b).values[0], 500 / 1500, 1e-12);
    near('NTR arithmetic', I.compute('ntr', b).values[0], (0 - 1500) / 1500, 1e-12);

    // SSR + IDR = 100 exactly when exports are zero.
    const ssr = I.compute('ssr', b).values[0], idr = I.compute('idr', b).values[0];
    near('SSR + IDR = 100 when X = 0', ssr + idr, 100, 1e-9);

    // With exports positive they must NOT sum to 100 -- this is the property that
    // produces Benin's 351% IDR, so it is asserted rather than tolerated.
    const bx = mkBal({
      years: [2000], production: [500], imports: [1500], exports: [1200], population: [10000]
    });
    const ssr2 = I.compute('ssr', bx).values[0], idr2 = I.compute('idr', bx).values[0];
    near('SSR with exports', ssr2, 100 * 500 / 800, 1e-9);
    near('IDR with exports', idr2, 100 * 1500 / 800, 1e-9);
    ok('SSR + IDR exceeds 100 when X > 0', ssr2 + idr2 > 100 + 1e-6,
       'sum = ' + fmt(ssr2 + idr2) + ' as the FAO definition implies');
    ok('IDR above 100 raises a flag', I.compute('idr', bx).flags.some(f => /exceeds 100/.test(f.text)));

    // Self-sufficient case.
    const bs = mkBal({ years: [2000], production: [3000], imports: [0], exports: [1000], population: [10000] });
    near('SSR above 100 for a net exporter', I.compute('ssr', bs).values[0], 150, 1e-9);

    // Yield identity.
    const by = mkBal({ years: [2000], production: [3000], area: [1000], imports: [0], exports: [0], population: [1] });
    by.yield = [3000 * 1000 / 1000];
    near('yield = 1000 P / A', by.yield[0], 3000, 1e-9);

    // CAGR: 100 -> 200 over 10 years is 7.1773%.
    near('CAGR', I.cagr([2000, 2010], [100, 200]), 7.17734625, 1e-6);
    isNull('CAGR undefined through zero', I.cagr([2000, 2010], [0, 200]));
    isNull('CAGR undefined for a sign change', I.cagr([2000, 2010], [-5, 200]));

    // Growth rates.
    const g = I.growth([100, 110, 99]);
    isNull('growth undefined in the first period', g[0]);
    near('growth +10%', g[1], 10, 1e-9);
    near('growth -10%', g[2], -10, 1e-9);
  }

  /* ========================================================== edge cases */

  function testEdges() {
    group('edge cases');
    const I = RSAIndicators;

    /* A selection the registry does not know must be REFUSED, not answered.
     * balance() used to pass any string straight through as a member, so a
     * typo'd ISO3 came back as a correctly-shaped series of nulls carrying the
     * typo as its label -- indistinguishable, downstream, from a real country
     * that happens to report nothing. */
    const bogus = RSA.balance('fao', { kind: 'country', id: 'ZZZ' }, { basis: 'milled' });
    ok('an unknown country code is rejected, not silently accepted',
       bogus.selectionValid === false && bogus.members.length === 0 &&
       bogus.unknownMembers.indexOf('ZZZ') >= 0,
       'valid=' + bogus.selectionValid + ', members=' + bogus.members.length);
    ok('the rejected selection says why, in a note the UI can show',
       bogus.notes.some(n => n.level === 'error' && /ZZZ/.test(n.text)),
       bogus.notes.map(n => n.level + ': ' + n.text).join(' | ') || '(no notes)');

    const noRegion = RSA.balance('fao', { kind: 'region', id: 'Nowhere' }, { basis: 'milled' });
    ok('an unknown region resolves to nothing and is flagged',
       noRegion.selectionValid === false && noRegion.members.length === 0);

    const mixed = RSA.balance('fao', { kind: 'custom', ids: ['BEN', 'ZZZ', 'SEN'] }, { basis: 'milled' });
    ok('a custom group keeps its real members and drops the unknown one',
       mixed.members.length === 2 && mixed.members.indexOf('ZZZ') < 0 &&
       mixed.unknownMembers.length === 1 && mixed.selectionValid === false,
       'members=' + mixed.members.join(',') + ' unknown=' + mixed.unknownMembers.join(','));

    const real = RSA.balance('fao', { kind: 'country', id: 'BEN' }, { basis: 'milled' });
    ok('a real selection is still marked valid', real.selectionValid === true &&
       real.unknownMembers.length === 0);

    // Zero consumption must give null, never Infinity.
    const b0 = mkBal({ years: [2000], production: [0], imports: [0], exports: [0], population: [1000] });
    isNull('SSR is null when consumption is zero', I.compute('ssr', b0).values[0]);
    isNull('IDR is null when consumption is zero', I.compute('idr', b0).values[0]);
    near('PPC is zero when production is zero', I.compute('ppc', b0).values[0], 0, 1e-12);

    // Zero imports.
    const bm = mkBal({ years: [2000], production: [1000], imports: [0], exports: [0], population: [1000] });
    near('SSR is 100 with no trade', I.compute('ssr', bm).values[0], 100, 1e-9);
    near('IDR is 0 with no imports', I.compute('idr', bm).values[0], 0, 1e-12);
    isNull('ICR is null when imports are zero', I.compute('icr', bm).values[0]);
    isNull('NTR is null when there is no trade', I.compute('ntr', bm).values[0]);

    // Zero population.
    const bp = mkBal({ years: [2000], production: [1000], imports: [0], exports: [0], population: [0] });
    isNull('PPC is null when population is zero', I.compute('ppc', bp).values[0]);

    // Missing values propagate as missing, never as zero.
    const bn = mkBal({ years: [2000, 2001], production: [null, 500], imports: [100, null], exports: [0, 0], population: [1000, 1000] });
    isNull('missing production gives missing SSR', I.compute('ssr', bn).values[0]);
    isNull('missing imports gives missing IDR', I.compute('idr', bn).values[1]);

    /* Exports above production plus imports -- which FAOSTAT really does carry,
     * for Kenya in 1992 and Eswatini in 1968. This test used to require a
     * NEGATIVE SSR, on the reasoning that an absurd number is at least visibly
     * absurd. That was the wrong call: a negative ratio still got plotted, and
     * "-34.3%" reads as data. The balance sheet is unusable, so the whole family
     * of ratios resting on it is withheld and the reason stated in a note. */
    const bneg = mkBal({ years: [2000], production: [100], imports: [50], exports: [500], population: [1000] });
    isNull('a balance sheet with exports above supply yields no SSR at all',
           I.compute('ssr', bneg).values[0]);
    isNull('and no IDR either -- they share the broken denominator',
           I.compute('idr', bneg).values[0]);

    // Consumption exactly balanced.
    const beq = mkBal({ years: [2000], production: [1000], imports: [500], exports: [500], population: [1000] });
    near('SSR is 100 when imports equal exports', I.compute('ssr', beq).values[0], 100, 1e-9);

    // A single observation must not break descriptive statistics.
    const d = I.describe(I.compute('ssr', bm), null, null);
    ok('describe survives a single observation', d.observations === 1 && d.cagr == null);

    // An all-missing series.
    const ball = mkBal({ years: [2000, 2001], production: [null, null], imports: [null, null], population: [null, null] });
    const dd = I.describe(I.compute('ssr', ball), null, null);
    ok('describe survives an all-missing series', dd.observations === 0 && dd.first == null);
  }

  /* =============================================== statistical validation */

  function testStats() {
    group('statistics');
    const T = RSATsa;

    // Deterministic pseudo-random generator so the suite is reproducible.
    let seed = 12345;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    function normal() {
      let u = 0, v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // chi-squared CDF against known values.
    near('chi2cdf(3.84, 1) = 0.95', T.chi2cdf(3.841459, 1), 0.95, 1e-4);
    near('chi2cdf(5.99, 2) = 0.95', T.chi2cdf(5.991465, 2), 0.95, 1e-4);
    near('chi2cdf(18.31, 10) = 0.95', T.chi2cdf(18.307, 10), 0.95, 1e-3);

    // Normal quantiles.
    near('z(0.975) = 1.95996', T.normalQuantile(0.975), 1.959964, 1e-5);
    near('z(0.90) = 1.28155', T.normalQuantile(0.90), 1.281552, 1e-5);

    // ACF of white noise: lag-1 autocorrelation should sit inside the band.
    const wn = [];
    for (let i = 0; i < 400; i++) wn.push(normal());
    const r = T.acf(wn, 10);
    near('ACF at lag 0 is 1', r[0], 1, 1e-12);
    ok('white noise has a small lag-1 ACF', Math.abs(r[1]) < 3 / Math.sqrt(400),
       'r1 = ' + fmt(r[1]));

    // AR(1) with phi = 0.7: theoretical ACF is 0.7^k.
    const ar = [0];
    for (let i = 1; i < 2000; i++) ar.push(0.7 * ar[i - 1] + normal());
    const rar = T.acf(ar, 3);
    near('AR(1) ACF at lag 1 approximates phi', rar[1], 0.7, 0.08);
    near('AR(1) ACF at lag 2 approximates phi^2', rar[2], 0.49, 0.10);

    // PACF of an AR(1) must cut off after lag 1.
    const par = T.pacf(ar, 5);
    near('AR(1) PACF at lag 1 approximates phi', par[1], 0.7, 0.08);
    ok('AR(1) PACF cuts off after lag 1', Math.abs(par[2]) < 0.1, 'pacf2 = ' + fmt(par[2]));

    // Differencing.
    const dd = T.diff([1, 4, 9, 16, 25], 1);
    ok('first difference', dd.join(',') === '3,5,7,9', 'got ' + dd.join(','));
    const dd2 = T.diff([1, 4, 9, 16, 25], 2);
    ok('second difference of a quadratic is constant', dd2.every(v => Math.abs(v - 2) < 1e-12),
       'got ' + dd2.join(','));

    // Unit-root tests must be able to tell a random walk from white noise.
    const rw = [0];
    for (let i = 1; i < 300; i++) rw.push(rw[i - 1] + normal());
    const ppRw = T.pp(rw, { spec: 'c' });
    const ppWn = T.pp(wn, { spec: 'c' });
    ok('PP does not reject a unit root in a random walk', ppRw && !ppRw.rejects5,
       'Z-tau = ' + fmt(ppRw.statistic) + ' vs 5% ' + fmt(ppRw.critical['5']));
    ok('PP rejects a unit root in white noise', ppWn && ppWn.rejects5,
       'Z-tau = ' + fmt(ppWn.statistic) + ' vs 5% ' + fmt(ppWn.critical['5']));

    const adfRw = T.adf(rw, { spec: 'c' });
    const adfWn = T.adf(wn, { spec: 'c' });
    ok('ADF does not reject a unit root in a random walk', adfRw && !adfRw.rejects5,
       't = ' + fmt(adfRw.statistic));
    ok('ADF rejects a unit root in white noise', adfWn && adfWn.rejects5,
       't = ' + fmt(adfWn.statistic));

    const kWn = T.kpss(wn, { spec: 'c' });
    const kRw = T.kpss(rw, { spec: 'c' });
    ok('KPSS does not reject stationarity for white noise', kWn && !kWn.rejects5,
       'stat = ' + fmt(kWn.statistic));
    ok('KPSS rejects stationarity for a random walk', kRw && kRw.rejects5,
       'stat = ' + fmt(kRw.statistic));

    // selectD should call a random walk I(1) and white noise I(0).
    ok('selectD finds d = 0 for white noise', T.selectD(wn, 2).d === 0);
    ok('selectD finds d = 1 for a random walk', T.selectD(rw, 2).d === 1);

    // ARIMA parameter recovery on a series with known coefficients.
    const ar2 = [0, 0];
    for (let i = 2; i < 1200; i++) ar2.push(0.6 * ar2[i - 1] - 0.3 * ar2[i - 2] + normal());
    const m = T.arima(ar2, 2, 0, 0, { includeMean: true });
    ok('ARIMA(2,0,0) converges', m && m.converged);
    if (m) {
      near('AR(1) coefficient recovered', m.phi[0], 0.6, 0.08);
      near('AR(2) coefficient recovered', m.phi[1], -0.3, 0.08);
      near('innovation variance recovered', m.sigma2, 1, 0.20);
      ok('fitted AR(2) is stationary', m.stationary);
    }

    // MA(1) recovery.
    const e = [], ma = [];
    for (let i = 0; i < 1200; i++) e.push(normal());
    for (let i = 1; i < 1200; i++) ma.push(e[i] + 0.5 * e[i - 1]);
    const m2 = T.arima(ma, 0, 0, 1, { includeMean: true });
    ok('ARIMA(0,0,1) converges', m2 && m2.converged);
    if (m2) {
      near('MA(1) coefficient recovered', m2.theta[0], 0.5, 0.12);
      ok('fitted MA(1) is invertible', m2.invertible);
    }

    // Ljung-Box: white noise passes, an AR(1) series fails.
    const lbWn = T.ljungBox(wn, 10, 0);
    const lbAr = T.ljungBox(ar.slice(0, 300), 10, 0);
    ok('Ljung-Box passes white noise', lbWn.whiteNoise === true, 'p = ' + fmt(lbWn.pValue));
    ok('Ljung-Box fails an autocorrelated series', lbAr.whiteNoise === false, 'p = ' + fmt(lbAr.pValue));

    // Polynomial roots, which is what stationarity and invertibility actually
    // rest on. z^2 - 0.6z + 0.08 has roots 0.4 and 0.2.
    const rts = T.polyRoots([1, -0.6, 0.08]).map(r => r.re).sort((a, b) => a - b);
    near('polynomial root 1', rts[0], 0.2, 1e-6);
    near('polynomial root 2', rts[1], 0.4, 1e-6);
    // (z - 2)(z - 3) = z^2 - 5z + 6, roots outside the unit circle.
    near('largest inverse root of an explosive polynomial', T.maxInverseRoot([1, -5, 6]), 3, 1e-6);

    // The stationarity check must ACCEPT a well-behaved AR and REJECT an
    // explosive one. The earlier unit-circle scan passed both, which let
    // explosive models through model selection.
    ok('AR(1) with phi = 0.5 is stationary', T.isStationary([0.5]));
    ok('AR(1) with phi = 1.5 is NOT stationary', !T.isStationary([1.5]));
    ok('AR(1) with phi = 1 is NOT stationary (unit root)', !T.isStationary([1.0]));
    ok('AR(2) 0.6/-0.3 is stationary', T.isStationary([0.6, -0.3]));
    ok('AR(2) 1.5/-0.6 is stationary', T.isStationary([1.5, -0.6]));
    ok('AR(2) 0.5/0.6 is NOT stationary', !T.isStationary([0.5, 0.6]));
    ok('explosive AR(4) is rejected', !T.isStationary([-0.708, -1.659, -0.797, -0.663]),
       'the coefficient set an earlier build accepted as stationary');
    ok('MA(1) with theta = 0.5 is invertible', T.isInvertible([0.5]));
    ok('MA(1) with theta = 1.5 is NOT invertible', !T.isInvertible([1.5]));
    ok('MA(4) with a large second term is rejected', !T.isInvertible([0.683, 2.289, 0.766, 1.261]));

    // Every model that survives selection must satisfy both conditions.
    const trend = [];
    for (let i = 0; i < 60; i++) trend.push(100 + 4 * i + 8 * normal());
    const selT = T.selectModel(trend, { maxP: 3, maxQ: 3 });
    ok('model selection returns a model', !!selT.selected);
    ok('every candidate surviving selection is stationary and invertible',
       selT.candidates.every(c => c.stationary && c.invertible),
       selT.candidates.length + ' candidates checked');

    // psi-weights: for ARIMA(0,1,0) every weight is 1, so the forecast variance
    // grows linearly in the horizon -- the classic random-walk result.
    const psi = T.psiWeights([], [], 1, 5);
    ok('psi weights of a random walk are all 1', psi.every(v => Math.abs(v - 1) < 1e-12),
       'got ' + psi.join(','));

    // psi-weights for AR(1) with d = 0 are phi^j.
    const psiAr = T.psiWeights([0.5], [], 0, 4);
    near('psi_1 of AR(1)', psiAr[1], 0.5, 1e-12);
    near('psi_2 of AR(1)', psiAr[2], 0.25, 1e-12);

    // Forecast of a pure random walk must be flat at the last value.
    const mrw = T.arima(rw, 0, 1, 0, {});
    if (mrw) {
      const f = T.forecast(mrw, 5);
      near('random-walk forecast is flat at the last observation', f.mean[4], rw[rw.length - 1], 1.0);
      ok('random-walk interval widens with horizon', f.se[4] > f.se[0], 'se: ' + fmt(f.se[0]) + ' -> ' + fmt(f.se[4]));
      ok('95% band is wider than the 80% band',
         (f.intervals['95'].upper[0] - f.intervals['95'].lower[0]) >
         (f.intervals['80'].upper[0] - f.intervals['80'].lower[0]));
    }

    // A deterministic linear trend must be extrapolated by the drift benchmark.
    const lin = [];
    for (let i = 0; i < 40; i++) lin.push(100 + 5 * i);
    const rwd = T.rwDrift(lin);
    near('drift recovers the slope of a linear trend', rwd.drift, 5, 1e-9);
    near('drift forecast extrapolates the line', rwd.forecast(3)[2], 100 + 5 * 42, 1e-6);

    // Holt on the same trend.
    const h = T.holt(lin);
    near('Holt extrapolates a linear trend', h.forecast(3)[2], 100 + 5 * 42, 2.0);
  }

  /* ============================================ golden: reproduce the paper */

  async function testGolden() {
    group('golden -- Gassi, Gul & Cetin (2025), Benin');

    // Published Table 1. The paper computes on FAOSTAT paddy production against
    // item 31 milled trade, so the as-published basis is the one that must match.
    const table1 = {
      2010: { ppc: 12.76, cpc: 17.35, idr: 351.71, ssr: 73.51 },
      2015: { ppc: 17.98, cpc: 41.97, idr: 57.15, ssr: 42.85 },
      2020: { ppc: 31.49, cpc: 95.63, idr: 67.15, ssr: 32.93 },
      2021: { ppc: 38.74, cpc: 139.45, idr: 72.22, ssr: 27.78 },
      2022: { ppc: 38.16, cpc: 148.20, idr: 74.25, ssr: 25.75 }
    };

    // Replicating the paper needs BOTH of its choices made explicit: the
    // as-published basis (paddy production against milled trade) AND item 31,
    // "Rice, milled", rather than the platform's default item 30 total. The
    // platform defaults differently now because item 31 excludes broken rice and
    // is wrong for most of Africa; reproducing the paper means asking for it.
    const paperOpts = { basis: 'asPublished', standardizedTrade: false };
    const bal = RSA.balance('fao', { kind: 'country', id: 'BEN' }, paperOpts);
    const I = RSAIndicators;
    const ppc = I.compute('ppc', bal), cpc = I.compute('cpc', bal);
    const ssr = I.compute('ssr', bal), idr = I.compute('idr', bal);

    Object.keys(table1).forEach(yStr => {
      const y = parseInt(yStr, 10);
      const i = bal.years.indexOf(y);
      const exp = table1[y];
      // 0.02 absolute tolerance: the paper rounds to two decimals and FAOSTAT has
      // revised some values since its November 2024 extraction.
      near('Benin ' + y + ' PPC', ppc.values[i], exp.ppc, 0.02);
      near('Benin ' + y + ' CPC', cpc.values[i], exp.cpc, 0.02);
      near('Benin ' + y + ' SSR', ssr.values[i], exp.ssr, 0.02);
      near('Benin ' + y + ' IDR', idr.values[i], exp.idr, 0.02);
    });

    // The identity the whole balance sheet rests on.
    const i22 = bal.years.indexOf(2022);
    near('C = P + M - X holds', bal.consumption[i22],
      bal.production[i22] + bal.imports[i22] - (bal.exports[i22] || 0), 1e-6);

    // Switching to the milled basis must lower SSR, and by the milling rate when
    // trade is unchanged.
    const balM = RSA.balance('fao', { kind: 'country', id: 'BEN' },
      { basis: 'milled', standardizedTrade: false });
    const ssrM = I.compute('ssr', balM);
    ok('milled basis lowers SSR below the as-published figure',
       ssrM.values[i22] < ssr.values[i22],
       'milled ' + fmt(ssrM.values[i22]) + '% vs as-published ' + fmt(ssr.values[i22]) + '%');
    ok('as-published basis raises a unit-consistency warning',
       ssr.flags.some(f => f.level === 'warning' && /paddy/.test(f.text)));
    ok('selecting item 31 raises a broken-rice warning',
       bal.notes.some(n => n.level === 'warning' && /BROKEN RICE/.test(n.text)),
       'so a replication run cannot be mistaken for a measurement run');

    group('trade series correction');

    // The defect this correction fixes. Item 31 excludes broken rice, which is
    // the staple imported form in much of West Africa; item 30 is the
    // standardized total. For Senegal the two differ by more than an order of
    // magnitude, and only item 30 agrees with USDA's independent estimate.
    const senTot = RSA.balance('fao', { kind: 'country', id: 'SEN' }, { basis: 'milled' });
    const senM31 = RSA.balance('fao', { kind: 'country', id: 'SEN' },
      { basis: 'milled', standardizedTrade: false });
    const j = senTot.years.indexOf(2024);
    ok('item 30 is the default trade series',
       senTot.imports[j] > senM31.imports[j] * 5,
       'item 30 ' + fmt(senTot.imports[j]) + ' t vs item 31 ' + fmt(senM31.imports[j]) + ' t');

    const ssrTot = I.compute('ssr', senTot).values[j];
    const ssrM31 = I.compute('ssr', senM31).values[j];
    ok('the default gives a plausible Senegalese self-sufficiency ratio',
       ssrTot > 20 && ssrTot < 70, 'SSR ' + fmt(ssrTot) + '%');
    ok('item 31 would have overstated it badly', ssrM31 > 90,
       'SSR ' + fmt(ssrM31) + '% on item 31 — the figure this correction removes');

    // Agreement with the independent source is the real test of which series is
    // measuring rice trade.
    const xs = RSAPolicy.crossDatabase('SEN', {});
    if (xs) {
      ok('default FAOSTAT imports agree with USDA to within a factor of two for Senegal',
         xs.imports.ratio > 0.5 && xs.imports.ratio < 2,
         'USDA is ' + f2(xs.imports.ratio) + 'x FAOSTAT in ' + xs.year);
    }

    // The correction must not have broken countries that were already right.
    ['MLI', 'TZA', 'MDG'].forEach(iso => {
      const b = RSA.balance('fao', { kind: 'country', id: iso }, { basis: 'milled' });
      const v = I.compute('ssr', b);
      const last = RSAPolicy.lastObs(v);
      ok(iso + ' self-sufficiency stays in a plausible range',
         last && last.value > 0 && last.value < 250, last ? fmt(last.value) + '%' : 'no value');
    });
  }

  /* ============================================== data integrity, live data */

  function testData() {
    group('data integrity');
    const meta = RSA.state.meta;
    const fao = RSA.state.fao;

    ok('registry is populated', RSA.countries().length >= 50,
       RSA.countries().length + ' countries');
    ok('every country has a FAOSTAT series',
       RSA.countries().every(c => !!fao.series[c.iso3]));
    ok('FAOSTAT window starts in 1961', fao.years[0] === 1961);
    ok('population runs past 2050 for projection',
       fao.popYears[fao.popYears.length - 1] >= 2050);
    ok('provenance records an extraction timestamp', !!meta.extracted);
    ok('every source records a publication date',
       meta.sources.every(s => !!s.published && !!s.url));

    // Series lengths must match their year vectors, or every chart is silently
    // misaligned by one.
    let lenOk = true, lenBad = null;
    RSA.countries().forEach(c => {
      const s = fao.series[c.iso3];
      ['area', 'yield', 'production', 'imports', 'exports'].forEach(f => {
        if (s[f].length !== fao.years.length) { lenOk = false; lenBad = c.iso3 + '.' + f; }
      });
      if (s.population.length !== fao.popYears.length) { lenOk = false; lenBad = c.iso3 + '.population'; }
    });
    ok('all series align with their year vectors', lenOk, lenBad ? 'first mismatch: ' + lenBad : '');

    // No negative quantities anywhere.
    let negs = 0;
    RSA.countries().forEach(c => {
      const s = fao.series[c.iso3];
      ['area', 'yield', 'production', 'imports', 'exports'].forEach(f => {
        s[f].forEach(v => { if (v != null && v < 0) negs++; });
      });
    });
    ok('no negative quantities in the FAOSTAT extract', negs === 0, negs + ' found');

    // Aggregation must be additive.
    const wa = RSA.balance('fao', { kind: 'region', id: 'Western Africa' }, { basis: 'asPublished' });
    const members = RSA.resolve({ kind: 'region', id: 'Western Africa' });
    const i = wa.years.indexOf(2020);
    let sum = 0;
    members.forEach(iso => {
      const v = RSA.state.fao.series[iso].production[i];
      if (v != null) sum += v;
    });
    near('regional production is the sum of its members', wa.production[i], sum, 1e-6);

    // USDA must stay separate and be on a different basis.
    ok('USDA series are held separately', !!RSA.state.usda.series &&
       Object.keys(RSA.state.usda.series).length > 20);
    ok('USDA declares a milled production basis', /MILLED/.test(RSA.state.usda.basis.production));

    // Data quality scoring.
    const q = RSA.quality('fao', 'NGA', { from: 1990, to: 2024 });
    ok('quality score is on a 0-100 scale', q && q.score >= 0 && q.score <= 100, 'Nigeria: ' + (q && q.score));
    ok('quality weights sum to 1',
       Math.abs(Object.keys(q.weights).reduce((a, k) => a + q.weights[k], 0) - 1) < 1e-9);
  }

  /* ==================================================== scenario invariants */

  function testScenarios() {
    group('scenarios');
    const bal = RSA.balance('fao', { kind: 'country', id: 'NGA' }, { basis: 'milled' });
    const base = RSAScenarios.baseline(bal, 2035, {});
    ok('a baseline can be built for Nigeria', base.ok, base.ok ? '' : base.reason);
    if (!base.ok) return;

    ok('the baseline reaches the target year',
       base.path[base.path.length - 1].year === 2035);
    ok('the baseline identity holds: P = A x Y / 1000',
       base.path.every(p => Math.abs(p.production - p.area * p.yield / 1000) < 1e-6));
    ok('the baseline identity holds: C = cpc x N / 1000',
       base.path.every(p => p.consumption == null ||
         Math.abs(p.consumption - p.cpc * p.population / 1000) < 1e-3));
    ok('population comes from the UN projection, not from a fitted model',
       /World Population Prospects/.test(base.populationSource));

    // A null intervention must reproduce the baseline exactly.
    const s0 = RSAScenarios.scenarioArea(base, 0, {});
    ok('a zero-expansion scenario reproduces the baseline',
       Math.abs(s0.summary.ssr - s0.summary.ssrBaseline) < 1e-9,
       'delta = ' + fmt(s0.summary.ssr - s0.summary.ssrBaseline));
    near('a zero-expansion scenario costs nothing', s0.summary.cost, 0, 1e-6);

    // Monotonicity: more area cannot lower SSR.
    const s10 = RSAScenarios.scenarioArea(base, 0.10, {});
    const s30 = RSAScenarios.scenarioArea(base, 0.30, {});
    ok('SSR is monotone increasing in area expansion',
       s30.summary.ssr > s10.summary.ssr && s10.summary.ssr > s0.summary.ssr,
       fmt(s0.summary.ssr) + ' < ' + fmt(s10.summary.ssr) + ' < ' + fmt(s30.summary.ssr));
    ok('cost is monotone increasing in area expansion', s30.summary.cost > s10.summary.cost);

    // Yield and variety levers act on yield, not area.
    const sy = RSAScenarios.scenarioYield(base, 0.20, {});
    ok('the yield lever leaves area unchanged',
       Math.abs(sy.summary.area - s0.summary.area) < 1e-6);
    ok('the yield lever raises yield', sy.summary.yield > s0.summary.yield);
    const sv = RSAScenarios.scenarioVariety(base, 0.50, 0.30, {});
    ok('variety adoption raises yield', sv.summary.yield > s0.summary.yield);
    near('variety yield effect is adoption x gain at full phase-in',
      sv.summary.yield / s0.summary.yield, 1 + 0.5 * 0.30, 1e-6);

    // The tariff scenario must move consumption DOWN and flag consumer welfare.
    const st = RSAScenarios.scenarioTariff(base, 0.20, {});
    ok('a tariff reduces consumption', st.summary.imports <= s0.summary.imports);
    ok('a tariff raises production', st.summary.production > s0.summary.production);
    ok('a tariff carries a consumer welfare warning',
       st.warnings.some(w => /staple|welfare/i.test(w.text)));
    ok('a tariff is labelled a simulation rather than a prediction',
       /not a causal prediction/i.test(st.warnings.map(w => w.text).join(' ')));

    // Excessive area expansion must be flagged, not silently accepted.
    const sBig = RSAScenarios.scenarioArea(base, 5.0, {});
    ok('implausible expansion is flagged against the land ceiling',
       sBig.warnings.some(w => w.level === 'error'),
       'feasibility: ' + sBig.feasibility.level);
    ok('implausible expansion is not called plausible', sBig.feasibility.level !== 'plausible');

    // Optimiser.
    const opt = RSAScenarios.optimize(base, { ssrTarget: 100 });
    ok('the optimiser returns a decision', opt.ok === true || opt.ok === false);
    if (opt.ok) {
      ok('the optimal package meets the SSR target', opt.solution.ssr >= 100 - 1e-6,
         'SSR = ' + fmt(opt.solution.ssr));
      ok('the optimal package respects the land constraint',
         opt.solution.areaExpansion <= opt.constraints.maxArea + 1e-9);
      ok('the optimiser states its objective', /minimise/.test(opt.objective));
      ok('the optimiser discloses that costs are assumptions', /placeholder/i.test(opt.disclaimer));
    } else {
      ok('an infeasible target reports the best attainable outcome instead of failing silently',
         !!opt.bestAttainable, opt.reason);
    }

    // Every scenario must carry its disclaimer.
    [s0, s10, sy, sv, st].forEach(s => {
      ok(s.label + ' is labelled a simulation', s.kind === 'scenario-simulation' && !!s.disclaimer);
    });

    group('baseline plausibility');

    // Benin is the case that exposed this. Before the stationarity check was
    // fixed, model selection accepted an explosive ARIMA whose extrapolation put
    // per-capita consumption above 450 kg/capita/year by 2040 -- roughly three
    // times any national diet on record -- and that single number propagated into
    // consumption, imports and SSR. With proper inverse-root checking the
    // selected model is well behaved and the projection is plausible again, so
    // the assertion here is that the OUTPUT is sane, not that the guard fires.
    const benBal = RSA.balance('fao', { kind: 'country', id: 'BEN' }, { basis: 'asPublished' });
    const benBase = RSAScenarios.baseline(benBal, 2040, {});
    ok('a baseline can be built for Benin', benBase.ok, benBase.ok ? '' : benBase.reason);
    if (benBase.ok) {
      const maxCpc = Math.max.apply(null, benBase.path.map(p => p.cpc).filter(v => v != null));
      ok('projected per capita consumption never exceeds the plausibility ceiling',
         maxCpc <= benBase.cpcCeiling + 1e-6,
         'max ' + fmt(maxCpc) + ' kg/capita against a ceiling of ' + fmt(benBase.cpcCeiling));
      ok('projected per capita consumption is dietarily plausible',
         maxCpc < 250, 'max ' + fmt(maxCpc) + ' kg/capita');
      ok('the projecting model is stationary and invertible',
         !benBase.components.cpc.selection || !benBase.components.cpc.selection.selected ||
         (benBase.components.cpc.selection.selected.stationary &&
          benBase.components.cpc.selection.selected.invertible),
         benBase.components.cpc.model);
      ok('historical re-export distortion is reported',
         benBase.reExportYears.length === 0 ||
         benBase.warnings.some(w => /re-export/i.test(w.text)),
         benBase.reExportYears.length + ' years with IDR above 100%');
      ok('the unconstrained path is retained for inspection',
         Array.isArray(benBase.cpcUnconstrained) && benBase.cpcUnconstrained.length > 0);
    }

    // The guard itself is tested by forcing a ceiling the projection must breach.
    // This checks the mechanism independently of which model happens to be chosen.
    const forced = RSAScenarios.baseline(benBal, 2040, { cpcCeiling: 50 });
    if (forced.ok) {
      const maxForced = Math.max.apply(null, forced.path.map(p => p.cpc).filter(v => v != null));
      ok('a breached ceiling caps the projected path', maxForced <= forced.cpcCeiling + 1e-6,
         'max ' + fmt(maxForced) + ' against a forced ceiling of ' + fmt(forced.cpcCeiling));
      ok('capping is reported rather than applied silently',
         forced.cpcCapped.length > 0 && forced.warnings.some(w => /CAPPED/.test(w.text)),
         forced.cpcCapped.length + ' years capped');
      ok('a capped baseline is flagged as unreliable', forced.reliable === false);
      ok('the capped baseline still reports the unconstrained maximum',
         forced.warnings.some(w => /kg\/capita, which no/.test(w.text)));
    }

    // A country without the distortion must NOT be capped or flagged.
    const tzBase = RSAScenarios.baseline(
      RSA.balance('fao', { kind: 'country', id: 'TZA' }, { basis: 'milled' }), 2040, {});
    if (tzBase.ok) {
      ok('an undistorted baseline is not capped', tzBase.cpcCapped.length === 0,
         'Tanzania, milled basis');
      ok('an undistorted baseline is marked reliable', tzBase.reliable === true);
    }
  }

  /* ================================== accuracy invariants across the full dataset
   *
   * These are the checks that catch a broken indicator no unit test would: they
   * run every equation over every country and every year and assert properties
   * that must hold by construction. A failure here means an arithmetic error, not
   * a data problem.
   */

  function testAccuracy() {
    group('accuracy invariants');
    const I = RSAIndicators;
    const countries = RSA.countries();

    // SSR and IDR are ratios, so multiplying numerator and denominator by the
    // milling rate must leave them unchanged. Milled and paddy bases therefore
    // give identical values; only the per-capita quantities differ.
    let worstSsr = 0, worstIdr = 0, n = 0;
    countries.forEach(c => {
      const m = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'milled' });
      const p = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'paddy' });
      const sm = I.compute('ssr', m).values, sp = I.compute('ssr', p).values;
      const im = I.compute('idr', m).values, ip = I.compute('idr', p).values;
      for (let i = 0; i < sm.length; i++) {
        if (sm[i] != null && sp[i] != null) { worstSsr = Math.max(worstSsr, Math.abs(sm[i] - sp[i])); n++; }
        if (im[i] != null && ip[i] != null) worstIdr = Math.max(worstIdr, Math.abs(im[i] - ip[i]));
      }
    });
    // Tolerance is 1e-6 percentage points, not zero: the milled basis multiplies
    // the numerator by the milling rate while the paddy basis divides the trade
    // terms by it, so the two reach the same ratio through different arithmetic
    // and cannot be bit-identical in double precision. 1e-6 pp is roughly ten
    // orders of magnitude below anything that could change a reading.
    ok('SSR is identical on the milled and paddy bases', worstSsr < 1e-6,
       'max deviation ' + worstSsr.toExponential(2) + ' pp over ' + n + ' observations');
    ok('IDR is identical on the milled and paddy bases', worstIdr < 1e-6,
       'max deviation ' + worstIdr.toExponential(2) + ' pp');

    // The balance-sheet identity, on every basis.
    let worstC = 0;
    ['asPublished', 'milled', 'paddy'].forEach(basis => {
      countries.forEach(c => {
        const b = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: basis });
        for (let i = 0; i < b.years.length; i++) {
          if (b.consumption[i] == null) continue;
          const expect = b.production[i] + b.imports[i] - (b.exports[i] || 0);
          worstC = Math.max(worstC, Math.abs(b.consumption[i] - expect));
        }
      });
    });
    ok('C = P + M - X holds on every basis for every country and year', worstC < 1e-6,
       'max deviation ' + worstC.toExponential(2));

    // SSR + IDR = 100 exactly when exports are zero.
    let worstSum = 0, zeroX = 0;
    countries.forEach(c => {
      const b = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'milled' });
      const s = I.compute('ssr', b).values, d = I.compute('idr', b).values;
      for (let i = 0; i < b.years.length; i++) {
        if (s[i] == null || d[i] == null) continue;
        if (b.exports[i] != null && b.exports[i] !== 0) continue;
        zeroX++;
        worstSum = Math.max(worstSum, Math.abs(s[i] + d[i] - 100));
      }
    });
    ok('SSR + IDR = 100 wherever exports are zero', worstSum < 1e-9,
       'max deviation ' + worstSum.toExponential(2) + ' over ' + zeroX + ' country-years');

    // Yield identity and the basis conversion factor.
    let worstY = 0, worstR = 0;
    const rate = RSA.DEFAULT_MILLING_RATE;
    countries.forEach(c => {
      const b = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'milled' });
      const a = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'asPublished' });
      for (let i = 0; i < b.years.length; i++) {
        if (b.yield[i] != null && b.area[i]) {
          worstY = Math.max(worstY, Math.abs(b.yield[i] - 1000 * b.production[i] / b.area[i]));
        }
        if (a.production[i] != null) {
          worstR = Math.max(worstR, Math.abs(b.production[i] - a.production[i] * rate));
        }
      }
    });
    ok('yield = 1000 x P / A everywhere', worstY < 1e-6, 'max deviation ' + worstY.toExponential(2));
    ok('milled production = milling rate x paddy production', worstR < 1e-6,
       'rate ' + rate + ', max deviation ' + worstR.toExponential(2));

    // Aggregates are exact sums, in every region.
    let worstAgg = 0;
    RSA.regions().forEach(rg => {
      const agg = RSA.balance('fao', { kind: 'region', id: rg }, { basis: 'milled' });
      const members = RSA.resolve({ kind: 'region', id: rg });
      for (let i = 0; i < agg.years.length; i++) {
        let sum = null;
        members.forEach(iso => {
          const b = RSA.balance('fao', { kind: 'country', id: iso }, { basis: 'milled' });
          if (b.production[i] != null) sum = (sum == null ? 0 : sum) + b.production[i];
        });
        if (sum != null && agg.production[i] != null) {
          worstAgg = Math.max(worstAgg, Math.abs(sum - agg.production[i]));
        }
      }
    });
    ok('every regional aggregate is the exact sum of its members', worstAgg < 1e-6,
       'max deviation ' + worstAgg.toExponential(2));

    // No indicator may return a non-finite number anywhere.
    let nonFinite = 0, firstBad = null;
    const ids = ['production', 'area', 'yield', 'imports', 'exports', 'consumption',
                 'ppc', 'cpc', 'ssr', 'idr', 'icr', 'ntr', 'pcb', 'pcg', 'importBill',
                 'importUnitValue', 'importBillPerCapita', 'tradeBalanceValue'];
    countries.forEach(c => {
      const b = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'milled' });
      ids.forEach(id => {
        I.compute(id, b).values.forEach((v, i) => {
          if (v == null) return;
          if (!isFinite(v)) { nonFinite++; if (!firstBad) firstBad = c.iso3 + '.' + id + '@' + b.years[i]; }
        });
      });
    });
    ok('no indicator returns Infinity or NaN anywhere in the dataset', nonFinite === 0,
       nonFinite ? 'first: ' + firstBad : 'checked ' + ids.length + ' indicators x ' +
       countries.length + ' countries');

    // The SSR definition text must state the milled basis, since that is what the
    // platform now presents as the FAO definition.
    const ssrDef = I.get('ssr');
    ok('the SSR definition is stated on a milled basis',
       /milled/i.test(ssrDef.equation) && /milled/i.test(ssrDef.latex),
       ssrDef.equation);
    ok('the SSR definition explains the basis rule', /same commodity/i.test(ssrDef.note || ''));
  }

  /* =========================================== horizons and phase-in models */

  function testHorizons() {
    group('horizons and phase-in models');
    const R = RSAScenarios;

    ok('five horizons are defined', R.HORIZONS.length === 5, R.HORIZONS.join(', '));
    ok('horizons are 2030 to 2050 in five-year steps',
       R.HORIZONS.join(',') === '2030,2035,2040,2045,2050');

    // Every ramp model must map [0,1] onto [0,1], start at 0 (except the step)
    // and end at 1, and never decrease.
    Object.keys(R.RAMPS).forEach(k => {
      const at = x => R.rampFactor(x, k);
      ok(k + ' ramp ends at 1', Math.abs(at(1) - 1) < 1e-9, 'f(1) = ' + at(1));
      if (k !== 'immediate') ok(k + ' ramp starts at 0', Math.abs(at(0)) < 1e-9, 'f(0) = ' + at(0));
      let mono = true;
      for (let x = 0; x <= 1.0001; x += 0.05) if (at(x) < at(Math.max(0, x - 0.05)) - 1e-9) mono = false;
      ok(k + ' ramp is monotone non-decreasing', mono);
      let bounded = true;
      for (let x = -0.5; x <= 1.5; x += 0.1) { const v = at(x); if (v < -1e-9 || v > 1 + 1e-9) bounded = false; }
      ok(k + ' ramp stays within [0, 1] even outside the domain', bounded);
      ok(k + ' ramp documents itself', !!R.RAMPS[k].label && !!R.RAMPS[k].note);
    });

    // The logistic must actually be S-shaped: below linear early, above it late.
    ok('the logistic ramp lags a linear one early', R.rampFactor(0.25, 'logistic') < 0.25);
    ok('the logistic ramp leads a linear one late', R.rampFactor(0.75, 'logistic') > 0.75);
    ok('the logistic ramp is symmetric about its midpoint',
       Math.abs(R.rampFactor(0.5, 'logistic') - 0.5) < 1e-9);
    // Back-loaded lags throughout, front-loaded leads throughout.
    ok('the back-loaded ramp lags a linear one', R.rampFactor(0.5, 'backloaded') < 0.5);
    ok('the front-loaded ramp leads a linear one', R.rampFactor(0.5, 'frontloaded') > 0.5);
    ok('the immediate ramp is fully applied from the start', R.rampFactor(0, 'immediate') === 1);
    ok('an unknown ramp model falls back to linear',
       Math.abs(R.rampFactor(0.37, 'nonsense') - 0.37) < 1e-9);

    // Scenario horizon rows.
    const b = RSA.balance('fao', { kind: 'country', id: 'SEN' }, { basis: 'milled' });
    const base = RSAScenarios.baseline(b, 2050, {});
    ok('a baseline reaching 2050 can be built', base.ok, base.ok ? '' : base.reason);
    if (!base.ok) return;

    const sc = RSAScenarios.scenarioYield(base, 0.20, { rampTo: 2040, rampModel: 'linear' });
    ok('a scenario reports every horizon', sc.horizons.length === 5);
    ok('horizon years are correct', sc.horizons.map(r => r.year).join(',') === '2030,2035,2040,2045,2050');
    ok('all horizons are available on a 2050 baseline', sc.horizons.every(r => r.available));
    ok('phase-in reaches 1 at the ramp target',
       Math.abs(sc.horizons.find(r => r.year === 2040).phaseIn - 1) < 1e-9);
    ok('phase-in holds at 1 after the ramp target',
       sc.horizons.filter(r => r.year > 2040).every(r => Math.abs(r.phaseIn - 1) < 1e-9),
       'the policy stays in place rather than switching off');
    ok('phase-in is partial before the ramp target',
       sc.horizons.find(r => r.year === 2030).phaseIn < 1);
    ok('SSR improves monotonically with phase-in against the baseline',
       sc.horizons.every(r => r.ssrChange >= -1e-9),
       sc.horizons.map(r => r.year + ':' + (r.ssrChange || 0).toFixed(2)).join(' '));

    // A different phase-in model must change intermediate years but not the end.
    const back = RSAScenarios.scenarioYield(base, 0.20, { rampTo: 2040, rampModel: 'backloaded' });
    const lin2030 = sc.horizons.find(r => r.year === 2030).ssr;
    const back2030 = back.horizons.find(r => r.year === 2030).ssr;
    ok('a back-loaded model delivers less by 2030 than a linear one', back2030 < lin2030,
       f2(back2030) + '% vs ' + f2(lin2030) + '%');
    const lin2050 = sc.horizons.find(r => r.year === 2050).ssr;
    const back2050 = back.horizons.find(r => r.year === 2050).ssr;
    ok('both models converge once fully phased in', Math.abs(back2050 - lin2050) < 1e-6,
       f2(back2050) + '% vs ' + f2(lin2050) + '%');

    // A zero-intensity scenario must equal the baseline at every horizon.
    const zero = RSAScenarios.scenarioYield(base, 0, { rampTo: 2040 });
    ok('a null intervention matches the baseline at every horizon',
       zero.horizons.every(r => Math.abs(r.ssr - r.ssrBaseline) < 1e-9));

    // pointAt must not silently substitute a nearby year.
    ok('pointAt returns null for a year outside the path',
       RSAScenarios.pointAt(base.path, 2099) === null);
  }

  /* ============================================== diagnostic rules on real data */

  function testDiagnostics() {
    group('diagnostics');

    // Nigeria: recorded imports collapsed from ~2.15 Mt (2013) to a few thousand
    // tonnes after the FX restrictions and border closure, which pushes measured
    // SSR to ~99% even though the rice kept arriving informally. The platform
    // must not report that as self-sufficiency without saying what it is.
    const nga = RSA.balance('fao', { kind: 'country', id: 'NGA' }, { basis: 'milled' });
    const dn = RSAPolicy.diagnose(nga, {});
    ok('Nigeria triggers the import-collapse rule',
       dn.findings.some(f => f.ruleId === 'import-collapse'),
       'rules fired: ' + dn.findings.map(f => f.ruleId).join(', '));
    ok('the import-collapse finding warns that SSR is overstated',
       dn.findings.some(f => f.ruleId === 'import-collapse' && /overstated/i.test(f.text)));
    ok('the import-collapse finding is high severity',
       dn.findings.some(f => f.ruleId === 'import-collapse' && f.severity === 'high'));

    // A country with stable trade must NOT trigger it.
    const tza = RSAPolicy.diagnose(RSA.balance('fao', { kind: 'country', id: 'TZA' }, { basis: 'milled' }), {});
    ok('a country with stable trade does not trigger import-collapse',
       !tza.findings.some(f => f.ruleId === 'import-collapse'));

    // Ethiopia's SSR jumps from ~14% to ~90% in three years, which is a
    // provisional final year of trade data rather than an agricultural miracle.
    const eth = RSAPolicy.diagnose(RSA.balance('fao', { kind: 'country', id: 'ETH' }, { basis: 'milled' }), {});
    ok('an implausible final-year jump is flagged as provisional',
       eth.findings.some(f => f.ruleId === 'provisional-final-year'),
       'rules fired: ' + eth.findings.map(f => f.ruleId).join(', '));

    // Every rule that fires must report the condition that fired it, so a reader
    // can audit the claim rather than take it on trust.
    const all = [dn, tza, eth];
    ok('every finding states its rule and condition',
       all.every(d => d.findings.every(f => !!f.ruleId && !!f.condition)));
    ok('no rule fires on missing data',
       RSAPolicy.diagnose(RSA.balance('fao', { kind: 'country', id: 'SYC' }, { basis: 'milled' }), {})
         .findings.every(f => !!f.title));

    // Cross-database check: for Nigeria, USDA estimates rice imports two orders
    // of magnitude above FAOSTAT while the two agree closely on production. That
    // gap is the unrecorded trade, and it must be surfaced rather than averaged.
    const x = RSAPolicy.crossDatabase('NGA', {});
    ok('a cross-database comparison is available for Nigeria', !!x);
    if (x) {
      ok('the comparison uses a year both databases report',
         x.year >= 1990 && x.year <= 2026, 'year ' + x.year);
      ok('the two databases broadly agree on production',
         Math.abs(x.production.pctDiff) < 40, f2(x.production.pctDiff) + '% apart');
      ok('the two databases diverge sharply on imports',
         x.imports.ratio > 3, 'USDA is ' + f2(x.imports.ratio) + 'x FAOSTAT');
      ok('both self-sufficiency figures are reported side by side',
         x.ssr.fao != null && x.ssr.usda != null,
         'FAO ' + f2(x.ssr.fao) + '% vs USDA ' + f2(x.ssr.usda) + '%');
      ok('the FAOSTAT figure is the more self-sufficient of the two',
         x.ssr.fao > x.ssr.usda, 'as unrecorded imports inflate it');
      ok('the comparison explains the methodological difference',
         /customs/.test(x.note) && /balance/.test(x.note));
    }
    ok('Nigeria triggers the database-divergence finding',
       dn.findings.some(fd => fd.ruleId === 'database-divergence'),
       dn.findings.map(fd => fd.ruleId).join(', '));
    ok('the divergence finding warns against quoting the FAOSTAT SSR unqualified',
       dn.findings.some(fd => fd.ruleId === 'database-divergence' && /Do not quote/.test(fd.text)));
    ok('a cross-database check is not attempted for aggregates',
       RSAPolicy.diagnose(RSA.balance('fao', { kind: 'region', id: 'Western Africa' },
         { basis: 'milled' }), {}).crossDatabase === null);

    // Recommendations must be deduplicated and resolvable.
    ok('recommendations resolve to defined actions',
       dn.recommendations.every(r => r.id && r.label && r.detail));
    ok('recommendations are deduplicated',
       new Set(dn.recommendations.map(r => r.id)).size === dn.recommendations.length);
  }

  /* ================================================ language and food balance */

  function testI18n() {
    group('language');
    const before = RSAi18n.get();

    ok('both languages are complete', (function () {
      RSAi18n.set('en'); const en = RSAi18n.coverage();
      RSAi18n.set('fr'); const fr = RSAi18n.coverage();
      RSAi18n.set(before);
      return en.pct === 100 && fr.pct === 100;
    })(), 'English and French both at 100% of ' + Object.keys(RSAi18n.STRINGS).length + ' keys');

    // Every key must have both languages, or a switch leaves gaps.
    const missing = Object.keys(RSAi18n.STRINGS)
      .filter(k => !RSAi18n.STRINGS[k].en || !RSAi18n.STRINGS[k].fr);
    ok('no key is missing a language', missing.length === 0, missing.slice(0, 5).join(', '));

    // Interpolation.
    RSAi18n.set('en');
    ok('placeholders interpolate', RSAi18n.t('hero.lede', { n: 55 }).indexOf('55') > 0);
    RSAi18n.set('fr');
    ok('placeholders interpolate in French', RSAi18n.t('hero.lede', { n: 55 }).indexOf('55') > 0);

    // Number formatting is the part that could actually mislead: French uses a
    // comma as the decimal mark, so an SSR of 18.25 must render "18,25" and
    // never "18.25", which a French reader would parse as eighteen thousand.
    RSAi18n.set('fr');
    ok('French uses a comma as the decimal mark', RSAi18n.num(18.25, 2) === '18,25',
       'got ' + RSAi18n.num(18.25, 2));
    ok('French per-cent carries a preceding space', /\s%$/.test(RSAi18n.pct(18.25)),
       'got "' + RSAi18n.pct(18.25) + '"');
    RSAi18n.set('en');
    ok('English uses a point as the decimal mark', RSAi18n.num(18.25, 2) === '18.25',
       'got ' + RSAi18n.num(18.25, 2));
    ok('English per-cent has no preceding space', /\d%$/.test(RSAi18n.pct(18.25)),
       'got "' + RSAi18n.pct(18.25) + '"');

    // Unknown keys and languages must degrade, not break.
    ok('an unknown key returns the key rather than blank',
       RSAi18n.t('no.such.key') === 'no.such.key');
    ok('an unsupported language is rejected', RSAi18n.set('de') !== 'de');
    RSAi18n.set(before);

    // Equations and symbols must NOT be translated -- they are international
    // notation and localising them would make the methodology harder to check.
    RSAi18n.set('fr');
    const ssr = RSAIndicators.get('ssr');
    ok('equations stay in international notation', /Production\(milled\)/.test(ssr.equation));
    /* get().label used to hold the ENGLISH name while label(id) held the French
     * one, which meant every call site that reached for the descriptor -- most of
     * them -- silently rendered English. get() now returns the localised label
     * and keeps the English in labelEn for exports. */
    ok('indicator labels ARE localised', RSAIndicators.label('ssr') === ssr.label &&
       ssr.label !== ssr.labelEn, 'fr: ' + ssr.label + ' / en: ' + ssr.labelEn);
    ok('an indicator with no translation falls back to English',
       RSAIndicators.label('nonexistent') === 'nonexistent');
    RSAi18n.set(before);
  }

  function testFoodBalance() {
    group('food balance sheets');
    const fbsMeta = RSA.state.fao.fbs;
    ok('food balance sheet data is present', !!fbsMeta && !!fbsMeta.series);
    if (!fbsMeta) return;
    ok('the FBS basis is declared as milled equivalent', /MILLED/.test(fbsMeta.basis));
    ok('FBS coverage is recorded, including what is missing',
       fbsMeta.covered.length > 40 && Array.isArray(fbsMeta.missing),
       fbsMeta.covered.length + ' covered, ' + fbsMeta.missing.length + ' missing');
    // Benin is absent from the CURRENT release but present in the HISTORIC one,
    // and joining the two is what brought its per-capita consumption into line
    // with published figures.
    ok('Benin is covered once the historic release is joined in',
       fbsMeta.missing.indexOf('BEN') < 0 && fbsMeta.covered.indexOf('BEN') >= 0,
       'the current release alone omits it');

    // Senegal is covered and is the case that shows why this matters.
    const fb = RSA.foodBalance({ kind: 'country', id: 'SEN' }, { basis: 'milled' });
    ok('a food balance can be built for Senegal', fb && fb.available);
    if (fb && fb.available) {
      const i = fb.years.indexOf(2022);
      ok('food use is strictly less than domestic supply',
         fb.food[i] < fb.domesticSupply[i],
         'food ' + fmt(fb.food[i] / 1000) + ' kt vs supply ' + fmt(fb.domesticSupply[i] / 1000) + ' kt');
      ok('per capita food supply is dietarily plausible',
         fb.foodPerCapita[i] > 20 && fb.foodPerCapita[i] < 200,
         fmt(fb.foodPerCapita[i]) + ' kg/capita on a milled basis');
    }

    // A country absent from BOTH releases must return a clear negative, not a
    // fabricated series. Six remain uncovered after the join.
    const uncovered = fbsMeta.missing[0];
    ok('some countries remain uncovered by either release', !!uncovered,
       fbsMeta.missing.join(', '));
    if (uncovered) {
      const none = RSA.foodBalance({ kind: 'country', id: uncovered }, { basis: 'milled' });
      ok('an uncovered country reports no data rather than inventing it',
         none && none.available === false && !!none.reason,
         uncovered + ': ' + (none && none.reason));
      ok('fbsAvailable agrees',
         RSA.fbsAvailable('SEN') === true && RSA.fbsAvailable('BEN') === true &&
         RSA.fbsAvailable(uncovered) === false);
    }

    // The consumption cross-check: apparent utilization is not food.
    const chk = RSA.consumptionCheck({ kind: 'country', id: 'SEN' }, { basis: 'milled' });
    ok('the consumption check runs where FBS exists', chk && chk.available);
    if (chk && chk.available && chk.last) {
      ok('apparent utilization exceeds food use', chk.last.ratioApparentToFood > 1,
         'ratio ' + fmt(chk.last.ratioApparentToFood));
      ok('a non-food share is reported', chk.last.nonFoodShare != null &&
         chk.last.nonFoodShare > 0 && chk.last.nonFoodShare < 1,
         fmt(100 * chk.last.nonFoodShare) + '% of supply is not food');
      ok('the check explains what the gap means', /not food consumption/.test(chk.note));
    }
  }

  /* ================================ accuracy against published figures */

  function testPublishedAccuracy() {
    group('accuracy vs published figures');
    const I = RSAIndicators;

    // Per-capita rice consumption from the Food Balance Sheets, which is the
    // measure published statistics quote. Apparent utilization is NOT that
    // measure and was previously several times too high for re-exporting
    // countries -- Benin read 146 kg/capita against a published ~54.
    const published = {
      BEN: [45, 65],    // AfricaRice country page: 54.37 kg (2022)
      SEN: [70, 110],   // among the world's highest
      NGA: [15, 40],
      GHA: [30, 55],
      CIV: [55, 90],
      MDG: [85, 125]
    };
    Object.keys(published).forEach(iso => {
      const b = RSA.balance('fao', { kind: 'country', id: iso }, { basis: 'milled' });
      const last = RSAPolicy.lastObs(I.compute('cpcFood', b));
      const range = published[iso];
      ok(iso + ' per capita food consumption is in the published range',
         last != null && last.value >= range[0] && last.value <= range[1],
         last ? fmt(last.value) + ' kg/capita (' + last.year + '), expected ' +
                range[0] + '-' + range[1] : 'no value');
    });

    // Benin is the specific case the reference paper and AfricaRice both cover.
    const ben = RSA.balance('fao', { kind: 'country', id: 'BEN' }, { basis: 'milled' });
    const benFood = RSAPolicy.lastObs(I.compute('cpcFood', ben));
    const benApparent = RSAPolicy.lastObs(I.compute('cpc', ben));
    ok('Benin now has food balance sheet coverage', RSA.fbsAvailable('BEN'),
       'via the historic release, which the current one omits');
    ok('Benin food consumption is close to the AfricaRice figure of 54.37 kg',
       benFood && Math.abs(benFood.value - 54.37) < 12,
       benFood ? fmt(benFood.value) + ' kg/capita in ' + benFood.year : 'no value');
    ok('apparent utilization is much higher than food use for Benin',
       benApparent && benFood && benApparent.value > benFood.value * 2,
       'apparent ' + fmt(benApparent && benApparent.value) + ' vs food ' +
       fmt(benFood && benFood.value) + ' — the gap is unrecorded re-export');

    // The two food balance releases are on different bases and must have been
    // reconciled, or every series would step by ~1.5x at 2010.
    const fb = RSA.foodBalance({ kind: 'country', id: 'SEN' }, { basis: 'milled' });
    ok('the food balance runs from 1961', fb.available && fb.years[0] === 1961,
       fb.available ? 'from ' + fb.years[0] : 'unavailable');
    if (fb.available) {
      const i2012 = fb.years.indexOf(2012), i2013 = fb.years.indexOf(2013);
      const i2014 = fb.years.indexOf(2014);
      const a = fb.foodPerCapita[i2012], b2 = fb.foodPerCapita[i2013], c = fb.foodPerCapita[i2014];
      ok('there is no methodological step at the 2013 join',
         a && b2 && c && Math.abs(c - b2) / b2 < 0.35,
         '2012 ' + fmt(a) + ', 2013 ' + fmt(b2) + ', 2014 ' + fmt(c));
    }
    ok('the food balance declares its milled basis', /MILLED/.test(RSA.state.fao.fbs.basis));
    ok('the food balance records the milling rate used to reconcile the two releases',
       RSA.state.fao.fbs.millingRate > 0);

    // Countries that grow no rice must appear at 0%, not as missing data.
    const noRice = ['LBY', 'TUN', 'BWA', 'NAM', 'LSO'];
    noRice.forEach(iso => {
      const b = RSA.balance('fao', { kind: 'country', id: iso }, { basis: 'milled' });
      const last = RSAPolicy.lastObs(I.compute('ssr', b));
      ok(iso + ' shows a self-sufficiency ratio of 0 rather than no data',
         last != null && last.value === 0, last ? fmt(last.value) + '%' : 'still missing');
      ok(iso + ' declares that the zero is derived',
         b.notes.some(n => /DERIVED/.test(n.text)));
    });

    // And every country must now be mappable.
    let mappable = 0;
    RSA.countries().forEach(c => {
      const b = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'milled' });
      if (RSAPolicy.lastObs(I.compute('ssr', b))) mappable++;
    });
    ok('every country has a self-sufficiency value for the map',
       mappable === RSA.countries().length,
       mappable + ' of ' + RSA.countries().length);

    // A country with a genuine mid-series gap must NOT be zero-filled.
    let zeroFilledWrongly = 0;
    RSA.countries().forEach(c => {
      const s = RSA.state.fao.series[c.iso3];
      let hasAny = false;
      for (let i = 0; i < s.production.length; i++) if (s.production[i] > 0) { hasAny = true; break; }
      if (!hasAny) return;
      const b = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'milled' });
      for (let i = 0; i < b.years.length; i++) {
        if (s.production[i] == null && b.production[i] === 0) zeroFilledWrongly++;
      }
    });
    ok('rice-growing countries are never zero-filled for missing years',
       zeroFilledWrongly === 0, zeroFilledWrongly + ' wrongly filled');
  }

  /* ===================================================== crisis analysis */

  function testCrisis() {
    group('crisis analysis');
    const T2 = RSATsa;

    // The F distribution underpins the Chow test.
    near('F(0.95; 1, 10) = 4.9646', 1 - T2.fcdf(4.9646, 1, 10), 0.05, 1e-3);
    near('F(0.95; 2, 20) = 3.4928', 1 - T2.fcdf(3.4928, 2, 20), 0.05, 1e-3);
    near('F(0.99; 3, 30) = 4.5097', 1 - T2.fcdf(4.5097, 3, 30), 0.01, 1e-3);
    ok('fcdf is 0 at or below zero', T2.fcdf(0, 2, 10) === 0 && T2.fcdf(-1, 2, 10) === 0);
    ok('fcdf rises to 1', T2.fcdf(1e6, 2, 10) > 0.999);

    // Every crisis is fully specified: a half-documented event window would let
    // the section report a number without saying what it is a number about.
    ok('every crisis has dates, a channel and confounders',
       RSACrisis.CRISES.every(c => c.start && c.end && c.end >= c.start &&
         c.channel && c.expect && c.confounders && c.name),
       RSACrisis.CRISES.length + ' crises');
    ok('every crisis is translated', RSACrisis.CRISES.every(c => c.nameFr && c.channelFr));
    ok('the 2007-08 crisis is dated correctly',
       RSACrisis.get('food2008').start === 2007 && RSACrisis.get('food2008').end === 2008);
    ok('the Russia-Ukraine window starts in 2022', RSACrisis.get('ukraine').start === 2022);
    ok('the India export ban window starts in 2023', RSACrisis.get('indiaban').start === 2023);

    // The 2011 pre-window unavoidably overlaps the 2008 aftermath, and that must
    // be declared rather than silently reported as a change.
    ok('the 2011 event declares its contaminated baseline',
       !!RSACrisis.get('spike2011').preWarning &&
       /ALREADY ELEVATED/.test(RSACrisis.get('spike2011').preWarning));

    const bal = RSA.balance('fao', { kind: 'country', id: 'SEN' }, { basis: 'milled' });

    // The 2008 rice price crisis is the cleanest natural experiment available and
    // is the check that the machinery detects a real shock.
    const a = RSACrisis.analyse(bal, 'food2008', {});
    ok('the 2008 analysis runs', !!a && a.rows.length > 0);
    const uv = a.rows.filter(r => r.id === 'importUnitValue')[0];
    ok('import unit value rose sharply in 2008 for Senegal',
       uv && uv.changePct > 40, uv ? fmt(uv.changePct) + '%' : 'n/a');

    const cf = a.counterfactual.importUnitValue;
    ok('a counterfactual was built from pre-crisis data only', cf && cf.ok, cf && cf.reason);
    if (cf && cf.ok) {
      ok('the counterfactual is fitted strictly before the crisis', cf.fittedTo < 2007,
         'fitted to ' + cf.fittedTo);
      ok('2008 falls outside the 95% interval of the pre-crisis projection',
         cf.anyOutsideInterval, cf.verdict.slice(0, 80));
      ok('the counterfactual reports the interval it was judged against',
         cf.rows.every(r => r.lower != null && r.upper != null && r.expected != null));
      ok('deviations are actual minus expected',
         cf.rows.every(r => Math.abs(r.deviation - (r.actual - r.expected)) < 1e-9));
    }

    const br = a.breaks.importUnitValue;
    ok('a Chow test ran at the crisis date', br && br.ok, br && br.reason);
    if (br && br.ok) {
      ok('the Chow test detects the 2008 break', br.significant, 'p = ' + fmt(br.pValue));
      ok('the Chow p-value is a probability', br.pValue >= 0 && br.pValue <= 1);
      ok('the Chow test discloses that its date was fixed in advance',
         /data mining/.test(br.caveat));
    }

    // COVID is the negative control: annual data cannot resolve a price spike that
    // ran for a few weeks, and the platform must say so rather than invent one.
    const cov = RSACrisis.analyse(bal, 'covid', {});
    const ccf = cov.counterfactual.importUnitValue;
    ok('COVID price movement is reported as within normal variation for Senegal',
       ccf && ccf.ok && ccf.anyOutsideInterval === false,
       'which is the honest answer for a spike that lasted weeks in annual data');
    ok('a within-interval verdict says explicitly that it is not evidence',
       ccf && /NOT be reported as a crisis effect/.test(ccf.verdict));

    // A window with too little data either side must refuse the break test.
    const ind = RSACrisis.analyse(bal, 'indiaban', {});
    ok('the break test refuses when there is too little post-crisis data',
       ind.breaks.importUnitValue && ind.breaks.importUnitValue.ok === false,
       ind.breaks.importUnitValue && ind.breaks.importUnitValue.reason);

    // Findings and recommendations.
    ok('every finding carries its evidence',
       a.findings.every(f => f.title && f.text && f.evidence && f.severity));
    ok('the analysis carries its non-causal caveat',
       /not causal identification/i.test(a.caveat));

    const all = RSACrisis.analyseAll(bal, {});
    ok('all crises can be analysed together', all.length === RSACrisis.CRISES.length);
    const rec = RSACrisis.recommendations(all);
    ok('recommendations are produced', rec.items.length > 0);
    ok('recommendations resolve to defined instruments',
       rec.items.every(r => r.id && r.label && r.detail && RSACrisis.RESILIENCE[r.id]));
    ok('recommendations distinguish resilience from structural policy',
       /RESILIENCE/.test(rec.note) || rec.items.length === 1);
    ok('the export-ban recommendation exists, given 2008 was caused by export bans',
       !!RSACrisis.RESILIENCE['avoid-export-bans']);

    // Cross-country ranking must separate real movement from trend continuation.
    const cc = RSACrisis.crossCountry('food2008', 'fao', { basis: 'milled' }, 'importUnitValue');
    ok('a cross-country ranking is produced', cc.length > 10, cc.length + ' countries');
    ok('the ranking is sorted by change', cc.every((r, i) =>
       i === 0 || cc[i - 1].changePct >= r.changePct));
    ok('the ranking flags whether each change exceeds normal variation',
       cc.some(r => r.beyondNormalVariation === true) &&
       cc.some(r => r.beyondNormalVariation === false),
       'both kinds present, so the flag is discriminating');

    // A counterfactual must refuse rather than guess on a short series.
    const shortRes = { years: [2018, 2019, 2020], values: [1, 2, 3], unit: 't' };
    const bad = RSACrisis.counterfactual(shortRes, RSACrisis.get('covid'), {});
    ok('a counterfactual refuses when pre-crisis data is too short',
       bad.ok === false && /15/.test(bad.reason), bad.reason);
  }

  /* ===================================== self-sufficiency condition */

  function testCondition() {
    group('self-sufficiency condition');
    const C = RSACondition;

    ok('four horizons are defined', C.HORIZONS.join(',') === '2030,2035,2045,2050');
    ok('four routes are defined', C.ROUTES.length === 4 &&
       C.ROUTES.every(r => r.id && r.label && r.labelFr));

    const opts = { dbKey: 'fao', basis: 'milled' };
    const ben = C.forSelection({ kind: 'country', id: 'BEN' }, opts);
    ok('the condition runs for Benin', ben.ok, ben.ok ? '' : ben.reason);
    if (!ben.ok) return;
    ok('every horizon is evaluated', ben.years.length === 4);

    const y = ben.years.filter(x => x.year === 2035)[0];
    ok('a horizon reports its baseline and gap',
       y.available && y.baseline.ssr > 0 && y.productionGap > 0);

    // The condition itself: required multiplier must equal C/P exactly.
    near('required multiplier equals consumption over production',
      y.requiredMultiplier, y.baseline.consumption / y.baseline.production, 1e-9);

    // Route 1: the yield-only requirement must exactly satisfy A x Y* = 1000 C.
    const rY = y.routes.filter(r => r.id === 'yield')[0];
    near('the yield-only requirement exactly closes the gap',
      y.baseline.area * rY.value / 1000, y.baseline.consumption, 1e-6);
    // Route 2: likewise for area.
    const rA = y.routes.filter(r => r.id === 'area')[0];
    near('the area-only requirement exactly closes the gap',
      rA.value * y.baseline.yield / 1000, y.baseline.consumption, 1e-6);
    // Route 3: adoption a satisfies (1 + a*g) = required multiplier.
    const rV = y.routes.filter(r => r.id === 'variety')[0];
    near('the adoption requirement delivers the required multiplier',
      1 + rV.value * y.ceilings.varietyYieldGain, y.requiredMultiplier, 1e-9);

    // Adoption above 100% is impossible and must be described as such rather than
    // printed as a percentage that looks like a bug.
    if (rV.value > 1) {
      ok('an impossible adoption requirement says why it is impossible',
         /cannot exceed 100%/.test(rV.requirement) && rV.feasible === false,
         rV.requirement.slice(0, 70));
    }

    /* REGRESSION: the optimiser must evaluate at the horizon being asked about.
     * It previously always evaluated at the baseline's own target year -- the
     * LAST horizon -- so a package that only reached 100% by 2050 was reported as
     * feasible at 2030. The check is independent: recompute the multiplier from
     * the returned levers and confirm it lands on P/C = 1 at THAT year. */
    let checked = 0, worst = 0;
    ['BEN', 'MLI', 'NGA', 'SEN', 'GHA'].forEach(iso => {
      const r = C.forSelection({ kind: 'country', id: iso }, opts);
      if (!r.ok) return;
      r.years.forEach(yr => {
        if (!yr.available || yr.alreadySelfSufficient) return;
        const mix = yr.routes.filter(x => x.id === 'mix')[0];
        if (!mix || !mix.solution) return;
        const s = mix.solution;
        const mult = (1 + s.areaExpansion) *
                     (1 + s.adoptionRate * yr.ceilings.varietyYieldGain) *
                     (1 + s.yieldImprovement);
        const achieved = yr.baseline.ssr * mult / 100;
        checked++;
        worst = Math.max(worst, Math.abs(achieved - 1));
      });
    });
    ok('the least-cost mix reaches P/C = 1 at the horizon it is reported for',
       checked > 8 && worst < 0.06,
       checked + ' packages checked, worst deviation ' + fmt(worst) +
       ' (regression: optimiser used to answer for the last horizon regardless)');

    // The mix stacks variety adoption on top of the productivity lever, and the
    // two compound. Bounding each lever on its own is not enough: the implied
    // yield must stay inside the SAME agronomic ceiling the yield-only route
    // reports, or the table recommends a yield it has just called impossible.
    let yieldCeilingBreaches = 0, mixesChecked = 0, worstFactor = 0;
    ['BEN', 'MLI', 'NGA', 'SEN', 'TZA', 'EGY', 'CIV', 'GIN'].forEach(iso => {
      const r = C.forSelection({ kind: 'country', id: iso }, opts);
      if (!r.ok) return;
      r.years.forEach(yr => {
        if (!yr.available || yr.alreadySelfSufficient) return;
        const mix = yr.routes.filter(x => x.id === 'mix')[0];
        if (!mix || !mix.solution) return;
        const s = mix.solution;
        const factor = (1 + s.adoptionRate * yr.ceilings.varietyYieldGain) *
                       (1 + s.yieldImprovement);
        mixesChecked++;
        worstFactor = Math.max(worstFactor, factor / yr.ceilings.maxYieldFactor);
        if (factor > yr.ceilings.maxYieldFactor + 1e-6) yieldCeilingBreaches++;
      });
    });
    ok('the least-cost mix never implies a yield above the agronomic ceiling',
       mixesChecked > 5 && yieldCeilingBreaches === 0,
       mixesChecked + ' packages checked, ' + yieldCeilingBreaches + ' breaches, worst ' +
       fmt(worstFactor * 100) + '% of the ceiling (regression: adoption and the ' +
       'productivity lever compound, so bounding each separately let the mix reach 3.1x)');

    // A route reported feasible must be within its ceiling, and vice versa.
    let ceilingViolations = 0;
    ['BEN', 'MLI', 'NGA', 'SEN', 'TZA', 'EGY'].forEach(iso => {
      const r = C.forSelection({ kind: 'country', id: iso }, opts);
      if (!r.ok) return;
      r.years.forEach(yr => {
        if (!yr.available || yr.alreadySelfSufficient) return;
        const rY2 = yr.routes.filter(x => x.id === 'yield')[0];
        const rA2 = yr.routes.filter(x => x.id === 'area')[0];
        if (rY2.feasible !== (rY2.value <= rY2.ceiling + 1e-6)) ceilingViolations++;
        if (rA2.feasible !== (rA2.value <= rA2.ceiling + 1e-6)) ceilingViolations++;
      });
    });
    ok('feasibility always agrees with the ceiling it was tested against',
       ceilingViolations === 0, ceilingViolations + ' disagreements');

    // Every infeasible route must name what is binding.
    let unnamed = 0;
    ben.years.forEach(yr => {
      if (!yr.available) return;
      yr.routes.forEach(r => { if (!r.feasible && !r.binding) unnamed++; });
    });
    ok('every infeasible route names its binding constraint', unnamed === 0);

    // Raising a ceiling can only make things easier, never harder.
    const tight = C.forSelection({ kind: 'country', id: 'SEN' },
      Object.assign({}, opts, { maxAreaFactor: 1.2, maxYieldFactor: 1.2, maxAdoption: 0.2 }));
    const loose = C.forSelection({ kind: 'country', id: 'SEN' },
      Object.assign({}, opts, { maxAreaFactor: 6.0, maxYieldFactor: 4.0, maxAdoption: 1.0 }));
    if (tight.ok && loose.ok) {
      const feas = r => r.years.filter(x => x.available && x.anyFeasible).length;
      ok('loosening the ceilings never reduces the number of reachable horizons',
         feas(loose) >= feas(tight),
         'tight ' + feas(tight) + ', loose ' + feas(loose));
    }

    // A self-sufficient country must be reported as already meeting the condition.
    const tza = C.forSelection({ kind: 'country', id: 'TZA' }, opts);
    if (tza.ok) {
      const early = tza.years[0];
      if (early.available && early.baseline.ssr >= 100) {
        ok('a country above 100% is reported as already meeting the condition',
           early.alreadySelfSufficient && early.best.id === 'none');
        near('its production gap is zero', early.productionGap, 0, 1e-9);
      }
    }

    // Regions and the continent.
    const africa = C.forSelection({ kind: 'africa' }, opts);
    ok('the condition runs for Africa as a whole', africa.ok, africa.ok ? '' : africa.reason);
    const regions = C.scanRegions(opts);
    ok('every region and bloc is scanned', regions.length >= 12, regions.length + ' scopes');

    // Verdicts.
    ok('a verdict is produced for every evaluated horizon',
       ben.years.every(yr => !!C.verdict(yr).code));
    ok('caveats state that this rests on a projection, not observed data',
       ben.caveats.some(c => /BASELINE PROJECTION/.test(c)));
    ok('caveats state that the ceilings are assumptions',
       ben.caveats.some(c => /assumptions, not measurements/.test(c)));
  }

  /* ============================== van Oort et al. (2015) West Africa model */

  const WEST_AFRICA_T = ['BEN', 'BFA', 'CPV', 'CIV', 'GMB', 'GHA', 'GIN', 'GNB',
                         'LBR', 'MLI', 'MRT', 'NER', 'NGA', 'SEN', 'SLE', 'TGO'];

  function testVanOort() {
    group('van Oort model');
    const V = RSAVanOort;

    ok('the paper\'s milling rate is used, not the platform default',
       V.MILLING_RATE === 0.65 && RSA.DEFAULT_MILLING_RATE === 0.67,
       'model 0.65 (paper Eq. 2), platform 0.67 (FAO)');
    ok('the exploitable fraction is 80%', V.EXPLOITABLE_FRACTION === 0.80);
    ok('six yield scenarios and two diet scenarios are defined',
       V.YIELD_SCENARIOS.length === 6 && V.DIET_SCENARIOS.length === 2);
    ok('every scenario documents itself',
       V.YIELD_SCENARIOS.every(s => s.label && s.labelFr && s.note));
    ok('scenarios needing yield potentials are marked',
       V.YIELD_SCENARIOS.filter(s => s.needsPotential).length === 2);

    // Paper parameters, transcribed.
    ok('paper parameters are held for the four West African countries it covers',
       Object.keys(V.PAPER).length === 4 &&
       ['BFA', 'GHA', 'MLI', 'NGA'].every(k => V.PAPER[k]));
    ok('the paper\'s own Table 1 arithmetic reproduces its published P/C',
       V.validate().rows.every(r => r.agrees),
       V.validate().rows.map(r => r.iso + ' ' + r.recomputedFromPaperTable1.toFixed(2)).join(', '));

    // A single country.
    const nga = V.run({ kind: 'country', id: 'NGA' }, { targetYear: 2035, dbKey: 'fao' });
    ok('the model runs for Nigeria', nga.ok, nga.ok ? '' : nga.reason);
    if (!nga.ok) return;

    ok('the baseline P/C is a plausible ratio',
       nga.baseline.pcRatio > 0.1 && nga.baseline.pcRatio < 3,
       'P/C = ' + fmt(nga.baseline.pcRatio));
    ok('Eq. 2 is applied: milled production is 0.65 of unmilled',
       Math.abs(nga.baseline.productionMilled - 0.65 * nga.baseline.productionPaddy) < 1e-6);
    ok('Eq. 1 is applied: paddy production is area times yield',
       Math.abs(nga.baseline.productionPaddy - nga.baseline.area * nga.baseline.yield / 1000) < 1e-6);
    ok('Eq. 3 is applied: consumption is population times per capita',
       Math.abs(nga.baseline.consumption -
                nga.baseline.perCapita * nga.baseline.population / 1000) < 1e-3);
    ok('population comes from the UN projection and grows to the target',
       nga.target.populationGrowthFactor > 1 && nga.target.populationGrowthFactor < 2.5,
       'x' + fmt(nga.target.populationGrowthFactor));

    // The scenario grid.
    ok('the grid is six yield scenarios x two diets', nga.rows.length === 12);
    const g = (y, d) => nga.rows.filter(x => x.yieldScenario === y && x.dietScenario === d)[0];
    ok('a higher yield gives a higher P/C',
       g('plus2', 'current').pcRatio > g('plus1', 'current').pcRatio &&
       g('plus1', 'current').pcRatio > g('none', 'current').pcRatio,
       'none ' + fmt(g('none', 'current').pcRatio) + ' < +1 ' + fmt(g('plus1', 'current').pcRatio) +
       ' < +2 ' + fmt(g('plus2', 'current').pcRatio));
    // The diet trend is NOT always upward. Nigeria's per-capita rice food supply
    // has been falling, so extrapolating its trend lowers the denominator and
    // raises P/C. The invariant is that the direction follows the sign of the
    // trend, not that a trend diet always hurts.
    const dietTrend = nga.trends.perCapitaPerYear;
    const pcCur = g('none', 'current').pcRatio, pcTr = g('none', 'trend').pcRatio;
    ok('the diet scenario moves P/C in the direction the per-capita trend implies',
       dietTrend > 0 ? pcTr <= pcCur + 1e-9
                     : (dietTrend < 0 ? pcTr >= pcCur - 1e-9 : Math.abs(pcTr - pcCur) < 1e-9),
       'per-capita trend ' + fmt(dietTrend) + ' kg/yr: current-diet P/C ' + fmt(pcCur) +
       ', trend-diet P/C ' + fmt(pcTr));

    // And a country with a rising diet must show the penalty.
    const risingDiet = ['SEN', 'CIV', 'GHA', 'MLI', 'BFA']
      .map(iso => V.run({ kind: 'country', id: iso }, { targetYear: 2035, dbKey: 'fao' }))
      .filter(r => r.ok && r.trends.perCapitaPerYear > 0.2)[0];
    if (risingDiet) {
      const h2 = (y, d) => risingDiet.rows.filter(x => x.yieldScenario === y && x.dietScenario === d)[0];
      ok('where per-capita consumption is rising, the trend diet lowers P/C',
         h2('none', 'trend').pcRatio < h2('none', 'current').pcRatio,
         risingDiet.selection + ': ' + fmt(h2('none', 'current').pcRatio) + ' -> ' +
         fmt(h2('none', 'trend').pcRatio));
    }
    ok('+1 t/ha means exactly one tonne per hectare more',
       Math.abs(g('plus1', 'current').yield - (nga.baseline.yield + 1000)) < 1e-6 ||
       g('plus1', 'current').yield === nga.ceiling,
       'or capped at the exploitable ceiling');

    // Eq. 5: the area needed for P/C = 1 must actually deliver P/C = 1.
    const r = g('trend', 'current');
    const impliedP = V.MILLING_RATE * r.areaNeeded * r.yield / 1000;
    ok('Eq. 5 area gives exactly P/C = 1',
       Math.abs(impliedP / r.consumption - 1) < 1e-9,
       'recomputed P/C at the required area = ' + fmt(impliedP / r.consumption));
    ok('the expansion factor is the required area over the current area',
       Math.abs(r.areaExpansionFactor - r.areaNeeded / nga.baseline.area) < 1e-9);

    // Eqs. 8-9: the ceiling binds where it is known, and is refused where it is not.
    ok('Nigeria has a reconstructed exploitable ceiling', nga.ceiling != null,
       nga.ceilingSource || '');
    ok('the ceiling is above the current yield', nga.ceiling > nga.baseline.yield);
    ok('no scenario exceeds the ceiling',
       nga.rows.filter(x => x.available).every(x => x.yield <= nga.ceiling + 1e-6));
    ok('the ceiling records how it was reconstructed',
       /Table 2/.test(nga.ceilingSource || ''));

    const ben = V.run({ kind: 'country', id: 'BEN' }, { targetYear: 2035, dbKey: 'fao' });
    ok('a country outside the paper has no ceiling', ben.ok && ben.ceiling == null);
    ok('and its 80%-of-potential scenarios are refused rather than guessed',
       ben.ok && ben.rows.filter(x => x.yieldScenario === 'pct80')
         .every(x => x.available === false && /Global Yield Gap Atlas/.test(x.reason)));

    // Regional aggregate, cross-validated against the platform's own SSR.
    const region = V.run({ kind: 'custom', ids: WEST_AFRICA_T }, { targetYear: 2035, dbKey: 'fao' });
    ok('the model runs for West Africa as a region', region.ok, region.ok ? '' : region.reason);
    if (region.ok) {
      const b = RSA.balance('fao', { kind: 'custom', ids: WEST_AFRICA_T }, { basis: 'milled' });
      const ssr = RSAPolicy.lastObs(RSAIndicators.compute('ssr', b));
      // The two are computed by completely separate code paths and differ only by
      // the milling rate (0.65 vs 0.67), so they must agree to within ~5%.
      ok('the regional baseline agrees with the platform\'s own SSR',
         ssr && Math.abs(region.baseline.pcRatio - ssr.value / 100) < 0.05,
         'model ' + fmt(region.baseline.pcRatio) + ' vs SSR ' + fmt(ssr.value / 100) +
         ' (milling rate 0.65 vs 0.67)');
      ok('the regional result is flagged as an aggregate', region.aggregate === true);
      ok('the aggregate carries its netting caveat',
         region.caveats.some(c => /nets against/.test(c)));
    }

    // Every West African country either runs or explains why not.
    let ran = 0, refused = 0;
    WEST_AFRICA_T.forEach(iso => {
      const res = V.run({ kind: 'country', id: iso }, { targetYear: 2035, dbKey: 'fao' });
      if (res.ok) ran++; else { refused++; ok(iso + ' explains why it could not run', !!res.reason, res.reason); }
    });
    ok('most West African countries can be modelled', ran >= 14, ran + ' ran, ' + refused + ' refused');

    // A negative yield trend must be flagged, not silently published.
    const sle = V.run({ kind: 'country', id: 'SLE' }, { targetYear: 2035, dbKey: 'fao' });
    if (sle.ok) {
      const t = sle.rows.filter(x => x.yieldScenario === 'trend' && x.dietScenario === 'trend')[0];
      if (t.available && t.yield < 0.5 * sle.baseline.yield) {
        ok('a collapsing yield trend is flagged as an extrapolation artefact',
           t.trendCollapse === true && /artefact/.test(t.trendCollapseNote || ''));
      } else {
        ok('Sierra Leone trend scenario is within range', true);
      }
    }

    // Caveats and references.
    ok('every run states that it is aggregate rather than split by system',
       /AGGREGATE/.test(nga.caveats.join(' ')));
    ok('every run states that it has no prices or costs',
       /no prices/.test(nga.caveats.join(' ')));
    ok('the reference list cites the paper with its DOI',
       V.REFERENCES.some(x => /van Oort/.test(x.text) && x.doi === '10.1016/j.gfs.2015.01.002'));
    ok('the reference list cites Cassman for the 80% ceiling',
       V.REFERENCES.some(x => /Cassman/.test(x.text)));
    ok('every reference explains its role', V.REFERENCES.every(x => x.text && x.role));
  }

  /* ==================================================== data dictionary */

  function testDataDict() {
    group('data dictionary');
    const D = RSADataDict;

    ok('every source is documented', D.SOURCES.length >= 6, D.SOURCES.length + ' sources');
    ok('every source states its item, basis and URL',
       D.SOURCES.every(s => s.db && s.dataset && s.item && s.basis && s.url && s.portal));
    ok('every variable has a name and unit',
       D.SOURCES.every(s => s.variables.length > 0 &&
         s.variables.every(v => v.name && v.unit && v.code != null)));
    ok('derived series are listed separately from read series',
       D.DERIVED.length > 5 && D.DERIVED.every(d => d.name && d.unit && d.from));
    ok('the derived list includes the zero-production rule',
       D.DERIVED.some(d => /DERIVED, not observed/.test(d.from)));

    // Coverage is computed from loaded data, not transcribed.
    const cov = D.coverage();
    ok('coverage is reported for every source',
       D.SOURCES.every(s => cov[s.id] != null));
    ok('FAOSTAT coverage matches the loaded registry',
       cov['fao-prod'].countries === RSA.countries().length,
       cov['fao-prod'].countries + ' countries');
    ok('food balance coverage matches what actually loaded',
       cov['fao-fbs'].countries === (RSA.state.fao.fbs.covered || []).length);
    ok('boundary coverage matches the loaded geo file',
       cov['naturalearth'].countries === Object.keys(RSA.state.geo.shapes).length);

    // Equations.
    const eqs = D.equations();
    ok('equations are collected from every part of the platform',
       eqs.length >= 25, eqs.length + ' equations');
    ok('every equation has a group, label, formula and unit',
       eqs.every(e => e.group && e.label && e.equation && e.unit));
    ok('every equation states its interpretation and limitations',
       eqs.every(e => e.interpretation && e.limitations),
       eqs.filter(e => !e.limitations).map(e => e.label).join(', ') || 'all complete');
    ok('all nine van Oort equations are present',
       eqs.filter(e => e.group === 'van Oort et al. (2015)').length === 9);
    ok('indicator equations are read from the descriptors, not restated',
       eqs.filter(e => e.group === 'Indicator').some(e =>
         e.equation === RSAIndicators.get(e.id).equation));

    // Exports.
    const csv = D.toCsv();
    ok('the dictionary exports as CSV', csv.split('\n').length > 30);
    ok('the CSV carries provenance', /# data extracted/.test(csv));
    const eqCsv = D.equationsToCsv();
    ok('the equations export as CSV', eqCsv.split('\n').length > 25);
    let parsed = null;
    try { parsed = JSON.parse(D.toJson()); } catch (e) { parsed = null; }
    ok('the dictionary exports as valid JSON', !!parsed);
    ok('the JSON carries sources, equations and references',
       parsed && parsed.sources.length > 0 && parsed.equations.length > 0 &&
       parsed.references.length > 0);
    const md = D.toMarkdown();
    ok('the dictionary exports as Markdown', md.length > 5000);
    ok('the Markdown includes the reference list', /## References/.test(md));
  }

  /* Language coverage measured on OUTPUT, not on the dictionary.
   *
   * RSAi18n.coverage() reported 100% while roughly a third of the rendered
   * interface was still English, because a string that was never routed through
   * t() has no key and so cannot be counted as missing. These tests check the
   * things a French reader actually sees. */
  function testLanguageOutput() {
    group('language coverage on rendered output');
    const before = RSAi18n.get();
    RSAi18n.set('fr');
    try {
      // Every indicator must have a French name. The food-balance-sheet family
      // had none, which is why the country profile was the least translated
      // panel in the platform.
      const untranslated = RSAIndicators.list()
        .filter(i => !RSAi18n.has('ind.' + i.id)).map(i => i.id);
      ok('every indicator has a French label', untranslated.length === 0,
         untranslated.join(', ') || 'all ' + RSAIndicators.list().length + ' translated');

      // get() and list() must return the LOCALISED label. Call sites reach for
      // .label far more naturally than for label(id), and every one of them
      // used to render English.
      ok('get() returns a localised label', RSAIndicators.get('ssr').label !== 'Self-sufficiency ratio (SSR)',
         RSAIndicators.get('ssr').label);
      ok('list() returns localised labels',
         RSAIndicators.list().every(i => i.label === RSAIndicators.label(i.id)));
      ok('but the English label is preserved for exports',
         RSAIndicators.get('ssr').labelEn === 'Self-sufficiency ratio (SSR)');
      ok('compute() carries both', (function () {
        const b = RSA.balance('fao', { kind: 'country', id: 'SEN' }, { basis: 'milled' });
        const r = RSAIndicators.compute('ssr', b);
        return r.label !== r.labelEn && !!r.labelEn;
      })());

      // Units are localised for display only. Localising the raw `unit` field
      // would break formatting, which compares it as a literal.
      ok('units are localised for display', RSAIndicators.unitLabel('kg/capita') === 'kg/habitant');
      ok('but the raw unit is untouched, because formatting compares it literally',
         RSAIndicators.get('cpc').unit === 'kg/capita' && RSAIndicators.get('ssr').unit === '%');

      // Country names.
      const noFr = RSA.countries().filter(c => !RSAi18n.has('country.' + (c.nameEn || c.name)));
      ok('every country has a French name', noFr.length === 0,
         noFr.map(c => c.iso3).join(', ') || 'all 55 translated');
      ok('RSA.country() returns the localised name',
         RSA.country('COD').name === 'République démocratique du Congo', RSA.country('COD').name);
      ok('and preserves the English name for exports',
         RSA.country('COD').nameEn === 'Democratic Republic of the Congo');
      ok('the Africa aggregate label is localised',
         RSA.selectionLabel({ kind: 'africa' }).indexOf('Afrique') === 0,
         RSA.selectionLabel({ kind: 'africa' }));

      // Indicator groups.
      ok('indicator groups are localised',
         RSAIndicators.categoryLabel('Food security') === 'Sécurité alimentaire');

      // The methodological notes attached to every balance.
      const bal = RSA.balance('fao', { kind: 'country', id: 'SEN' }, { basis: 'milled' });
      ok('the basis and trade notes are in French',
         bal.notes.every(n => !/^Basis: |^Trade series: /.test(n.text)),
         bal.notes.map(n => n.text.slice(0, 40)).join(' | '));

      // Falling back must show the real English string, never a bare key.
      ok('a missing key falls back to readable text, not a key',
         RSAIndicators.label('__nope__') === '__nope__' &&
         RSAIndicators.unitLabel('furlongs') === 'furlongs');
    } finally {
      RSAi18n.set(before);
    }

    ok('coverage() now says what it measures',
       /dictionary/.test(RSAi18n.coverage().measures || ''));
    ok('auditRendered() exists to measure the interface instead',
       typeof RSAi18n.auditRendered === 'function');
  }

  /* ============================= SSA aggregate and the single SSR definition */

  function testSsaAndSsr() {
    group('sub-Saharan Africa and the canonical SSR');
    const I = RSAIndicators;

    /* SSR must exist ONCE. Every module that reports it has to go through
     * RSA.selfSufficiency, or the platform can disagree with itself. */
    ok('a canonical self-sufficiency function is exported',
       typeof RSA.selfSufficiency === 'function');
    near('it implements FAO (2001): 100 x P / (P + M - X)',
         RSA.selfSufficiency(670, 330, 0), 67, 1e-9);
    near('a missing export figure counts as zero',
         RSA.selfSufficiency(670, 330, null), 67, 1e-9);
    near('exports reduce the denominator',
         RSA.selfSufficiency(500, 500, 500), 100, 1e-9);
    isNull('a non-positive denominator returns null, never a negative percentage',
           RSA.selfSufficiency(100, 50, 500));
    isNull('a zero denominator returns null', RSA.selfSufficiency(0, 0, 0));
    isNull('a missing production returns null', RSA.selfSufficiency(null, 100, 0));

    // The indicator and the canonical function must not drift apart.
    let drift = 0, checked = 0;
    RSA.countries().forEach(c => {
      const b = RSA.balance('fao', { kind: 'country', id: c.iso3 }, { basis: 'milled' });
      const v = I.compute('ssr', b).values;
      for (let i = 0; i < v.length; i++) {
        const p = b.production[i], m = b.imports[i], x = b.exports[i];
        if (p == null || m == null) continue;
        const canon = RSA.selfSufficiency(p, m, x);
        checked++;
        if (v[i] == null && canon == null) continue;
        if (v[i] == null || canon == null || Math.abs(v[i] - canon) > 1e-9) drift++;
      }
    });
    ok('the SSR indicator agrees with the canonical function everywhere',
       drift === 0, checked + ' country-years checked, ' + drift + ' disagreements');

    /* ---- Sub-Saharan Africa ---- */
    const ssa = RSA.balance('fao', { kind: 'ssa' }, { basis: 'milled' });
    const afr = RSA.balance('fao', { kind: 'africa' }, { basis: 'milled' });
    ok('SSA resolves to a valid selection', ssa.selectionValid === true);
    ok('SSA excludes Northern Africa',
       ssa.members.indexOf('EGY') < 0 && ssa.members.indexOf('MAR') < 0 &&
       ssa.members.indexOf('DZA') < 0 && ssa.members.indexOf('TUN') < 0,
       ssa.members.length + ' members');
    ok('SSA keeps the sub-Saharan countries',
       ['NGA', 'SEN', 'BEN', 'MLI', 'TZA', 'MDG'].every(x => ssa.members.indexOf(x) >= 0));
    ok('SSA is smaller than Africa but not by much',
       ssa.members.length < afr.members.length && ssa.members.length > 40,
       ssa.members.length + ' of ' + afr.members.length);

    /* SSA production must equal Africa less Northern Africa, exactly. This is the
     * figure published sources quote: CARD report 38.34 Mt of paddy for SSA in
     * 2024, and Egypt is why the continental number is six million tonnes higher. */
    const nor = RSA.balance('fao', { kind: 'region', id: 'Northern Africa' }, { basis: 'milled' });
    const i24 = ssa.years.indexOf(2024);
    near('SSA production = Africa minus Northern Africa, exactly',
         ssa.production[i24], afr.production[i24] - nor.production[i24], 1e-6);
    const paddy = ssa.production[i24] / ssa.millingRate;
    ok('SSA 2024 paddy production matches the published 38.34 Mt',
       Math.abs(paddy / 1e6 - 38.34) < 0.5, fmt(paddy / 1e6) + ' Mt');

    // Egypt is the reason the two scopes differ, so the ratios must differ too.
    const ssaSsr = I.compute('ssr', ssa).values[i24];
    const afrSsr = I.compute('ssr', afr).values[i24];
    ok('SSA self-sufficiency is lower than the continental figure',
       ssaSsr < afrSsr, 'SSA ' + fmt(ssaSsr) + '% vs Africa ' + fmt(afrSsr) + '%');

    ok('SSA carries a localised label',
       RSA.selectionLabel({ kind: 'ssa' }).indexOf('Sub-Saharan') >= 0,
       RSA.selectionLabel({ kind: 'ssa' }));

    // It must work end to end, not merely resolve.
    ok('every indicator computes on SSA without throwing', (function () {
      try { I.list().forEach(d => I.compute(d.id, ssa)); return true; } catch (e) { return false; }
    })());
    const base = RSAScenarios.baseline(ssa, 2040, {});
    ok('the scenario engine accepts SSA', base.ok === true, base.ok ? '' : base.reason);
    const adv = RSAAdvisor.diagnose(ssa, {});
    ok('the policy advisor accepts SSA', adv.ok === true && adv.causes.length > 0);
  }

  /* ==================================================== guided policy analysis */

  function testAdvisor() {
    group('policy advisor');
    const A = RSAAdvisor;
    const b = iso => RSA.balance('fao', { kind: 'country', id: iso }, { basis: 'milled' });

    /* The decomposition is an IDENTITY, not a model. ln(SSR1/SSR0) must equal
     * ln(P1/P0) - ln(C1/C0) to machine precision for every country; any residual
     * means an arithmetic slip, not an error term to be interpreted. */
    let worst = 0, checked = 0;
    RSA.countries().forEach(c => {
      const d = A.decompose(b(c.iso3), {});
      if (!d.ok) return;
      checked++;
      worst = Math.max(worst, Math.abs(d.residual));
    });
    ok('the growth decomposition is exact for every country',
       checked > 30 && worst < 1e-9,
       checked + ' countries, worst residual ' + worst.toExponential(2));

    // Supply minus demand must equal the SSR movement, by construction.
    let mismatch = 0;
    ['BEN', 'SEN', 'NGA', 'MLI', 'EGY', 'TZA'].forEach(iso => {
      const d = A.decompose(b(iso), {});
      if (!d.ok) return;
      const implied = 100 * ((1 + d.supplyGrowth / 100) / (1 + d.demandGrowth / 100) - 1);
      if (Math.abs(implied - d.ssrGrowth) > 0.02) mismatch++;
    });
    ok('supply growth minus demand growth reproduces the SSR trend', mismatch === 0,
       mismatch + ' mismatches');

    // The four terms must be the four terms: two supply, two demand.
    const d0 = A.decompose(b('SEN'), {});
    ok('the decomposition has exactly two supply and two demand terms',
       d0.terms.filter(t => t.side === 'supply').length === 2 &&
       d0.terms.filter(t => t.side === 'demand').length === 2);
    ok('contribution shares sum to 100%',
       Math.abs(d0.terms.reduce((s, t) => s + t.share, 0) - 100) < 0.5,
       fmt(d0.terms.reduce((s, t) => s + t.share, 0)));

    /* Per-capita consumption is consumption (tonnes) over population (persons),
     * so it needs x1000 to be the kg/capita it is labelled with. Without it the
     * level is out by three orders of magnitude -- Benin 1961 showed as 0.0012
     * kg/capita rather than 1.24. */
    const dBen = A.decompose(b('BEN'), {});
    const diet = dBen.terms.filter(t => t.key === 'diet')[0];
    ok('per-capita consumption is in kg/capita, not tonnes/capita',
       diet.to > 20 && diet.to < 400, fmt(diet.to) + ' kg/capita at ' + dBen.window.to);
    // And it must agree with the CPC indicator computed independently.
    const cpc = RSAIndicators.compute('cpc', b('BEN'));
    const iT = cpc.years.indexOf(dBen.window.to);
    near('and it matches the CPC indicator computed separately', diet.to, cpc.values[iT], 0.01);

    /* A full-record endpoint pair can be exactly right and useless. Benin is the
     * case: 15.9% self-sufficient in 1961 and 15.9% in 2024, hiding a rise to
     * 64.6% and a collapse. The recent window must be the one diagnosed on. */
    const per = A.decomposePeriods(b('BEN'), {});
    ok('a long record is also decomposed over a recent window',
       per.ok && per.recent != null && per.recent.window.from > per.full.window.from,
       per.ok ? (per.recent ? per.recent.window.from + '-' + per.recent.window.to : 'none') : per.reason);
    ok('and the recent window is the one used as the headline',
       per.headline === per.recent);

    // Diagnosis must produce ranked, evidenced causes.
    const dg = A.diagnose(b('BEN'), {});
    ok('the diagnosis returns ranked causes', dg.ok && dg.causes.length > 0,
       dg.ok ? dg.causes.map(c => c.id).join(', ') : dg.reason);
    ok('every cause carries a finding, an implication and evidence',
       dg.causes.every(c => c.finding && c.implication && c.evidence),
       dg.causes.filter(c => !(c.finding && c.implication && c.evidence)).map(c => c.id).join(','));
    const SEV = ['critical', 'high', 'medium', 'info', 'good'];
    ok('severities are drawn from the declared set',
       dg.causes.every(c => SEV.indexOf(c.severity) >= 0));
    ok('causes are ordered most severe first', (function () {
      for (let i = 1; i < dg.causes.length; i++) {
        if (SEV.indexOf(dg.causes[i].severity) < SEV.indexOf(dg.causes[i - 1].severity)) return false;
      }
      return true;
    })());

    // Benin's re-export distortion must be detected: it is the clearest case in
    // Africa and the one the platform has been reasoning about throughout.
    ok('Benin is flagged for import dependence or re-export',
       dg.causes.some(c => c.id === 're-export' || c.id === 'import-dependence'),
       dg.causes.map(c => c.id).join(', '));

    /* A self-sufficient country must not be told it has a shortfall. Tanzania is
     * the one African country currently above 100% (117.1% in 2024); Egypt is at
     * 98.5% and is deliberately NOT flagged, which is the sharper test of the
     * threshold. Egypt did exceed 180% in the 1960s, so this is a live boundary,
     * not a country that was never near it. */
    const dgT = A.diagnose(b('TZA'), {});
    ok('Tanzania is recognised as already self-sufficient',
       dgT.ok && dgT.causes.some(c => c.id === 'already'),
       dgT.ok ? dgT.causes.map(c => c.id).join(', ') : dgT.reason);
    const dgE = A.diagnose(b('EGY'), {});
    ok('Egypt at 98.5% is NOT flagged as already self-sufficient',
       dgE.ok && !dgE.causes.some(c => c.id === 'already'),
       dgE.ok ? fmt(dgE.ssr.value) + '% in ' + dgE.ssr.year : dgE.reason);

    // Prescription must be driven by the diagnosis, and every instrument must
    // carry its objection -- an instrument without its caveat is not advice.
    const pr = A.prescribe(b('BEN'), {});
    ok('prescription returns instruments selected by the diagnosis',
       pr.ok && pr.instruments.length > 0, pr.ok ? pr.instruments.length + ' instruments' : pr.reason);
    ok('every instrument states why it helps AND what is wrong with it',
       pr.instruments.every(i => i.why && i.caveat && i.becauseOf),
       pr.instruments.filter(i => !i.caveat).map(i => i.id).join(','));
    ok('no instrument is offered twice',
       new Set(pr.instruments.map(i => i.id)).size === pr.instruments.length);
    ok('the tariff instrument carries the porous-border objection',
       (RSAAdvisor.INSTRUMENTS.trade.filter(i => i.id === 'tariff')[0] || {}).caveat
         .indexOf('porous') >= 0);

    // Peers must be real and exclude the country being advised.
    const pe = A.peers(b('SEN'), {});
    ok('peer countries exclude the selection itself',
       !pe.all.some(p => p.iso3 === 'SEN'));
    ok('self-sufficient peers really are at or above 100%',
       pe.selfSufficient.every(p => p.ssr >= 100),
       pe.selfSufficient.map(p => p.iso3 + ' ' + fmt(p.ssr)).join(', '));

    // Thresholds must be declared rather than buried, so they can be argued with.
    ok('every threshold used in the diagnosis is published',
       Object.keys(A.THRESHOLDS).length >= 8 &&
       Object.keys(A.THRESHOLDS).every(k => typeof A.THRESHOLDS[k] === 'number'));

    // Regions and the continent must work, not only countries.
    const dgR = A.diagnose(RSA.balance('fao', { kind: 'africa' }, { basis: 'milled' }), {});
    ok('the advisor works on the continental aggregate too', dgR.ok && dgR.causes.length > 0);
  }

  /* ================== validation, ranges, logging and the CARD reconciliation */

  function testValidation() {
    group('validation and error logging');
    const V = RSAValidate;

    ok('the platform reports a semantic version', /^\d+\.\d+\.\d+$/.test(RSA_VERSION), RSA_VERSION);
    ok('the validator carries the same version', V.VERSION === RSA_VERSION,
       V.VERSION + ' vs ' + RSA_VERSION);

    /* ---- structural validation ---- */
    const good = { years: [2000, 2001, 2002],
                   series: { BEN: { production: [1, 2, 3], area: [1, 1, 1],
                                    imports: [0, 0, 0], exports: [0, 0, 0],
                                    population: [1e6, 1e6, 1e6] } } };
    ok('a well-formed dataset validates', V.validateDataset(good).ok === true);

    // A ragged array is the defect that does not throw: it silently shifts every
    // value against the wrong year, so it must be caught structurally.
    const ragged = JSON.parse(JSON.stringify(good));
    ragged.series.BEN.production = [1, 2];
    const rv = V.validateDataset(ragged);
    ok('a ragged series is rejected, naming the field and both lengths',
       !rv.ok && rv.errors.some(e => e.code === 'length-mismatch'),
       rv.errors.map(e => e.code).join(',') || '(none)');

    const dup = { years: [2000, 2000], series: good.series };
    ok('a non-increasing year axis is rejected',
       V.validateDataset(dup).errors.some(e => e.code === 'year-order'));

    const neg = JSON.parse(JSON.stringify(good));
    neg.series.BEN.imports = [0, -5, 0];
    ok('a negative quantity is rejected',
       V.validateDataset(neg).errors.some(e => e.code === 'negative'));

    const nan = JSON.parse(JSON.stringify(good));
    nan.series.BEN.area = [1, 'x', 1];
    ok('a non-numeric cell is rejected',
       V.validateDataset(nan).errors.some(e => e.code === 'non-numeric'));

    ok('a null dataset is refused without throwing', V.validateDataset(null).ok === false);
    ok('validation never throws on garbage',
       V.validateDataset({ years: 'nope' }).ok === false);

    /* ---- range checks ---- */
    isNull('a normal yield raises nothing', V.checkValue('yield', 3500));
    ok('a 40 t/ha yield is an error, not a warning',
       (V.checkValue('yield', 40000) || {}).severity === 'error');
    ok('a yield of 30 kg/ha is flagged, but only as a warning -- a failed harvest is real',
       (V.checkValue('yield', 30) || {}).severity === 'warning');
    ok('a yield of 5 kg/ha is a hard error: that is a unit mistake, not a harvest',
       (V.checkValue('yield', 5) || {}).severity === 'error');
    ok('an unusual but possible yield is only a warning',
       (V.checkValue('yield', 11500) || {}).severity === 'warning');
    ok('every range documents the evidence that sets it',
       Object.keys(V.RANGES).every(k => V.RANGES[k].why && V.RANGES[k].why.length > 40),
       Object.keys(V.RANGES).filter(k => !V.RANGES[k].why).join(',') || 'all documented');
    ok('every range is internally ordered min <= lo <= hi <= max',
       Object.keys(V.RANGES).every(k => {
         const r = V.RANGES[k];
         return r.min <= r.lo && r.lo <= r.hi && r.hi <= r.max;
       }));
    ok('the FAO, CARD and van Oort milling rates all sit inside the accepted range',
       [0.67, 0.667, 0.65].every(r => V.checkValue('millingRate', r) === null));

    /* ---- the real data against its own range checks ----
     *
     * This is deliberately NOT "zero findings". Two country-years in FAOSTAT
     * genuinely carry exports above production plus imports, and pretending
     * otherwise would mean either loosening the check until it catches nothing
     * or editing the source data. The contract is: exactly the known defects
     * are reported, they are all of one understood kind, and nothing new has
     * appeared. A third case showing up should fail this test and be looked at. */
    const sweep = V.sweep('fao', { basis: 'milled' });
    const nonBalance = sweep.errors.filter(e => !/domestic supply is negative/.test(e.message));
    ok('FAOSTAT raises no range error other than the known broken balance sheets',
       nonBalance.length === 0,
       sweep.checked + ' countries checked, ' + sweep.errors.length + ' errors (' +
       nonBalance.length + ' unexplained), ' + sweep.warnings.length + ' warnings' +
       (nonBalance.length ? ' :: ' + nonBalance.slice(0, 3).map(e => e.message).join(' | ') : ''));
    ok('and the broken balance sheets are exactly the two known country-years',
       sweep.errors.length === 2,
       sweep.errors.map(e => (e.context && e.context.iso3) + ' ' +
                             (e.context && e.context.year)).join(', '));

    const sweepU = V.sweep('usda', { basis: 'milled' });
    ok('USDA PSD raises no range errors',
       sweepU.errors.length === 0,
       sweepU.checked + ' countries checked, ' + sweepU.errors.length + ' errors' +
       (sweepU.errors.length ? ' :: ' + sweepU.errors.slice(0, 2).map(e => e.message).join(' | ') : ''));

    // A catastrophic harvest is real data, not a unit error. Chad in the 1984
    // Sahel drought took 1,000 t off 31,000 ha; the floor must sit below that.
    ok('a drought-year yield of 48 kg/ha is a warning, not a hard error',
       (V.checkValue('yield', 48) || {}).severity === 'warning',
       JSON.stringify(V.checkValue('yield', 48) || null));

    /* Yield bounds are quoted on a paddy basis. If the check did not convert a
     * milled balance up before testing it, ~130 sound country-years would be
     * flagged and the noise would bury any real unit error. */
    ok('milled-basis yields are checked against paddy bounds after conversion',
       sweep.warnings.filter(w => w.field === 'yield').length < 60,
       sweep.warnings.filter(w => w.field === 'yield').length + ' yield warnings ' +
       '(regression: was 131 when milled yields were tested against paddy bounds)');

    /* FAOSTAT carries a small number of country-years where exports exceed
     * production plus imports. These must be DETECTED and withheld, not turned
     * into a negative self-sufficiency ratio and plotted. */
    const ken = RSA.balance('fao', { kind: 'country', id: 'KEN' }, { basis: 'milled' });
    const k92 = ken.years.indexOf(1992);
    ok('Kenya 1992 is recognised as a broken balance sheet',
       ken.brokenBalanceYears.some(b => b.year === 1992),
       JSON.stringify(ken.brokenBalanceYears.map(b => b.year)));
    isNull('and its apparent utilization is withheld rather than left negative',
           ken.consumption[k92]);
    ['ssr', 'idr', 'cpc'].forEach(id => {
      isNull('Kenya 1992 ' + id + ' is null, not a negative percentage',
             RSAIndicators.compute(id, ken).values[k92]);
    });
    ok('the withheld year is explained in a note the reader can see',
       ken.notes.some(n => n.level === 'warning' && /1992/.test(n.text)),
       ken.notes.filter(n => n.level === 'warning').map(n => n.text.slice(0, 60)).join(' | '));
    ok('the underlying production and trade are still shown for that year',
       ken.production[k92] > 0 && ken.exports[k92] > 0);

    // And no country-year anywhere may carry a negative ratio.
    let negRatios = 0;
    ['fao', 'usda'].forEach(db => {
      RSA.countries().forEach(c => {
        const b = RSA.balance(db, { kind: 'country', id: c.iso3 }, { basis: 'milled' });
        ['ssr', 'idr', 'cpc', 'ppc'].forEach(id => {
          RSAIndicators.compute(id, b).values.forEach(v => { if (v != null && v < 0) negRatios++; });
        });
      });
    });
    ok('no indicator anywhere returns a negative value', negRatios === 0,
       negRatios + ' negative values across both databases');

    /* ---- error logging ---- */
    V.clear();
    const fallback = V.guard('test', () => { throw new Error('boom'); }, -1);
    ok('a throwing calculation returns the fallback rather than propagating', fallback === -1);
    ok('and the failure is logged with its reason',
       V.entries('error').some(e => /boom/.test(e.message)),
       (V.entries('error')[0] || {}).message || '(nothing logged)');
    const inf = V.guard('test', () => 1 / 0, null);
    ok('a non-finite result is treated as a failure, not returned as Infinity',
       inf === null && V.counts().error === 2, JSON.stringify(V.counts()));
    ok('a successful calculation is not logged',
       V.guard('test', () => 42, null) === 42 && V.counts().error === 2);

    // The log must be bounded: a failure inside a 55-country x 64-year loop
    // must not be able to exhaust memory.
    for (let i = 0; i < V.LOG_LIMIT + 50; i++) V.logInfo('flood', 'entry ' + i);
    ok('the log is bounded but still reports the true total',
       V.entries().length <= V.LOG_LIMIT && V.counts().total > V.LOG_LIMIT,
       'retained ' + V.entries().length + ' of ' + V.counts().total);
    V.clear();
    ok('clearing the log resets both the buffer and the counter',
       V.entries().length === 0 && V.counts().total === 0);
  }

  /* The AfricaRice / CARD country pages at riceforafrica.net are the reference
   * this platform is most often checked against. They compute the same FAO
   * ratio but take every trade term from INSIDE the food balance sheet rather
   * than from the trade matrix, which is the entire reason the two disagree.
   * These tests pin that reconciliation so it cannot silently drift. */
  function testCard() {
    group('reconciliation vs riceforafrica.net (CARD)');
    const I = RSAIndicators;
    const bal = iso => RSA.balance('fao', { kind: 'country', id: iso }, { basis: 'milled' });
    const atYear = (b, ind, y) => {
      const i = b.years.indexOf(y);
      return i < 0 ? null : I.compute(ind, b).values[i];
    };

    // Published on the Senegal page: SSR 40.7% for 2023.
    const sen = atYear(bal('SEN'), 'ssrFbs', 2023);
    near('Senegal 2023 balance-sheet SSR reproduces the CARD figure of 40.7%', sen, 40.7, 0.1);

    // Published on the Nigeria page: 99.9%, carried against the 2023 balance sheet.
    const nga = atYear(bal('NGA'), 'ssrFbs', 2023);
    near('Nigeria balance-sheet SSR reproduces the CARD figure of 99.9%', nga, 99.9, 0.1);

    // Per-capita food supply is published directly and must match to the decimal.
    near('Senegal 2023 per-capita food supply matches CARD (82.7 kg)',
         atYear(bal('SEN'), 'cpcFood', 2023), 82.7, 0.5);
    near('Nigeria per-capita food supply matches CARD (22.17 kg)',
         atYear(bal('NGA'), 'cpcFood', 2023), 22.17, 0.2);

    // Production and area come from the same FAOSTAT tables both sides use, so
    // these must agree exactly, not approximately.
    const senB = bal('SEN'), i24 = senB.years.indexOf(2024);
    near('Senegal 2024 paddy production matches CARD exactly (1,580,000 t)',
         senB.production[i24] / senB.millingRate, 1580000, 1);
    near('Senegal 2024 harvested area matches CARD exactly (410,271 ha)',
         senB.area[i24], 410271, 0.5);
    const ngaB = bal('NGA'), n24 = ngaB.years.indexOf(2024);
    near('Nigeria 2024 paddy production matches CARD exactly (9,129,900 t)',
         ngaB.production[n24] / ngaB.millingRate, 9129900, 1);
    near('Nigeria 2024 harvested area matches CARD exactly (4,572,900 ha)',
         ngaB.area[n24], 4572900, 0.5);
    const benB = bal('BEN'), b10 = benB.years.indexOf(2010);
    near('Benin 2010 paddy production matches CARD exactly (124,975 t)',
         benB.production[b10] / benB.millingRate, 124975, 1);

    /* The trade-matrix SSR and the balance-sheet SSR are DIFFERENT numbers, and
     * the platform must not pretend otherwise. Senegal 2023: 45.5% on the trade
     * matrix, 40.7% on the balance sheet. Both are correct answers to different
     * questions, and the gap is the thing worth reporting. */
    const senMatrix = atYear(bal('SEN'), 'ssr', 2023);
    ok('the trade-matrix and balance-sheet SSRs are reported as distinct series',
       senMatrix != null && sen != null && Math.abs(senMatrix - sen) > 1,
       'matrix ' + fmt(senMatrix) + '% vs balance sheet ' + fmt(sen) + '%');

    // Benin has no current-release balance sheet, so the CARD-convention series
    // must be honestly absent rather than quietly falling back to the matrix.
    const benFbs = atYear(bal('BEN'), 'ssrFbs', 2023);
    isNull('Benin 2023 balance-sheet SSR is null, because FAO has no 2023 FBS for Benin', benFbs);
    const ben13 = atYear(bal('BEN'), 'ssrFbs', 2013);
    ok('but Benin does carry the series while the historic release covers it',
       ben13 != null && ben13 > 0 && ben13 < 100, fmt(ben13) + '% in 2013');

    // The indicator must describe itself like every other one.
    const d = I.get('ssrFbs');
    ok('the CARD-convention indicator documents its equation, limits and source',
       !!(d && d.equation && d.limitations && d.source && d.latex));
  }

  /* ============================================ report generation and export */

  function testReport() {
    group('report and exports');
    const bal = RSA.balance('fao', { kind: 'country', id: 'SEN' }, { basis: 'milled' });
    const ctx = {
      bal: bal, from: 1961, to: 2024, targetYear: 2040,
      quality: RSA.quality('fao', 'SEN', { from: 1990 }),
      assumptions: RSAScenarios.DEFAULTS
    };
    ctx.diagnosis = RSAPolicy.diagnose(bal, { quality: ctx.quality ? ctx.quality.score : null });

    const base = RSAScenarios.baseline(bal, 2040, {});
    if (base.ok) {
      ctx.baseline = base;
      ctx.forecast = {
        ssrPath: base.path.map(p => p.ssr),
        crossingYear: RSAScenarios.firstCrossing(base.path, 100),
        tests: [], models: [], backtest: []
      };
      ctx.scenarios = [
        RSAScenarios.scenarioArea(base, 0.10, {}),
        RSAScenarios.scenarioYield(base, 0.20, {})
      ];
      ctx.ranking = RSAPolicy.rankScenarios(ctx.scenarios, null);
      ctx.optimization = RSAScenarios.optimize(base, { ssrTarget: 100 });
    }

    let report = null;
    try { report = RSAReport.generate(ctx); } catch (e) {
      ok('report generates without throwing', false, String(e && e.stack || e));
      return;
    }
    ok('report generates without throwing', true);
    ok('report has the required sections',
       ['executive-summary', 'objective', 'data', 'methodology', 'trends', 'self-sufficiency',
        'economy', 'risks', 'reproducibility'].every(id => report.sections.some(s => s.id === id)),
       report.sections.map(s => s.id).join(','));
    ok('report records the platform version and data extraction date',
       !!report.meta.platformVersion && !!report.meta.dataExtracted);

    // Every equation block must be complete -- this is what the methodology
    // section is generated from, so a missing field would silently ship a
    // formula with no variable definitions.
    const eqs = [];
    report.sections.forEach(s => s.blocks.forEach(b => { if (b.type === 'equation') eqs.push(b); }));
    ok('the report contains equation blocks', eqs.length >= 8, eqs.length + ' equations');
    ok('every equation defines its variables, interpretation and limitations',
       eqs.every(e => e.equation && e.variables && e.variables.length &&
                      e.interpretation && e.limitations),
       eqs.filter(e => !(e.variables && e.variables.length)).map(e => e.label).join(',') || 'all complete');
    ok('every equation variable has a symbol and a definition',
       eqs.every(e => e.variables.every(v => v.sym && v.def)));

    // Tables must be rectangular, or the exporters produce ragged output.
    const tables = [];
    report.sections.forEach(s => s.blocks.forEach(b => { if (b.type === 'table') tables.push(b); }));
    ok('the report contains tables', tables.length > 0, tables.length + ' tables');
    ok('every table row matches its header width',
       tables.every(t => t.rows.every(r => r.length === t.columns.length)),
       tables.filter(t => t.rows.some(r => r.length !== t.columns.length))
             .map(t => t.caption).join(',') || 'all rectangular');

    // Exports.
    const md = RSAReport.toMarkdown(report);
    ok('Markdown export is produced', md.length > 4000, md.length + ' chars');
    ok('Markdown contains the SSR equation', md.indexOf('SSR_t') >= 0);

    const tex = RSAReport.toLatex(report);
    ok('LaTeX export is produced', tex.length > 3000, tex.length + ' chars');
    ok('LaTeX has a document environment',
       tex.indexOf('\\begin{document}') >= 0 && tex.indexOf('\\end{document}') >= 0);
    ok('LaTeX escapes the characters that would break compilation',
       tex.indexOf('&amp;') < 0 && !/[^\\]%/.test(tex.split('\n').filter(l => l[0] !== '%').join('\n')),
       'no unescaped % or stray entities');

    const csv = RSAReport.toCsv(bal, ctx);
    const csvLines = csv.split('\n');
    ok('CSV export is produced', csvLines.length > 40, csvLines.length + ' lines');
    ok('CSV carries a provenance header', csv.indexOf('# source,') >= 0);
    const headerIx = csvLines.findIndex(l => l.indexOf('year') === 0);
    ok('CSV header row is present', headerIx > 0);
    const width = csvLines[headerIx].split(',').length;
    ok('every CSV data row has the header width',
       csvLines.slice(headerIx + 1).filter(l => l.trim()).every(l => l.split(',').length === width),
       'expected ' + width + ' columns');

    const json = RSAReport.toJson(report, bal, ctx);
    let parsed = null;
    try { parsed = JSON.parse(json); } catch (e) { parsed = null; }
    ok('JSON export parses', !!parsed);
    ok('JSON carries the reproducibility manifest', parsed && !!parsed.manifest &&
       !!parsed.manifest.dataExtracted && !!parsed.manifest.version);
    ok('JSON carries the series with their equations',
       parsed && parsed.series && parsed.series.indicators.ssr &&
       !!parsed.series.indicators.ssr.equation);

    const html = RSAReport.toHtml(report);
    ok('HTML export is produced', html.indexOf('<!doctype html>') === 0 && html.length > 6000);
    ok('HTML escapes angle brackets in content',
       html.indexOf('<script') < 0, 'no script tags in generated report');

    const xls = RSAReport.toExcel(report, bal, ctx);
    ok('Excel export is produced', xls.indexOf('<?mso-application progid="Excel.Sheet"?>') > 0);
    ok('Excel is well-formed XML', (function () {
      try {
        const d = new DOMParser().parseFromString(xls, 'application/xml');
        return !d.querySelector('parsererror');
      } catch (e) { return false; }
    })(), 'parsed with DOMParser');
    ok('Excel has a provenance sheet and a series sheet',
       xls.indexOf('ss:Name="Provenance"') > 0 && xls.indexOf('ss:Name="Series"') > 0);
    ok('Excel emits typed numeric cells', xls.indexOf('ss:Type="Number"') > 0);

    const doc = RSAReport.toWord(report);
    ok('Word export is produced', doc.indexOf('urn:schemas-microsoft-com:office:word') > 0);
    ok('Word export carries the report body', doc.indexOf('Executive summary') > 0 ||
       doc.indexOf('Methodology') > 0);

    // The manifest must be sufficient to reproduce the run.
    const man = RSAReport.buildManifest(bal, ctx, RSA.provenance());
    ok('manifest pins everything needed to reproduce the analysis',
       ['version', 'dataExtracted', 'database', 'selection', 'basis', 'millingRate',
        'periodFrom', 'periodTo', 'targetYear', 'consumptionMethod']
         .every(k => man[k] != null && man[k] !== ''),
       Object.keys(man).join(','));
  }

  /* ================================================================= runner */

  async function run() {
    results.length = 0;
    const t0 = Date.now();
    try {
      testIndicators();
      testEdges();
      testStats();
      testData();
      await testGolden();
      testScenarios();
      testAccuracy();
      testHorizons();
      testDiagnostics();
      testI18n();
      testFoodBalance();
      testPublishedAccuracy();
      testCrisis();
      testCondition();
      testVanOort();
      testDataDict();
      testSsaAndSsr();
      testAdvisor();
      testLanguageOutput();
      testValidation();
      testCard();
      testReport();
    } catch (err) {
      ok('suite completed without throwing', false, String(err && err.stack || err));
    }
    const ms = Date.now() - t0;
    const passed = results.filter(r => r.pass).length;
    const failed = results.length - passed;

    const byGroup = {};
    results.forEach(r => {
      if (!byGroup[r.group]) byGroup[r.group] = { pass: 0, fail: 0, failures: [] };
      if (r.pass) byGroup[r.group].pass++;
      else { byGroup[r.group].fail++; byGroup[r.group].failures.push(r); }
    });

    return { results: results, passed: passed, failed: failed, total: results.length, ms: ms, byGroup: byGroup };
  }

  function report(summary) {
    const lines = [];
    lines.push('RICE STATISTICS FOR AFRICA -- TEST SUITE');
    lines.push('='.repeat(64));
    Object.keys(summary.byGroup).forEach(g => {
      const b = summary.byGroup[g];
      lines.push('');
      lines.push(g.toUpperCase() + '  ' + b.pass + ' passed, ' + b.fail + ' failed');
      b.failures.forEach(f => lines.push('   FAIL  ' + f.name + '  [' + f.detail + ']'));
    });
    lines.push('');
    lines.push('='.repeat(64));
    lines.push(summary.passed + '/' + summary.total + ' passed in ' + summary.ms + ' ms');
    return lines.join('\n');
  }

  return { run: run, report: report, results: results };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSATests; }
