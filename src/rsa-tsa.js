/* Rice Statistics for Africa -- time-series analysis and forecasting.
 *
 * A self-contained Box-Jenkins implementation: unit-root testing, correlogram
 * identification, ARIMA estimation, residual diagnostics, information criteria,
 * and forecasts with prediction intervals. No external library -- this runs in
 * the browser alongside everything else.
 *
 * Methodological choices worth stating, because they are the ones a reviewer
 * would ask about:
 *
 *  * The data are ANNUAL. There is no seasonal cycle to model, so no seasonal
 *    ARIMA is ever fitted. Section 8 of the platform brief asks for SARIMA "where
 *    appropriate"; with one observation per year it never is, and fitting one
 *    would manufacture structure that cannot exist in the data.
 *
 *  * Estimation is conditional sum of squares (CSS), initialised by the
 *    Hannan-Rissanen two-step procedure and refined by Nelder-Mead. CSS is not
 *    exact maximum likelihood: for the short series here (typically 60 annual
 *    observations) the difference in point forecasts is small, but the likelihood
 *    -- and therefore AIC/BIC/HQIC -- is a conditional one. It is comparable
 *    across models fitted to the same differenced series, which is what model
 *    selection needs, and NOT comparable across different differencing orders.
 *    The platform never compares information criteria across different d.
 *
 *  * Prediction intervals are the standard Gaussian psi-weight intervals. They
 *    capture uncertainty from the innovations ONLY. They do not include parameter
 *    uncertainty, model-selection uncertainty, or the possibility that the
 *    process changes. Real coverage over a 25-year horizon is therefore worse --
 *    often much worse -- than the nominal 80% or 95%, and the platform says so
 *    every time it draws one.
 */

