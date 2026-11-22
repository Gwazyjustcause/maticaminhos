// node tools/build-toll-catalog.mjs rates.json osm-nodes.json
// Inputs: official Brisa PDF extraction + toll-tagged nodes from a Portugal OSM extract.
import fs from 'node:fs/promises';
import {distanceMetres} from '../routing.mjs';
const rates=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const nodes=JSON.parse(await fs.readFile(process.argv[3],'utf8'));
const manifest=JSON.parse(await fs.readFile(new URL('./toll-stations.json',import.meta.url),'utf8'));
const stations=[];
for(const id of new Set([...Object.keys(manifest.named),...Object.keys(manifest.located)])){
  const seeds=nodes.filter(n=>manifest.named[id]?.includes(n.tags.name));
  for(const [lat,lon] of manifest.located[id]||[])seeds.push({lat,lon});
  const matched=nodes.filter(n=>seeds.some(p=>distanceMetres(p,n)<120));
  if(!matched.length||!rates.names[id])throw Error('Missing reviewed station '+id);
  stations.push({id,name:rates.names[id].replace(/^\d{4}[:\-]\s*/,''),kind:'closed',points:matched.map(n=>({lat:n.lat,lon:n.lon}))});
}
const ids=new Set(stations.map(s=>s.id));
const fares=Object.fromEntries(Object.entries(rates.rates).filter(([key])=>key.split('>').every(id=>ids.has(id))));
const data={version:1,effectiveFrom:'26/08/2026',verifiedOn:'2026-11-22',coverage:'Selected verified plazas in the Brisa northern/central networks and Brisal A17. Not nationwide coverage.',sources:[{name:'Brisa / Brisal official class 1–4 tariffs, including VAT',url:'https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_25082026_v7.pdf',pages:[1,2,3,4,5,6,7,8,11,12]},{name:'OpenStreetMap contributors / Geofabrik Portugal extract',url:'https://download.geofabrik.de/europe/portugal.html',license:'ODbL-1.0',attribution:'© OpenStreetMap contributors, https://www.openstreetmap.org/copyright'}],stations,rates:fares};
await fs.writeFile(new URL('../toll-data.json',import.meta.url),JSON.stringify(data));
console.log('Published catalogue:',stations.length,'plazas,',Object.keys(fares).length,'directed four-class fares.');
