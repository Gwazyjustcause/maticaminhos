export const pointKey=p=>`${Number(p.lat).toFixed(6)},${Number(p.lon).toFixed(6)}`;
export const legKey=(from,to)=>`${pointKey(from)}>${pointKey(to)}`;
export function tripLegs(depot,stops,roundtrip,mode,overrides={}){
  const points=[depot,...stops,...(roundtrip&&stops.length?[depot]:[])];
  return points.slice(1).map((to,i)=>({from:points[i],to,key:legKey(points[i],to),mode:overrides[legKey(points[i],to)]||mode,index:i}));
}
export function routeBatches(legs,max=6){
  const batches=[];
  for(const leg of legs){const last=batches.at(-1);if(last&&last.mode===leg.mode&&last.legs.length<max&&pointKey(last.legs.at(-1).to)===pointKey(leg.from))last.legs.push(leg);else batches.push({mode:leg.mode,legs:[leg]});}
  return batches;
}
export function costing(mode){return {auto:{use_tolls:mode==='avoid'?0:0.5,...(mode==='avoid'?{exclude_tolls:true}:{})}};}
const validCoordinate=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
export function distanceMetres(a,b){const rad=x=>x*Math.PI/180,dLat=rad(a.lat-b.lat),dLon=rad(a.lon-b.lon);return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2)));}
export function accessKey(p){return pointKey(p)+'|'+(validCoordinate(p.manualAccess)?pointKey(p.manualAccess):'auto');}
export function roadAccessPayload(points){return {locations:points.map(p=>({...validCoordinate(p.manualAccess)?{lat:p.manualAccess.lat,lon:p.manualAccess.lon}:{lat:p.lat,lon:p.lon},radius:100,search_cutoff:500,minimum_reachability:50,search_filter:{max_road_class:'trunk',exclude_ramp:true,exclude_ferry:true}})),costing:'auto',verbose:false};}
export function resolveRoadAccess(point,result){
  const manual=validCoordinate(point.manualAccess),input=manual?point.manualAccess:point;
  const fail=()=>{const error=new Error(`Não foi encontrado um acesso de viatura próximo de «${point.name}». Use «Acesso» nessa paragem para indicar a entrada pela estrada.`);error.place=point;return error;};
  if(manual&&distanceMetres(point,input)>1000)throw fail();
  const candidates=(result?.edges||[]).map(edge=>({lat:edge.correlated_lat,lon:edge.correlated_lon})).filter(validCoordinate).map(p=>({...p,distance:distanceMetres(input,p)})).filter(p=>p.distance<=(manual?100:300)).sort((a,b)=>a.distance-b.distance);
  if(!candidates.length)throw fail();
  const nearest=candidates[0];return {lat:nearest.lat,lon:nearest.lon,offset:distanceMetres(point,nearest),manual};
}
export function routingLocation(p){const road=validCoordinate(p.road)?p.road:null;return {lat:road?.lat??p.lat,lon:road?.lon??p.lon,type:'break',radius:road?30:100,search_cutoff:road?75:500,minimum_reachability:50,search_filter:{max_road_class:'trunk',exclude_ramp:true,exclude_ferry:true}};}
export function routePayload(batch){return {locations:[batch.legs[0].from,...batch.legs.map(leg=>leg.to)].map(routingLocation),costing:'auto',costing_options:costing(batch.mode),directions_type:'none',units:'kilometers'};}
export function decodePolyline6(encoded){
  if(typeof encoded!=='string'||!encoded.length)throw new Error('O serviço não devolveu o traçado do percurso.');
  const points=[];let index=0,lat=0,lon=0;
  const next=()=>{let result=0,shift=0,byte;do{if(index>=encoded.length||shift>30)throw new Error('Traçado de percurso inválido.');byte=encoded.charCodeAt(index++)-63;if(byte<0||byte>63)throw new Error('Traçado de percurso inválido.');result|=(byte&31)<<shift;shift+=5;}while(byte>=32);return result&1?~(result>>1):result>>1;};
  while(index<encoded.length){lat+=next();lon+=next();points.push([lon/1e6,lat/1e6]);}
  return points;
}
export function parseTrip(data,batch){
  if(data?.trip?.status!==0||!Array.isArray(data.trip.legs)||data.trip.legs.length!==batch.legs.length)throw new Error(data?.error||'Não foi possível calcular este percurso.');
  return data.trip.legs.map((result,i)=>{
    const leg=batch.legs[i],summary=result.summary;
    if(!summary||!Number.isFinite(summary.time)||!Number.isFinite(summary.length)||summary.time<0||summary.length<0)throw new Error('Tempos de percurso indisponíveis.');
    if(leg.mode==='avoid'&&summary.has_toll!==false)throw new Error(`Não foi possível confirmar um percurso sem portagens entre ${leg.from.name} e ${leg.to.name}. Altere o trajeto ou permita portagens neste trecho.`);
    return {...leg,duration:summary.time,distance:summary.length*1000,hasToll:typeof summary.has_toll==='boolean'?summary.has_toll:null,encodedShape:result.shape,geometry:{type:'LineString',coordinates:decodePolyline6(result.shape)}};
  });
}
export function totalTrip(legs,stops,service){
  const driving=legs.reduce((sum,leg)=>sum+leg.duration,0),distance=legs.reduce((sum,leg)=>sum+leg.distance,0),delivery=stops*service*60;
  return {driving,distance,delivery,duration:driving+delivery};
}
export function arrivalTime(departure,seconds){
  if(!/^\d{2}:\d{2}$/.test(departure)||!Number.isFinite(seconds))return '—';
  const [h,m]=departure.split(':').map(Number);if(h>23||m>59)return '—';
  const total=h*60+m+Math.round(seconds/60),days=Math.floor(total/1440);
  return `${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}${days?` (+${days} dia${days>1?'s':''})`:''}`;
}
export function moveStop(stops,from,to){const next=[...stops];if(from<0||to<0||from>=next.length||to>=next.length)return next;const [p]=next.splice(from,1);next.splice(to,0,p);return next;}
export function matrixBatches(points,size=10){const batches=[];for(let i=0;i<points.length;i+=size)for(let j=0;j<points.length;j+=size)batches.push({sourceOffset:i,targetOffset:j,sources:points.slice(i,i+size),targets:points.slice(j,j+size)});return batches;}
export async function matrixTimes(rows,sources,targets,resolveMissing){
  if(!Array.isArray(rows)||rows.length!==sources.length||rows.some(row=>!Array.isArray(row)||row.length!==targets.length))throw new Error('O serviço não conseguiu comparar as paragens. Pode calcular na ordem atual.');
  const times=[];
  for(let i=0;i<sources.length;i++){
    const row=[];
    for(let j=0;j<targets.length;j++){
      let time=rows[i][j]?.time;
      // A matrix can miss destination-only access roads that /route can reach.
      if(!Number.isFinite(time)||time<0)time=await resolveMissing(sources[i],targets[j]);
      if(!Number.isFinite(time)||time<0)throw new Error('Não foi possível confirmar o tempo de condução entre as paragens.');
      row.push(time);
    }
    times.push(row);
  }
  return times;
}
export function normalizeQuery(value){const trimmed=value.trim();if(/^\d{4}$/.test(trimmed))return trimmed+' Portugal';return /^\d{4}\s*-?\s*\d{3}$/.test(trimmed)?trimmed.replace(/\D/g,'').replace(/^(\d{4})(\d{3})$/,'$1-$2')+' Portugal':trimmed;}
