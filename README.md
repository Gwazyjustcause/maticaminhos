# MatiCaminhos

Portuguese daily delivery planner, with Matisilva — Carnes Lda as the default depot (40.1299257, -8.5240277), confirmed from the supplied Google Maps link.

This is the source for the GitHub repository `Gwazyjustcause/maticaminhos`. It is a standalone static website with no package dependencies or ChatGPT sign-in requirement.

Use Node.js 20 or newer. Run `npm run dev` and open http://127.0.0.1:4173. No installation step is required. Run `npm test` to verify route ordering and `npm run check` to check JavaScript syntax.

The editable website files are `index.html`, `style.css`, `app.js`, and `optimizer.mjs` at the repository root. Run `npm run build` to copy the static website into `dist/` for deployment to a static host such as GitHub Pages. The build output is ignored by Git. This repository does not depend on Sites hosting or a Sites manifest.

Add up to 25 restaurants through explicit Photon search, coordinates, or a map click. Confirm each location. The browser saves the depot, stops, and restaurant library locally. Optimization uses OSRM road duration matrices, multiple nearest-neighbor starts, and directed 2-opt improvement. It preserves the company departure and supports optional return. This is a heuristic, not a guarantee of the global optimum. OSRM draws the route and supplies estimated driving time and distance. Service time is added separately. Each delivery opens its own Google Maps navigation link, avoiding any need to send a 25-stop route to Google Maps.

Photon, OSRM, Leaflet CDN, map tiles, and fonts require internet access. The public routing and geocoding services are for a small pilot and have no availability guarantee. For regular production use, configure a supported commercial or self-hosted routing/geocoding service. No live traffic, vehicle dimensions/weight restrictions, delivery time windows, cold-chain logic, or multi-driver allocation is implemented. Public providers receive search text and/or coordinates when used. Storage is device-local; export CSV to retain a copy. No credentials are included in the application.
