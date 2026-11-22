import assert from 'node:assert/strict';
import fs from 'node:fs';
import {identifyTollStation} from '../tolls.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../toll-data.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('./toll-stations.json',import.meta.url),'utf8'));
const ids=new Set(catalog.stations.map(s=>s.id)),sources=new Set(catalog.sources.map(s=>s.id).filter(Boolean));
assert.equal(ids.size,catalog.stations.length);
const validPrices=prices=>Array.isArray(prices)&&prices.length===4&&prices.every(p=>Number.isSafeInteger(p)&&p>=0&&p%5===0);
for(const station of catalog.stations){
 assert.ok(['closed','open','free'].includes(station.kind),station.id);
 assert.ok(station.points.length,station.id);
 if(station.kind==='open'){assert.ok(validPrices(station.cents),station.id);assert.ok(sources.has(station.source),station.id);}
 for(const point of station.points){
  assert.ok(Number.isFinite(point.lat)&&Number.isFinite(point.lon)&&point.lat>36.9&&point.lat<42.2&&point.lon>-9.6&&point.lon<-6,station.id);
  assert.equal(identifyTollStation(point,catalog.stations)?.id,station.id,'Conflicting lane geometry: '+station.id);
 }
}
for(const [key,prices]of Object.entries(catalog.rates)){
 const [a,b]=key.split('>');assert.notEqual(a,b);assert.ok(ids.has(a)&&ids.has(b),key);assert.ok(validPrices(prices),key);assert.ok(sources.has(catalog.rateSources[key]),key);
 const source=catalog.reverseOf[key];if(source){assert.deepEqual(catalog.rates[source],prices,key);assert.equal(source,b+'>'+a);}
}
for(const[a,b]of manifest.invalidPairs||[])for(const key of [a+'>'+b,b+'>'+a])assert.equal(catalog.rates[key],undefined,'Maximum/lost-ticket cell must not be used: '+key);
// Independent published reference journeys exercise every class and the
// previously clipped first column, instead of only checking data structure.
for(const[key,prices]of Object.entries({
 '0119>0112':[765,1340,1730,1910],
 '0121>0112':[1280,2240,2890,3195],
 '0134>0128':[2505,4385,5650,6275],
 '0311>0323':[1020,1775,2280,2535],
 '0411>0420':[475,825,1070,1185],
 '1711>1721':[890,1565,2005,2230],
 '0211>0222':[2380,4165,5350,5950],
 '0211>0618':[1910,3345,4280,4760],
 '0710>0716':[385,685,870,970],
 '4126>4121':[345,615,0,0],
 '3201>3206':[345,610,780,870],
 '1411>0117':[290,505,650,725]
}))assert.deepEqual(catalog.rates[key],prices,'Published reference fare: '+key);
console.log(`Catalog audit passed: ${ids.size} charging locations, ${Object.keys(catalog.rates).length} four-class directed fares, lane separation, provenance, exclusions and reference journeys.`);
