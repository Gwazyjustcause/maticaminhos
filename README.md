# MatiCaminhos

Portuguese delivery planner for restaurants, supermarkets, shopping centres, and unnamed delivery addresses. Default departure: Matisilva — Carnes Lda (40.1299257, -8.5240277).

Source: `Gwazyjustcause/maticaminhos`. Static site on GitHub Pages, with no package dependencies, API credentials, or ChatGPT sign-in.

## Development

Use Node.js 20+. `npm run dev` serves http://127.0.0.1:4173. `npm run check` checks syntax. `npm test` covers route optimization, costs, road access, per-leg toll preferences, route validation, postcodes, and whole-trip time. `npm run build` copies static files into ignored `dist/`. `npm run test:live` checks a real Matisilva–Leiria trip with tolls allowed and avoided. `npm run test:access` checks restaurant/building pins through road lookup, matrix optimization, and route geometry. Live checks make public routing requests and are deliberately separate from normal tests.

## Driver workflow

Search above the permanently visible map. Desktop shows the route in a scrolling sidebar. Phone shows the map above an independently scrolling route, so scrolling stops never hides the map. Search supports business names (e.g. Continente, Pingo Doce), shopping centres, addresses, Portuguese postcodes (including seven digits without a hyphen), latitude/longitude, and full Google Maps URLs containing coordinates. An optional Cidade ou vila field disambiguates addresses; a comma-separated street and town also works. Common street abbreviations such as R. and Av. expand before lookup.

Every forward request sets `countrycode=PT`, and results with any other country code (or no code) are rejected again locally. A supplied or inferred town is resolved before searching its area. Street-name tokens, administrative locality, and an optional house number are checked to prevent unrelated roads, wrong house numbers, or another municipality sharing the county name from appearing as matches. When needed, a structured street search is attempted. Requests are session-cached and spaced by at least 1.1 seconds.

Photon/OpenStreetMap results are not Google's complete business catalogue. Search also includes a small source-verified supplemental listing for Restaurante O Casimiro in Silveirinho / São Pedro de Alva, using the address and coordinates published on its own website: https://restauranteocasimiro.eatbu.com/?lang=pt. This is an explicit local catalogue entry, not a claim that the search provider now covers all missing Google businesses. Complete native Google business search requires a Google Places integration and API credential. A Google Maps lookup link lets drivers find missing places externally and paste the address or a full coordinate-bearing Maps URL back into the planner. Imports are reverse-checked for Portugal before confirmation; short share links cannot be expanded directly from this static app.

Postcodes and street-level results can be approximate. Preview them on the map, drag the pin to the delivery entrance, and give the stop an optional custom name. If a named street cannot be found inside the supplied town (e.g. the reported Bela Vista / São João de Lourosa case), the app offers an explicitly labelled **locality-centre fallback, not an exact street location**. It cannot be added until the driver moves the pin. No search service guarantees every address or an exact entrance for a postcode.

Adding a stop does **not** add it to favourites. A heart explicitly toggles favourite status in search results, in the route, or when confirming a pin. Today's stops and the separate favourites library persist in local storage, as do vehicle and route preferences. Older saved data is preserved.

The interface calls this library **Moradas guardadas**. Persistent app data is stored in this site's browser `localStorage`, under `maticaminhos-v1`, on the current device/browser profile. There is no account database or device synchronization; clearing the site's browser data removes it. Geocoding and road-network requests still send search text/coordinates to the external providers described below.

Saved addresses can be assigned to a group from the **Grupo** selector beneath each saved address. **Todas** shows the full library, **Sem grupo** shows unassigned addresses, and the group filter shows counts. Initial groups are Restaurantes, Continentes, and Pingo Doce; **Novo grupo** creates a custom group and **Renomear** changes its name. Existing addresses remain unassigned until the driver chooses a group. Group definitions and membership persist alongside saved addresses in the same local storage, and editing a saved stop preserves its group. Groups do not affect route order or clear-route behavior.

**Limpar rota** removes the current stops, per-leg overrides, calculated path, and trip-specific toll amount while retaining saved addresses, depot, manual entrances on saved addresses, and vehicle/preferences. **Restaurar rota** reverses the last clear during the same page session, until another plan change. Clearing also cancels queued recalculation, closes location/search editors, removes delivery progress with the route, resets totals, and centres on the depot. It does not delete saved addresses or reset vehicle settings.

The main **Rota mais rápida** button suggests a visiting order from driving-time matrices and a heuristic solver, then calculates and draws that route in one action. It also works with a single stop. It does not guarantee the global optimum or account for live traffic. **Manter ordem** calculates the displayed order instead. Move stops with Subir/Descer on any device, or drag a stop on desktop. Clicking a stop name lets the driver rename it or move its entrance. After calculating a route, changes to order, stop locations, return, or toll preferences recalculate its durations and map geometry. Delivery time updates the total without another routing request.

