# MatiCaminhos

Portuguese daily delivery planner, with Matisilva — Carnes Lda as the default depot (40.1299257, -8.5240277), confirmed from the supplied Google Maps link.

This is the source for the GitHub repository `Gwazyjustcause/maticaminhos`. It is a standalone static website with no package dependencies or ChatGPT sign-in requirement.

Use Node.js 20 or newer. Run `npm run dev` and open http://127.0.0.1:4173. No installation step is required. Run `npm test` to verify route ordering and `npm run check` to check JavaScript syntax.

The editable website files are `index.html`, `style.css`, `app.js`, and `optimizer.mjs` at the repository root. Run `npm run build` to copy the static website into `dist/` for deployment to a static host such as GitHub Pages. The build output is ignored by Git. This repository does not depend on Sites hosting or a Sites manifest.

The driver adds restaurants (up to 25), taps **Calcular rota**, and opens the next delivery in Waze or Google Maps. **Entregue** moves to the next stop, including the return to the depot when enabled. Search results add directly to the list. Restaurants and vehicle settings are saved locally. Map, vehicle settings, and extra options are collapsed to keep the main screen simple. Coordinates and map clicks are also supported.

Optimization uses OSRM road duration matrices, multiple nearest-neighbor starts, and directed 2-opt improvement. It preserves the company departure and supports optional return. This is a heuristic, not a guarantee of the global optimum. OSRM supplies estimated driving time and distance. Service time is added separately. Waze and Google Maps may choose different roads and change actual time and costs.

## Fuel and toll costs

The driver fills in consumption (L/100 km), price (EUR/litre), and toll class (1–4). No vehicle values or current fuel prices are assumed. Fuel litres = route kilometres × consumption / 100. Fuel cost = litres × price. Settings persist in the browser.

**Automatic toll pricing is not implemented.** The Portuguese official calculator's service returned different prices for the same route depending on the request referrer in live checks, so it is not called directly from the GitHub Pages website. The page links to the official calculator and accepts a user-confirmed toll amount for the current route. A blank amount is unknown, not zero. The combined total appears only when both fuel and toll amounts are known. Toll amounts reset whenever the route is recalculated or vehicle class changes. Reliable automatic toll prices require a supported provider and a server-side integration to protect its API credential; GitHub Pages only serves static files.

Photon, OSRM, Leaflet CDN, and map tiles require internet access. The public routing and geocoding services are for a small pilot and have no availability guarantee. For regular production use, configure a supported commercial or self-hosted routing/geocoding service. No live traffic, vehicle dimensions/weight restrictions, delivery time windows, cold-chain logic, or multi-driver allocation is implemented. Public providers receive search text and/or coordinates when used. Storage is device-local; export CSV to retain a copy. No credentials are included in the application.
