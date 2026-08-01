/* Rice Statistics for Africa -- internationalisation (English / French).
 *
 * French is not decoration here. Rice policy in West Africa is conducted in
 * French across Benin, Senegal, Cote d'Ivoire, Mali, Burkina Faso, Niger, Guinea,
 * Togo, Cameroon and Chad -- most of the countries whose self-sufficiency this
 * platform is about. A tool a Beninese ministry cannot read in its working
 * language is a tool it will not use.
 *
 * Design notes:
 *
 *  * Lookup is by key with an English fallback. A missing French string renders
 *    the English rather than a blank or a raw key, so an incomplete translation
 *    degrades to something readable instead of something broken.
 *
 *  * Numbers and dates follow the locale: French uses a comma as the decimal
 *    separator and a non-breaking space as the thousands separator. Getting this
 *    wrong is not cosmetic -- "1,234" means one-point-two-three-four in French and
 *    one thousand two hundred and thirty-four in English, and a self-sufficiency
 *    ratio is exactly the kind of number that would be misread.
 *
 *  * Equations, variable symbols, ISO codes and database names are NOT translated.
 *    SSR, PPC, FAOSTAT and P + M - X are international notation; localising them
 *    would make the methodology harder to check against the literature, not easier.
 *
 *  * The scientific caveats ARE translated in full. They are the part a
 *    policymaker most needs to understand, and shipping warnings only in English
 *    would defeat the point of the warnings.
 */