Whole-trip duration includes all driving legs, service time at every delivery, and return to the depot if selected. The interface focuses on route planning and does not ask for a date or departure time. Google Maps navigation opens the next directed leg with its toll preference; it may choose different roads and change the estimate.

## Restaurant pins and road access

Business/search pins remain at their original coordinates. Before matrix optimization or route calculation, a batched Valhalla `/locate` request resolves every stop and the depot to a nearby car-accessible road candidate with minimum connected-network reachability. Motorway edges, ramps, and ferries are excluded as access candidates. The closest eligible candidate must be within 300 metres; the app never silently jumps a building pin to a distant road.

The same prepared road coordinates and correlation settings are used by both the time matrix and final route. Road-access points appear as small outlined circles, linked to the place pins with dashed lines that are informational, not extra driving segments. Navigation links target the road access. Cached routes include their resolved access coordinates in their key, so changing an entrance cannot reuse an old route. Access lookups are cached only in memory and refreshed after reload.

If the matrix returns an unavailable connection (for example, a destination-only supermarket access road), the app automatically checks that directed pair with the full driving-route service, using the same access and toll preference. It uses the verified duration for optimization and caches the geometry for the final route. It never substitutes straight-line times or silently allows tolls. The live access regression includes Pingo Doce Crujeiro in Trancoso in both directions with and without tolls.

Each stop has an **Acesso** control for adjusting its vehicle/loading entrance independently of the business pin. A manual entrance can be at most 1 km from the business and must correlate to a drivable road within 100 metres. Manual entrances persist with the stop and update an existing favourite without automatically favouriting anything. Moving the business pin clears its manual entrance. An unavailable access or unreachable matrix pair identifies the place that needs attention. Road tagging cannot establish the actual loading-gate location or physical gate availability; drivers can adjust the suggested entrance.

## Tolls and routing

Valhalla/FOSSGIS supplies driving-time matrices and full-resolution polyline6 geometry. Global Permit/Evitar applies to all legs, clearing older overrides. Each directed pair of adjacent places can override the global choice, including the return leg. Overrides are keyed to the coordinates of the exact origin and destination, not a list index: reordering cannot attach an old preference to the wrong connection. Newly adjacent pairs use the global choice. Optimization uses the appropriate matrix entry for each directed override.

Avoid requests use `use_tolls: 0` and `exclude_tolls: true`. Public-server support for hard exclusions varies. The app only accepts an avoid leg if the returned **leg summary explicitly says `has_toll: false`**. A toll-containing or unverifiable avoid leg fails with an explanation rather than silently reverting to a tolled route. This depends on OpenStreetMap toll tagging and does not guarantee current real-world charging conditions.

Requests are user-triggered, cached per directed pair/preference in memory, batched into at most six consecutive legs with the same mode, and spaced at least 1.1 seconds apart. Matrices are split into at most 10×10 cells to respect the public server's 100-cell limit; 26 locations use nine small comparisons per required preference. Each request identifies the application with `X-Client-Id: gwazyjustcause.github.io/maticaminhos`. These are public demo services, not a production SLA. For regular or expanded production use, arrange a supported provider or self-hosted service. The Valhalla maintainers request an app-use notice via GitHub Discussions before broad end-user rollout; no external messages have been sent on the user's behalf.

## Fuel and toll prices

The driver supplies consumption (L/100 km), fuel price (EUR/L), and toll class. No vehicle figures or current fuel prices are assumed. Fuel litres = route kilometres × consumption / 100. Fuel cost = litres × price.

Choosing toll avoidance changes the **road route**, but automatic toll **pricing** is still not implemented. The official Portuguese price calculator returned different prices for the same route depending on request referrer during prior testing, so the static app does not call that price service. It links to the official calculator and accepts a user-confirmed toll amount. A blank amount remains unknown, not zero. The combined cost appears only when fuel and toll amounts are known. Recalculating or changing vehicle class clears the toll amount. Reliable automatic prices require a supported price provider and a backend protecting the API credential.

## Limits and privacy

Maximum 25 delivery stops plus departure and optional return. Internet is required for Photon, Valhalla, Leaflet CDN, and map tiles. Search text and/or coordinates are sent to the relevant public services. No live traffic, delivery windows, vehicle weight/height restrictions, cold-chain rules, or multiple-driver allocation is implemented. CSV export retains each leg's toll preference and navigation link. No credentials are included in the source.
