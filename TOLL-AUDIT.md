# Toll catalogue audit — 22 November 2026

The audit found real price-import errors and major omissions. The corrected catalogue contains **203 tariff locations, 5,624 directed four-class fares, fixed open-barrier prices, and explicitly verified free crossings**. It is substantially broader than the previous 48 locations / 738 fares. It is **not a certification that every Portuguese journey is covered**.

## Findings corrected

- **26 published fare rows had damaged prices.** The old importer treated rotated column headings as centred labels and clipped leading digits in the first column. Some syntactically valid amounts were seriously wrong. The importer now reads complete currency tokens first, checks that every euro amount was assigned exactly once, and tests independent reference journeys in every class.
- **The latest Brisa PDF contains southern pages labelled 2025.** The southern catalogue uses the official March revision with a 2026 heading instead. The importer rejects an outdated heading and records source hashes.
- **A road name is not enough to identify a tariff.** A4 Campo and A41 ZIC were incorrectly grouped. They are now separate. Grijó, Carcavelos, Queluz, Pinhal Novo, Tornada, A-dos-Negros and Idanha have distinct main-road/slip-road lane membership where appropriate. Lane-sensitive entries require a match within 3 metres; they cannot absorb a nearby unreviewed ramp using the general 80-metre fallback.
- **Maximum/lost-ticket cells are not ordinary local fares.** In addition to diagonal cells, the builder excludes the reviewed mutually exclusive access pairs at Maia, Ermesinde, Alverca, Coina, Queluz and Pinhal Novo. For example, a Pinhal Novo access must not acquire a €24.40 maximum charge merely because that number appears in a matrix.
- **A8 Leiria Sul was confused with IC36.** The closed A8 endpoint is west of the A19 junction. The Leiria–Pousos/IC36 mapped points are separate and use their jointly verified corridor price once. A partial corridor crossing remains unavailable rather than guessing a price for one point.
- **A free gantry cannot make an otherwise unpriced route free.** A25/A24 obsolete crossings are explicitly handled. Whole-road zero pricing requires verified free road references and must not override known payable gates on toll=false approach lanes.
- **Higher classes are not always more expensive.** Verified A41 and A19/Leiria–Pousos class 3/4 exemptions are retained. A global ascending-price rule would incorrectly reject these genuine fares.

## Sources and method

All runtime data is bundled and free to use without a paid API/account. Coordinates come from a Portugal OpenStreetMap/Geofabrik extract (ODbL). Price sources are:

