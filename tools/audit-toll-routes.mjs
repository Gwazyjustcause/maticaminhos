// Optional live audit; all evidence stays in ignored artifacts/.
import fs from 'node:fs/promises';
import {tollTracePayload,priceTollTrace,identifyTollStation} from '../tolls.mjs';
import {decodePolyline6} from '../routing.mjs';
const catalog=JSON.parse(await fs.readFile(new URL('../toll-data.json',import.meta.url),'utf8'));
const cases=[
 ['A19 / A8 Batalha → Pousos',[39.66,-8.824],[39.735,-8.775]],
 ['A8 / A19 Pousos → Batalha',[39.735,-8.775],[39.66,-8.824]],
 ['A2 Lisboa → Coina',[38.72,-9.14],[38.568,-9.05]],
 ['A2 Coina → Lisboa',[38.568,-9.05],[38.72,-9.14]],
 ['A12 norte → Pinhal Novo',[38.67,-8.889],[38.631,-8.913]],
 ['A12 Pinhal Novo → norte',[38.631,-8.913],[38.67,-8.889]],
 ['A12 Pinhal Novo → Montijo',[38.631,-8.913],[38.706,-8.975]],
 ['A12 Montijo → Pinhal Novo',[38.706,-8.975],[38.631,-8.913]],
 ['A12 Pinhal Novo → Setúbal',[38.631,-8.913],[38.524,-8.893]],
 ['A12 Setúbal → Pinhal Novo',[38.524,-8.893],[38.631,-8.913]],
 ['A11 Braga → Porto',[41.50,-8.42],[41.15,-8.61]],
 ['A1 Lisboa → Porto',[38.86,-9.06],[41.15,-8.61]],
 ['A1 Porto → Lisboa',[41.15,-8.61],[38.86,-9.06]],
 ['A2 Lisboa → Algarve',[38.60,-9.07],[37.09,-8.25]],
 ['A2 Algarve → Lisboa / bridge',[37.09,-8.25],[38.72,-9.14]],
 ['Vasco da Gama paid direction',[38.71,-8.94],[38.78,-9.10]],
 ['Vasco da Gama free direction',[38.78,-9.10],[38.71,-8.94]],
 ['A28 airport → Viana',[41.25,-8.70],[41.69,-8.83]],
 ['A28 Viana → airport',[41.69,-8.83],[41.25,-8.70]],
 ['A17 Mira → Aveiro',[40.45,-8.75],[40.64,-8.65]],
 ['A17 Aveiro → Mira',[40.64,-8.65],[40.45,-8.75]],
 ['A14 Figueira → Coimbra',[40.15,-8.85],[40.22,-8.43]],
 ['A14 Coimbra → Figueira',[40.22,-8.43],[40.15,-8.85]],
 ['A4 Matosinhos → Amarante',[41.18,-8.68],[41.27,-8.08]],
 ['A4 Amarante → Matosinhos',[41.27,-8.08],[41.18,-8.68]],
 ['A21 Ericeira → Mafra',[38.96,-9.41],[38.94,-9.33]],
 ['A41 Argoncilhe → Gandra',[41.01,-8.54],[41.20,-8.45]],
 ['A7 Famalicão → Fafe',[41.41,-8.52],[41.45,-8.17]],
 ['A5 Lisboa → Cascais',[38.72,-9.14],[38.70,-9.42]],
 ['A16 Sintra → Lisboa',[38.80,-9.38],[38.80,-9.15]],
 ['A33 Caparica → Coina',[38.62,-9.21],[38.59,-9.02]],
 ['A19 Porto de Mós → Leiria',[39.60,-8.82],[39.74,-8.81]],
 ['A8 Torres Vedras → Leiria',[39.09,-9.26],[39.74,-8.81]],
 ['A3 Porto → Valença',[41.15,-8.61],[42.03,-8.64]]
];
let last=0;const report=JSON.parse(await fs.readFile(new URL('../artifacts/toll-feasibility/live-audit.json',import.meta.url),'utf8').catch(()=>'[]'));
async function request(endpoint,payload){const wait=Math.max(0,1200-(Date.now()-last));if(wait)await new Promise(r=>setTimeout(r,wait));last=Date.now();const r=await fetch('https://valhalla1.openstreetmap.de/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Client-Id':'gwazyjustcause.github.io/maticaminhos'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
for(const [name,from,to]of cases){
 if(process.argv[2]&&!new RegExp(process.argv[2]).test(name))continue;
 try{
  const result=await request('route',{locations:[from,to].map(([lat,lon])=>({lat,lon})),costing:'auto',costing_options:{auto:{use_tolls:0.5}},directions_type:'none'});
  const leg=result.trip.legs[0];
  const trace=await request('trace_attributes',tollTracePayload({encodedShape:leg.shape}));
  const shape=decodePolyline6(trace.shape);
  const crossings=trace.edges.filter(e=>/^toll_(booth|gantry)$/.test(e.end_node?.type)).map(e=>{const [lon,lat]=shape[e.end_shape_index];const station=identifyTollStation({lat,lon},catalog.stations);return {lat,lon,id:station?.id||null,name:station?.name||null};});
  const price=leg.summary.has_toll===false?{complete:true,cents:[0,0,0,0],charges:[]}:priceTollTrace(trace,catalog);
  const previous=report.findIndex(r=>r.name===name);if(previous>=0)report.splice(previous,1);
  report.push({name,hasToll:leg.summary.has_toll,km:leg.summary.length,crossings,...price,trace});
  await fs.writeFile(new URL('../artifacts/toll-feasibility/live-audit.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,complete:price.complete,cents:price.cents,reason:price.reason,crossings:crossings.map(c=>c.id||[c.lat,c.lon])}));
 }catch(error){report.push({name,error:error.message});console.log(name,error.message);}
}
await fs.writeFile(new URL('../artifacts/toll-feasibility/live-audit.json',import.meta.url),JSON.stringify(report,null,2));
