# MatiCaminhos

Portuguese delivery planner for restaurants, supermarkets, shopping centres, and unnamed delivery addresses. Default departure: Matisilva — Carnes Lda (40.1299257, -8.5240277).

Source: `Gwazyjustcause/maticaminhos`. Static site on GitHub Pages, with no package dependencies, API credentials, or ChatGPT sign-in.

## Development

Use Node.js 20+. `npm run dev` serves http://127.0.0.1:4173. `npm run check` checks syntax. `npm test` covers route optimization, costs, per-leg toll preferences, route validation, postcodes, and whole-trip time. `npm run build` copies static files into ignored `dist/`. `npm run test:live` checks a real Matisilva–Leiria trip with tolls allowed and avoided; this makes two public routing requests and is deliberately separate from normal tests.

## Driver workflow

Search above the permanently visible map. Desktop shows the route in a scrolling sidebar. Phone shows the map above an independently scrolling route, so scrolling stops never hides the map. Search supports business names (e.g. Continente, Pingo Doce), shopping centres, addresses, Portuguese postcodes (including seven digits without a hyphen), and latitude/longitude.

Photon/OpenStreetMap results are not Google listings. A business need not exist in Google to add a stop. Postcodes and street-level results can be approximate; preview them on the map, drag the pin to the delivery entrance, and give the stop an optional custom name. Map clicks also create unnamed stops. If a search has no match, manual pin placement remains available; no search service guarantees every address or an exact entrance for a postcode.

Adding a stop does **not** add it to favourites. A heart explicitly toggles favourite status in search results, in the route, or when confirming a pin. Today's stops and the separate favourites library persist in local storage, as do vehicle and route preferences. Older saved data is preserved.

**Calcular rota** preserves the displayed order. Move stops with Subir/Descer on any device, or drag a stop on desktop. Clicking a stop name lets the driver rename it or move its entrance. **Otimizar ordem** explicitly suggests an order from driving-time matrices and a heuristic solver. It does not guarantee the global optimum. After calculating a route, changes to order, stop locations, return, or toll preferences recalculate its durations and map geometry. Delivery time updates the total without another routing request.

Whole-trip duration includes all driving legs, service time at every delivery, and return to the depot if selected. The interface focuses on route planning and does not ask for a date or departure time. Google Maps navigation opens the next directed leg with its toll preference; it may choose different roads and change the estimate.

## Tolls and routing

Valhalla/FOSSGIS supplies driving-time matrices and full-resolution polyline6 geometry. Global Permit/Evitar applies to all legs, clearing older overrides. Each directed pair of adjacent places can override the global choice, including the return leg. Overrides are keyed to the coordinates of the exact origin and destination, not a list index: reordering cannot attach an old preference to the wrong connection. Newly adjacent pairs use the global choice. Optimization uses the appropriate matrix entry for each directed override.

Avoid requests use `use_tolls: 0` and `exclude_tolls: true`. Public-server support for hard exclusions varies. The app only accepts an avoid leg if the returned **leg summary explicitly says `has_toll: false`**. A toll-containing or unverifiable avoid leg fails with an explanation rather than silently reverting to a tolled route. This depends on OpenStreetMap toll tagging and does not guarantee current real-world charging conditions.

Requests are user-triggered, cached per directed pair/preference in memory, batched into at most six consecutive legs with the same mode, and spaced at least 1.1 seconds apart. Matrices are split into at most 10×10 cells to respect the public server's 100-cell limit; 26 locations use nine small comparisons per required preference. Each request identifies the application with `X-Client-Id: gwazyjustcause.github.io/maticaminhos`. These are public demo services, not a production SLA. For regular or expanded production use, arrange a supported provider or self-hosted service. The Valhalla maintainers request an app-use notice via GitHub Discussions before broad end-user rollout; no external messages have been sent on the user's behalf.

## Fuel and toll prices

The driver supplies consumption (L/100 km), fuel price (EUR/L), and toll class. No vehicle figures or current fuel prices are assumed. Fuel litres = route kilometres × consumption / 100. Fuel cost = litres × price.

Choosing toll avoidance changes the **road route**, but automatic toll **pricing** is still not implemented. The official Portuguese price calculator returned different prices for the same route depending on request referrer during prior testing, so the static app does not call that price service. It links to the official calculator and accepts a user-confirmed toll amount. A blank amount remains unknown, not zero. The combined cost appears only when fuel and toll amounts are known. Recalculating or changing vehicle class clears the toll amount. Reliable automatic prices require a supported price provider and a backend protecting the API credential.

## Limits and privacy

Maximum 25 delivery stops plus departure and optional return. Internet is required for Photon, Valhalla, Leaflet CDN, and map tiles. Search text and/or coordinates are sent to the relevant public services. No live traffic, delivery windows, vehicle weight/height restrictions, cold-chain rules, or multiple-driver allocation is implemented. CSV export retains each leg's toll preference and navigation link. No credentials are included in the source.