| Source | Use |
| --- | --- |
| [Brisa/Brisal, August 2026](https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_25082026_v7.pdf) | Northern/central matrices, Brisal A17 and fixed barriers; source pages recorded in data |
| [Brisa, March 2026 revision](https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_04032026_v4.pdf) | Southern matrices with a valid 2026 heading |
| [Autoestradas do Atlântico, 2026](https://www.aeatlantico.pt/wp-content/uploads/2025/12/Taxas-20260101_Site.pdf) | A8/A15 matrices; overlapping Brisa fares checked for agreement |
| [IMT, 2026 tariffs](https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/) | A14/A21 and A32/A41/A43 section tables |
| [Ascendi electronic](https://ascendi.pt/portagens-eletronicas/) and [traditional](https://ascendi.pt/portagens-tradicionais/) | A4/A41/A42, A17/A29 gantries, A7 sections and A16 barriers |
| [Via Livre](https://www.vialivre.pt/pt-pt/portagens/portagens-na-a28-2/) | Current Angeiras and Póvoa A28 gantries |
| [Lusoponte: 25 de Abril](https://www.lusoponte.pt/25-de-abril/informacoes-gerais) / [Vasco da Gama](https://www.lusoponte.pt/vasco-da-gama/informacoes-gerais) | Standard bridge prices; paid-lane geometry preserves the charging direction |
| [IP calculator](https://portagens.infraestruturasdeportugal.pt/) | Manual checks of A7, A19, IC36 and all three A33 charging sections, in every class |
| [IP zero-tariff notice](https://servicos.infraestruturasdeportugal.pt/portagens-ips) | Abolished whole-road A22/A23/A24/A25 tolls and the A25 extension |
| [Lei 6/2026](https://diariodarepublica.pt/dr/detalhe/lei/6-2026-1058701611) and [Decreto-Lei 155-A/2026](https://diariodarepublica.pt/dr/detalhe/decreto-lei/155-a-2026-1153967375) | Class 3/4 exemptions, including corrections to stale higher-class calculator figures |

`rateSources` links every directed fare to its source. `reverseOf` identifies a reverse-derived standard fare; the directional Vila Franca de Xira accesses are excluded from that derivation. `aliases` records reviewed equivalent tariff identifiers. Section-derived fares use reviewed tree networks, which reject loops and must agree with overlapping published matrix cells. The builder never invents a distance-based toll rate or turns a blank source cell into zero.

The official calculator is useful for complete source journeys, but its API/partial-section responses are not reliable enough for runtime pricing. In the audit, stopping a route inside the eastern A33 charging section produced zero; continuing across the whole section to Montijo produced the correct €0.35/€0.65/€0.85/€0.90. The catalogue uses that completed-section result, not the zero response. A33's other verified gantries are Queimada (€0.75/€1.35/€1.75/€1.90) and Laranjeiras (€0.85/€1.50/€1.95/€2.15).

## Route evidence

The wider audit exercised 34 actual route examples during development. Ordinary tests remain offline. Selected verified class-1 results are below; coordinates/road choice matter, so these are examples rather than city-wide flat prices.

| Actual route example | Class 1 |
| --- | ---: |
| CREP/A1 → Condeixa, and reverse | €8.60 each |
| Matisilva → Leiria / Leiria → Matisilva | €3.90 / €5.15 |
| Alverca → Grijó, and reverse | €25.05 each |
| Maia → Valença | €10.20 |
| Matosinhos → Amarante, and reverse, including A4 electronic gantries | €5.05 each |
| Famalicão → Fafe | €3.85 |
| Figueira da Foz → Coimbra, and reverse | €2.90 each |
| Mira → Aveiro, and reverse, A17 gantries | €1.40 each |
| Airport-area A28 → Viana, and reverse | €1.35 each |
| Lisboa → Cascais, A5 main barrier | €1.60 |
| Sintra → Lisboa, tested A16/A9 connection | €1.65 |
| Porto de Mós → Leiria, A19 | €1.45 |
| Batalha → Pousos, A19 + IC36 | €1.40 |
| Torres Vedras → Leiria, tested A8 entries | €7.45 |
| Caparica → Coina east, crossing all three A33 gantries | €1.95 |
| Algarve → Lisboa, including 25 de Abril | €26.05 |
| Vasco da Gama towards Lisbon / opposite direction | €3.40 / €0 |

The A19 and IC36 examples also verify zero for exempt classes 3/4. Outbound/return fares are calculated from each route's actual crossings, not copied between journeys. Occasional routing-service HTTP 502/504 errors occurred during the wider survey; these are recorded as service failures, not zero-price journeys.

## Remaining limits — do not claim 100% coverage

1. **A11 Figueiredo PV / Figueiredo Nó (1105/1106)** still need a reviewed physical-lane mapping and the missing internal A11 matrix combinations. A nearby Celeirós barrier must not be assigned those tariff IDs merely because it is near a place called Figueiredo. The published section price at Celeirós is represented separately. Some A11 journeys therefore remain unavailable.
2. **Grândola A26 (0223)** remains unmapped pending a reliable charging-location review. It must not be assigned to an unrelated southern toll point.
3. **Partial closed-system and IC36 journeys** (for example, a stop inside a charging system with no verified entry/exit pair) remain unavailable. A full corridor price does not prove a standalone point price.
4. A mapped plaza does **not** establish every possible connecting fare. Missing matrix combinations, ambiguous correlations, missing OSM gate tags and failed traces still produce unavailable pricing. Private roads, parking barriers, pedestrian attractions and EasyToll registration booths are not motorway tariff entries.
5. Standard prices include the verified general class exemptions above. Resident/business eligibility, personal Via Verde discounts, motorcycle class 5 and temporary future measures are not inferred from class 1–4 alone. Static prices need a new source review when tariffs/laws change.

For every incomplete journey, the app withholds the whole-trip automatic toll total and the combined fuel+tolls total. It never presents a partial sum as a full amount. A driver can still enter an explicit manual trip total.

## Repeatable checks

`npm test` includes all catalogue-record validations, source references, lane separation, known invalid pairs, official reference journeys, legal zeros and missing-coverage behavior. `npm run test:tolls` checks the original live CREP/Condeixa/Leiria/Porto/Trancoso regressions. `npm run audit:tolls:live` performs the broader survey and saves route/crossing evidence locally under ignored `artifacts/toll-feasibility/`. See README for the source import/build commands.
