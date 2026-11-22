import assert from 'node:assert/strict';
import fs from 'node:fs';
import {roadAccessPayload,resolveRoadAccess,tripLegs,routePayload,parseTrip} from './routing.mjs';
import {tollTracePayload,priceTollTrace,totalTollPrices} from './tolls.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./toll-data.json',import.meta.url),'utf8'));
let last=0;
async function request(endpoint,payload){const pause=Math.max(0,1100-(Date.now()-last));if(pause)await new Promise(r=>setTimeout(r,pause));last=Date.now();const r=await fetch('https://valhalla1.openstreetmap.de/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Client-Id':'gwazyjustcause.github.io/maticaminhos'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});assert.equal(r.ok,true);return r.json();}
const points=[{name:'Matisilva',lat:40.1299257,lon:-8.5240277},{name:'Leiria',lat:39.7444,lon:-8.8072},{name:'CREP/A1',lat:41.01452,lon:-8.5292},{name:'Porto',lat:41.1496,lon:-8.6109},{name:'Pingo Doce Trancoso',lat:40.764761,lon:-7.355542}];
const located=await request('locate',roadAccessPayload(points));const [depot,leiria,crep,porto,trancoso]=points.map((p,i)=>({...p,road:resolveRoadAccess(p,located[i])}));
const prices=[];
for(const [from,to,expected] of [[depot,leiria,[390,680,875,970]],[leiria,depot,[515,900,1160,1285]]]){
  const batch={mode:'allow',legs:tripLegs(from,[to],false,'allow')};
  const leg=parseTrip(await request('route',routePayload(batch)),batch)[0];
  const price=priceTollTrace(await request('trace_attributes',tollTracePayload(leg)),catalog);
  assert.equal(price.complete,true,price.reason);assert.deepEqual(price.cents,expected);prices.push(price);
  console.log(JSON.stringify({from:from.name,to:to.name,...price}));
}
assert.deepEqual(totalTollPrices(prices).cents,[905,1580,2035,2255]);
console.log('Live proof: real road-access coordinates, both directions, static class tariffs, whole-trip total.');
for(const [from,to,pair] of [[crep,depot,'0133>0119'],[depot,crep,'0119>0133'],[depot,porto,'0119>0134'],[porto,depot,'0134>0119'],[depot,trancoso,'0119>0117'],[trancoso,depot,'0114>0119']]){
  const batch={mode:'allow',legs:tripLegs(from,[to],false,'allow')};
  const leg=parseTrip(await request('route',routePayload(batch)),batch)[0];
  const price=priceTollTrace(await request('trace_attributes',tollTracePayload(leg)),catalog);
  assert.equal(price.complete,true,`${from.name} → ${to.name}: ${price.reason}`);
  assert.deepEqual(price.cents,catalog.rates[pair]);
  console.log(JSON.stringify({regression:from.name+' → '+to.name,cents:price.cents,charges:price.charges.map(c=>c.label)}));
}
