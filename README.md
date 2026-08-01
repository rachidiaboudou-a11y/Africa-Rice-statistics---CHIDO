# Rice Statistics for Africa

A rice intelligence and policy-support platform for 55 African countries, built directly on
**FAOSTAT** and **USDA PSD**. It answers three questions and keeps them clearly apart:

1. **Where are we?** — historical statistics and structural diagnosis
2. **Where are we going?** — Box–Jenkins forecasts with prediction intervals
3. **What should we do?** — policy simulation and a least-cost path to self-sufficiency

Self-sufficiency indicators follow FAO (2001), *Food Balance Sheets: A Handbook*, as applied by
Gassi, Gul & Çetin (2025), *Rice Self-Sufficiency in Benin: Analysis and Forecasts*,
**IJFAEC 13(1), 29–42**. The platform reproduces that paper's published Table 1 exactly, as a
regression test (see *Golden test* below).

---

## Quick start

No toolchain required — no Node, no Python, no Docker.

```bash
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Then open <http://localhost:8788/>. The server rebuilds `index.html` whenever a source module
changes, and serves with `no-store` so a reload always reflects the last edit.

Run the test suite at <http://localhost:8788/tests.html> — **425 tests**, all green.

The hero carries an **original vector illustration** of lowland paddies at dawn — drawn rather than
photographed because the platform is a single self-contained file with a no-external-request rule, so
a stock photograph would bring a licence, a CDN dependency and a megabyte with it.

To refresh the data from the official sources:

```bash
powershell -ExecutionPolicy Bypass -File .\tools\build-data.ps1 -Refresh
```

To rebuild the map boundaries:

```bash
powershell -ExecutionPolicy Bypass -File .\tools\build-geo.ps1
```

---

## Why this architecture

The brief specified Next.js + FastAPI + PostgreSQL + Redis + Celery + Docker. **None of those
runtimes exist on the target machine** — verified: no `node`, no `python`, no `docker`. A repo that
cannot be launched is a mock-up, which the brief explicitly forbids.

So the platform is built the way this machine actually works: modular JavaScript compiled into one
self-contained `index.html`, a PowerShell data pipeline, and a PowerShell dev server using .NET
`HttpListener`. All computation — indicators, ARIMA estimation, scenario simulation, optimisation,
report generation — runs client-side. The result opens from a USB stick, deploys to any static host,
and needs no runtime at all.

**Trade-offs accepted.** No authentication or server-side security (§37) because there is no server
and no user data — it is a static analytical page. No PowerPoint export (§31); everything else is
there. The Africa map is a schematic tile cartogram, not a geographic projection — see below.

---

## Files

```
tools/africa-registry.ps1   55-country registry: ISO3, M49, FAOSTAT + USDA codes, regions, blocs
tools/build-data.ps1        pipeline: download → validate → standardize → transform → store
data/rsa-{meta,fao,usda,registry}.json   versioned output with full provenance
src/rsa-core.js             data layer, selections, aggregation, product basis, quality scoring
src/rsa-indicators.js       indicator library; each carries its own equation and limitations
src/rsa-tsa.js              Box–Jenkins: PP/ADF/KPSS, ACF/PACF, ARIMA, Ljung–Box, forecasts
src/rsa-scenarios.js        baseline projection, five scenarios, least-cost optimiser
src/rsa-policy.js           policy score, diagnostic rules, Rice Policy Copilot
src/rsa-crisis.js           crisis registry, interrupted time-series, Chow tests, resilience policy
src/rsa-i18n.js             English/French translation layer and locale number formatting
src/rsa-figs.js             SVG charts, correlograms, tile cartogram, SVG/PNG export
src/rsa-report.js           report generator + Markdown/LaTeX/CSV/JSON/HTML/Excel/Word export
src/rsa-app.js              eight-panel UI
src/rsa-tests.js            215 tests
build.ps1 / serve.ps1       bundler and dev server
```

---

## Data Used

Every variable the platform reads, per source, with element code, unit, product basis and coverage —
plus every equation in one place. Coverage counts are **computed from what actually loaded**, not
transcribed, so the dictionary cannot drift away from the data it describes.

Downloads: the data dictionary (CSV), all equations (CSV), the whole thing as Markdown or JSON, and
**every observed and derived series for every country in long format** — one row per
country-year-variable, with unit, source and an `observed`/`derived` flag.

Seven sources documented: FAOSTAT production, trade, population and food balance sheets; USDA PSD;
Natural Earth boundaries; and the van Oort et al. parameter tables. Derived series are listed
separately from read series, including the zero-production rule, so a reader tracing a number always
knows which is which.

---

## West Africa model — van Oort et al. (2015)

Implements the framework of:

> van Oort, P.A.J., Saito, K., Tanaka, A., Amovin-Assagba, E., Van Bussel, L.G.J., Van Wart, J.,
> de Groot, H., van Ittersum, M.K., Cassman, K.G. & Wopereis, M.C.S. (2015).
> **Assessment of rice self-sufficiency in 2025 in eight African countries.**
> *Global Food Security* 5, 39–49. [doi:10.1016/j.gfs.2015.01.002](https://doi.org/10.1016/j.gfs.2015.01.002)

applied to all sixteen West African countries and to the region as a whole, at a horizon of
2030–2050.

**All nine equations** are implemented: production from area and yield (Eq. 1), milled conversion at
**0.65** — the paper's rate, not the platform's 0.67 (Eq. 2), consumption from population and
per-capita consumption (Eq. 3), the scenario identity and required-area solution (Eqs. 4–5),
cropping intensity (Eqs. 6–7) and the exploitable yield ceiling at 80% of potential (Eqs. 8–9,
following Cassman 2001). Six yield scenarios × two diet scenarios, as in the paper's Tables 3–5.

**Cross-validation.** The regional baseline P/C of **0.615** agrees with the platform's own
independently-computed SSR of **0.633** for the same countries — two entirely separate code paths,
differing only by the milling rate. Mali reads 0.87 against the paper's published 0.89.

**Three honest limitations**, stated on every result rather than buried:

- **Aggregate form.** The paper splits rainfed from irrigated systems (Eq. 1). That split needs the
  SPAM land-cover map and GYGA simulations, which exist for the paper's eight countries and not for
  the rest of West Africa. Outside them the model runs with a single national area and yield.
- **The 80%-of-potential scenarios are refused, not guessed,** for the twelve countries the paper
  does not cover. `Yw` and `Yp` are ORYZA2000 simulations, not derivable from public statistics. For
  Burkina Faso, Ghana, Mali and Nigeria the ceiling is *reconstructed* from the paper's published
  Table 2 and labelled as such.
- **A negative yield trend extrapolated over a decade drives yield toward zero.** Sierra Leone and
  Niger hit this. The figure is flagged as an extrapolation artefact rather than floored silently.

Ends with a **scientific report** — executive summary, model and equations, data used, regional and
country results, a discussion drawing on the paper's own arguments (the three-lever decision space,
the 38%-of-potential yield gap, why 80% of potential would need growth exceeding the Asian green
revolution, and diet as the underrated term), validation against the published tables, limitations
and **sixteen references**. Exports to HTML/PDF, Word, Markdown, LaTeX and JSON.

---

## Crisis and Policy

Measures how rice indicators moved around five dated external shocks:

| Crisis | Window | Transmission channel |
|---|---|---|
| Global food price crisis | 2007–08 | World rice prices roughly tripled Jan–May 2008, driven by **export restriction** (India, Viet Nam, Egypt, Cambodia) rather than harvest failure |
| Food price spike | 2010–11 | Russian wheat export ban; rice less affected than wheat — a useful contrast case |
| COVID-19 | 2020–21 | Logistics disruption; Viet Nam suspended export registrations March 2020 |
| Russia–Ukraine war | 2022–24 | **Indirect, through inputs** — potash and nitrogen, not rice. Fertiliser prices roughly doubled in 2022 |
| India export restrictions | 2023–24 | India supplies ~40% of world rice exports; banned non-basmati white rice July 2023. West Africa is the most exposed region on earth to this specific measure |

**The method is interrupted time-series, and the counterfactual is the load-bearing part.** For each
crisis a model is fitted to *pre-crisis data only*, projected across the window, and the deviation
reported against that projection's own 95% prediction interval. **A movement that stays inside the
interval is reported as NOT evidence of a crisis effect.** A Chow test at the fixed crisis date asks
separately whether the *trend* changed rather than just the level.

Worked example — Senegal, 2008:

| | |
|---|---|
| Import unit value, pre-crisis mean | $268/t |
| During crisis | $491/t (+83%) |
| **2008 actual** | **$637/t** |
| Counterfactual expectation | $308/t (95% upper bound $418) |
| Verdict | **outside the interval** |
| Chow test at 2007 | F significant, p < 0.0001 |

And the honest negatives: **COVID-19 and the Russia–Ukraine window show no detectable price effect**
for Senegal — every crisis year sits inside the counterfactual interval. That is the correct answer
for a spike that lasted weeks in data recorded annually, and the platform says so rather than
manufacturing a narrative.

The section also flags a limitation it cannot fix: the 2010–11 pre-window (2008–09) sits directly on
the peak of the 2007–08 crisis, so every "change from before" figure for that event is measured
against an already-elevated baseline. There is no uncontaminated baseline in annual data, so it is
declared in red above the table rather than quietly reported.

Ends with **eight resilience instruments** — strategic reserves, supplier diversification, FX
provisioning, fertiliser security, targeted transfers, resisting export bans, early warning, and
reducing the exposure itself — ranked by how many of the observed effects each addresses. These are
deliberately distinct from the structural recommendations in the policy simulator: resilience is
about surviving a shock that has already happened, structural policy is about production over
decades, and the two compete for the same budget.

A dedicated crisis report exports to HTML/PDF, Word, Markdown, LaTeX and JSON.

**What this is not.** Association around dated windows, not causal identification. The crises
overlap (the Ukraine window contains India's ban entirely; 2008 coincides with the financial crisis;
COVID coincides with the East African locust upsurge), the data are annual, and there is no unexposed
control group — every African country was exposed to every crisis examined.

---

## Validation against riceforafrica.net

Checked against AfricaRice's country page for Benin
(<https://riceforafrica.net/country_site/benin/>). **The methodology matches exactly** — they compute
`milled production / (milled production + imports − exports) × 100`, the same FAO definition used
here — and the input data reconciles:

| | riceforafrica | This platform | |
|---|---|---|---|
| 2019 exports | 1,891 t | 1,891.09 t | **exact** |
| 2019 imports | 1,528,490 t | 1,528,914 t | 0.03% |
| Production (their "2023") | 525,014 t | 525,014.19 t (FAOSTAT **2022**) | exact value, year label shifted |
| Area | 134,840 ha | 134,840 ha | exact |
| Yield | 3.89 t/ha | 3.89 t/ha | exact |
| SSR | 18.0% | 18.25% | 0.25 pp |

Two differences are real and documented rather than "fixed":

- **Milling rate.** They compute at 0.70 (despite citing 0.667); this platform uses FAO's 0.67.
  That accounts for essentially all of the 0.25 pp SSR gap.
- **Year labelling.** Their "2023" row carries FAOSTAT's 2022 values. This platform labels years as
  FAOSTAT does.

Their exports matching mine *to the decimal* on item 30 is the strongest available confirmation that
the trade-series correction below is right.

---

## Accuracy: matching published per-capita consumption

The single largest source of disagreement with published figures was that the platform reported
**apparent utilization** (`P + M − X`) as consumption. That counts feed, seed, losses, processing,
industrial use and stock building as though people ate them — and where re-export goes unrecorded it
counts rice that left the country. Benin read **146 kg/capita** against a published ~54.

Fixed by joining **both** FAOSTAT food-balance releases:

| Release | Years | Item | Basis | Benin? |
|---|---|---|---|---|
| Historic | 1961–2013 | 2805 "Rice (Milled Equivalent)" | **milled** | ✅ |
| Current | 2010–2023 | 2807 "Rice and products" | **paddy** | ❌ |

The two are on **different bases** — verified on the 2010–13 overlap, where the ratio is 0.67–0.71
(the milling rate) across Senegal, Nigeria, Ghana and Madagascar. Merging naively would put a 1.5×
step in every series at 2010. The pipeline normalises both to **milled**, records which release each
year came from, and the test suite asserts there is no step at the join.

Coverage rose from 43 to **49 of 55 countries**, and per-capita consumption now matches the
literature:

| Country | Platform (FBS, milled) | Published | Previously (apparent) |
|---|---|---|---|
| **Benin** | **51.5** | ≈54 (AfricaRice) | 146 ✗ |
| Madagascar | 100.8 | ≈100–115 | 111.9 |
| Côte d'Ivoire | 74.9 | ≈70 | 100.2 |
| Senegal | 83.1 | ≈90–100 | 127.7 |
| Guinea | 112.9 | ≈100 | 239.2 ✗ |
| Ghana | 40.0 | ≈45 | 51.8 |

New indicators: `cpcFood` (per-capita food consumption), `foodUse`, `ssrFood` (production against
what is actually eaten) and `kcalRice`. Apparent consumption is still reported — it is the correct
denominator for the FAO self-sufficiency definition — but it is no longer presented as diet.

**Countries that grow no rice** — Libya, Tunisia, Botswana, Namibia, Lesotho and seven others — had
no FAOSTAT production row at all, so every ratio came out null and they vanished from the map as
"no data". They import rice and grow none, so their SSR is **0%**. Production is now taken as zero
for these, flagged as *derived rather than observed*, and never applied to a country that merely has
a gap in an otherwise populated series. All 55 countries now appear.

---

## Food Balance Sheets: what is eaten, not what arrives

The comparison surfaced a genuine gap. Apparent utilization (`P + M − X`) counts feed, seed, losses,
processing, industrial use and stock building as though they were consumption. FAOSTAT's Food
Balance Sheets separate them. For Senegal in 2022, domestic supply was 3,250 kt but **food use only
2,154 kt** — a third of the balance sheet is not food.

The FBS is now in the pipeline, with two properties carried through explicitly:

- It is in **paddy equivalent** throughout, including trade. Verified: Senegal's FBS imports of
  2,221 kt ÷ 0.67 = the 1,487 kt milled in the trade file, matching to 0.05%.
- Coverage is **43 of 55 countries, 2010–2023 only**. **Benin is not in the current release**, so
  riceforafrica's 54.37 kg/capita figure comes from an older FBS vintage. The platform reports the
  absence rather than inventing a series.

`RSA.consumptionCheck()` puts apparent utilization beside FBS food use and reports the non-food
share, which is the direct measure of how far "consumption" is from consumption.

---

## Automatic updating

`tools/auto-update.ps1` checks FAOSTAT, USDA PSD and Natural Earth by HTTP HEAD — comparing
`Last-Modified` and `Content-Length` against the last known state — and rebuilds **only** when a
source has actually published something new. A daily check costs six HEAD requests.

```bash
powershell -File .\tools\auto-update.ps1 -Install     # register a daily 06:30 check
powershell -File .\tools\auto-update.ps1 -CheckOnly   # report status, change nothing
powershell -File .\tools\auto-update.ps1              # check, and update if changed
```

Guarantees that matter:

- **Nothing is overwritten in place.** The previous `data/*.json` set is archived to
  `data/versions/<extraction-timestamp>/` before every rebuild, so any past analysis can be re-run
  against the exact data it used.
- **A failed rebuild is rolled back**, never left half-written.
- **An unreachable source is left at its previous version** and reported, rather than failing the run.

The Data & quality panel shows what the updater last found, and says so plainly when it has never run.

---

## Languages

English and French, switchable from the header, with the choice remembered and the browser's
language as the initial default. French is not decoration: rice policy across Benin, Senegal, Côte
d'Ivoire, Mali, Burkina Faso, Niger, Guinea, Togo, Cameroon and Chad is conducted in French.

Both languages are at **100% of 159 keys**, asserted by the test suite. What is and is not translated
is a deliberate split:

- **Translated in full** — UI chrome, indicator names, section headings, and *every scientific
  caveat*. Shipping warnings only in English would defeat their purpose.
- **Not translated** — equations, variable symbols, ISO codes and database names. `SSR`, `PPC`,
  `FAOSTAT` and `P + M − X` are international notation; localising them would make the methodology
  harder to check against the literature, not easier. Exports and the reproducibility manifest also
  stay in English so a file is readable by whoever receives it.
- **Numbers follow the locale.** French renders `18,25` and `18,3 %`; English renders `18.25` and
  `18.3%`. This is not cosmetic — a French reader parsing `18.25` under their own convention reads a
  different number.

---

## The trade series: why the default is item 30, not item 31

FAOSTAT publishes several rice trade series. Two matter:

| Item | Label | Covers |
|---|---|---|
| **30** | Rice, paddy (rice milled equivalent) | **Total rice trade** — husked, milled *and broken*, on one basis. **The default.** |
| 31 | Rice, milled | Milled rice only. **Excludes broken rice.** Used by Gassi et al. (2025). |

Broken rice is the dominant *imported* form across much of West Africa — it is what
Senegalese thieboudienne is made from. Using item 31 therefore misses most of the region's rice
imports. The effect is not marginal:

| Senegal, 2024 imports | |
|---|---|
| FAOSTAT item 31 | 38,651 t |
| FAOSTAT item 30 | 1,387,262 t |
| USDA PSD (independent) | ~1,400,000 t |

Item 31 understated Senegal's rice imports **thirty-six fold** and put its self-sufficiency ratio at
99.3% instead of 44.8%. Burkina Faso read 88.0% instead of 28.7%. Africa as a whole read 72.0%
instead of 64.1%.

Item 30 agrees with USDA's independently constructed estimate to within a few per cent for most
countries. Item 31 remains selectable — reproducing the published Benin results requires it — but it
is now an explicit choice that raises a warning, not a silent default.

---

## The one thing to understand: product basis

**FAOSTAT reports rice production as paddy (item 27) but rice trade as milled rice (item 31).**
Milling a tonne of paddy yields roughly two-thirds of a tonne of milled rice, so dividing paddy
production by a denominator containing milled trade mixes commodities.

The published literature does this anyway — including the Benin paper — because it is what the raw
columns give you. Rather than silently repeating the problem or silently "fixing" their numbers, the
platform carries an explicit switch:

| Basis | What it does | Use when |
|---|---|---|
| `asPublished` | paddy production against milled trade, no conversion | reproducing Gassi et al. (2025) and most FAOSTAT literature. **Not unit-consistent; SSR biased upward** |
| `milled` | paddy production × milling rate before the ratio | you want a unit-consistent, scientifically defensible figure — **recommended** |
| `paddy` | milled trade ÷ milling rate | the question is about land and farm-gate output |

USDA PSD has no such problem: production, trade, consumption and stocks are all milled, with a
published milling rate.

---

## Equations

The self-sufficiency ratio is stated on the FAO definition, on a **milled** basis:

```
SSR_t = Production(milled)_t / (Production(milled)_t + Imports_t − Exports_t) × 100
```

and the companion indicators:

```
PPC_t = 1000 × P_t / N_t                        per capita production, kg/capita
CPC_t = 1000 × (P_t + M_t − X_t) / N_t           per capita consumption, kg/capita
IDR_t = 100 × M_t / (P_t + M_t − X_t)            import dependency ratio, %
```

Production, imports and exports must be the same commodity for the ratio to mean anything, which is
why the milled basis is the default. The milled and paddy bases give the **identical** SSR and IDR —
multiplying numerator and denominator by the milling rate leaves a ratio unchanged — and differ only
in the per-capita quantities. This is asserted as a test across all 2,605 country-years.

These were reverse-engineered from the paper (its formulas are embedded as images) and verified
against its published Table 1 to the decimal.

`SSR + IDR = 100` **only when exports are zero**. A large re-exporter shows IDR far above 100% —
Benin's 351.71% in 2010 is the textbook case, driven by re-export to Nigeria. That is a property of
the FAO definition, not a data error, and the platform says so wherever it occurs.

Also implemented: ICR, NTR, PCB, PCG, growth, CAGR, import bill, unit value, bill per capita, trade
balance. Every indicator carries its equation, variable definitions, units, interpretation and
limitations in one place — the methodology section of the report is *generated from those
descriptors*, so documentation cannot drift from the arithmetic.

---

## Golden test

The suite reproduces the paper's Table 1 from the live FAOSTAT extract:

| Year | PPC | CPC | IDR | SSR |
|---|---|---|---|---|
| 2010 | 12.76 | 17.35 | 351.71 | 73.51 |
| 2015 | 17.98 | 41.97 | 57.15 | 42.85 |
| 2020 | 31.49 | 95.63 | 67.15 | 32.93 |
| 2021 | 38.74 | 139.45 | 72.22 | 27.78 |
| 2022 | 38.16 | 148.20 | 74.25 | 25.75 |

All twenty figures match within 0.02 (the paper's own rounding). Reproducing them requires asking for
**both** of the paper's choices explicitly — the as-published basis *and* trade item 31 — since the
platform now defaults to neither.

---

## Map

A real geographic choropleth built from **Natural Earth 1:110m** boundaries (public domain), bundled
with the platform: no API key, no billing, no external request, works offline. 49 countries as
polygons plus 6 small island states as markers, 33 KB total. An equirectangular projection with a
cos(latitude) correction is used rather than Web Mercator, which would inflate the Maghreb and South
Africa relative to the Sahel on a continent whose whole point here is cross-country comparison.

Fourteen indicators, any year from 1961 to 2050, under any scenario, with a play button that animates
the trajectory. Colour domains are fixed per indicator so a country's colour means the same thing in
every frame. Projected years are tagged *model forecast* or *scenario simulation*, never left to look
like data.

A **live readout** under the map reports the country, its value and its rank as you sweep across —
a tooltip disappears the moment you look away from it, which makes comparing countries impossible.
The subtitle states coverage explicitly (*"54 of 55 countries with data"*) so a gap is visible rather
than inferred.

**Google Maps** is offered as an optional base layer. It needs a billing-enabled JavaScript API key,
which the platform cannot create and most users will not have, so it layers on top of a map that is
already complete rather than being the map itself. The key is stored only in the local browser.

---

## Scenario horizons and phase-in models

Every scenario reports at **2030, 2035, 2040, 2045 and 2050** — a single target year hides the shape
of a policy, and an intervention that arrives late looks identical to one that delivers steadily
until you tabulate the path.

How fast a policy arrives is a separate, explicit choice from how large it is:

| Model | Shape | Fits |
|---|---|---|
| Linear | constant effort | the neutral default |
| **Logistic (S-curve)** | slow, then rapid, then saturating | how technology adoption actually diffuses — recommended for variety adoption |
| Back-loaded | quadratic | capital works such as irrigation, where construction precedes yield |
| Front-loaded | square root | extension reaching the most accessible farmers first |
| Immediate | step | not realistic; an upper bound on what timing alone can contribute |

Interventions hold at full intensity after the phase-in year rather than switching off.

---

## Trends mode

Setting **Target → Trends** switches projections off entirely and reports every indicator for every
observed year: a summary with first/last/change/CAGR/min/max, the full year-by-year matrix, a
year-on-year growth matrix, and charts. Nothing modelled, nothing projected.

---

## Forecasting

Box–Jenkins, implemented from scratch: Phillips–Perron (the paper's test), ADF and KPSS run
together, ACF/PACF identification, conditional-sum-of-squares estimation initialised by
Hannan–Rissanen and refined by Nelder–Mead, Ljung–Box and Jarque–Bera diagnostics, AIC/BIC/HQIC,
psi-weight prediction intervals, and rolling-origin backtests against a random-walk-with-drift
benchmark.

**The data are annual, so no seasonal ARIMA is ever fitted.** §8 asks for SARIMA "where
appropriate"; with one observation per year it never is.

**Stationarity and invertibility are decided by actual polynomial roots** (Durand–Kerner), not a
proxy — this is what the paper checks by plotting inverse roots against the unit circle. Models
whose residuals fail Ljung–Box are excluded from selection before information criteria are compared,
mirroring the paper's move from ARIMA(5,1,2) to AR(5)+MA(2)+MA(3) after a lag-3 failure.

Information criteria are **never** compared across different differencing orders.

---

## Scenarios

The baseline is built **structurally**, not by extrapolating production and consumption separately:

```
P_t = A_t × Y_t          C_t = cpc_t × N_t          SSR_t = 100 × P_t / C_t
```

Area, yield and per-capita consumption are each projected from their own history; **population comes
from the UN World Population Prospects projection already in the dataset** — the demographic term is
not forecast at all. This is what makes the levers meaningful: area expansion acts on area, variety
adoption and irrigation act on yield, trade policy acts through price on both.

Five scenarios (area, improved varieties, import tariff, productivity, combined) plus a least-cost
optimiser minimising programme cost subject to `SSR ≥ 100%` under land, adoption and budget
constraints.

The tariff scenario does **not** assume tariffs create production. It models
`tariff → pass-through → domestic price → supply/demand elasticities → production and consumption`,
with every elasticity editable and labelled as an illustrative default, plus explicit warnings about
consumer welfare on a staple food and about informal trade defeating high tariffs on porous borders.

**All cost parameters are placeholders, not national costings.** The composition of an optimal
package is more informative than its price tag.

---

## What the editorial review found

Three passes, as §40 requires. These were real defects found and fixed, not a formality:

**Pass 1 — explosive ARIMA models were being accepted.** The stationarity check scanned the
polynomial around the unit circle looking for near-zeros, which only detects roots sitting almost
exactly *on* the circle and says nothing about roots well inside it. It accepted ARIMA(4,1,4) with
AR coefficients like −1.659 as "stationary". Downstream, that model extrapolated Benin's per-capita
rice consumption to **451 kg/person/year** — roughly three times any national diet on record — and
that number propagated into consumption, imports and every scenario. Replaced with Durand–Kerner
root-finding. Benin's projection is now 169 kg, and consumption falls from 9.21 Mt to 3.46 Mt.
A documented plausibility ceiling was added as defence in depth, and it reports when it fires.

**Pass 2 — headline figures were being taken from provisional data.** FAOSTAT publishes trade later
than production, so the newest year can carry partial coverage. Seven countries showed impossible
final-year jumps: Ethiopia's SSR appeared to go from 14.4% to 90% in three years. Separately,
Nigeria's *recorded* imports collapsed from 2.15 Mt (2013) to 5.3 kt (2022) after its FX
restrictions and border closure — making it read as 99% self-sufficient when the rice simply moved
into informal channels. Two diagnostic rules added (`provisional-final-year`, `import-collapse`),
plus a fix to cross-country rankings, which were described as using a "common year" when reporting
is not synchronised.

**Pass 4 — the wrong trade series was the default.** Prompted by a request to re-check every value,
Senegal's baseline self-sufficiency read 112.5% — impossible for a major rice importer. The cause was
using FAOSTAT item 31, which excludes broken rice. Switching the default to item 30 corrected Senegal
from 99.3% to 44.8%, Burkina Faso from 88.0% to 28.7%, and Africa from 72.0% to 64.1%; the
FAOSTAT/USDA import ratios collapsed toward 1.0 for most countries, which is the real confirmation
that the corrected series is the one measuring rice trade. See the trade-series section above.

**Pass 3 — the databases disagree by 222× and nothing said so.** For Nigeria in 2023, FAOSTAT and
USDA agree closely on production (5.96 vs 5.61 Mt milled, 6% apart) but record **8,508 t** and
**1,885,000 t** of imports respectively. FAOSTAT counts rice clearing customs; USDA estimates what
the supply–demand balance requires. **The gap is a direct measurement of the unrecorded trade** —
and it is why FAOSTAT puts Nigerian self-sufficiency at 99% and USDA at 75%. A cross-database check
now runs automatically, and the Compare panel puts both figures side by side on a common year and a
common milled basis. This is the strongest single piece of evidence the platform produces, and it
exists only because §2 forbade merging the two sources.

---

## Known limitations

- **Apparent consumption is not intake.** `P + M − X` absorbs stock change, seed, feed, industrial
  use and waste, and inherits every error in production and trade.
- **Unrecorded trade is substantial in West Africa** and is the dominant source of error in
  country-level SSR. The cross-database check quantifies it where USDA has coverage.
- Forecasts are **univariate** — no prices, weather, conflict or policy.
- Prediction intervals capture **innovation uncertainty only**. Over a 25-year horizon, realised
  coverage is materially below the nominal 80%/95%.
- Environmental consequences of area expansion — land-use-change emissions, paddy methane,
  biodiversity, water — are **not modelled**.
- Distributional effects are not modelled. A policy that raises SSR may make rice less affordable
  for the poorest households.
- The **Africa map is a schematic tile cartogram**, not a geographic projection. Each country is one
  equal-sized tile in roughly its relative position. This gives every country equal visual weight
  regardless of land area, needs no boundary file, and takes no position on contested borders. It is
  labelled as schematic wherever it appears.
- The `Sahel` grouping is agro-ecological (CILSS-style), **not** the dissolved G5 Sahel. Burkina
  Faso, Mali and Niger are retained in ECOWAS with a flag so long historical aggregates stay
  continuous.

---

## Reproducibility

Every report carries a manifest pinning data version, extraction date, source publication dates,
database, selection, basis, milling rate, period, target year, consumption method, scenario
assumptions and platform version. The platform stores no hidden state: the same inputs against the
same data version reproduce the same numbers. `tools/build-data.ps1` rebuilds the data from the
official sources and records the publication date of every archive.

## Data sources

| Database | Dataset | Coverage |
|---|---|---|
| FAOSTAT | Production: Crops and livestock products | 1961–2024 |
| FAOSTAT | Trade: Crops and livestock products | 1961–2024 |
| FAOSTAT | Population (UN WPP) | 1950–2100 |
| USDA PSD | Production, Supply and Distribution — grains | MY 1960–2026 |

Downloaded from the official bulk endpoints; no API key required.
