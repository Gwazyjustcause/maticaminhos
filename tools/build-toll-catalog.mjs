// node tools/build-toll-catalog.mjs rates.json osm-nodes.json
// Inputs: official Brisa PDF extraction + toll-tagged nodes from a Portugal OSM extract.
import fs from 'node:fs/promises';
import {distanceMetres} from '../routing.mjs';
const rates=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const nodes=JSON.parse(await fs.readFile(process.argv[3],'utf8'));
const manifest=JSON.parse(await fs.readFile(new URL('./toll-stations.json',import.meta.url),'utf8'));
const supplement=JSON.parse(await fs.readFile(new URL('./toll-supplement.json',import.meta.url),'utf8'));
const atlantico=process.argv[4]?JSON.parse(await fs.readFile(process.argv[4],'utf8')):null;
const sectionTables=JSON.parse(await fs.readFile(new URL('./toll-section-tables.json',import.meta.url),'utf8'));
const stations=[];
for(const id of new Set([...Object.keys(manifest.named),...Object.keys(manifest.located),...Object.keys(manifest.nodes||{})])){
  const seeds=nodes.filter(n=>manifest.named[id]?.includes(n.tags.name));
  for(const [lat,lon] of manifest.located[id]||[])seeds.push({lat,lon});
  const matched=manifest.nodes?.[id]?nodes.filter(n=>manifest.nodes[id].includes(n.id)):nodes.filter(n=>seeds.some(p=>distanceMetres(p,n)<120));
  if(!matched.length||!rates.names[id])throw Error('Missing reviewed station '+id);
  stations.push({id,name:rates.names[id].replace(/^\d{4}[:\-]\s*/,''),kind:'closed',...(manifest.nodes?.[id]?{exactOnly:true}:{}),points:matched.map(n=>({lat:n.lat,lon:n.lon}))});
}
const ids=new Set(stations.map(s=>s.id));
for(const [id,definition] of Object.entries(manifest.free||{})){
  const points=nodes.filter(n=>definition.located.some(([lat,lon])=>distanceMetres({lat,lon},n)<120)).map(n=>({lat:n.lat,lon:n.lon}));
  if(!points.length)throw Error('Missing free gantry '+id);
  stations.push({id,name:definition.name,kind:'free',points});
}
const fares={},rateSources={};
for(const [key,prices]of Object.entries(rates.rates)){
  if(!key.split('>').every(id=>ids.has(id)))continue;
  fares[key]=prices;rateSources[key]=/^0[26]|^12|^13|>0[26]|>12|>13/.test(key)?'brisa-south-2026':'brisa-august-2026';
}
if(atlantico)for(const [key,prices]of Object.entries(atlantico.rates)){
  if(!key.split('>').every(id=>ids.has(id)))continue;
  if(fares[key]&&JSON.stringify(fares[key])!==JSON.stringify(prices))throw Error('Conflicting operator fares: '+key);
  if(!fares[key]){fares[key]=prices;rateSources[key]='atlantico-2026';}
}
// Explicit 2026 IMT section tables. Unique linear paths only; never derive
// prices from distance or choose an arbitrary path through a motorway graph.
for(const chain of [
 {ids:['1411','1412','1413','1414','0117'],sections:[[50,90,115,130],[85,150,195,215],[105,180,235,260],[50,85,105,120]]},
 {ids:['2101','2102','2103','2104','0813'],sections:[[55,100,125,140],[75,130,165,185],[55,100,130,145],[35,65,85,90]]}
])for(let i=0;i<chain.ids.length;i++)for(let j=i+1;j<chain.ids.length;j++){
  const price=chain.sections.slice(i,j).reduce((a,b)=>a.map((v,c)=>v+b[c]),[0,0,0,0]);
  for(const key of [chain.ids[i]+'>'+chain.ids[j],chain.ids[j]+'>'+chain.ids[i]]){
    if(fares[key]&&JSON.stringify(fares[key])!==JSON.stringify(price))throw Error('Section/matrix conflict: '+key);
    if(!fares[key]){fares[key]=price;rateSources[key]='imt-sections-2026';}
  }
}
// The same physical closed-system plaza pair has the same standard tariff
// in reverse. Keep the original source key for audit; asymmetric V.F. Xira
// access codes are excluded and must have an explicit directed source cell.
for(const network of sectionTables.networks){
  const graph=new Map();
  for(const[a,b,price]of network.edges){for(const[from,to]of [[a,b],[b,a]]){if(!graph.has(from))graph.set(from,[]);graph.get(from).push({to,price});}}
  // These are reviewed trees: each pair has exactly one section path. Reject
  // loops instead of silently choosing a cheapest or shortest tariff path.
  if(network.edges.length!==graph.size-1)throw Error('Section network is not a tree');
  for(const origin of graph.keys()){
    const visited=new Set(),queue=[{id:origin,cents:[0,0,0,0]}];
    while(queue.length){
      const {id,cents}=queue.shift();if(visited.has(id))throw Error('Section network loop');visited.add(id);
      if(origin!==id&&ids.has(origin)&&ids.has(id)){
        const key=origin+'>'+id;
        if(fares[key]&&JSON.stringify(fares[key])!==JSON.stringify(cents))throw Error('Published matrix / section conflict: '+key+' '+JSON.stringify([fares[key],cents]));
        if(!fares[key]&&!network.validationOnly?.includes(origin)&&!network.validationOnly?.includes(id)){fares[key]=cents;rateSources[key]=network.source;}
      }
      for(const edge of graph.get(id))if(!visited.has(edge.to))queue.push({id:edge.to,cents:cents.map((v,i)=>v+edge.price[i])});
    }
  }
}
const directional=new Set(['0127','0130','0131','0132']);
const reverseOf={};
for(const [key,prices]of Object.entries(fares)){
  const [a,b]=key.split('>'),reverse=b+'>'+a;
  if(directional.has(a)||directional.has(b)||fares[reverse])continue;
  fares[reverse]=prices;rateSources[reverse]=rateSources[key];reverseOf[reverse]=key;
}
stations.push(...supplement.stations);
for(const station of stations)if(['0102','0501','0502','0503','0504','0506','0901','1201'].includes(station.id))station.exactOnly=true;
for(const[key,fare]of Object.entries(supplement.rates||{})){
  if(fares[key]&&JSON.stringify(fares[key])!==JSON.stringify(fare.cents))throw Error('Conflicting supplemental fare '+key);
  fares[key]=fare.cents;rateSources[key]=fare.source;
}
for(const[a,b]of manifest.invalidPairs||[])for(const key of [a+'>'+b,b+'>'+a]){delete fares[key];delete rateSources[key];delete reverseOf[key];}
const data={version:2,effectiveFrom:'2026 tariffs; source-specific dates',verifiedOn:'2026-11-22',coverage:'Expanded verified plazas and gantries. See TOLL-AUDIT.md for remaining gaps; not certified nationwide coverage.',sources:[{id:'brisa-august-2026',name:'Brisa / Brisal official class 1–4 tariffs, including VAT',url:'https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_25082026_v7.pdf',pages:[1,2,3,4,5,6,7,8,11,12],effectiveFrom:'2026-08-26'},{id:'brisa-south-2026',name:'Brisa official southern 2026 revision; replaces stale 2025-labelled southern pages in August PDF',url:'https://www.brisaconcessao.pt/Portals/0/Documentos/TabelaEcadaTaxas_23iva_04032026_v4.pdf',pages:[9,10],effectiveFrom:'2026-01-08'},{id:'imt-sections-2026',name:'IMT 2026 A14 and A21 section tariffs',url:'https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/'},...(atlantico?[atlantico.source]:[]),...supplement.sources,{name:'OpenStreetMap contributors / Geofabrik Portugal extract',url:'https://download.geofabrik.de/europe/portugal.html',license:'ODbL-1.0',attribution:'© OpenStreetMap contributors, https://www.openstreetmap.org/copyright'}],stations,rates:fares,rateSources,reverseOf};
data.sources.push({name:'IP: A25 in its entirety at zero tariff from 1 January 2026',url:'https://servicos.infraestruturasdeportugal.pt/pt-pt/portagens-ips'});
data.sources.push(...sectionTables.sources);
data.freeRoadRefs=['A22','A23','A24','A25'];
data.effectiveFrom='2026';
data.aliases={'0312':'0311','0412':'0411','0505':'0501'};
for(const source of data.sources)if(rates.sourceDigests?.[source.id])source.sha256=rates.sourceDigests[source.id];
await fs.writeFile(new URL('../toll-data.json',import.meta.url),JSON.stringify(data));
console.log('Published catalogue:',stations.length,'plazas,',Object.keys(fares).length,'directed four-class fares.');
