import {decodePolyline6,distanceMetres} from './routing.mjs?v=12';

export function tollTracePayload(leg){
  return {encoded_polyline:leg.encodedShape,shape_match:'edge_walk',costing:'auto',filters:{action:'include',attributes:['edge.toll','edge.names','edge.end_shape_index','edge.begin_shape_index','node.type','shape']}};
}
export function identifyTollStation(point,stations){
  const matches=stations.map(station=>({station,distance:Math.min(...station.points.map(p=>distanceMetres(point,p)))})).filter(m=>m.distance<=(m.station.exactOnly?3:80)).sort((a,b)=>a.distance-b.distance);
  if(!matches.length)return null;
  // Exact OSM lane-node matches distinguish adjacent plazas with different
  // tariffs (e.g. the main Carcavelos barrier and its cheaper slip roads).
  if(matches[0].distance<=3&&(!matches[1]||matches[1].distance>3))return matches[0].station;
  if(matches[1]&&matches[1].distance-matches[0].distance<20)return null;
  return matches[0].station;
}
const zero=()=>[0,0,0,0];
export function priceTollTrace(trace,catalog){
  const unavailable=reason=>({complete:false,cents:null,reason,charges:[]});
  if(!Array.isArray(trace?.edges)||!trace.edges.length)return unavailable('Não foi possível identificar as portagens deste trajeto.');
  let shape;try{shape=decodePolyline6(trace.shape);}catch{return unavailable('Traçado de portagens indisponível.');}
  const tolledEdges=trace.edges.filter(edge=>edge.toll===true);
  const freeRefs=new Set(catalog.freeRoadRefs||[]);
  const namedFree=edge=>{
    const refs=(Array.isArray(edge.names)?edge.names:[]).flatMap(name=>String(name).toUpperCase().match(/\bA\s*\d+\b/g)||[]).map(ref=>ref.replace(/\s/g,''));
    return refs.length>0&&refs.every(ref=>freeRefs.has(ref));
  };
  // Exit plazas may sit on non-tolled approach lanes: inspect every crossing.
  // Obsolete gantries are skipped only when the local catalogue verifies them free.
  const gates=trace.edges.filter(edge=>/^toll_(booth|gantry)$/.test(edge.end_node?.type));
  if(tolledEdges.length&&tolledEdges.every(namedFree)&&gates.every(gate=>{
    const coordinate=shape[gate.end_shape_index];if(!coordinate)return false;
    const station=identifyTollStation({lat:coordinate[1],lon:coordinate[0]},catalog.stations);
    return station?station.kind==='free':namedFree(gate);
  }))return {complete:true,cents:zero(),charges:[],reason:''};
  if(!gates.length)return unavailable('Há um troço com portagens sem preço identificado.');
  const cents=zero(),charges=[];let entry=null,previous=null;
  for(const gate of gates){
    const coordinate=shape[gate.end_shape_index];
    if(!coordinate)return unavailable('Localização de portagem indisponível.');
    const station=identifyTollStation({lat:coordinate[1],lon:coordinate[0]},catalog.stations);
    if(!station)return unavailable('Este trajeto passa numa portagem ainda sem tarifa na tabela local.');
    if(station.kind==='free')continue;
    // Several lanes/nodes at the same physical plaza are one crossing. Never
    // deduplicate separate visits to the same station later in a trip.
    let along=0;
    if(previous?.id===station.id)for(let i=previous.index+1;i<=gate.end_shape_index&&along<=80;i++)along+=distanceMetres({lat:shape[i-1][1],lon:shape[i-1][0]},{lat:shape[i][1],lon:shape[i][0]});
    if(previous?.id===station.id&&along<=80)continue;
    previous={id:station.id,index:gate.end_shape_index};
    if(station.kind==='open'){
      if(entry)return unavailable('Combinação de sistemas de portagem ainda não coberta.');
      if(!Array.isArray(station.cents)||station.cents.length!==4)return unavailable('Tarifa desta portagem indisponível.');
      charges.push({label:station.name,cents:station.cents});
    }else if(!entry){entry=station;}
    else{
      const fare=catalog.rates[entry.id+'>'+station.id];
      if(entry.id===station.id||!Array.isArray(fare)||fare.length!==4)return unavailable(`Sem tarifa verificada: ${entry.name} → ${station.name}.`);
      charges.push({label:entry.name+' → '+station.name,cents:fare});entry=null;
    }
  }
  if(entry)return unavailable('Não foi possível confirmar a entrada e a saída da autoestrada neste trajeto.');
  if(!charges.length)return unavailable('Não foi possível confirmar todos os troços deste trajeto.');
  for(const charge of charges)for(let i=0;i<4;i++){
    const value=charge.cents[i];if(!Number.isSafeInteger(value)||value<0)return unavailable('Tarifa inválida.');cents[i]+=value;
  }
  return {complete:true,cents,charges,reason:''};
}
export function totalTollPrices(prices){
  const complete=prices.length>0&&prices.every(p=>p?.complete);
  return {complete,cents:complete?prices.reduce((sum,p)=>sum.map((v,i)=>v+p.cents[i]),zero()):null,missing:prices.filter(p=>!p?.complete).length};
}
export function selectedTollPrice(pricing,tollClass){
  if(!pricing?.complete||!/^\d$/.test(String(tollClass))||Number(tollClass)<1||Number(tollClass)>4)return null;
  return pricing.cents[Number(tollClass)-1]/100;
}
