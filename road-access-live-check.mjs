import assert from 'node:assert/strict';
import {roadAccessPayload,resolveRoadAccess,routingLocation,tripLegs,routePayload,parseTrip,distanceMetres,matrixTimes,costing} from './routing.mjs';
import {optimizeOrder} from './optimizer.mjs';
const points=[{name:'Matisilva',lat:40.1299257,lon:-8.5240277},{name:'Restaurante O Casimiro',lat:40.2637622,lon:-8.2775141},{name:'Pin no interior do centro comercial',lat:40.2040,lon:-8.3965}];
let last=0;
async function request(endpoint,payload){const wait=Math.max(0,1100-(Date.now()-last));if(wait)await new Promise(r=>setTimeout(r,wait));last=Date.now();const response=await fetch('https://valhalla1.openstreetmap.de/'+endpoint+'?json='+encodeURIComponent(JSON.stringify(payload)),{headers:{'X-Client-Id':'gwazyjustcause.github.io/maticaminhos'},signal:AbortSignal.timeout(30000)});assert.equal(response.ok,true);return response.json();}
const located=await request('locate',roadAccessPayload(points));
const prepared=points.map((p,i)=>({...p,road:resolveRoadAccess(p,located[i])}));
const locations=prepared.map(routingLocation);
const matrix=await request('sources_to_targets',{sources:locations,targets:locations,costing:'auto',units:'kilometers'});
const order=optimizeOrder(matrix.sources_to_targets.map(row=>row.map(c=>c.time)),true);
const batch={mode:'allow',legs:tripLegs(prepared[0],order.map(i=>prepared[i]),true,'allow')};
const route=parseTrip(await request('route',routePayload(batch)),batch);
assert.equal(route.length,points.length);
for(const leg of route){const start=leg.geometry.coordinates[0],end=leg.geometry.coordinates.at(-1);assert.ok(distanceMetres({lat:start[1],lon:start[0]},leg.from.road)<80);assert.ok(distanceMetres({lat:end[1],lon:end[0]},leg.to.road)<80);}
console.log(JSON.stringify({accesses:prepared.map(p=>({name:p.name,offsetMetres:Math.round(p.road.offset)})),visitingOrder:order.map(i=>prepared[i].name),legs:route.length,minutes:Math.round(route.reduce((sum,l)=>sum+l.duration,0)/60)}));
// Regression: the comparison service returns null for this destination-only shop access,
// while the full route service finds a legal driving route without moving the place pin.
const shop={name:'Pingo Doce Crujeiro - Trancoso',lat:40.764761,lon:-7.355542};
const shopLocated=await request('locate',roadAccessPayload([shop]));
const pair=[prepared[0],{...shop,road:resolveRoadAccess(shop,shopLocated[0])}],pairLocations=pair.map(routingLocation);
for(const mode of ['allow','avoid']){
  const comparison=await request('sources_to_targets',{sources:pairLocations,targets:pairLocations,costing:'auto',costing_options:costing(mode),units:'kilometers'});
  const recovered=[];
  const times=await matrixTimes(comparison.sources_to_targets,pair,pair,async(from,to)=>{
    const batch={mode,legs:tripLegs(from,[to],false,mode)};
    const leg=parseTrip(await request('route',routePayload(batch)),batch)[0];
    recovered.push({from:from.name,to:to.name,minutes:Math.round(leg.duration/60),hasToll:leg.hasToll});
    return leg.duration;
  });
  assert.ok(times[0][1]>0&&times[1][0]>0);assert.deepEqual(optimizeOrder(times,true),[1]);
  console.log(JSON.stringify({regression:shop.name,mode,recovered}));
}