const RSAi18n = (function () {
  'use strict';

  let current = 'en';
  const listeners = [];

  const STR = {

    /* ------------------------------------------------------------ chrome */
    'app.title':          { en: 'Rice Statistics for Africa',  fr: 'Statistiques Rizicoles pour l’Afrique' },
    'app.tagline':        { en: 'rice intelligence & policy support',
                            fr: 'intelligence rizicole et aide à la décision' },
    'ctl.database':       { en: 'Database',    fr: 'Base de données' },
    'ctl.basis':          { en: 'Basis',       fr: 'Base produit' },
    'ctl.tradeSeries':    { en: 'Trade series', fr: 'Série commerciale' },
    'ctl.selection':      { en: 'Selection',   fr: 'Sélection' },
    'ctl.target':         { en: 'Target',      fr: 'Horizon' },
    'ctl.language':       { en: 'Language',    fr: 'Langue' },
    'ctl.indicator':      { en: 'Indicator',   fr: 'Indicateur' },
    'ctl.scenario':       { en: 'Scenario',    fr: 'Scénario' },
    'ctl.rendering':      { en: 'Rendering',   fr: 'Rendu' },
    'ctl.criterion':      { en: 'Criterion',   fr: 'Critère' },
    'ctl.series':         { en: 'Series',      fr: 'Série' },

    'basis.milled':       { en: 'Milled equivalent (FAO definition)',
                            fr: 'Équivalent usiné (définition FAO)' },
    'basis.paddy':        { en: 'Paddy equivalent', fr: 'Équivalent paddy' },
    'basis.asPublished':  { en: 'As published (paddy vs milled)',
                            fr: 'Tel que publié (paddy vs usiné)' },
    'trade.std':          { en: 'Total rice (item 30, incl. broken)',
                            fr: 'Riz total (produit 30, brisures incluses)' },
    'trade.m31':          { en: 'Milled only (item 31 — paper replication)',
                            fr: 'Usiné seul (produit 31 — réplication de l’article)' },
    'target.trends':      { en: 'Trends (all observed years)',
                            fr: 'Tendances (toutes années observées)' },

    /* -------------------------------------------------------------- tabs */
    'tab.overview':   { en: 'Overview',        fr: 'Vue d’ensemble' },
    'tab.map':        { en: 'Map',             fr: 'Carte' },
    'tab.profile':    { en: 'Country profile', fr: 'Profil pays' },
    'tab.compare':    { en: 'Compare',         fr: 'Comparer' },
    'tab.forecast':   { en: 'Forecast',        fr: 'Prévision' },
    'tab.scenarios':  { en: 'Policy simulator', fr: 'Simulateur de politiques' },
    'tab.sources':    { en: 'Data & quality',  fr: 'Données et qualité' },
    'tab.copilot':    { en: 'Policy copilot',  fr: 'Copilote politique' },
    'tab.report':     { en: 'Report',          fr: 'Rapport' },

    /* -------------------------------------------------------------- hero */
    'hero.title':  { en: 'Africa’s rice economy, from the official record to the policy question',
                     fr: 'L’économie rizicole africaine, des statistiques officielles à la question politique' },
    'hero.lede':   { en: 'Historical statistics, self-sufficiency diagnostics, Box–Jenkins forecasts and transparent policy simulation for {n} African countries, built directly on FAOSTAT and USDA PSD.',
                     fr: 'Statistiques historiques, diagnostic d’autosuffisance, prévisions Box–Jenkins et simulation de politiques transparente pour {n} pays africains, construits directement sur FAOSTAT et USDA PSD.' },
    'hero.credit': { en: 'Illustration: lowland rice paddies at dawn — original vector artwork',
                     fr: 'Illustration : rizières de bas-fond à l’aube — création vectorielle originale' },
    'hero.q1':     { en: 'Where are we?',       fr: 'Où en sommes-nous ?' },
    'hero.q2':     { en: 'Where are we going?', fr: 'Où allons-nous ?' },
    'hero.q3':     { en: 'What should we do?',  fr: 'Que devons-nous faire ?' },
    'hero.a1':     { en: 'Africa’s SSR was {ssr} in {year}; imports supplied {idr} of utilization.',
                     fr: 'Le TAS de l’Afrique était de {ssr} en {year} ; les importations ont fourni {idr} de l’utilisation.' },
    'hero.a2':     { en: 'Forecasts to 2050 with intervals, built from area, yield and UN population.',
                     fr: 'Prévisions à 2050 avec intervalles, construites à partir des superficies, des rendements et de la population ONU.' },
    'hero.a3':     { en: 'Five scenarios and a least-cost optimiser, every assumption on the page.',
                     fr: 'Cinq scénarios et un optimiseur de moindre coût, avec toutes les hypothèses affichées.' },

    /* -------------------------------------------------------- indicators */
    'ind.production':  { en: 'Rice production',        fr: 'Production de riz' },
    'ind.area':        { en: 'Rice harvested area',    fr: 'Superficie récoltée' },
    'ind.yield':       { en: 'Rice yield',             fr: 'Rendement rizicole' },
    'ind.imports':     { en: 'Rice imports',           fr: 'Importations de riz' },
    'ind.exports':     { en: 'Rice exports',           fr: 'Exportations de riz' },
    'ind.netTrade':    { en: 'Net rice trade',         fr: 'Solde commercial rizicole' },
    'ind.consumption': { en: 'Rice consumption (apparent utilization)',
                         fr: 'Consommation de riz (utilisation apparente)' },
    'ind.population':  { en: 'Population',             fr: 'Population' },
    'ind.ppc':         { en: 'Per capita production (PPC)',
                         fr: 'Production par habitant (PPH)' },
    'ind.cpc':         { en: 'Per capita consumption (CPC)',
                         fr: 'Consommation par habitant (CPH)' },
    'ind.ssr':         { en: 'Self-sufficiency ratio (SSR)',
                         fr: 'Taux d’autosuffisance (TAS)' },
    'ind.idr':         { en: 'Import dependency ratio (IDR)',
                         fr: 'Taux de dépendance aux importations (TDI)' },
    'ind.icr':         { en: 'Import coverage ratio (ICR)',
                         fr: 'Taux de couverture des importations (TCI)' },
    'ind.ntr':         { en: 'Net trade ratio (NTR)',  fr: 'Ratio commercial net (RCN)' },
    'ind.pcb':         { en: 'Production-consumption balance (PCB)',
                         fr: 'Solde production-consommation (SPC)' },
    'ind.pcg':         { en: 'Per capita production-consumption gap (PCG)',
                         fr: 'Écart production-consommation par habitant (EPC)' },
    'ind.ppcArea':     { en: 'Rice area per capita',   fr: 'Superficie rizicole par habitant' },
    'ind.importBill':  { en: 'Rice import bill',       fr: 'Facture d’importation de riz' },
    'ind.importUnitValue': { en: 'Rice import unit value',
                             fr: 'Valeur unitaire des importations' },
    'ind.importBillPerCapita': { en: 'Rice import bill per capita',
                                 fr: 'Facture d’importation par habitant' },
    'ind.tradeBalanceValue':   { en: 'Rice trade balance',
                                 fr: 'Balance commerciale rizicole' },
    /* The food-balance-sheet family. These appear on the country profile, which
     * was the least translated panel in the platform until they were added. */
    'ind.cpcFood':     { en: 'Per capita food consumption (FBS)',
                         fr: 'Consommation alimentaire par habitant (BA)' },
    'ind.foodUse':     { en: 'Rice used as food (FBS)',
                         fr: 'Riz utilisé pour l’alimentation (BA)' },
    'ind.ssrFood':     { en: 'Self-sufficiency vs food use (SSR-food)',
                         fr: 'Autosuffisance vs usage alimentaire (TAS-alim.)' },
    'ind.ssrFbs':      { en: 'Self-sufficiency, balance-sheet basis (CARD convention)',
                         fr: 'Autosuffisance, base bilan alimentaire (convention CARD)' },
    'ind.kcalRice':    { en: 'Calories from rice',     fr: 'Calories issues du riz' },

    /* --------------------------------------------- methodological notes
     * These appear on every panel, so leaving them in English left a quarter of
     * a "French" screen in English. {0} is the milling rate. */
    'note.basis.asPublished': {
      en: 'Basis: as published. Production is paddy (FAOSTAT item 27); trade is milled rice (item 31). The ratio is therefore not unit-consistent, and SSR is biased upward because paddy overstates the edible quantity. This reproduces Gassi, Gul & Cetin (2025) and the bulk of the FAOSTAT-based literature. Switch to the milled basis for a unit-consistent figure.',
      fr: 'Base : telle que publiée. La production est en paddy (FAOSTAT article 27) ; le commerce est en riz usiné (article 31). Le ratio n’est donc pas cohérent en unités, et le TAS est surestimé car le paddy surévalue la quantité comestible. Cela reproduit Gassi, Gul et Çetin (2025) et l’essentiel de la littérature fondée sur FAOSTAT. Passez à la base usinée pour un chiffre cohérent en unités.'
    },
    'note.basis.milled': {
      en: 'Basis: milled equivalent. Paddy production multiplied by a milling rate of {0} before the ratio is taken, so production and trade are on the same commodity. Unit-consistent; SSR is lower than the as-published figure.',
      fr: 'Base : équivalent usiné. La production de paddy est multipliée par un taux d’usinage de {0} avant le calcul du ratio, de sorte que production et commerce portent sur le même produit. Cohérent en unités ; le TAS est inférieur au chiffre tel que publié.'
    },
    'note.basis.paddy': {
      en: 'Basis: paddy equivalent. Milled trade divided by a milling rate of {0} so that trade is expressed at farm-gate weight. Unit-consistent.',
      fr: 'Base : équivalent paddy. Le commerce de riz usiné est divisé par un taux d’usinage de {0} afin d’exprimer les échanges au poids sortie-exploitation. Cohérent en unités.'
    },
    'note.trade.std': {
      en: 'Trade series: FAOSTAT item 30, "Rice, paddy (rice milled equivalent)" -- the standardized TOTAL rice trade aggregate, covering husked, milled and broken rice on a single basis. This is the series that measures rice trade.',
      fr: 'Série commerciale : FAOSTAT article 30, « Riz paddy (équivalent riz usiné) » — l’agrégat TOTAL normalisé du commerce du riz, couvrant le riz décortiqué, usiné et brisé sur une base unique. C’est la série qui mesure réellement le commerce du riz.'
    },
    'note.trade.milledOnly': {
      en: 'Trade series: FAOSTAT item 31, "Rice, milled" -- the series used by Gassi et al. (2025), selected here for replication. It EXCLUDES BROKEN RICE, which is the dominant imported form across much of West Africa, so rice imports are understated and self-sufficiency overstated -- for Senegal in 2024 by a factor of about thirty-six. Use item 30 for anything other than reproducing that paper.',
      fr: 'Série commerciale : FAOSTAT article 31, « Riz usiné » — la série utilisée par Gassi et al. (2025), retenue ici à des fins de réplication. Elle EXCLUT LE RIZ BRISÉ, forme importée dominante dans une grande partie de l’Afrique de l’Ouest ; les importations sont donc sous-estimées et l’autosuffisance surestimée — d’un facteur d’environ trente-six pour le Sénégal en 2024. Utilisez l’article 30 pour tout autre usage que la reproduction de cet article.'
    },
    'note.usda.basis': {
      en: 'USDA PSD reports production, trade, consumption and stocks all on a milled basis, so no conversion is needed for unit consistency. Years are MARKET years, not calendar years, and are not directly comparable to FAOSTAT calendar years.',
      fr: 'L’USDA PSD publie production, commerce, consommation et stocks sur une base usinée ; aucune conversion n’est nécessaire pour la cohérence des unités. Les années sont des campagnes COMMERCIALES, et non des années civiles : elles ne sont pas directement comparables aux années civiles de FAOSTAT.'
    },
    'note.usda.reported': {
      en: 'Consumption: USDA\'s own domestic consumption estimate, which incorporates stock change and is not a residual.',
      fr: 'Consommation : estimation propre de l’USDA de la consommation intérieure, qui intègre la variation des stocks et n’est pas un solde résiduel.'
    },
    'note.usda.derived': {
      en: 'Consumption: computed as P + M - X to match the FAO (2001) definition used on the FAOSTAT side. This ignores USDA\'s stock data and its own consumption estimate; it is chosen so the two databases are compared on one definition rather than two.',
      fr: 'Consommation : calculée comme P + M − X afin de correspondre à la définition FAO (2001) utilisée du côté FAOSTAT. Cela ignore les données de stocks de l’USDA et sa propre estimation de consommation ; ce choix permet de comparer les deux bases sur une seule définition plutôt que deux.'
    },
    'note.derivedZero': {
      en: 'This selection includes at least one country that grows no rice at all, for which FAOSTAT carries no production row rather than a row of zeros. Production has been taken as zero in years where rice imports are reported, so the country appears with a self-sufficiency ratio of 0% rather than as missing data. That zero is DERIVED, not observed.',
      fr: 'Cette sélection comprend au moins un pays qui ne cultive pas de riz, pour lequel FAOSTAT ne fournit aucune ligne de production plutôt qu’une ligne de zéros. La production est prise égale à zéro pour les années où des importations de riz sont déclarées, de sorte que le pays apparaît avec un taux d’autosuffisance de 0 % et non comme donnée manquante. Ce zéro est DÉDUIT, et non observé.'
    },

    /* ------------------------------------------- panel chrome and captions */
    'sub.map':       { en: 'any indicator, any year, under any scenario',
                       fr: 'tout indicateur, toute année, tout scénario' },
    'sub.compare':   { en: 'select any number of countries',
                       fr: 'sélectionnez autant de pays que vous le souhaitez' },
    'card.ranking':  { en: 'Ranking, most recent observed year',
                       fr: 'Classement, dernière année observée' },
    'fig.africaPvC': { en: 'Africa: production against apparent consumption',
                       fr: 'Afrique : production comparée à la consommation apparente' },
    'fig.acrossAfrica': { en: '{0} across Africa', fr: '{0} à travers l’Afrique' },
    'fig.mostRecent':   { en: '{0} — most recent observed year',
                          fr: '{0} — dernière année observée' },
    'ref.selfSufficiency': { en: 'self-sufficiency', fr: 'autosuffisance' },
    /* Screen-reader descriptions for charts. */
    'fig.desc.line':   { en: 'Line chart, {0} to {1}.',
                         fr: 'Graphique linéaire, de {0} à {1}.' },
    'fig.desc.bar':    { en: 'Bar chart of {0} items, from {1} at {2} to {3} at {4}',
                         fr: 'Diagramme en barres de {0} éléments, de {1} à {2} jusqu’à {3} à {4}' },
    'fig.desc.fromTo': { en: ' from {0} to {1}', fr: ' de {0} à {1}' },
    'fig.desc.noData': { en: ': no data', fr: ' : aucune donnée' },
    'note.composition': {
      en: 'Aggregate composition changes over the period: between {0} and {1} of the {2} selected countries report production in any given year ({3} in {4}, {5} in {6}). Part of any change in the aggregate is therefore a change in which countries are counted, not in how much rice was grown. Compare countries individually where this matters.',
      fr: 'La composition de l’agrégat évolue sur la période : entre {0} et {1} des {2} pays sélectionnés déclarent une production pour une année donnée ({3} en {4}, {5} en {6}). Une partie de toute variation de l’agrégat traduit donc un changement dans les pays comptabilisés, et non dans la quantité de riz produite. Comparez les pays individuellement lorsque cela importe.'
    },
    'sel.africa':    { en: 'Africa (all reporting countries)',
                       fr: 'Afrique (tous les pays déclarants)' },
    'kpi.apparentCons': { en: 'Apparent consumption', fr: 'Consommation apparente' },
    'fig.perCountry':   { en: 'most recent observed year per country',
                          fr: 'dernière année observée par pays' },
    'fig.tileMap':      { en: 'schematic tile map', fr: 'carte schématique en tuiles' },
    'tbl.rank':      { en: 'Rank',    fr: 'Rang' },
    'tbl.country':   { en: 'Country', fr: 'Pays' },
    'tbl.year':      { en: 'Year',    fr: 'Année' },

    /* ---------------------------------------------------- indicator groups */
    'cat.Production':    { en: 'Production',    fr: 'Production' },
    'cat.Land':          { en: 'Land',          fr: 'Terres' },
    'cat.Productivity':  { en: 'Productivity',  fr: 'Productivité' },
    'cat.Trade':         { en: 'Trade',         fr: 'Commerce' },
    'cat.Consumption':   { en: 'Consumption',   fr: 'Consommation' },
    'cat.Population':    { en: 'Population',    fr: 'Population' },
    'cat.Food security': { en: 'Food security', fr: 'Sécurité alimentaire' },
    'cat.Economy':       { en: 'Economy',       fr: 'Économie' },

    /* --------------------------------------------------------- country names
     * French exonyms as used by the UN and the OIF. Countries whose French name
     * is identical to the English one are listed anyway, so that coverage is a
     * complete statement rather than a silent fallback. */
    'country.Algeria': { en: 'Algeria', fr: 'Algérie' },
    'country.Angola': { en: 'Angola', fr: 'Angola' },
    'country.Benin': { en: 'Benin', fr: 'Bénin' },
    'country.Botswana': { en: 'Botswana', fr: 'Botswana' },
    'country.Burkina Faso': { en: 'Burkina Faso', fr: 'Burkina Faso' },
    'country.Burundi': { en: 'Burundi', fr: 'Burundi' },
    'country.Cabo Verde': { en: 'Cabo Verde', fr: 'Cabo Verde' },
    'country.Cameroon': { en: 'Cameroon', fr: 'Cameroun' },
    'country.Central African Republic': { en: 'Central African Republic',
                                          fr: 'République centrafricaine' },
    'country.Chad': { en: 'Chad', fr: 'Tchad' },
    'country.Comoros': { en: 'Comoros', fr: 'Comores' },
    'country.Congo': { en: 'Congo', fr: 'Congo' },
    /* The registry stores plain-ASCII names because the source tables key on
     * them, so the KEY must be the ASCII form. Both display names carry the
     * proper diacritics -- "Cote d'Ivoire" is a mojibake artefact, not a name. */
    'country.Cote d\'Ivoire': { en: 'Côte d’Ivoire', fr: 'Côte d’Ivoire' },
    'country.Reunion': { en: 'Réunion', fr: 'La Réunion' },
    'country.Democratic Republic of the Congo': { en: 'Democratic Republic of the Congo',
                                                  fr: 'République démocratique du Congo' },
    'country.Djibouti': { en: 'Djibouti', fr: 'Djibouti' },
    'country.Egypt': { en: 'Egypt', fr: 'Égypte' },
    'country.Equatorial Guinea': { en: 'Equatorial Guinea', fr: 'Guinée équatoriale' },
    'country.Eritrea': { en: 'Eritrea', fr: 'Érythrée' },
    'country.Eswatini': { en: 'Eswatini', fr: 'Eswatini' },
    'country.Ethiopia': { en: 'Ethiopia', fr: 'Éthiopie' },
    'country.Gabon': { en: 'Gabon', fr: 'Gabon' },
    'country.Gambia': { en: 'Gambia', fr: 'Gambie' },
    'country.Ghana': { en: 'Ghana', fr: 'Ghana' },
    'country.Guinea': { en: 'Guinea', fr: 'Guinée' },
    'country.Guinea-Bissau': { en: 'Guinea-Bissau', fr: 'Guinée-Bissau' },
    'country.Kenya': { en: 'Kenya', fr: 'Kenya' },
    'country.Lesotho': { en: 'Lesotho', fr: 'Lesotho' },
    'country.Liberia': { en: 'Liberia', fr: 'Libéria' },
    'country.Libya': { en: 'Libya', fr: 'Libye' },
    'country.Madagascar': { en: 'Madagascar', fr: 'Madagascar' },
    'country.Malawi': { en: 'Malawi', fr: 'Malawi' },
    'country.Mali': { en: 'Mali', fr: 'Mali' },
    'country.Mauritania': { en: 'Mauritania', fr: 'Mauritanie' },
    'country.Mauritius': { en: 'Mauritius', fr: 'Maurice' },
    'country.Morocco': { en: 'Morocco', fr: 'Maroc' },
    'country.Mozambique': { en: 'Mozambique', fr: 'Mozambique' },
    'country.Namibia': { en: 'Namibia', fr: 'Namibie' },
    'country.Niger': { en: 'Niger', fr: 'Niger' },
    'country.Nigeria': { en: 'Nigeria', fr: 'Nigéria' },
    'country.Rwanda': { en: 'Rwanda', fr: 'Rwanda' },
    'country.Sao Tome and Principe': { en: 'Sao Tome and Principe',
                                       fr: 'Sao Tomé-et-Principe' },
    'country.Senegal': { en: 'Senegal', fr: 'Sénégal' },
    'country.Seychelles': { en: 'Seychelles', fr: 'Seychelles' },
    'country.Sierra Leone': { en: 'Sierra Leone', fr: 'Sierra Leone' },
    'country.Somalia': { en: 'Somalia', fr: 'Somalie' },
    'country.South Africa': { en: 'South Africa', fr: 'Afrique du Sud' },
    'country.South Sudan': { en: 'South Sudan', fr: 'Soudan du Sud' },
    'country.Sudan': { en: 'Sudan', fr: 'Soudan' },
    'country.Togo': { en: 'Togo', fr: 'Togo' },
    'country.Tunisia': { en: 'Tunisia', fr: 'Tunisie' },
    'country.Uganda': { en: 'Uganda', fr: 'Ouganda' },
    'country.United Republic of Tanzania': { en: 'United Republic of Tanzania',
                                             fr: 'République-Unie de Tanzanie' },
    'country.Zambia': { en: 'Zambia', fr: 'Zambie' },
    'country.Zimbabwe': { en: 'Zimbabwe', fr: 'Zimbabwe' },

    /* ------------------------------------------------------------- units */
    'unit.t':          { en: 't',           fr: 't' },
    'unit.ha':         { en: 'ha',          fr: 'ha' },
    'unit.kgha':       { en: 'kg/ha',       fr: 'kg/ha' },
    'unit.kgcap':      { en: 'kg/capita',   fr: 'kg/habitant' },
    'unit.pct':        { en: '%',           fr: '%' },
    'unit.persons':    { en: 'persons',     fr: 'personnes' },
    'unit.usd':        { en: '1000 USD',    fr: '1000 USD' },
    'unit.usdt':       { en: 'USD/t',       fr: 'USD/t' },

    /* ------------------------------------------------- evidential status */
    'kind.observed':   { en: 'observed',            fr: 'observé' },
    'kind.forecast':   { en: 'model forecast',      fr: 'prévision du modèle' },
    'kind.scenario':   { en: 'scenario simulation', fr: 'simulation de scénario' },
    'kind.assumption': { en: 'assumption',          fr: 'hypothèse' },
    'legend.observed': { en: 'observed data',       fr: 'données observées' },
    'legend.forecast': { en: 'model forecast',      fr: 'prévision du modèle' },
    'legend.scenario': { en: 'scenario simulation', fr: 'simulation de scénario' },

    /* ---------------------------------------------------------- sections */
    'sec.africaAggregate': { en: 'Africa in aggregate', fr: 'Afrique agrégée' },
    'sec.map':          { en: 'The Africa map',      fr: 'La carte de l’Afrique' },
    'sec.mapHint':      { en: 'click a country to open its profile',
                          fr: 'cliquez sur un pays pour ouvrir son profil' },
    'sec.rankings':     { en: 'Rankings',            fr: 'Classements' },
    'map.coverage':     { en: '{n} of {total} countries with data',
                          fr: '{n} pays sur {total} avec données' },
    'sec.trends':       { en: 'Trends',              fr: 'Tendances' },
    'sec.diagnosis':    { en: 'Diagnosis',           fr: 'Diagnostic' },
    'sec.fullSeries':   { en: 'Full series',         fr: 'Séries complètes' },
    'sec.compare':      { en: 'Compare countries',   fr: 'Comparer les pays' },
    'sec.countries':    { en: 'Countries',           fr: 'Pays' },
    'sec.provenance':   { en: 'Data sources and provenance',
                          fr: 'Sources et traçabilité des données' },
    'sec.quality':      { en: 'Data quality by country',
                          fr: 'Qualité des données par pays' },
    'sec.methodology':  { en: 'Methodology',         fr: 'Méthodologie' },
    'sec.policyLevers': { en: 'Policy levers',       fr: 'Leviers de politique' },
    'sec.simModel':     { en: 'Simulation model',    fr: 'Modèle de simulation' },
    'sec.baseline':     { en: 'Baseline projection', fr: 'Projection de référence' },
    'sec.comparison':   { en: 'Scenario comparison', fr: 'Comparaison des scénarios' },
    'sec.policyScore':  { en: 'Policy score',        fr: 'Score des politiques' },
    'sec.leastCost':    { en: 'Least-cost path to self-sufficiency',
                          fr: 'Trajectoire de moindre coût vers l’autosuffisance' },
    'sec.allHorizons':  { en: 'All scenarios at all horizons',
                          fr: 'Tous les scénarios à tous les horizons' },

    /* ------------------------------------------------------------ labels */
    'lbl.year':         { en: 'Year',          fr: 'Année' },
    'lbl.country':      { en: 'Country',       fr: 'Pays' },
    'lbl.rank':         { en: 'Rank',          fr: 'Rang' },
    'lbl.unit':         { en: 'Unit',          fr: 'Unité' },
    'lbl.first':        { en: 'First',         fr: 'Première' },
    'lbl.last':         { en: 'Last',          fr: 'Dernière' },
    'lbl.change':       { en: 'Change',        fr: 'Variation' },
    'lbl.cagr':         { en: 'CAGR',          fr: 'TCAM' },
    'lbl.min':          { en: 'Min',           fr: 'Min' },
    'lbl.max':          { en: 'Max',           fr: 'Max' },
    'lbl.observations': { en: 'Obs.',          fr: 'Obs.' },
    'lbl.scenario':     { en: 'Scenario',      fr: 'Scénario' },
    'lbl.phaseIn':      { en: 'Phase-in',      fr: 'Montée en charge' },
    'lbl.vsBaseline':   { en: 'vs baseline',   fr: 'vs référence' },
    'lbl.production':   { en: 'Production',    fr: 'Production' },
    'lbl.consumption':  { en: 'Consumption',   fr: 'Consommation' },
    'lbl.imports':      { en: 'Imports',       fr: 'Importations' },
    'lbl.importSaving': { en: 'Import saving', fr: 'Économie d’importation' },
    'lbl.selfSufficient': { en: 'Self-sufficient', fr: 'Autosuffisant' },
    'lbl.cost':         { en: 'Cost',          fr: 'Coût' },
    'lbl.feasibility':  { en: 'Feasibility',   fr: 'Faisabilité' },
    'lbl.score':        { en: 'Score',         fr: 'Score' },
    'lbl.yes':          { en: 'yes',           fr: 'oui' },
    'lbl.no':           { en: 'no',            fr: 'non' },
    'lbl.population':   { en: 'Population',    fr: 'Population' },
    'lbl.download':     { en: 'Download',      fr: 'Télécharger' },
    'lbl.downloadCsv':  { en: 'Download CSV',  fr: 'Télécharger CSV' },
    'lbl.generate':     { en: 'Generate report', fr: 'Générer le rapport' },
    'lbl.ask':          { en: 'Ask',           fr: 'Demander' },
    'lbl.play':         { en: 'Play',          fr: 'Lecture' },
    'lbl.pause':        { en: 'Pause',         fr: 'Pause' },
    'lbl.loading':      { en: 'Loading…', fr: 'Chargement…' },
    'lbl.computing':    { en: 'Computing…', fr: 'Calcul en cours…' },
    'lbl.fitting':      { en: 'Fitting models…', fr: 'Estimation des modèles…' },
    'lbl.buildingBaseline': { en: 'Building baseline…',
                              fr: 'Construction de la référence…' },
    'lbl.buildingProjections': { en: 'Building country projections…',
                                 fr: 'Construction des projections par pays…' },
    'lbl.noData':       { en: 'no data',       fr: 'aucune donnée' },

    /* --------------------------------------------- feasibility judgements */
    'feas.plausible':   { en: 'plausible',    fr: 'plausible' },
    'feas.demanding':   { en: 'demanding',    fr: 'exigeant' },
    'feas.strained':    { en: 'strained',     fr: 'tendu' },
    'feas.implausible': { en: 'implausible',  fr: 'implausible' },

    /* ---------------------------------------------- the scientific caveats
     * Translated in full: these are the sentences that stop a number being
     * misread, and shipping them only in English would defeat their purpose. */
    'warn.simulation':  { en: 'Everything below is a SIMULATION under stated assumptions. It is not a prediction and not causal evidence about what a policy would achieve. Every parameter is shown and editable.',
                          fr: 'Tout ce qui suit est une SIMULATION sous hypothèses explicites. Ce n’est ni une prédiction, ni une preuve causale de ce qu’une politique produirait. Chaque paramètre est affiché et modifiable.' },
    'warn.notPrediction': { en: 'A projection of current trends under no policy change. It is not a prediction of what will happen, and its uncertainty widens sharply with horizon.',
                            fr: 'Une projection des tendances actuelles sans changement de politique. Ce n’est pas une prédiction de ce qui arrivera, et son incertitude s’élargit fortement avec l’horizon.' },
    'warn.intervals':   { en: 'Prediction intervals reflect innovation uncertainty only. They exclude parameter uncertainty, model-selection uncertainty and the possibility of structural change, so realised coverage over long horizons is lower than the nominal level.',
                          fr: 'Les intervalles de prévision ne reflètent que l’incertitude des innovations. Ils excluent l’incertitude sur les paramètres, sur le choix du modèle et la possibilité d’un changement structurel : la couverture réelle sur longue période est donc inférieure au niveau nominal.' },
    'warn.ssrNotSecurity': { en: 'Self-sufficiency is not the same thing as food security. A country can be fully self-sufficient and still have households unable to afford rice, and a low-SSR country with reliable export earnings and functioning markets may be entirely food-secure. SSR measures the source of supply, not access to it (Clapp 2017).',
                             fr: 'L’autosuffisance n’est pas la sécurité alimentaire. Un pays peut être pleinement autosuffisant et compter des ménages incapables d’acheter du riz ; un pays à faible TAS disposant de recettes d’exportation fiables et de marchés fonctionnels peut être parfaitement sûr sur le plan alimentaire. Le TAS mesure l’origine de l’approvisionnement, pas l’accès à celui-ci (Clapp, 2017).' },
    'warn.idrOver100':  { en: 'IDR above 100% means recorded imports exceed domestic utilization, which happens when a country re-exports a large share of what it imports. It is a property of the FAO definition, not a data error.',
                          fr: 'Un TDI supérieur à 100 % signifie que les importations enregistrées dépassent l’utilisation intérieure, ce qui survient lorsqu’un pays réexporte une large part de ses importations. C’est une propriété de la définition FAO, non une erreur de données.' },
    'warn.currentPrices': { en: 'All values are in current US dollars and are not deflated, so part of any upward trend is world price inflation rather than rising volume.',
                            fr: 'Toutes les valeurs sont en dollars courants et ne sont pas déflatées : une partie de toute tendance à la hausse reflète l’inflation des prix mondiaux plutôt qu’une hausse des volumes.' },
    'warn.costsPlaceholder': { en: 'The cost parameters are placeholders, not national costings. The least-cost package shown is the cheapest under THOSE numbers; substitute real costs before drawing any policy conclusion from the ranking.',
                               fr: 'Les paramètres de coût sont indicatifs et ne constituent pas un chiffrage national. Le paquet de moindre coût présenté est le moins cher SOUS CES chiffres ; substituez des coûts réels avant toute conclusion de politique publique.' },
    'warn.brokenRice':  { en: 'FAOSTAT item 31 "Rice, milled" excludes broken rice, the dominant imported form across much of West Africa. Using it understates rice imports and overstates self-sufficiency — for Senegal in 2024 by a factor of about thirty-six.',
                          fr: 'Le produit FAOSTAT 31 « Riz usiné » exclut les brisures, forme importée dominante dans une grande partie de l’Afrique de l’Ouest. L’utiliser sous-estime les importations de riz et surestime l’autosuffisance — pour le Sénégal en 2024, d’un facteur d’environ trente-six.' },
    'warn.apparentNotIntake': { en: 'Apparent utilization (P + M − X) is not measured intake. It absorbs stock building and drawdown, seed, feed, industrial use and waste, and it inherits every error in production and trade.',
                                fr: 'L’utilisation apparente (P + M − X) n’est pas la consommation mesurée. Elle absorbe les variations de stocks, les semences, l’alimentation animale, les usages industriels et les pertes, et hérite de toutes les erreurs de production et de commerce.' },
    'warn.schematicMap': { en: 'schematic tile map; tiles are equal-sized and are not geographic areas',
                           fr: 'carte schématique en tuiles ; les tuiles sont de taille égale et ne représentent pas des superficies' },
    'warn.trendsMode':  { en: 'Target is set to "Trends", so projections are not shown. Everything below is OBSERVED data — no model, no projection, no scenario. Choose a target year (2030–2050) to turn projections back on.',
                          fr: 'L’horizon est réglé sur « Tendances » : aucune projection n’est affichée. Tout ce qui suit correspond à des données OBSERVÉES — sans modèle, sans projection, sans scénario. Choisissez une année cible (2030–2050) pour réactiver les projections.' },
    'warn.neverMerged': { en: 'The two sources are never merged or averaged. Where they disagree, the disagreement is itself the finding.',
                          fr: 'Les deux sources ne sont jamais fusionnées ni moyennées. Lorsqu’elles divergent, la divergence est elle-même le résultat.' },

    /* --------------------------------------------------------- copilot */
    'copilot.title':  { en: 'Rice Policy Copilot', fr: 'Copilote de politique rizicole' },
    'copilot.lede':   { en: 'answers computed from the platform’s own calculations',
                        fr: 'réponses calculées à partir des propres calculs de la plateforme' },
    'copilot.intro':  { en: 'This assistant is rule-based. Every answer is assembled from values the platform has actually computed, and every answer carries an evidence trace naming the database, selection, indicators, equations and assumptions used. It does not generate prose of its own and it will say so rather than guess.',
                        fr: 'Cet assistant fonctionne par règles. Chaque réponse est construite à partir de valeurs réellement calculées par la plateforme et s’accompagne d’une traçabilité indiquant la base de données, la sélection, les indicateurs, les équations et les hypothèses utilisés. Il ne produit pas de texte de son propre chef et préfère le dire plutôt que de deviner.' },
    'copilot.evidence': { en: 'Evidence trace', fr: 'Traçabilité des preuves' },
    'copilot.placeholder': { en: 'e.g. Why is Nigeria unlikely to reach self-sufficiency by 2035?',
                             fr: 'ex. Pourquoi le Nigeria a-t-il peu de chances d’atteindre l’autosuffisance d’ici 2035 ?' },

    /* ---------------------------------------------------------- report */
    'report.title':   { en: 'Automatic scientific report', fr: 'Rapport scientifique automatique' },
    'report.lede':    { en: 'The report assembles the full analysis: sources, methodology with every equation, historical trends, self-sufficiency, the rice economy, forecasts, policy scenarios, the least-cost path, recommendations, risks and a reproducibility manifest.',
                        fr: 'Le rapport rassemble l’analyse complète : sources, méthodologie avec toutes les équations, tendances historiques, autosuffisance, économie rizicole, prévisions, scénarios de politique, trajectoire de moindre coût, recommandations, risques et manifeste de reproductibilité.' },

    /* ------------------------------------------- self-sufficiency condition */
    'tab.condition':  { en: 'Self-sufficiency condition', fr: 'Condition d’autosuffisance' },
    'cond.title':     { en: 'Self-Sufficiency Condition', fr: 'Condition d’autosuffisance' },
    'cond.lede':      { en: 'what would have to be true, for every country and region, at 2030, 2035, 2045 and 2050',
                        fr: 'ce qui devrait être vrai, pour chaque pays et région, en 2030, 2035, 2045 et 2050' },
    'cond.method':    { en: 'Self-sufficiency means A × Y ≥ cpc × N — projected production covering projected utilization. Because production is area times yield, that is not one requirement but a FRONTIER: any combination on or above the curve satisfies it. Four routes to that frontier are reported — yield only, area only, improved varieties only, and the least-cost mix — each tested against its own ceiling, with the binding constraint named where a route fails.',
                        fr: 'L’autosuffisance signifie A × Y ≥ cpc × N — la production projetée couvrant l’utilisation projetée. La production étant le produit de la superficie et du rendement, il ne s’agit pas d’une exigence unique mais d’une FRONTIÈRE : toute combinaison située sur ou au-dessus de la courbe la satisfait. Quatre voies vers cette frontière sont présentées — rendement seul, superficie seule, variétés améliorées seules, et la combinaison de moindre coût — chacune testée contre son propre plafond, la contrainte limitante étant nommée lorsqu’une voie échoue.' },
    'cond.ceilings':  { en: 'Feasibility ceilings', fr: 'Plafonds de faisabilité' },
    'cond.maxYield':  { en: 'Max yield (× current)', fr: 'Rendement max (× actuel)' },
    'cond.maxArea':   { en: 'Max area (× current)', fr: 'Superficie max (× actuelle)' },
    'cond.maxAdopt':  { en: 'Max adoption', fr: 'Adoption max' },
    'cond.ceilingNote': { en: 'These are ASSUMPTIONS, not measurements. A route reported as infeasible is infeasible under these bounds — change a bound and the verdict changes. Every verdict names the ceiling it was tested against.',
                          fr: 'Ce sont des HYPOTHÈSES, non des mesures. Une voie déclarée infaisable l’est sous ces bornes — modifiez une borne et le verdict change. Chaque verdict indique le plafond retenu.' },
    'cond.computing': { en: 'Evaluating every country at every horizon…',
                        fr: 'Évaluation de chaque pays à chaque horizon…' },
    'cond.progress':  { en: 'Evaluating {done} of {total} — {name}',
                        fr: 'Évaluation de {done} sur {total} — {name}' },
    'cond.detail':    { en: 'Detail', fr: 'Détail' },
    'cond.selection': { en: 'Selection', fr: 'Sélection' },
    'cond.crossing':  { en: 'Baseline reaches 100% in', fr: 'La référence atteint 100 % en' },
    'cond.never':     { en: 'never within the horizon', fr: 'jamais dans l’horizon' },
    'cond.baselineSSR': { en: 'Baseline SSR', fr: 'TAS de référence' },
    'cond.gap':       { en: 'Production gap', fr: 'Déficit de production' },
    'cond.multiplier':{ en: 'Production must rise by', fr: 'La production doit croître de' },
    'cond.route':     { en: 'Route', fr: 'Voie' },
    'cond.requirement': { en: 'Requirement', fr: 'Exigence' },
    'cond.ceiling':   { en: 'Ceiling', fr: 'Plafond' },
    'cond.feasible':  { en: 'Feasible', fr: 'Faisable' },
    'cond.binding':   { en: 'Binding constraint', fr: 'Contrainte limitante' },
    'cond.best':      { en: 'Best route', fr: 'Meilleure voie' },
    'cond.none':      { en: 'none', fr: 'aucune' },
    'cond.alreadyMet':{ en: 'condition already met', fr: 'condition déjà remplie' },
    'cond.regions':   { en: 'Regions and blocs', fr: 'Régions et blocs' },
    'cond.countries': { en: 'Countries', fr: 'Pays' },
    'cond.matrixNote':{ en: 'Each cell is the best route available at that horizon. Hover a cell for the requirement. "Already met" means the baseline projection alone reaches 100%; "not reachable" means no route reaches it within the ceilings above.',
                        fr: 'Chaque cellule indique la meilleure voie disponible à cet horizon. Survolez une cellule pour l’exigence. « Déjà remplie » signifie que la projection de référence atteint seule 100 % ; « non atteignable » signifie qu’aucune voie n’y parvient dans les plafonds ci-dessus.' },
    'cond.summary':   { en: 'How many countries could reach self-sufficiency',
                        fr: 'Combien de pays pourraient atteindre l’autosuffisance' },
    'cond.summaryChart': { en: 'Countries where self-sufficiency is reachable',
                           fr: 'Pays où l’autosuffisance est atteignable' },
    'cond.summarySub':{ en: 'within the stated ceilings, including those already self-sufficient',
                        fr: 'dans les plafonds indiqués, y compris les pays déjà autosuffisants' },
    'cond.cMet':      { en: 'Already met', fr: 'Déjà remplie' },
    'cond.cMix':      { en: 'Least-cost mix', fr: 'Combinaison' },
    'cond.cSingle':   { en: 'Single route only', fr: 'Voie unique' },
    'cond.cNone':     { en: 'Not reachable', fr: 'Non atteignable' },
    'cond.cNa':       { en: 'No model', fr: 'Sans modèle' },
    'cond.unreliable':{ en: 'The baseline projection for this selection was flagged as unreliable. Every requirement below inherits that.',
                        fr: 'La projection de référence pour cette sélection a été signalée comme peu fiable. Toutes les exigences ci-dessous en héritent.' },
    'cond.report':    { en: 'Report', fr: 'Rapport' },
    'cond.reportLede':{ en: 'Assembles the condition, the four routes, regional and country matrices, detail for the current selection, limitations and references.',
                        fr: 'Rassemble la condition, les quatre voies, les matrices régionales et par pays, le détail de la sélection, les limites et les références.' },
    'cond.buildReport': { en: 'Generate report', fr: 'Générer le rapport' },

    /* --------------------------------------------------- crisis and policy */
    'tab.crisis':     { en: 'Crisis & policy', fr: 'Crises et politiques' },
    'crisis.title':   { en: 'Crisis and Policy', fr: 'Crises et politiques' },
    'crisis.event':   { en: 'Crisis', fr: 'Crise' },
    'crisis.allEvents': { en: 'All crises', fr: 'Toutes les crises' },
    'crisis.method':  { en: 'This is an INTERRUPTED TIME-SERIES analysis, not causal identification. For each crisis a model is fitted to pre-crisis data only and projected across the window; the deviation of the actual from that projection is the estimated shock, reported against the projection’s own 95% interval. A movement that stays inside that interval is NOT evidence of a crisis effect. The crises overlap with each other and with unrelated shocks, the data are annual, and there is no unexposed control group.',
                        fr: 'Il s’agit d’une analyse de SÉRIES TEMPORELLES INTERROMPUES, non d’une identification causale. Pour chaque crise, un modèle est estimé uniquement sur les données antérieures puis projeté sur la fenêtre ; l’écart entre l’observé et cette projection constitue le choc estimé, rapporté à l’intervalle à 95 % de la projection. Un mouvement restant à l’intérieur de cet intervalle ne constitue PAS une preuve d’effet de crise. Les crises se chevauchent entre elles et avec d’autres chocs, les données sont annuelles et il n’existe aucun groupe témoin non exposé.' },
    'crisis.window':  { en: 'Crisis window', fr: 'Fenêtre de crise' },
    'crisis.preWindow': { en: 'Pre-crisis window', fr: 'Fenêtre pré-crise' },
    'crisis.postWindow': { en: 'Post-crisis window', fr: 'Fenêtre post-crise' },
    'crisis.tblWindows': { en: 'Indicator levels before, during and after',
                           fr: 'Niveaux des indicateurs avant, pendant et après' },
    'crisis.before':  { en: 'Before', fr: 'Avant' },
    'crisis.during':  { en: 'During', fr: 'Pendant' },
    'crisis.after':   { en: 'After', fr: 'Après' },
    'crisis.changePct': { en: 'Change', fr: 'Variation' },
    'crisis.peakYear': { en: 'Peak in window', fr: 'Pic dans la fenêtre' },
    'crisis.counterfactual': { en: 'Counterfactual', fr: 'Contrefactuel' },
    'crisis.counterfactualShort': { en: 'Counterfactual (no crisis)', fr: 'Contrefactuel (sans crise)' },
    'crisis.cfUnavailable': { en: 'A counterfactual could not be built:',
                              fr: 'Impossible de construire un contrefactuel :' },
    'crisis.fitted':  { en: 'fitted', fr: 'estimé sur' },
    'crisis.actual':  { en: 'Actual', fr: 'Observé' },
    'crisis.expected': { en: 'Expected without crisis', fr: 'Attendu sans crise' },
    'crisis.lower':   { en: 'lower', fr: 'inf.' },
    'crisis.upper':   { en: 'upper', fr: 'sup.' },
    'crisis.deviation': { en: 'Deviation', fr: 'Écart' },
    'crisis.beyondNormal': { en: 'Beyond normal variation', fr: 'Au-delà de la variation normale' },
    'crisis.chow':    { en: 'Chow test for a structural break',
                        fr: 'Test de Chow pour rupture structurelle' },
    'crisis.nPre':    { en: 'n before', fr: 'n avant' },
    'crisis.nPost':   { en: 'n after', fr: 'n après' },
    'crisis.conclusion': { en: 'Conclusion', fr: 'Conclusion' },
    'crisis.significant': { en: 'Significant at 5%', fr: 'Significatif à 5 %' },
    'crisis.interpretation': { en: 'Interpretation', fr: 'Interprétation' },
    'crisis.evidence': { en: 'evidence', fr: 'preuves' },
    'crisis.expected2': { en: 'What to expect', fr: 'Ce à quoi s’attendre' },
    'crisis.expected': { en: 'What theory predicts for this crisis:',
                         fr: 'Ce que la théorie prédit pour cette crise :' },
    'crisis.confounders': { en: 'Confounded with:', fr: 'Confondu avec :' },
    'crisis.chartSub': { en: 'solid = observed; dashed = projection from pre-crisis data with 95% interval',
                         fr: 'continu = observé ; pointillé = projection à partir des données pré-crise, intervalle à 95 %' },
    'crisis.crossCountry': { en: 'Which countries were most affected',
                             fr: 'Quels pays ont été les plus touchés' },
    'crisis.crossSub': { en: 'change from pre-crisis mean; red = beyond that country’s own normal variation',
                         fr: 'variation par rapport à la moyenne pré-crise ; rouge = au-delà de la variation normale du pays' },
    'crisis.crossNote': { en: 'Countries shown in grey moved, but not beyond what their own pre-crisis model would have projected. Ranking countries by raw change alone would place them alongside genuinely affected ones.',
                          fr: 'Les pays en gris ont bougé, mais pas au-delà de ce que leur propre modèle pré-crise aurait projeté. Un classement fondé sur la seule variation brute les placerait à tort aux côtés des pays réellement touchés.' },
    'crisis.recommendations': { en: 'Policy recommendations', fr: 'Recommandations de politique' },
    'crisis.addresses': { en: 'addresses', fr: 'répond à' },
    'crisis.recCaveat': { en: 'These are RESILIENCE measures — about surviving a shock that has already happened — and are deliberately different from the structural recommendations in the policy simulator, which are about raising production over decades. A country needs both, and the two compete for the same budget.',
                          fr: 'Ce sont des mesures de RÉSILIENCE — destinées à surmonter un choc déjà survenu — délibérément distinctes des recommandations structurelles du simulateur, qui visent à accroître la production sur des décennies. Un pays a besoin des deux, et elles se disputent le même budget.' },
    'crisis.report':  { en: 'Crisis report', fr: 'Rapport de crise' },
    'crisis.reportLede': { en: 'Assembles the full crisis analysis into a document: method, event windows, counterfactuals, structural break tests, interpretation, policy recommendations and limitations.',
                           fr: 'Rassemble l’analyse complète des crises en un document : méthode, fenêtres d’événement, contrefactuels, tests de rupture structurelle, interprétation, recommandations et limites.' },
    'crisis.buildReport': { en: 'Generate crisis report', fr: 'Générer le rapport de crise' },
    'crisis.repSummary': { en: 'Executive summary', fr: 'Résumé' },
    'crisis.repSummaryText': { en: 'This report examines {n} dated external shock(s) and how rice indicators for {sel} moved around them.',
                               fr: 'Ce rapport examine {n} choc(s) externe(s) daté(s) et l’évolution des indicateurs rizicoles de {sel} autour de ces événements.' },
    'crisis.repOverview': { en: 'Overview of crises examined', fr: 'Aperçu des crises examinées' },
    'crisis.repEffects': { en: 'Reportable effects', fr: 'Effets rapportables' },
    'crisis.repMethod': { en: 'Three things are computed for each crisis: event-window means before, during and after; a counterfactual from a model fitted to pre-crisis data only, with the deviation reported against its 95% prediction interval; and a Chow test for a structural break at the crisis date. The counterfactual is the load-bearing part — a movement inside the interval is not evidence of an effect.',
                          fr: 'Trois éléments sont calculés pour chaque crise : les moyennes avant, pendant et après ; un contrefactuel issu d’un modèle estimé uniquement sur les données pré-crise, l’écart étant rapporté à son intervalle de prévision à 95 % ; et un test de Chow de rupture structurelle à la date de la crise. Le contrefactuel est l’élément déterminant — un mouvement à l’intérieur de l’intervalle ne prouve pas un effet.' },
    'crisis.repLimits': { en: 'Limitations', fr: 'Limites' },
    'crisis.repManifest': { en: 'Reproducibility', fr: 'Reproductibilité' },
    'crisis.lim1': { en: 'This is association around dated windows, not causal identification. No crisis effect reported here is established as causal.',
                     fr: 'Il s’agit d’associations autour de fenêtres datées, non d’une identification causale. Aucun effet rapporté ici n’est établi comme causal.' },
    'crisis.lim2': { en: 'The crises overlap. The Russia–Ukraine window contains India’s 2023 export ban entirely; 2008 coincides with the global financial crisis; COVID-19 coincides with the East African locust upsurge.',
                     fr: 'Les crises se chevauchent. La fenêtre Russie-Ukraine contient entièrement l’interdiction indienne de 2023 ; 2008 coïncide avec la crise financière mondiale ; la COVID-19 coïncide avec l’invasion de criquets en Afrique de l’Est.' },
    'crisis.lim3': { en: 'The data are annual. The 2008 rice price spike ran from January to May and had largely unwound by December, so an annual average understates it.',
                     fr: 'Les données sont annuelles. La flambée des prix du riz de 2008 s’est déroulée de janvier à mai et s’était largement résorbée en décembre : une moyenne annuelle la sous-estime.' },
    'crisis.lim4': { en: 'There is no control group. Every African country was exposed to every crisis examined, so nothing here is a difference-in-differences.',
                     fr: 'Il n’existe pas de groupe témoin. Tous les pays africains ont été exposés à toutes les crises examinées : rien ici ne constitue une double différence.' },
    'crisis.lim5': { en: 'A self-sufficiency ratio can improve during a crisis for the wrong reason: if imports are cut off, the ratio rises while people eat less.',
                     fr: 'Un taux d’autosuffisance peut s’améliorer pendant une crise pour de mauvaises raisons : si les importations sont coupées, le ratio augmente tandis que la population mange moins.' },

    /* ----------------------------------------------------------- data used */
    'tab.datused':    { en: 'Data used', fr: 'Données utilisées' },
    'data.title':     { en: 'Data Used', fr: 'Données utilisées' },
    'data.lede':      { en: 'every variable, its source, unit and coverage — plus every equation',
                        fr: 'chaque variable, sa source, son unité et sa couverture — et chaque équation' },
    'data.item':      { en: 'Item', fr: 'Produit' },
    'data.coverage':  { en: 'Countries', fr: 'Pays' },
    'data.variables': { en: 'Variables', fr: 'Variables' },
    'data.basis':     { en: 'Basis', fr: 'Base' },
    'data.element':   { en: 'Element code', fr: 'Code élément' },
    'data.variable':  { en: 'Variable', fr: 'Variable' },
    'data.symbol':    { en: 'Symbol', fr: 'Symbole' },
    'data.note':      { en: 'Note', fr: 'Note' },
    'data.notCovered':{ en: 'Not covered', fr: 'Non couverts' },
    'data.bulk':      { en: 'Bulk file', fr: 'Fichier brut' },
    'data.portal':    { en: 'Portal', fr: 'Portail' },
    'data.derived':   { en: 'Derived series', fr: 'Séries dérivées' },
    'data.derivedNote': { en: 'Computed by the platform, not read from any source. A reader tracing a number needs to know which is which.',
                          fr: 'Calculées par la plateforme, non lues d’une source. Un lecteur qui remonte à un chiffre doit savoir de quoi il s’agit.' },
    'data.derivation':{ en: 'Derivation', fr: 'Dérivation' },
    'data.equations': { en: 'Equations and models', fr: 'Équations et modèles' },
    'data.interp':    { en: 'Interpretation', fr: 'Interprétation' },
    'data.limits':    { en: 'Limitations', fr: 'Limites' },
    'data.source':    { en: 'Source', fr: 'Source' },
    'data.references':{ en: 'References', fr: 'Références' },
    'data.dlDict':    { en: 'Download data dictionary (CSV)', fr: 'Télécharger le dictionnaire (CSV)' },
    'data.dlEq':      { en: 'Download equations (CSV)', fr: 'Télécharger les équations (CSV)' },
    'data.dlAll':     { en: 'Download ALL series (CSV, long format)',
                        fr: 'Télécharger TOUTES les séries (CSV, format long)' },

    /* ------------------------------------------------------- West Africa */
    'tab.westafrica': { en: 'West Africa model', fr: 'Modèle Afrique de l’Ouest' },
    'wa.title':       { en: 'West Africa — van Oort et al. (2015) model',
                        fr: 'Afrique de l’Ouest — modèle de van Oort et al. (2015)' },
    'wa.lede':        { en: 'rice self-sufficiency scenarios for each West African country and the region',
                        fr: 'scénarios d’autosuffisance rizicole par pays et pour la région' },
    'wa.method':      { en: 'Implements van Oort, P.A.J. et al. (2015), "Assessment of rice self-sufficiency in 2025 in eight African countries", Global Food Security 5, 39-49. Production is harvested area times yield (Eq. 1), milled production is 0.65 of unmilled (Eq. 2), consumption is population times per-capita consumption (Eq. 3), and yield increases are bounded at 80% of biophysical potential (Eqs. 8-9). This is a BIOPHYSICAL ACCOUNTING framework: it contains no prices, no costs and no behavioural response.',
                        fr: 'Met en œuvre van Oort, P.A.J. et al. (2015), « Assessment of rice self-sufficiency in 2025 in eight African countries », Global Food Security 5, 39-49. La production est la superficie récoltée multipliée par le rendement (éq. 1), la production usinée vaut 0,65 de la production brute (éq. 2), la consommation est la population multipliée par la consommation par habitant (éq. 3) et les hausses de rendement sont plafonnées à 80 % du potentiel biophysique (éq. 8-9). Il s’agit d’un cadre de COMPTABILITÉ BIOPHYSIQUE : ni prix, ni coûts, ni réponse comportementale.' },
    'wa.diet':        { en: 'Diet scenario', fr: 'Scénario de régime' },
    'wa.region':      { en: 'West Africa as a region', fr: 'Afrique de l’Ouest, région' },
    'wa.tblRegion':   { en: 'Regional scenarios', fr: 'Scénarios régionaux' },
    'wa.tblCountries':{ en: 'P/C ratio by country and yield scenario',
                        fr: 'Ratio P/C par pays et scénario de rendement' },
    'wa.yieldScenario':{ en: 'Yield scenario', fr: 'Scénario de rendement' },
    'wa.yieldAt':     { en: 'Yield at target', fr: 'Rendement à l’horizon' },
    'wa.areaNeeded':  { en: 'Area needed for P/C = 1', fr: 'Superficie requise pour P/C = 1' },
    'wa.expansionFactor': { en: 'Expansion factor', fr: 'Facteur d’expansion' },
    'wa.areaFactorTrend': { en: 'Area factor (trend)', fr: 'Facteur superficie (tendance)' },
    'wa.baseYear':    { en: 'Base year', fr: 'Année de base' },
    'wa.baselinePC':  { en: 'P/C baseline', fr: 'P/C de référence' },
    'wa.perCapita':   { en: 'Per-capita consumption', fr: 'Consommation par habitant' },
    'wa.pcSource':    { en: 'Per-capita source', fr: 'Source par habitant' },
    'wa.popGrowth':   { en: 'Population grows by a factor of {f} by {y} (UN medium variant).',
                        fr: 'La population croît d’un facteur {f} d’ici {y} (variante moyenne ONU).' },
    'wa.unavailable': { en: 'not computable', fr: 'non calculable' },
    'wa.na':          { en: 'n/a', fr: 'n.d.' },
    'wa.noModel':     { en: 'model could not be run', fr: 'modèle non exécutable' },
    'wa.regionFailed':{ en: 'The regional model could not be run:', fr: 'Le modèle régional n’a pu être exécuté :' },
    'wa.tblNote':     { en: 'The 80%-of-potential column requires Global Yield Gap Atlas simulations and is available only for Burkina Faso, Ghana, Mali and Nigeria — the West African countries the paper covers. For the others it is reported as not available rather than estimated.',
                        fr: 'La colonne « 80 % du potentiel » nécessite les simulations du Global Yield Gap Atlas et n’est disponible que pour le Burkina Faso, le Ghana, le Mali et le Nigeria — les pays ouest-africains couverts par l’article. Pour les autres, elle est signalée comme non disponible plutôt qu’estimée.' },
    'wa.collapseNote': { en: 'For {list} the recent yield trend is NEGATIVE, and extrapolating it linearly to the target year drives yield toward zero. Those trend figures are an artefact of extrapolation, not a credible scenario — read the +1 t/ha and +2 t/ha columns for those countries instead.',
                         fr: 'Pour {list}, la tendance récente des rendements est NÉGATIVE et son extrapolation linéaire à l’horizon fait tendre le rendement vers zéro. Ces chiffres sont un artefact d’extrapolation et non un scénario crédible — préférez les colonnes +1 t/ha et +2 t/ha pour ces pays.' },
    'wa.chart':       { en: 'P/C at the target year, recent yield trend',
                        fr: 'P/C à l’horizon, tendance récente des rendements' },
    'wa.chartSub':    { en: 'green = self-sufficient (P/C ≥ 1); the reference line is P/C = 1',
                        fr: 'vert = autosuffisant (P/C ≥ 1) ; la ligne de référence est P/C = 1' },
    'wa.validation':  { en: 'Validation against the published results',
                        fr: 'Validation par rapport aux résultats publiés' },
    'wa.publishedPC': { en: 'Published P/C 2012', fr: 'P/C publié 2012' },
    'wa.recomputedPC':{ en: 'Recomputed', fr: 'Recalculé' },
    'wa.agrees':      { en: 'Agrees', fr: 'Concorde' },
    'wa.publishedScenarios': { en: 'Published 2025 scenarios (Table 4)', fr: 'Scénarios 2025 publiés (tab. 4)' },
    'wa.validationNote': { en: 'The scenario columns are shown for reference and are NOT reproduced here: they rest on a rainfed/irrigated split and on ORYZA2000 yield potentials this platform does not hold. What is reproduced is the framework, the equations and the P/C definition.',
                           fr: 'Les colonnes de scénarios sont indiquées à titre de référence et ne sont PAS reproduites ici : elles reposent sur une répartition pluvial/irrigué et sur des potentiels ORYZA2000 dont la plateforme ne dispose pas. Ce qui est reproduit, c’est le cadre, les équations et la définition du P/C.' },
    'wa.report':      { en: 'Scientific report', fr: 'Rapport scientifique' },
    'wa.reportLede':  { en: 'Assembles the full analysis into a document: model and equations, data used, regional and country results, discussion drawing on the paper, validation, limitations and references.',
                        fr: 'Rassemble l’analyse complète : modèle et équations, données utilisées, résultats régionaux et par pays, discussion fondée sur l’article, validation, limites et références.' },
    'wa.buildReport': { en: 'Generate scientific report', fr: 'Générer le rapport scientifique' },

    /* ------------------------------------------------------ data freshness */
    'fresh.title':    { en: 'Data freshness', fr: 'Fraîcheur des données' },
    'fresh.extracted': { en: 'Data extracted', fr: 'Données extraites le' },
    'fresh.checking': { en: 'Checking sources for new releases…',
                        fr: 'Vérification des nouvelles publications…' },
    'fresh.current':  { en: 'Every source is current as of the last check.',
                        fr: 'Toutes les sources sont à jour à la dernière vérification.' },
    'fresh.stale':    { en: 'One or more sources have published newer data than this build. Run tools\\auto-update.ps1 to refresh.',
                        fr: 'Une ou plusieurs sources ont publié des données plus récentes que cette version. Exécutez tools\\auto-update.ps1 pour actualiser.' },
    'fresh.never':    { en: 'Automatic update has not been configured. Run tools\\auto-update.ps1 -Install to check daily.',
                        fr: 'La mise à jour automatique n’est pas configurée. Exécutez tools\\auto-update.ps1 -Install pour vérifier chaque jour.' },
    'fresh.lastCheck': { en: 'Last checked', fr: 'Dernière vérification' },
    'fresh.lastRebuild': { en: 'Last rebuild', fr: 'Dernière reconstruction' }
  };

  /* --------------------------------------------------------------- API */

  function t(key, vars) {
    const entry = STR[key];
    let s = entry ? (entry[current] != null ? entry[current] : entry.en) : key;
    if (vars) {
      Object.keys(vars).forEach(k => {
        s = s.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return s;
  }

  // True when a key has a real translation for the active language, so the UI can
  // report translation coverage honestly rather than implying completeness.
  function has(key) {
    const e = STR[key];
    return !!(e && e[current] != null);
  }

  /* Dictionary coverage: what share of the keys that EXIST have a translation.
   *
   * Read this for what it is. It reported 100% while roughly a quarter of the
   * rendered interface was still English, because a string that was never
   * routed through t() has no key and so cannot be counted as missing. It
   * measures the dictionary, not the interface. `auditRendered()` measures the
   * interface, and that is the number to trust when asking "is the French
   * version actually French?". */
  function coverage() {
    const keys = Object.keys(STR);
    let done = 0;
    keys.forEach(k => { if (STR[k][current] != null) done++; });
    return { language: current, keys: keys.length, translated: done,
             pct: keys.length ? Math.round(100 * done / keys.length) : 0,
             measures: 'dictionary keys, not rendered text -- see auditRendered()' };
  }

  /* Walks what is actually on screen and reports the text that still looks
   * English. Heuristic by necessity -- there is no way to ask a DOM node what
   * language it is in -- but it counts function words that do not occur in
   * French, which catches whole untranslated sentences reliably. Proper nouns
   * and shared technical terms produce a small false-positive floor. */
  function auditRendered(root) {
    if (typeof document === 'undefined') return null;
    /* English-EXCLUSIVE function words only. An earlier version included
     * "production", "table", "note" and "source", which are spelled identically
     * in French, so correctly translated sentences were counted as failures and
     * the reported gap was several points too wide. A measurement that flags
     * good work is worse than no measurement. */
    const EN = /\b(the|and|of|with|which|that|from|this|these|those|is|are|was|were|by|for|between|than|when|where|year|years|share|growth|yield|imports|exports|consumption|shown|used|based|most|recent|observed|country|countries|each|both|only|other|such|its|their)\b/i;
    const scope = root || document;
    const out = { language: current, nodes: 0, englishLooking: 0, samples: [], byContainer: {} };
    const walk = el => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.textContent.trim();
        if (t.length < 12) continue;
        out.nodes++;
        if (current !== 'en' && EN.test(t)) {
          out.englishLooking++;
          const box = n.parentElement && n.parentElement.closest('.panel');
          const id = box ? box.id : '(chrome)';
          out.byContainer[id] = (out.byContainer[id] || 0) + 1;
          if (out.samples.length < 30) out.samples.push({ where: id, text: t.slice(0, 90) });
        }
      }
    };
    walk(scope.body || scope);
    out.pctEnglish = out.nodes ? +(100 * out.englishLooking / out.nodes).toFixed(1) : 0;
    out.pctTranslated = +(100 - out.pctEnglish).toFixed(1);
    return out;
  }

  function locale() { return current === 'fr' ? 'fr-FR' : 'en-GB'; }

  /* Number formatting follows the locale. This is not cosmetic: French uses a
   * comma for the decimal mark, so "18,25" and "18.25" are the same number
   * written two ways and getting it wrong misstates a ratio by three orders of
   * magnitude to a reader who applies the other convention. */
  function num(x, dp) {
    if (x == null || !isFinite(x)) return '—';
    return Number(x).toLocaleString(locale(), {
      minimumFractionDigits: dp == null ? 1 : dp,
      maximumFractionDigits: dp == null ? 1 : dp
    });
  }

  function pct(x, dp) {
    if (x == null || !isFinite(x)) return '—';
    // French typography puts a non-breaking space before the per-cent sign.
    return num(x, dp == null ? 1 : dp) + (current === 'fr' ? ' %' : '%');
  }

  function date(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(locale(),
        { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return iso; }
  }

  function set(lang) {
    if (lang !== 'en' && lang !== 'fr') return current;
    current = lang;
    try { localStorage.setItem('rsa.lang', lang); } catch (e) {}
    try { document.documentElement.lang = lang; } catch (e) {}
    listeners.forEach(fn => { try { fn(lang); } catch (e) {} });
    return current;
  }

  function get() { return current; }
  function onChange(fn) { listeners.push(fn); }

  /* Initial language: a stored choice wins; otherwise follow the browser, which
   * for a francophone user is the right default without them having to ask. */
  function init() {
    let lang = null;
    try { lang = localStorage.getItem('rsa.lang'); } catch (e) {}
    if (!lang) {
      const nav = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'en';
      lang = /^fr/i.test(nav) ? 'fr' : 'en';
    }
    current = (lang === 'fr') ? 'fr' : 'en';
    try { document.documentElement.lang = current; } catch (e) {}
    return current;
  }

  return {
    t: t, has: has, set: set, get: get, init: init, onChange: onChange,
    num: num, pct: pct, date: date, locale: locale, coverage: coverage,
    auditRendered: auditRendered,
    STRINGS: STR
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RSAi18n; }
