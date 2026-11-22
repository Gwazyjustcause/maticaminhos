import assert from 'node:assert/strict';
import fs from 'node:fs';
import {priceTollTrace,totalTollPrices,selectedTollPrice,identifyTollStation} from './tolls.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('./toll-data.json',import.meta.url),'utf8'));
const station=id=>catalog.stations.find(s=>s.id===id).points[0];
function encode(points){let oldLat=0,oldLon=0,out='';for(const p of points){const lat=Math.round(p.lat*1e6),lon=Math.round(p.lon*1e6);for(const delta of [lat-oldLat,lon-oldLon]){let n=delta<0?~(delta<<1):delta<<1;while(n>=32){out+=String.fromCharCode((32|(n&31))+63);n>>>=5;}out+=String.fromCharCode(n+63);}oldLat=lat;oldLon=lon;}return out;}
function trace(points,gates=points.map((_,i)=>i)){return {shape:encode(points),edges:points.map((_,i)=>({toll:true,end_shape_index:i,...(gates.includes(i)?{end_node:{type:'toll_booth'}}:{})}))};}
const outbound=priceTollTrace(trace([station('0137'),station('0121')]),catalog);
const inbound=priceTollTrace(trace([station('0121'),station('0119')]),catalog);
assert.deepEqual(priceTollTrace(trace([station('0133'),station('0119')]),catalog).cents,[860,1510,1945,2150],'CREP/A1 IC24 Sul is a distinct plaza from Grijó PV.');
assert.deepEqual(priceTollTrace(trace([station('0119'),station('0133')]),catalog).cents,[860,1510,1945,2150]);
const nonTolledExit=trace([station('0119'),station('0117')]);nonTolledExit.edges[1].toll=false;
assert.deepEqual(priceTollTrace(nonTolledExit,catalog).cents,catalog.rates['0119>0117'],'An exit remains a toll crossing even if its approach lane is tagged toll=false.');
const freeGantry=station('a25-albergaria');
assert.deepEqual(priceTollTrace(trace([freeGantry,station('0114'),station('0119')]),catalog).cents,catalog.rates['0114>0119'],'The abolished A25 gantry does not shift A1 entry/exit pairing.');
assert.deepEqual(priceTollTrace(trace([freeGantry]),catalog).cents,[0,0,0,0]);
assert.deepEqual(outbound.cents,[390,680,875,970]);
assert.deepEqual(inbound.cents,[515,900,1160,1285]);
const total=totalTollPrices([outbound,inbound,{complete:true,cents:[0,0,0,0]}]);
assert.equal(selectedTollPrice(total,'1'),9.05);assert.equal(selectedTollPrice(total,'2'),15.8);assert.equal(selectedTollPrice(total,'4'),22.55);
for(const value of ['',null,0,5,'1x'])assert.equal(selectedTollPrice(total,value),null);
const missing=priceTollTrace(trace([station('0137'),{lat:39.1,lon:-7.1}]),catalog);
assert.equal(missing.complete,false);assert.equal(totalTollPrices([outbound,missing]).cents,null);
assert.equal(priceTollTrace(trace([station('0137')]),catalog).complete,false);
assert.equal(priceTollTrace(trace([station('0137'),{lat:40.4,lon:-8},station('0137')],[0,2]),catalog).complete,false,'Do not discard a later crossing of the same plaza or charge the maximum/lost-ticket diagonal.');
const near={...station('0137'),lat:station('0137').lat+0.00001};
assert.deepEqual(priceTollTrace(trace([station('0137'),near,station('0121')]),catalog).cents,outbound.cents,'Adjacent lane nodes count once.');
assert.equal(identifyTollStation(station('0137'),[{id:'a',points:[station('0137')]},{id:'b',points:[station('0137')]}]),null,'Ambiguous plazas are not guessed.');
assert.equal(priceTollTrace({edges:[],shape:''},catalog).complete,false);
assert.equal(priceTollTrace({shape:encode([station('0137')]),edges:[{toll:false,end_shape_index:0,end_node:{type:'toll_gantry'}}]},catalog).complete,false,'An old gantry alone is not proof of a payable fare.');
for(const [key,prices] of Object.entries(catalog.rates)){assert.notEqual(...key.split('>'));assert.equal(prices.length,4);assert.ok(prices.every(c=>Number.isSafeInteger(c)&&c>=0));}
assert.equal(new Set(catalog.stations.map(s=>s.id)).size,catalog.stations.length);
console.log('Passed: actual class 1–4 tariffs, directed return, mixed trips, missing coverage, repeated/ambiguous crossings, obsolete gantries, and no maximum-ticket diagonals.');