const RSATsa = (function () {
  'use strict';

  /* ====================================================== basic statistics */

  function mean(v) {
    let s = 0, n = 0;
    for (let i = 0; i < v.length; i++) if (v[i] != null) { s += v[i]; n++; }
    return n ? s / n : null;
  }

  function variance(v) {
    const m = mean(v);
    if (m == null) return null;
    let s = 0, n = 0;
    for (let i = 0; i < v.length; i++) if (v[i] != null) { s += (v[i] - m) * (v[i] - m); n++; }
    return n > 1 ? s / (n - 1) : null;
  }

  /* Sample autocorrelation, the standard biased (divide by n) estimator, which
   * is what Box-Jenkins identification and the Ljung-Box statistic both assume. */
  function acf(v, maxLag) {
    const n = v.length;
    const m = mean(v);
    maxLag = Math.min(maxLag || Math.floor(10 * Math.log10(n)), n - 1);
    let c0 = 0;
    for (let i = 0; i < n; i++) c0 += (v[i] - m) * (v[i] - m);
    c0 /= n;
    const out = [1];
    for (let k = 1; k <= maxLag; k++) {
      let c = 0;
      for (let i = k; i < n; i++) c += (v[i] - m) * (v[i - k] - m);
      c /= n;
      out.push(c0 === 0 ? 0 : c / c0);
    }
    return out;
  }

  /* Partial autocorrelation by the Durbin-Levinson recursion. */
  function pacf(v, maxLag) {
    const r = acf(v, maxLag);
    const K = r.length - 1;
    const phi = [];
    const out = [1];
    let prev = [];
    for (let k = 1; k <= K; k++) {
      let num = r[k], den = 1;
      for (let j = 1; j < k; j++) {
        num -= prev[j - 1] * r[k - j];
        den -= prev[j - 1] * r[j];
      }
      const pk = den === 0 ? 0 : num / den;
      const cur = new Array(k);
      cur[k - 1] = pk;
      for (let j = 1; j < k; j++) cur[j - 1] = prev[j - 1] - pk * prev[k - j - 1];
      prev = cur;
      out.push(pk);
    }
    return out;
  }

  /* Correlogram confidence band. Bartlett's formula would widen the band with
   * lag; the +/- 1.96/sqrt(n) band drawn here is the white-noise band, which is
   * the one used for identification and the one EViews plots. */
  function acfBand(n, level) {
    const z = level === 0.99 ? 2.5758 : 1.96;
    return z / Math.sqrt(n);
  }

  function diff(v, d) {
    let out = v.slice();
    for (let k = 0; k < (d || 0); k++) {
      const nx = [];
      for (let i = 1; i < out.length; i++) nx.push(out[i] - out[i - 1]);
      out = nx;
    }
    return out;
  }

  /* ========================================================== linear algebra */

  /* OLS by normal equations with partial pivoting. X includes its own intercept
   * column if one is wanted. Returns coefficients, residuals, and the standard
   * errors needed for the unit-root t-statistics. */
  function ols(X, y) {
    const n = X.length, k = X[0].length;
    const XtX = [], Xty = new Array(k).fill(0);
    for (let a = 0; a < k; a++) {
      XtX.push(new Array(k).fill(0));
      for (let b = 0; b < k; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += X[i][a] * X[i][b];
        XtX[a][b] = s;
      }
      let s2 = 0;
      for (let i = 0; i < n; i++) s2 += X[i][a] * y[i];
      Xty[a] = s2;
    }
    const inv = invert(XtX);
    if (!inv) return null;
    const beta = new Array(k).fill(0);
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) beta[a] += inv[a][b] * Xty[b];

    const resid = new Array(n);
    let sse = 0;
    for (let i = 0; i < n; i++) {
      let f = 0;
      for (let a = 0; a < k; a++) f += X[i][a] * beta[a];
      resid[i] = y[i] - f;
      sse += resid[i] * resid[i];
    }
    const dof = n - k;
    const s2 = dof > 0 ? sse / dof : NaN;
    const se = new Array(k);
    for (let a = 0; a < k; a++) se[a] = Math.sqrt(Math.max(0, s2 * inv[a][a]));
    return { beta: beta, se: se, resid: resid, sse: sse, sigma2: s2, n: n, k: k, inv: inv };
  }

  function invert(A) {
    const n = A.length;
    const M = A.map((r, i) => r.concat(identityRow(n, i)));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      const p = M[col][col];
      for (let c = 0; c < 2 * n; c++) M[col][c] /= p;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col];
        if (f === 0) continue;
        for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map(r => r.slice(n));
  }

  function identityRow(n, i) {
    const r = new Array(n).fill(0); r[i] = 1; return r;
  }

  /* ======================================================= unit-root testing */

  /* MacKinnon (1991, 2010) response-surface critical values:
   *     crit(T) = b0 + b1/T + b2/T^2
   * for the three deterministic specifications. */
  const ADF_CRIT = {
    nc: { '1': [-2.5658, -1.960, -10.04], '5': [-1.9393, -0.398, 0.0],   '10': [-1.6156, -0.181, 0.0] },
    c:  { '1': [-3.4336, -5.999, -29.25], '5': [-2.8621, -2.738, -8.36], '10': [-2.5671, -1.438, -4.48] },
    ct: { '1': [-3.9638, -8.353, -47.44], '5': [-3.4126, -4.039, -17.83],'10': [-3.1279, -2.418, -7.58] }
  };

  function adfCritical(spec, T) {
    const tab = ADF_CRIT[spec];
    const out = {};
    ['1', '5', '10'].forEach(l => {
      const b = tab[l];
      out[l] = b[0] + b[1] / T + b[2] / (T * T);
    });
    return out;
  }

  /* Augmented Dickey-Fuller.
   *   dy_t = alpha + beta*t + gamma*y_{t-1} + sum_i delta_i dy_{t-i} + e_t
   * H0: gamma = 0, i.e. a unit root. Lag length chosen by minimum AIC up to
   * Schwert's upper bound unless the caller pins it. */
  function adf(y, opts) {
    opts = opts || {};
    const spec = opts.spec || 'c';                 // 'nc' | 'c' | 'ct'
    const n = y.length;
    const maxLag = opts.lags != null ? opts.lags
      : Math.min(Math.floor(Math.pow(n - 1, 1 / 3)) + 2, Math.floor(12 * Math.pow(n / 100, 0.25)));

    let best = null;
    const lo = opts.lags != null ? maxLag : 0;
    for (let p = lo; p <= maxLag; p++) {
      const fit = adfFit(y, p, spec);
      if (!fit) continue;
      if (!best || fit.aic < best.aic) best = fit;
    }
    if (!best) return null;

    const crit = adfCritical(spec, best.effN);
    return {
      test: 'Augmented Dickey-Fuller',
      spec: spec,
      specLabel: spec === 'ct' ? 'constant and trend' : (spec === 'c' ? 'constant' : 'none'),
      lags: best.lags,
      statistic: best.tstat,
      critical: crit,
      effN: best.effN,
      rejects5: best.tstat < crit['5'],
      h0: 'the series has a unit root (is non-stationary)',
      conclusion: best.tstat < crit['5']
        ? 'reject H0 at 5%: no unit root, the series is stationary in this form'
        : 'fail to reject H0 at 5%: a unit root cannot be ruled out',
      note: 'Lag length ' + best.lags + ' chosen by minimum AIC. Critical values are MacKinnon ' +
            '(1991) finite-sample response surfaces for T = ' + best.effN + '.'
    };
  }

  function adfFit(y, p, spec) {
    const n = y.length;
    const dy = [];
    for (let i = 1; i < n; i++) dy.push(y[i] - y[i - 1]);
    const start = p;                                 // first usable index into dy
    const rows = [], target = [];
    for (let i = start; i < dy.length; i++) {
      const row = [];
      if (spec === 'c' || spec === 'ct') row.push(1);
      if (spec === 'ct') row.push(i + 1);
      row.push(y[i]);                                // y_{t-1} aligned with dy[i]
      for (let j = 1; j <= p; j++) row.push(dy[i - j]);
      rows.push(row);
      target.push(dy[i]);
    }
    if (rows.length < rows[0].length + 3) return null;
    const fit = ols(rows, target);
    if (!fit) return null;
    const gammaIx = (spec === 'ct') ? 2 : (spec === 'c' ? 1 : 0);
    const t = fit.beta[gammaIx] / fit.se[gammaIx];
    const N = rows.length;
    const aic = N * Math.log(fit.sse / N) + 2 * fit.k;
    return { tstat: t, lags: p, aic: aic, effN: N, fit: fit };
  }

  /* Phillips-Perron -- the test actually used by Gassi et al. (2025).
   * Same regression as DF with no augmentation; the serial correlation is handled
   * by a Newey-West correction to the test statistic rather than by added lags.
   * Reported here is the Z-tau form, which shares the ADF critical values. */
  function pp(y, opts) {
    opts = opts || {};
    const spec = opts.spec || 'c';
    const n = y.length;
    const dy = [];
    for (let i = 1; i < n; i++) dy.push(y[i] - y[i - 1]);

    const rows = [], target = [];
    for (let i = 0; i < dy.length; i++) {
      const row = [];
      if (spec === 'c' || spec === 'ct') row.push(1);
      if (spec === 'ct') row.push(i + 1);
      row.push(y[i]);
      rows.push(row); target.push(dy[i]);
    }
    if (rows.length < 6) return null;
    const fit = ols(rows, target);
    if (!fit) return null;
    const gammaIx = (spec === 'ct') ? 2 : (spec === 'c' ? 1 : 0);
    const tstat = fit.beta[gammaIx] / fit.se[gammaIx];

    const N = rows.length;
    const u = fit.resid;
    // Newey-West long-run variance with the Newey-West (1994) automatic bandwidth
    // that EViews uses by default.
    const q = opts.bandwidth != null ? opts.bandwidth : Math.floor(4 * Math.pow(N / 100, 2 / 9));
    let gamma0 = 0;
    for (let i = 0; i < N; i++) gamma0 += u[i] * u[i];
    gamma0 /= N;
    let lambda2 = gamma0;
    for (let j = 1; j <= q; j++) {
      let g = 0;
      for (let i = j; i < N; i++) g += u[i] * u[i - j];
      g /= N;
      lambda2 += 2 * (1 - j / (q + 1)) * g;
    }
    // Z_tau = sqrt(gamma0/lambda2) * t - (lambda2 - gamma0) * (N * se_gamma) / (2 * lambda2 * s)
    const s = Math.sqrt(fit.sse / (N - fit.k));
    const seGamma = fit.se[gammaIx];
    const ztau = Math.sqrt(gamma0 / lambda2) * tstat
               - (lambda2 - gamma0) * (N * seGamma) / (2 * lambda2 * s);

    const crit = adfCritical(spec, N);
    return {
      test: 'Phillips-Perron (Z-tau)',
      spec: spec,
      specLabel: spec === 'ct' ? 'constant and trend' : (spec === 'c' ? 'constant' : 'none'),
      statistic: ztau,
      rawT: tstat,
      bandwidth: q,
      critical: crit,
      effN: N,
      rejects5: ztau < crit['5'],
      h0: 'the series has a unit root (is non-stationary)',
      conclusion: ztau < crit['5']
        ? 'reject H0 at 5%: no unit root, the series is stationary in this form'
        : 'fail to reject H0 at 5%: a unit root cannot be ruled out',
      note: 'Newey-West bandwidth ' + q + ' (Bartlett kernel). Critical values are the MacKinnon ' +
            '(1991) Dickey-Fuller surfaces, which Z-tau shares asymptotically.'
    };
  }

  /* KPSS, which reverses the hypotheses: H0 is stationarity. Running it beside a
   * unit-root test is the standard guard against reading "failed to reject" as
   * "confirmed". */
  const KPSS_CRIT = {
    c:  { '10': 0.347, '5': 0.463, '2.5': 0.574, '1': 0.739 },
    ct: { '10': 0.119, '5': 0.146, '2.5': 0.176, '1': 0.216 }
  };

  function kpss(y, opts) {
    opts = opts || {};
    const spec = opts.spec === 'ct' ? 'ct' : 'c';
    const n = y.length;
    const rows = [], target = [];
    for (let i = 0; i < n; i++) {
      const row = [1];
      if (spec === 'ct') row.push(i + 1);
      rows.push(row); target.push(y[i]);
    }
    const fit = ols(rows, target);
    if (!fit) return null;
    const e = fit.resid;
    let S = 0, sumS2 = 0;
    for (let i = 0; i < n; i++) { S += e[i]; sumS2 += S * S; }
    const q = opts.bandwidth != null ? opts.bandwidth : Math.floor(4 * Math.pow(n / 100, 0.25));
    let s2 = 0;
    for (let i = 0; i < n; i++) s2 += e[i] * e[i];
    s2 /= n;
    for (let j = 1; j <= q; j++) {
      let g = 0;
      for (let i = j; i < n; i++) g += e[i] * e[i - j];
      g /= n;
      s2 += 2 * (1 - j / (q + 1)) * g;
    }
    const stat = sumS2 / (n * n * s2);
    const crit = KPSS_CRIT[spec];
    return {
      test: 'KPSS',
      spec: spec,
      specLabel: spec === 'ct' ? 'trend stationarity' : 'level stationarity',
      statistic: stat,
      critical: crit,
      bandwidth: q,
      rejects5: stat > crit['5'],
      h0: 'the series is stationary',
      conclusion: stat > crit['5']
        ? 'reject H0 at 5%: evidence against stationarity'
        : 'fail to reject H0 at 5%: consistent with stationarity',
      note: 'Critical values from Kwiatkowski et al. (1992), Table 1.'
    };
  }

  /* Determines how many differences the data support, by testing successively.
   * Capped at 2: a third difference of an annual economic series is almost always
   * over-differencing rather than a finding. */
  function selectD(y, maxD) {
    maxD = maxD == null ? 2 : maxD;
    const trace = [];
    let cur = y.slice();
    for (let d = 0; d <= maxD; d++) {
      const p = pp(cur, { spec: d === 0 ? 'ct' : 'c' });
      const k = kpss(cur, { spec: d === 0 ? 'ct' : 'c' });
      trace.push({ d: d, pp: p, kpss: k, n: cur.length });
      const ppStat = p && p.rejects5;
      const kpssOk = k && !k.rejects5;
      if (ppStat && kpssOk) return { d: d, trace: trace, reason: 'PP rejects a unit root and KPSS does not reject stationarity' };
      if (ppStat && !kpssOk) return { d: d, trace: trace, reason: 'PP rejects a unit root; KPSS disagrees, so the evidence is mixed and the lower d is taken' };
      if (d === maxD) return { d: d, trace: trace, reason: 'reached the maximum differencing order of ' + maxD };
      cur = diff(cur, 1);
    }
    return { d: maxD, trace: trace, reason: 'fallback' };
  }

  /* ======================================================= ARIMA estimation */

  /* Conditional sum of squares for an ARMA(p,q) with optional mean, evaluated on
   * an already-differenced series. Pre-sample innovations are set to zero, which
   * is the "conditional" in CSS. */
  function cssResiduals(w, phi, theta, mu) {
    const n = w.length, p = phi.length, q = theta.length;
    const e = new Array(n).fill(0);
    for (let t = 0; t < n; t++) {
      let f = mu;
      for (let i = 0; i < p; i++) f += phi[i] * ((t - i - 1 >= 0) ? (w[t - i - 1] - mu) : 0);
      for (let j = 0; j < q; j++) f += theta[j] * ((t - j - 1 >= 0) ? e[t - j - 1] : 0);
      e[t] = w[t] - f;
    }
    return e;
  }

  function cssObjective(w, p, q, includeMean) {
    return function (par) {
      const phi = par.slice(0, p);
      const theta = par.slice(p, p + q);
      const mu = includeMean ? par[p + q] : 0;
      if (!isStationary(phi) || !isInvertible(theta)) return 1e18;
      const e = cssResiduals(w, phi, theta, mu);
      let s = 0;
      // Burn in the first max(p,q) residuals, which are contaminated by the zero
      // pre-sample assumption.
      const burn = Math.max(p, q);
      for (let t = burn; t < e.length; t++) s += e[t] * e[t];
      if (!isFinite(s)) return 1e18;
      return s;
    };
  }

  /* Stationarity and invertibility are decided by the actual roots, not by a
   * proxy. An earlier version scanned the polynomial around the unit circle
   * looking for near-zeros, which quietly accepted explosive models: a scan can
   * only detect roots that sit almost exactly ON the circle, and says nothing
   * about roots well inside it.
   *
   * What is computed here are the INVERSE roots -- the roots of the companion
   * polynomial
   *      z^p - phi_1 z^(p-1) - ... - phi_p = 0
   * for the AR side and
   *      z^q + theta_1 z^(q-1) + ... + theta_q = 0
   * for the MA side. The process is stationary when every AR inverse root lies
   * strictly inside the unit circle, and invertible when every MA inverse root
   * does. This is exactly the condition Gassi et al. (2025) check by plotting
   * inverse roots against the unit circle, and it is what EViews reports.
   *
   * Roots come from Durand-Kerner, which converges reliably for the small
   * degrees used here (p, q <= 5) and needs no matrix machinery.
   */

  function cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
  function cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
  function cMul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
  function cDiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    if (d === 0) return { re: 0, im: 0 };
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }
  function cAbs(a) { return Math.sqrt(a.re * a.re + a.im * a.im); }

  /* Roots of a monic polynomial given in DESCENDING order, coef[0] === 1. */
  function polyRoots(coef) {
    const n = coef.length - 1;
    if (n < 1) return [];
    // Strip trailing zero coefficients: a zero constant term means a root at the
    // origin, which is inside the unit circle and harmless.
    let deg = n;
    while (deg > 0 && Math.abs(coef[deg]) < 1e-14) deg--;
    if (deg < 1) return [];
    const c = coef.slice(0, deg + 1);

    // Durand-Kerner from the standard spiral start.
    let z = [];
    for (let i = 0; i < deg; i++) {
      const ang = 2 * Math.PI * i / deg + 0.4;
      z.push({ re: 0.4 * Math.cos(ang) + 0.9 * Math.cos(ang), im: 0.4 * Math.sin(ang) + 0.9 * Math.sin(ang) });
    }
    const evalAt = w => {
      let acc = { re: c[0], im: 0 };
      for (let k = 1; k <= deg; k++) acc = cAdd(cMul(acc, w), { re: c[k], im: 0 });
      return acc;
    };
    for (let iter = 0; iter < 500; iter++) {
      let maxStep = 0;
      for (let i = 0; i < deg; i++) {
        let denom = { re: 1, im: 0 };
        for (let j = 0; j < deg; j++) {
          if (i === j) continue;
          denom = cMul(denom, cSub(z[i], z[j]));
        }
        const step = cDiv(evalAt(z[i]), denom);
        z[i] = cSub(z[i], step);
        maxStep = Math.max(maxStep, cAbs(step));
      }
      if (maxStep < 1e-12) break;
    }
    return z;
  }

  /* Largest inverse-root modulus. < 1 means the condition holds. */
  function maxInverseRoot(coefDescending) {
    const roots = polyRoots(coefDescending);
    let m = 0;
    roots.forEach(r => { m = Math.max(m, cAbs(r)); });
    return m;
  }

  // Tolerance rather than a hard 1: a root at 0.9999 is numerically a unit root
  // and produces forecasts that wander without bound.
  const ROOT_TOL = 0.9999;

  function arInverseRoots(phi) {
    if (!phi.length) return [];
    return polyRoots([1].concat(phi.map(v => -v)));
  }
  function maInverseRoots(theta) {
    if (!theta.length) return [];
    return polyRoots([1].concat(theta.slice()));
  }

  function isStationary(phi) {
    if (!phi.length) return true;
    for (let i = 0; i < phi.length; i++) if (!isFinite(phi[i])) return false;
    return maxInverseRoot([1].concat(phi.map(v => -v))) < ROOT_TOL;
  }
  function isInvertible(theta) {
    if (!theta.length) return true;
    for (let i = 0; i < theta.length; i++) if (!isFinite(theta[i])) return false;
    return maxInverseRoot([1].concat(theta.slice())) < ROOT_TOL;
  }

  /* Hannan-Rissanen: fit a long AR to get residual proxies, then regress on
   * lagged values and lagged residuals to initialise phi and theta. */
  function hannanRissanen(w, p, q) {
    const n = w.length;
    const m = Math.min(Math.max(2 * (p + q) + 4, 8), Math.floor(n / 3));
    const rowsA = [], tgtA = [];
    for (let t = m; t < n; t++) {
      const r = [1];
      for (let i = 1; i <= m; i++) r.push(w[t - i]);
      rowsA.push(r); tgtA.push(w[t]);
    }
    if (!rowsA.length) return null;
    const fa = ols(rowsA, tgtA);
    if (!fa) return null;
    const eps = new Array(n).fill(0);
    for (let t = m; t < n; t++) eps[t] = fa.resid[t - m];

    const start = Math.max(p, q) + m;
    const rows = [], tgt = [];
    for (let t = start; t < n; t++) {
      const r = [1];
      for (let i = 1; i <= p; i++) r.push(w[t - i]);
      for (let j = 1; j <= q; j++) r.push(eps[t - j]);
      rows.push(r); tgt.push(w[t]);
    }
    if (rows.length < rows[0].length + 2) return null;
    const f = ols(rows, tgt);
    if (!f) return null;
    return {
      phi: f.beta.slice(1, 1 + p),
      theta: f.beta.slice(1 + p, 1 + p + q),
      mu: mean(w)
    };
  }

  /* Nelder-Mead. Derivative-free, robust on the small ragged objective surfaces
   * that CSS produces, and short enough to read. */
  function nelderMead(f, x0, opts) {
    opts = opts || {};
    const n = x0.length;
    if (n === 0) return { x: [], fx: f([]) };
    const maxIter = opts.maxIter || 400 * n;
    const tol = opts.tol || 1e-8;
    const step = opts.step || 0.1;

    let simplex = [x0.slice()];
    for (let i = 0; i < n; i++) {
      const x = x0.slice();
      x[i] += (Math.abs(x[i]) > 1e-8 ? Math.abs(x[i]) * step : step);
      simplex.push(x);
    }
    let fv = simplex.map(f);

    for (let iter = 0; iter < maxIter; iter++) {
      const order = fv.map((v, i) => i).sort((a, b) => fv[a] - fv[b]);
      simplex = order.map(i => simplex[i]);
      fv = order.map(i => fv[i]);

      if (Math.abs(fv[n] - fv[0]) <= tol * (Math.abs(fv[0]) + tol)) break;

      const centroid = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

      const reflect = centroid.map((c, j) => c + 1.0 * (c - simplex[n][j]));
      const fr = f(reflect);
      if (fr < fv[0]) {
        const expand = centroid.map((c, j) => c + 2.0 * (c - simplex[n][j]));
        const fe = f(expand);
        if (fe < fr) { simplex[n] = expand; fv[n] = fe; }
        else { simplex[n] = reflect; fv[n] = fr; }
      } else if (fr < fv[n - 1]) {
        simplex[n] = reflect; fv[n] = fr;
      } else {
        const contract = centroid.map((c, j) => c + 0.5 * (simplex[n][j] - c));
        const fc = f(contract);
        if (fc < fv[n]) { simplex[n] = contract; fv[n] = fc; }
        else {
          for (let i = 1; i <= n; i++) {
            simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
            fv[i] = f(simplex[i]);
          }
        }
      }
    }
    const best = fv.indexOf(Math.min.apply(null, fv));
    return { x: simplex[best], fx: fv[best] };
  }

  /* Fits ARIMA(p,d,q) to the level series y. */
  function arima(y, p, d, q, opts) {
    opts = opts || {};
    const w = diff(y, d);
    const n = w.length;
    // A constant in a differenced model is a DRIFT term: it makes the level series
    // trend linearly. Included only when explicitly requested, because for a
    // 25-year extrapolation a drift term dominates everything else.
    const includeMean = (d === 0) ? (opts.includeMean !== false) : !!opts.drift;
    if (n < (p + q) * 2 + 6) return null;

    const init = hannanRissanen(w, p, q) || { phi: new Array(p).fill(0.1), theta: new Array(q).fill(0.1), mu: mean(w) };
    let par = init.phi.concat(init.theta);
    if (includeMean) par = par.concat([init.mu != null ? init.mu : 0]);
    // Damp wild Hannan-Rissanen starts back into the admissible region.
    for (let i = 0; i < p + q; i++) if (!isFinite(par[i]) || Math.abs(par[i]) > 0.95) par[i] = 0.1;

    const obj = cssObjective(w, p, q, includeMean);
    const res = nelderMead(obj, par, { tol: 1e-10 });
    const phi = res.x.slice(0, p);
    const theta = res.x.slice(p, p + q);
    const mu = includeMean ? res.x[p + q] : 0;

    const e = cssResiduals(w, phi, theta, mu);
    const burn = Math.max(p, q);
    const eff = e.slice(burn);
    const N = eff.length;
    if (N < 5) return null;
    let sse = 0;
    for (let i = 0; i < N; i++) sse += eff[i] * eff[i];
    const sigma2 = sse / N;
    const k = p + q + (includeMean ? 1 : 0);

    // Conditional Gaussian log-likelihood.
    const logL = -0.5 * N * (Math.log(2 * Math.PI) + Math.log(sigma2) + 1);
    const aic = -2 * logL + 2 * (k + 1);
    const bic = -2 * logL + Math.log(N) * (k + 1);
    const hqic = -2 * logL + 2 * Math.log(Math.log(N)) * (k + 1);

    // In-sample accuracy on the LEVEL series, which is what a user cares about.
    const fitted = reconstruct(y, d, w, e, burn);
    const acc = accuracy(y.slice(y.length - fitted.length), fitted);

    return {
      order: { p: p, d: d, q: q },
      label: 'ARIMA(' + p + ',' + d + ',' + q + ')' + (includeMean && d > 0 ? ' with drift' : ''),
      phi: phi, theta: theta, mean: mu, includeMean: includeMean,
      sigma2: sigma2, sse: sse, logLik: logL,
      aic: aic, bic: bic, hqic: hqic,
      nPar: k, nObs: N,
      residuals: eff,
      allResiduals: e,
      diffSeries: w,
      fitted: fitted,
      accuracy: acc,
      stationary: isStationary(phi),
      invertible: isInvertible(theta),
      // Inverse roots, so the UI can show what Gassi et al. plot in their Fig. 4.
      arInverseRoots: arInverseRoots(phi),
      maInverseRoots: maInverseRoots(theta),
      maxArRoot: phi.length ? maxInverseRoot([1].concat(phi.map(v => -v))) : 0,
      maxMaRoot: theta.length ? maxInverseRoot([1].concat(theta.slice())) : 0,
      converged: isFinite(res.fx) && res.fx < 1e17,
      y: y.slice()
    };
  }

  /* Rebuilds one-step-ahead fitted values on the level scale from the residuals
   * of the differenced model, undoing the differencing with the observed history
   * -- which is exactly what a genuine one-step-ahead forecast has available.
   * d is capped at 2 by selectD, so the three cases below are exhaustive. */
  function reconstruct(y, d, w, e, burn) {
    const out = [];
    for (let t = burn; t < w.length; t++) {
      const wHat = w[t] - e[t];
      const idx = t + d;                 // index into y aligned with w[t]
      let level;
      if (d === 0) level = wHat;
      else if (d === 1) level = wHat + y[idx - 1];
      else level = wHat + 2 * y[idx - 1] - y[idx - 2];
      out.push(level);
    }
    return out;
  }

  function accuracy(actual, fitted) {
    let se = 0, ae = 0, ape = 0, n = 0, nPct = 0;
    for (let i = 0; i < fitted.length; i++) {
      const a = actual[i], f = fitted[i];
      if (a == null || f == null || !isFinite(f)) continue;
      const err = a - f;
      se += err * err; ae += Math.abs(err); n++;
      if (a !== 0) { ape += Math.abs(err / a); nPct++; }
    }
    return {
      rmse: n ? Math.sqrt(se / n) : null,
      mae: n ? ae / n : null,
      // MAPE is reported but is scale-sensitive and blows up near zero; the
      // platform hides it when any actual is near zero.
      mape: nPct ? 100 * ape / nPct : null,
      n: n
    };
  }

  /* ==================================================== residual diagnostics */

  /* Ljung-Box Q. Degrees of freedom are reduced by the number of estimated ARMA
   * parameters, which is what makes the test valid on residuals rather than on
   * raw data. */
  function ljungBox(resid, lags, fitdf) {
    const n = resid.length;
    lags = lags || Math.min(20, Math.floor(n / 5));
    const r = acf(resid, lags);
    let Q = 0;
    const rows = [];
    for (let k = 1; k <= lags; k++) {
      Q += (r[k] * r[k]) / (n - k);
      const stat = n * (n + 2) * Q;
      const df = Math.max(1, k - (fitdf || 0));
      rows.push({ lag: k, acf: r[k], Q: stat, df: df, p: k <= (fitdf || 0) ? null : 1 - chi2cdf(stat, df) });
    }
    const last = rows[rows.length - 1];
    return {
      test: 'Ljung-Box Q',
      lags: lags,
      fitdf: fitdf || 0,
      statistic: last.Q,
      df: last.df,
      pValue: last.p,
      rows: rows,
      whiteNoise: last.p == null ? null : last.p > 0.05,
      h0: 'the residuals are not autocorrelated up to lag ' + lags,
      conclusion: last.p == null ? 'insufficient degrees of freedom to test'
        : (last.p > 0.05
          ? 'fail to reject H0 at 5%: residuals are consistent with white noise'
          : 'reject H0 at 5%: residual autocorrelation remains, the model is inadequate')
    };
  }

  /* Jarque-Bera, because the prediction intervals are Gaussian and it is honest
   * to check the assumption they rest on. */
  function jarqueBera(x) {
    const n = x.length, m = mean(x);
    let m2 = 0, m3 = 0, m4 = 0;
    for (let i = 0; i < n; i++) {
      const d = x[i] - m;
      m2 += d * d; m3 += d * d * d; m4 += d * d * d * d;
    }
    m2 /= n; m3 /= n; m4 /= n;
    const S = m3 / Math.pow(m2, 1.5);
    const K = m4 / (m2 * m2);
    const jb = n / 6 * (S * S + Math.pow(K - 3, 2) / 4);
    return {
      test: 'Jarque-Bera',
      skewness: S, kurtosis: K, statistic: jb, df: 2,
      pValue: 1 - chi2cdf(jb, 2),
      normal: (1 - chi2cdf(jb, 2)) > 0.05,
      h0: 'the residuals are normally distributed'
    };
  }

  /* ------ distribution helpers (series expansions, adequate at our precision) */

  function gammaln(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
               -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function lowerGamma(s, x) {
    if (x < 0) return 0;
    if (x < s + 1) {
      let sum = 1 / s, term = sum;
      for (let k = 1; k < 300; k++) {
        term *= x / (s + k);
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
      }
      return sum * Math.exp(-x + s * Math.log(x) - gammaln(s));
    }
    // continued fraction for the upper incomplete gamma, then complement
    let b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 300; i++) {
      const an = -i * (i - s);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    const Q = Math.exp(-x + s * Math.log(x) - gammaln(s)) * h;
    return 1 - Q;
  }

  function chi2cdf(x, k) {
    if (x <= 0) return 0;
    return lowerGamma(k / 2, x / 2);
  }

  /* Regularized incomplete beta, by the standard continued fraction. Needed for
   * the F distribution, which is what a Chow test for a structural break reports
   * against. */
  function betacf(a, b, x) {
    const tiny = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
  }

  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) +
                        a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  /* P(F <= x) for F(d1, d2). */
  function fcdf(x, d1, d2) {
    if (x <= 0) return 0;
    return betai(d1 / 2, d2 / 2, d1 * x / (d1 * x + d2));
  }

  function normalQuantile(p) {
    // Acklam's rational approximation; accurate to ~1e-9, ample for interval bounds.
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
                1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
                6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
               3.754408661907416e+00];
    const pl = 0.02425;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    if (p > 1 - pl) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }

  /* ============================================================= forecasting */

  /* psi-weights of the ARIMA in its MA(inf) representation on the LEVEL scale.
   * The AR side is phi(B)(1-B)^d expanded into a single polynomial. */
  function psiWeights(phi, theta, d, h) {
    const p = phi.length;
    // expand (1 - B)^d
    let delta = [1];
    for (let k = 0; k < d; k++) {
      const nx = new Array(delta.length + 1).fill(0);
      for (let i = 0; i < delta.length; i++) { nx[i] += delta[i]; nx[i + 1] -= delta[i]; }
      delta = nx;
    }
    // phi(B) = 1 - phi_1 B - ... ; multiply by delta(B)
    const phiPoly = [1];
    for (let i = 0; i < p; i++) phiPoly.push(-phi[i]);
    const full = new Array(phiPoly.length + delta.length - 1).fill(0);
    for (let i = 0; i < phiPoly.length; i++)
      for (let j = 0; j < delta.length; j++) full[i + j] += phiPoly[i] * delta[j];
    // pi_k such that y_t = sum pi_k y_{t-k} + ...
    const pi = full.slice(1).map(v => -v);

    const psi = [1];
    for (let j = 1; j <= h; j++) {
      let s = (j - 1 < theta.length) ? theta[j - 1] : 0;
      for (let i = 1; i <= Math.min(j, pi.length); i++) s += pi[i - 1] * psi[j - i];
      psi.push(s);
    }
    return psi;
  }

  /* Point forecasts and prediction intervals, h steps beyond the sample. */
  function forecast(model, h, opts) {
    opts = opts || {};
    const levels = opts.levels || [0.80, 0.95];
    const y = model.y, d = model.order.d, p = model.order.p, q = model.order.q;
    const w = model.diffSeries.slice();
    const e = model.allResiduals.slice();
    const phi = model.phi, theta = model.theta, mu = model.mean;

    // Extend the differenced series recursively.
    const wF = [];
    for (let s = 0; s < h; s++) {
      let f = mu;
      for (let i = 0; i < p; i++) {
        const idx = w.length + s - i - 1;
        const val = idx < w.length ? w[idx] : wF[idx - w.length];
        f += phi[i] * ((val != null ? val : mu) - mu);
      }
      for (let j = 0; j < q; j++) {
        const idx = e.length + s - j - 1;
        // future innovations have expectation zero
        const val = idx < e.length ? e[idx] : 0;
        f += theta[j] * val;
      }
      wF.push(f);
      w.push(f);
      e.push(0);
    }

    // Integrate back up to the level scale.
    const lvl = [];
    const hist = y.slice();
    for (let s = 0; s < h; s++) {
      let v = wF[s];
      if (d === 1) v = wF[s] + hist[hist.length - 1];
      else if (d === 2) v = wF[s] + 2 * hist[hist.length - 1] - hist[hist.length - 2];
      lvl.push(v);
      hist.push(v);
    }

    const psi = psiWeights(phi, theta, d, h);
    const sigma = Math.sqrt(model.sigma2);
    const bands = {};
    levels.forEach(L => {
      const z = normalQuantile(0.5 + L / 2);
      const lo = [], hi = [];
      let cum = 0;
      for (let s = 0; s < h; s++) {
        cum += psi[s] * psi[s];
        const sd = sigma * Math.sqrt(cum);
        lo.push(lvl[s] - z * sd);
        hi.push(lvl[s] + z * sd);
      }
      bands[String(Math.round(L * 100))] = { lower: lo, upper: hi, z: z };
    });

    const se = [];
    let cum = 0;
    for (let s = 0; s < h; s++) { cum += psi[s] * psi[s]; se.push(sigma * Math.sqrt(cum)); }

    return {
      h: h,
      mean: lvl,
      se: se,
      intervals: bands,
      psi: psi.slice(0, h),
      model: model.label,
      caveat: 'Prediction intervals reflect innovation uncertainty only. They exclude parameter ' +
              'uncertainty, model-selection uncertainty and the possibility of structural change, ' +
              'so realised coverage over long horizons is lower than the nominal level.'
    };
  }

  /* ======================================================= benchmark models */

  /* Random walk with drift -- the benchmark any forecast of a trending annual
   * series has to beat before it deserves to be believed. */
  function rwDrift(y) {
    const n = y.length;
    const drift = (y[n - 1] - y[0]) / (n - 1);
    const fitted = [];
    for (let t = 1; t < n; t++) fitted.push(y[t - 1] + drift);
    let sse = 0;
    for (let t = 1; t < n; t++) { const e = y[t] - fitted[t - 1]; sse += e * e; }
    const sigma2 = sse / (n - 1);
    const logL = -0.5 * (n - 1) * (Math.log(2 * Math.PI) + Math.log(sigma2) + 1);
    return {
      label: 'Random walk with drift',
      order: { p: 0, d: 1, q: 0 }, drift: drift,
      sigma2: sigma2, logLik: logL,
      aic: -2 * logL + 2 * 2, bic: -2 * logL + Math.log(n - 1) * 2,
      hqic: -2 * logL + 2 * Math.log(Math.log(n - 1)) * 2,
      nPar: 1, nObs: n - 1,
      accuracy: accuracy(y.slice(1), fitted),
      fitted: fitted,
      y: y.slice(),
      benchmark: true,
      forecast: function (h) {
        const out = [];
        for (let s = 1; s <= h; s++) out.push(y[n - 1] + drift * s);
        return out;
      }
    };
  }

  /* Holt's linear trend (ETS(A,A,N)), the other standard benchmark. Smoothing
   * parameters by direct search on SSE. */
  function holt(y) {
    let best = null;
    for (let a = 0.05; a <= 0.95; a += 0.05) {
      for (let b = 0.05; b <= 0.95; b += 0.05) {
        let l = y[0], t = y[1] - y[0], sse = 0;
        const fitted = [];
        for (let i = 1; i < y.length; i++) {
          const f = l + t;
          fitted.push(f);
          const err = y[i] - f;
          sse += err * err;
          const lNew = a * y[i] + (1 - a) * (l + t);
          t = b * (lNew - l) + (1 - b) * t;
          l = lNew;
        }
        if (!best || sse < best.sse) best = { alpha: a, beta: b, sse: sse, l: l, t: t, fitted: fitted };
      }
    }
    const n = y.length - 1;
    const sigma2 = best.sse / n;
    const logL = -0.5 * n * (Math.log(2 * Math.PI) + Math.log(sigma2) + 1);
    const lFinal = best.l, tFinal = best.t;
    return {
      label: 'Holt linear trend (ETS A,A,N)',
      alpha: best.alpha, beta: best.beta,
      sigma2: sigma2, logLik: logL,
      aic: -2 * logL + 2 * 3, bic: -2 * logL + Math.log(n) * 3,
      hqic: -2 * logL + 2 * Math.log(Math.log(n)) * 3,
      nPar: 2, nObs: n,
      accuracy: accuracy(y.slice(1), best.fitted),
      fitted: best.fitted,
      y: y.slice(),
      benchmark: true,
      forecast: function (h) {
        const out = [];
        for (let s = 1; s <= h; s++) out.push(lFinal + tFinal * s);
        return out;
      }
    };
  }

  /* ======================================================== model selection */

  /* Searches a grid of ARIMA orders at a fixed d, ranks by the requested
   * criterion, and rejects any candidate whose residuals fail Ljung-Box --
   * a model that has not whitened its residuals is not a candidate at all,
   * however good its AIC. This mirrors what Gassi et al. did when they moved
   * from ARIMA(5,1,2) to AR(5) + MA(2) + MA(3) after a lag-3 Ljung-Box failure.
   */
  function selectModel(y, opts) {
    opts = opts || {};
    const criterion = opts.criterion || 'aic';
    const maxP = opts.maxP == null ? 5 : opts.maxP;
    const maxQ = opts.maxQ == null ? 5 : opts.maxQ;
    const allowDrift = opts.drift !== false;

    const dsel = opts.d != null ? { d: opts.d, trace: [], reason: 'fixed by the user' } : selectD(y, 2);
    const d = dsel.d;

    const candidates = [];
    for (let p = 0; p <= maxP; p++) {
      for (let q = 0; q <= maxQ; q++) {
        if (p === 0 && q === 0) continue;
        const driftOptions = (d > 0 && allowDrift) ? [false, true] : [false];
        driftOptions.forEach(dr => {
          let m = null;
          try { m = arima(y, p, d, q, { drift: dr }); } catch (err) { m = null; }
          if (!m || !m.converged || !isFinite(m.aic)) return;
          if (!m.stationary || !m.invertible) return;
          const lb = ljungBox(m.residuals, Math.min(20, Math.floor(m.nObs / 4)), m.nPar);
          m.ljungBox = lb;
          m.jarqueBera = jarqueBera(m.residuals);
          m.adequate = lb.whiteNoise !== false;
          candidates.push(m);
        });
      }
    }

    // Always give the benchmarks a seat at the table.
    const bench = [];
    try { bench.push(rwDrift(y)); } catch (e) {}
    try { bench.push(holt(y)); } catch (e) {}

    const adequate = candidates.filter(m => m.adequate);
    const pool = adequate.length ? adequate : candidates;
    pool.sort((a, b) => a[criterion] - b[criterion]);

    const chosen = pool[0] || null;
    return {
      selected: chosen,
      d: d,
      dSelection: dsel,
      criterion: criterion,
      candidates: candidates.sort((a, b) => a[criterion] - b[criterion]).slice(0, 15),
      benchmarks: bench,
      adequateCount: adequate.length,
      totalFitted: candidates.length,
      note: adequate.length
        ? 'Selected by minimum ' + criterion.toUpperCase() + ' among models whose residuals pass ' +
          'Ljung-Box at 5%. ' + adequate.length + ' of ' + candidates.length + ' fitted models passed.'
        : 'WARNING: no candidate model produced white-noise residuals. The best-fitting model by ' +
          criterion.toUpperCase() + ' is reported, but its forecasts and intervals should be treated ' +
          'as unreliable -- there is structure in this series the ARIMA class is not capturing.',
      warning: adequate.length === 0
    };
  }

  /* Rolling-origin backtest: refits at each origin and scores h-step errors.
   * The only honest way to say anything about out-of-sample accuracy. */
  function backtest(y, opts) {
    opts = opts || {};
    const h = opts.h || 5;
    const minTrain = opts.minTrain || Math.max(20, Math.floor(y.length * 0.6));
    const p = opts.p, d = opts.d, q = opts.q;
    const errs = [], benchErrs = [];
    for (let origin = minTrain; origin <= y.length - 1; origin++) {
      const train = y.slice(0, origin);
      let m = null;
      try { m = arima(train, p, d, q, { drift: opts.drift }); } catch (e) { continue; }
      if (!m || !m.converged) continue;
      const f = forecast(m, Math.min(h, y.length - origin));
      const b = rwDrift(train).forecast(Math.min(h, y.length - origin));
      for (let s = 0; s < f.mean.length; s++) {
        const actual = y[origin + s];
        if (actual == null) continue;
        errs.push({ h: s + 1, err: actual - f.mean[s], actual: actual });
        benchErrs.push({ h: s + 1, err: actual - b[s], actual: actual });
      }
    }
    function agg(list) {
      if (!list.length) return null;
      let se = 0, ae = 0, ape = 0, np = 0;
      list.forEach(r => {
        se += r.err * r.err; ae += Math.abs(r.err);
        if (r.actual !== 0) { ape += Math.abs(r.err / r.actual); np++; }
      });
      return { rmse: Math.sqrt(se / list.length), mae: ae / list.length,
               mape: np ? 100 * ape / np : null, n: list.length };
    }
    const modelAgg = agg(errs), benchAgg = agg(benchErrs);
    return {
      horizon: h, origins: y.length - minTrain,
      model: modelAgg,
      benchmark: benchAgg,
      skill: (modelAgg && benchAgg && benchAgg.rmse) ? 1 - modelAgg.rmse / benchAgg.rmse : null,
      note: 'Rolling-origin evaluation against a random walk with drift. Positive skill means the ' +
            'ARIMA beat the benchmark out of sample; zero or negative means it did not, and the ' +
            'benchmark should be preferred.'
    };
  }

  return {
    mean: mean, variance: variance, acf: acf, pacf: pacf, acfBand: acfBand, diff: diff,
    ols: ols,
    adf: adf, pp: pp, kpss: kpss, selectD: selectD,
    arima: arima, forecast: forecast, psiWeights: psiWeights,
    polyRoots: polyRoots, maxInverseRoot: maxInverseRoot,
    arInverseRoots: arInverseRoots, maInverseRoots: maInverseRoots,
    isStationary: isStationary, isInvertible: isInvertible,
    ljungBox: ljungBox, jarqueBera: jarqueBera,
    rwDrift: rwDrift, holt: holt,
    selectModel: selectModel, backtest: backtest,
    accuracy: accuracy,
    chi2cdf: chi2cdf, normalQuantile: normalQuantile,
    fcdf: fcdf, betai: betai
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSATsa; }
