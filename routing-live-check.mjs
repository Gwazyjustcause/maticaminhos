import assert from 'node:assert/strict';
import {tripLegs,routePayload,parseTrip} from './routing.mjs';
const depot={name:'Matisilva',lat:40.1299257,lon:-8.5240277},destination={name:'Leiria',lat:39.7444,lon:-8.8072};
for(const mode of ['allow','avoid']){
  const batch={mode,legs:tripLegs(depot,[destination],false,mode)};
  const response=await fetch('https://valhalla1.openstreetmap.de/route?json='+encodeURIComponent(JSON.stringify(routePayload(batch))),{headers:{'X-Client-Id':'gwazyjustcause.github.io/maticaminhos'},signal:AbortSignal.timeout(30000)});
  assert.equal(response.ok,true);
  const [leg]=parseTrip(await response.json(),batch);
  assert.ok(leg.geometry.coordinates.length>2);assert.ok(leg.duration>0);
  if(mode==='avoid')assert.equal(leg.hasToll,false);
  console.log(JSON.stringify({mode,distanceKm:Math.round(leg.distance/100)/10,minutes:Math.round(leg.duration/60),hasToll:leg.hasToll,points:leg.geometry.coordinates.length}));
  await new Promise(resolve=>setTimeout(resolve,1200));
}
