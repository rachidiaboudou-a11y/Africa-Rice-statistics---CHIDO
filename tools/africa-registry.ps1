# Country registry for Rice Statistics for Africa.
#
# One row per African country (plus Reunion, an overseas department that FAOSTAT
# and USDA both report separately and that grows rice). Each row carries the join
# keys for both source databases plus the group memberships used for aggregation.
#
# Provenance of each field:
#   iso3     ISO 3166-1 alpha-3
#   m49      UN M49 numeric code
#   fao      FAOSTAT area code (from the FAOSTAT bulk *_AreaCodes.csv)
#   psd      USDA FAS country code (from psd_grains_pulses.csv). $null where USDA
#            PSD carries no rice balance sheet for the country -- this is a real
#            gap in the source, not a placeholder to be filled in later.
#   region   UN M49 geographic subregion. This is the classification the platform
#            treats as canonical because it is the one both FAO and the UN publish
#            against; the political blocs below are layered on top of it.
#
# Bloc memberships are as of the extraction date recorded in data/rsa-meta.json.
# Two of them carry caveats that the platform surfaces in the UI:
#   * ECOWAS -- Burkina Faso, Mali and Niger notified withdrawal, effective
#     29 January 2025. They are retained in the ECOWAS group with a flag so that
#     long historical aggregates remain continuous; the UI says so.
#   * Sahel -- there is no single official membership list. The list used here is
#     the agro-ecological Sahelian belt (CILSS member states), NOT the dissolved
#     G5 Sahel. Documented rather than hard-coded silently.

$script:AfricaRegistry = @(
  # --- Northern Africa ---
  @{ iso3='DZA'; name='Algeria';                  m49=12;  fao=4;   psd='AG'; region='Northern Africa';  blocs=@('AMU') }
  @{ iso3='EGY'; name='Egypt';                    m49=818; fao=59;  psd='EG'; region='Northern Africa';  blocs=@('COMESA') }
  @{ iso3='LBY'; name='Libya';                    m49=434; fao=124; psd='LY'; region='Northern Africa';  blocs=@('COMESA','AMU') }
  @{ iso3='MAR'; name='Morocco';                  m49=504; fao=143; psd='MO'; region='Northern Africa';  blocs=@('AMU') }
  @{ iso3='SDN'; name='Sudan';                    m49=729; fao=276; psd='SU'; region='Northern Africa';  blocs=@('COMESA','SAHEL') }
  @{ iso3='TUN'; name='Tunisia';                  m49=788; fao=222; psd=$null; region='Northern Africa';  blocs=@('COMESA','AMU') }

  # --- Western Africa ---
  @{ iso3='BEN'; name='Benin';                    m49=204; fao=53;  psd='DM'; region='Western Africa';   blocs=@('ECOWAS','UEMOA') }
  @{ iso3='BFA'; name='Burkina Faso';             m49=854; fao=233; psd='UV'; region='Western Africa';   blocs=@('ECOWAS','UEMOA','SAHEL'); ecowasExit=$true }
  @{ iso3='CPV'; name='Cabo Verde';               m49=132; fao=35;  psd='CV'; region='Western Africa';   blocs=@('ECOWAS') }
  @{ iso3='CIV'; name="Cote d'Ivoire";            m49=384; fao=107; psd='IV'; region='Western Africa';   blocs=@('ECOWAS','UEMOA') }
  @{ iso3='GMB'; name='Gambia';                   m49=270; fao=75;  psd='GA'; region='Western Africa';   blocs=@('ECOWAS') }
  @{ iso3='GHA'; name='Ghana';                    m49=288; fao=81;  psd='GH'; region='Western Africa';   blocs=@('ECOWAS') }
  @{ iso3='GIN'; name='Guinea';                   m49=324; fao=90;  psd='GU'; region='Western Africa';   blocs=@('ECOWAS') }
  @{ iso3='GNB'; name='Guinea-Bissau';            m49=624; fao=175; psd='PU'; region='Western Africa';   blocs=@('ECOWAS','UEMOA') }
  @{ iso3='LBR'; name='Liberia';                  m49=430; fao=123; psd='LI'; region='Western Africa';   blocs=@('ECOWAS') }
  @{ iso3='MLI'; name='Mali';                     m49=466; fao=133; psd='ML'; region='Western Africa';   blocs=@('ECOWAS','UEMOA','SAHEL'); ecowasExit=$true }
  @{ iso3='MRT'; name='Mauritania';               m49=478; fao=136; psd='MR'; region='Western Africa';   blocs=@('AMU','SAHEL') }
  @{ iso3='NER'; name='Niger';                    m49=562; fao=158; psd='NG'; region='Western Africa';   blocs=@('ECOWAS','UEMOA','SAHEL'); ecowasExit=$true }
  @{ iso3='NGA'; name='Nigeria';                  m49=566; fao=159; psd='NI'; region='Western Africa';   blocs=@('ECOWAS') }
  @{ iso3='SEN'; name='Senegal';                  m49=686; fao=195; psd='SG'; region='Western Africa';   blocs=@('ECOWAS','UEMOA','SAHEL') }
  @{ iso3='SLE'; name='Sierra Leone';             m49=694; fao=197; psd='SL'; region='Western Africa';   blocs=@('ECOWAS') }
  @{ iso3='TGO'; name='Togo';                     m49=768; fao=217; psd='TO'; region='Western Africa';   blocs=@('ECOWAS','UEMOA') }

  # --- Middle (Central) Africa ---
  @{ iso3='AGO'; name='Angola';                   m49=24;  fao=7;   psd='AO'; region='Middle Africa';    blocs=@('SADC') }
  @{ iso3='CMR'; name='Cameroon';                 m49=120; fao=32;  psd='CM'; region='Middle Africa';    blocs=@('ECCAS') }
  @{ iso3='CAF'; name='Central African Republic'; m49=140; fao=37;  psd=$null; region='Middle Africa';    blocs=@('ECCAS') }
  @{ iso3='TCD'; name='Chad';                     m49=148; fao=39;  psd='CD'; region='Middle Africa';    blocs=@('ECCAS','SAHEL') }
  @{ iso3='COG'; name='Congo';                    m49=178; fao=46;  psd=$null; region='Middle Africa';    blocs=@('ECCAS') }
  @{ iso3='COD'; name='Democratic Republic of the Congo'; m49=180; fao=250; psd='CG'; region='Middle Africa'; blocs=@('SADC','ECCAS','COMESA','EAC') }
  @{ iso3='GNQ'; name='Equatorial Guinea';        m49=226; fao=61;  psd=$null; region='Middle Africa';   blocs=@('ECCAS') }
  @{ iso3='GAB'; name='Gabon';                    m49=266; fao=74;  psd='GB'; region='Middle Africa';    blocs=@('ECCAS') }
  @{ iso3='STP'; name='Sao Tome and Principe';    m49=678; fao=193; psd=$null; region='Middle Africa';   blocs=@('ECCAS') }

  # --- Eastern Africa ---
  @{ iso3='BDI'; name='Burundi';                  m49=108; fao=29;  psd=$null; region='Eastern Africa';   blocs=@('EAC','COMESA') }
  @{ iso3='COM'; name='Comoros';                  m49=174; fao=45;  psd=$null; region='Eastern Africa';   blocs=@('SADC','COMESA') }
  @{ iso3='DJI'; name='Djibouti';                 m49=262; fao=72;  psd='DJ'; region='Eastern Africa';   blocs=@('COMESA') }
  @{ iso3='ERI'; name='Eritrea';                  m49=232; fao=178; psd=$null; region='Eastern Africa';   blocs=@('COMESA') }
  @{ iso3='ETH'; name='Ethiopia';                 m49=231; fao=238; psd='ET'; region='Eastern Africa';   blocs=@('COMESA') }
  @{ iso3='KEN'; name='Kenya';                    m49=404; fao=114; psd='KE'; region='Eastern Africa';   blocs=@('EAC','COMESA') }
  @{ iso3='MDG'; name='Madagascar';               m49=450; fao=129; psd='MA'; region='Eastern Africa';   blocs=@('SADC','COMESA') }
  @{ iso3='MWI'; name='Malawi';                   m49=454; fao=130; psd='MI'; region='Eastern Africa';   blocs=@('SADC','COMESA') }
  @{ iso3='MUS'; name='Mauritius';                m49=480; fao=137; psd='MP'; region='Eastern Africa';   blocs=@('SADC','COMESA') }
  @{ iso3='MOZ'; name='Mozambique';               m49=508; fao=144; psd='MZ'; region='Eastern Africa';   blocs=@('SADC') }
  @{ iso3='REU'; name='Reunion';                  m49=638; fao=182; psd='RE'; region='Eastern Africa';   blocs=@(); territory=$true }
  @{ iso3='RWA'; name='Rwanda';                   m49=646; fao=184; psd='RW'; region='Eastern Africa';   blocs=@('EAC','COMESA') }
  @{ iso3='SYC'; name='Seychelles';               m49=690; fao=196; psd=$null; region='Eastern Africa';  blocs=@('SADC','COMESA') }
  @{ iso3='SOM'; name='Somalia';                  m49=706; fao=201; psd='SO'; region='Eastern Africa';   blocs=@('EAC','COMESA') }
  @{ iso3='SSD'; name='South Sudan';              m49=728; fao=277; psd=$null; region='Eastern Africa';  blocs=@('EAC') }
  @{ iso3='UGA'; name='Uganda';                   m49=800; fao=226; psd='UG'; region='Eastern Africa';   blocs=@('EAC','COMESA') }
  @{ iso3='TZA'; name='United Republic of Tanzania'; m49=834; fao=215; psd='TZ'; region='Eastern Africa'; blocs=@('EAC','SADC') }
  @{ iso3='ZMB'; name='Zambia';                   m49=894; fao=251; psd='ZA'; region='Eastern Africa';   blocs=@('SADC','COMESA') }
  @{ iso3='ZWE'; name='Zimbabwe';                 m49=716; fao=181; psd=$null; region='Eastern Africa';   blocs=@('SADC','COMESA') }

  # --- Southern Africa ---
  @{ iso3='BWA'; name='Botswana';                 m49=72;  fao=20;  psd=$null; region='Southern Africa';  blocs=@('SADC') }
  @{ iso3='SWZ'; name='Eswatini';                 m49=748; fao=209; psd='WZ'; region='Southern Africa';  blocs=@('SADC','COMESA') }
  @{ iso3='LSO'; name='Lesotho';                  m49=426; fao=122; psd=$null; region='Southern Africa';  blocs=@('SADC') }
  @{ iso3='NAM'; name='Namibia';                  m49=516; fao=147; psd=$null; region='Southern Africa';  blocs=@('SADC') }
  @{ iso3='ZAF'; name='South Africa';             m49=710; fao=202; psd='SF'; region='Southern Africa';  blocs=@('SADC') }
)

# Bloc display names and the caveats the UI must show alongside them.
$script:BlocMeta = [ordered]@{
  'ECOWAS' = @{ label='ECOWAS';  note='Burkina Faso, Mali and Niger notified withdrawal effective 29 Jan 2025; retained here so historical aggregates stay continuous.' }
  'UEMOA'  = @{ label='WAEMU / UEMOA'; note='West African Economic and Monetary Union.' }
  'SADC'   = @{ label='SADC';    note='Southern African Development Community.' }
  'EAC'    = @{ label='EAC';     note='East African Community; Somalia acceded 2024, DR Congo 2022.' }
  'COMESA' = @{ label='COMESA';  note='Common Market for Eastern and Southern Africa.' }
  'ECCAS'  = @{ label='ECCAS';   note='Economic Community of Central African States.' }
  'AMU'    = @{ label='Arab Maghreb Union'; note='Largely dormant as an operating bloc; included for regional description only.' }
  'SAHEL'  = @{ label='Sahel (agro-ecological)'; note='CILSS-style Sahelian belt, NOT the dissolved G5 Sahel. An agro-ecological grouping, not a trade bloc.' }
}
