import {optimizeOrder} from './optimizer.mjs';
import {fuelEstimate,totalEstimate,confirmedToll} from './costs.mjs';
import {pointKey,legKey,tripLegs,routeBatches,routePayload,parseTrip,totalTrip,arrivalTime,moveStop,normalizeQuery,costing,matrixBatches} from './routing.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(value);
const decimal=value=>new Intl.NumberFormat('pt-PT',{maximumFractionDigits:1}).format(value);
const duration=seconds=>{const minutes=Math.round(seconds/60);return minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:`${minutes} min`;};
const defaultDepot={name:'Matisilva — Carnes Lda',address:'Zona Industrial · Condeixa-a-Nova',lat:40.1299257,lon:-8.5240277};
const validPlace=p=>p&&typeof p.name==='string'&&typeof p.address==='string'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180;
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const modeValue=value=>value==='avoid'?'avoid':'allow';
const now=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Lisbon',hourCycle:'h23'}).format(new Date());
let state={depot:defaultDepot,stops:[],saved:[],roundtrip:true,service:10,consumption:null,fuelPrice:null,tollClass:'',mode:'allow',overrides:{},departure:now};
try{
  const data=JSON.parse(localStorage.getItem('maticaminhos-v1'));
  if(data)state={
    depot:validPlace(data.depot)?data.depot:defaultDepot,
    stops:Array.isArray(data.stops)?data.stops.filter(validPlace).slice(0,25):[],
    saved:Array.isArray(data.saved)?data.saved.filter(validPlace).slice(0,500):[],
    roundtrip:data.roundtrip!==false,service:Number.isFinite(data.service)?Math.max(0,Math.min(120,data.service)):10,
    consumption:positive(data.consumption),fuelPrice:positive(data.fuelPrice),tollClass:/^[1-4]$/.test(data.tollClass)?String(data.tollClass):'',
    mode:modeValue(data.mode),overrides:Object.fromEntries(Object.entries(data.overrides||{}).filter(([,v])=>v==='allow'||v==='avoid')),
    departure:/^\d{2}:\d{2}$/.test(data.departure)?data.departure:now
  };
}catch{}
let route=null,busy=false,searching=false,changingDepot=false,pending=null,pendingMarker=null,pendingFavorite=false,toastTimer,calculateTimer,results=[],showingFavorites=false,draggedIndex=null;
let map,markers,routeLines;
const legCache=new Map();
const samePlace=(a,b)=>pointKey(a)===pointKey(b);
const isFavorite=place=>state.saved.some(p=>samePlace(p,place));
function notify(message){$('status').textContent=message;$('status').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('status').hidden=true,6500);}
function persist(){try{localStorage.setItem('maticaminhos-v1',JSON.stringify(state));}catch{notify('Não foi possível guardar neste navegador. Exporte a lista nas opções.');}}
function initializeMap(){
  if(!window.L){$('map').innerHTML='<p style="padding:70px 20px">O mapa não carregou. Atualize a página para tentar novamente. Pode continuar a pesquisar locais.</p>';return;}
  map=L.map('map',{scrollWheelZoom:true,zoomControl:false}).setView([state.depot.lat,state.depot.lon],11);
  L.control.zoom({position:'topleft'}).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  markers=L.layerGroup().addTo(map);routeLines=L.layerGroup().addTo(map);
  map.on('click',event=>{
    if(busy)return;
    if(pending){pending.lat=event.latlng.lat;pending.lon=event.latlng.lng;pending.approximate=false;pendingMarker?.setLatLng(event.latlng);}
    else beginPicker({name:'',address:`${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`,lat:event.latlng.lat,lon:event.latlng.lng});
  });
  new ResizeObserver(()=>map.invalidateSize()).observe($('map'));
  drawMap(true);
}
function drawMap(fit=false){
  if(!map)return;
  markers.clearLayers();routeLines.clearLayers();
  [state.depot,...state.stops].forEach((p,i)=>L.marker([p.lat,p.lon],{icon:L.divIcon({className:'map-pin'+(!i?' depot-pin':''),html:i||'⌂',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(markers).bindPopup(`<strong>${escapeHTML(p.name)}</strong><br>${escapeHTML(p.address)}`));
  if(route)route.legs.forEach(leg=>L.geoJSON(leg.geometry,{style:{color:leg.mode==='avoid'?'#16867c':'#7166ab',weight:5,opacity:.9}}).addTo(routeLines));
  if(fit)fitMap();
}
function fitMap(){
  if(!map)return;
  const points=[state.depot,...state.stops].map(p=>[p.lat,p.lon]);
  if(route)route.legs.forEach(leg=>leg.geometry.coordinates.forEach(([lon,lat])=>points.push([lat,lon])));
  map.fitBounds(L.latLngBounds(points),{padding:[40,55],maxZoom:14});
}
$('fit').onclick=fitMap;
function closeResults(){$('results-panel').hidden=true;}
$('close-results').onclick=closeResults;
function beginPicker(place,editIndex=null){
  if(busy)return;
  closeResults();pending={...place,editIndex};pendingFavorite=isFavorite(place);$('place-name').value=place.name;
  $('picker-title').textContent=changingDepot?'Ponto de partida':editIndex!==null?'Editar paragem':place.approximate?'Confirmar a entrada de entrega':'Confirmar local';
  $('picker-help').textContent=place.approximate?'Localização aproximada. Arraste o pin até à entrada.':'Arraste o pin para ajustar a entrada de entrega.';
  $('picker-heart').textContent=pendingFavorite?'♥':'♡';$('picker-heart').setAttribute('aria-pressed',String(pendingFavorite));
  $('confirm-place').textContent=editIndex!==null?'Guardar':'Adicionar';$('place-picker').hidden=false;
  if(map){
    pendingMarker?.remove();pendingMarker=L.marker([place.lat,place.lon],{draggable:true,icon:L.divIcon({className:'',html:'<div class="selection-pin"></div>',iconSize:[33,33],iconAnchor:[16,28]})}).addTo(map);
    pendingMarker.on('dragend',()=>{const p=pendingMarker.getLatLng();pending.lat=p.lat;pending.lon=p.lng;pending.approximate=false;});
    map.flyTo([place.lat,place.lon],place.approximate?15:17,{duration:.4});
  }
}
function cancelPicker(){pending=null;pendingMarker?.remove();pendingMarker=null;$('place-picker').hidden=true;}
$('cancel-picker').onclick=cancelPicker;
$('pick-map').onclick=()=>{if(!map)return notify('O mapa não está disponível. Atualize a página.');notify('Toque no mapa na entrada de entrega. Depois dê um nome ao local.');closeResults();};
$('picker-heart').onclick=()=>{pendingFavorite=!pendingFavorite;$('picker-heart').textContent=pendingFavorite?'♥':'♡';$('picker-heart').setAttribute('aria-pressed',String(pendingFavorite));};
$('confirm-place').onclick=()=>{
  if(!pending||busy)return;
  const place={name:$('place-name').value.trim()||pending.name||pending.address,address:pending.address,lat:pending.lat,lon:pending.lon,approximate:pending.approximate===true};
  const editIndex=pending.editIndex;
  if(editIndex!==null){
    const old=state.stops[editIndex];
    if(state.stops.some((p,i)=>i!==editIndex&&samePlace(p,place)))return notify('Este local já está na rota.');
    if(isFavorite(old))state.saved=state.saved.filter(p=>!samePlace(p,old));
    state.stops[editIndex]=place;
    if(pendingFavorite&&!isFavorite(place))state.saved.push(place);
    cancelPicker();planChanged(true);persist();notify('Paragem atualizada.');
  }else{
    const save=pendingFavorite;
    if(!addPlace(place))return;
    if(save&&!isFavorite(place))state.saved.push(place);
    render();persist();cancelPicker();
  }
};
function toggleFavorite(place){
  const existing=state.saved.findIndex(p=>samePlace(p,place));
  if(existing>=0)state.saved.splice(existing,1);else{if(state.saved.length>=500)return notify('Já tem 500 favoritos.');state.saved.push({...place});}
  persist();render();if(!$('results-panel').hidden)renderResults();
}
function addPlace(place){
  if(busy)return false;
  if(changingDepot){state.depot={...place};changingDepot=false;$('change-depot').textContent='Alterar';$('search').placeholder='Loja, restaurante, morada ou código postal';}
  else{
    if(state.stops.length>=25){notify('A rota já tem 25 paragens.');return false;}
    if(state.stops.some(p=>samePlace(p,place))){notify('Este local já está na rota.');return false;}
    state.stops.push({...place});
  }
  closeResults();$('search').value='';planChanged(true);persist();notify('Local adicionado à rota. Use o coração para o guardar nos favoritos.');return true;
}
function planChanged(fit=false){
  const recalculate=!!route;
  route=null;$('toll-amount').value='';$('route-message').textContent=recalculate?'A atualizar a rota…':'Calcule a rota para atualizar os tempos.';render();drawMap(fit);persist();
  if(recalculate){clearTimeout(calculateTimer);calculateTimer=setTimeout(()=>calculate(false),180);}
}
$('change-depot').onclick=()=>{
  if(busy)return;
  changingDepot=!changingDepot;cancelPicker();
  $('change-depot').textContent=changingDepot?'Cancelar':'Alterar';
  $('search').placeholder=changingDepot?'Morada ou nome da empresa':'Loja, restaurante, morada ou código postal';
  $('search').focus();notify(changingDepot?'Procure o novo ponto de partida ou escolha no mapa.':'Partida mantida.');
};

function currentLegs(){return tripLegs(state.depot,state.stops,state.roundtrip,state.mode,state.overrides);}
function legHTML(leg){
  const result=route?.legs.find(p=>p.key===leg.key&&p.mode===leg.mode);
  const selected=state.overrides[leg.key]||'';
  return `<div class="leg"><p>${escapeHTML(leg.from.name)} → ${escapeHTML(leg.to.name)}</p><div class="leg-controls"><select data-leg-key="${escapeHTML(leg.key)}" aria-label="Portagens de ${escapeHTML(leg.from.name)} para ${escapeHTML(leg.to.name)}"><option value=""${selected===''?' selected':''}>${state.mode==='avoid'?'Evitar':'Permitir'} (geral)</option><option value="allow"${selected==='allow'?' selected':''}>Permitir portagens</option><option value="avoid"${selected==='avoid'?' selected':''}>Evitar portagens</option></select><span class="leg-time">${result?duration(result.duration)+' · '+decimal(result.distance/1000)+' km':busy?'A calcular…':'—'}</span></div></div>`;
}
function render(){
  const panel=document.querySelector('.route-panel'),scrollPosition=panel.scrollTop;
  const legs=currentLegs();
  $('depot-name').textContent=state.depot.name;$('count').textContent=`${state.stops.length} ${state.stops.length===1?'paragem':'paragens'}`;
  $('saved-count').textContent=state.saved.length;$('empty').hidden=state.stops.length>0;
  $('allow-tolls').setAttribute('aria-pressed',String(state.mode==='allow'));$('avoid-tolls').setAttribute('aria-pressed',String(state.mode==='avoid'));
  $('stop-list').innerHTML=state.stops.map((p,i)=>`${legHTML(legs[i])}<article class="stop${route&&i<route.completed?' done':''}" draggable="true" data-stop-index="${i}"><div class="stop-main"><span class="number">${route&&i<route.completed?'✓':i+1}</span><div class="stop-text"><button class="stop-name" data-edit="${i}" aria-label="Editar ${escapeHTML(p.name)}">${escapeHTML(p.name)}</button><small>${escapeHTML(p.address)}${p.approximate?' · Pin aproximado':''}</small></div></div><div class="stop-actions"><button class="move-button" data-up="${i}" aria-label="Subir ${escapeHTML(p.name)}" ${i===0?'disabled':''}>Subir</button><button class="move-button" data-down="${i}" aria-label="Descer ${escapeHTML(p.name)}" ${i===state.stops.length-1?'disabled':''}>Descer</button><button class="heart" data-heart="${i}" aria-label="${isFavorite(p)?'Retirar dos':'Guardar nos'} favoritos: ${escapeHTML(p.name)}" aria-pressed="${isFavorite(p)}">${isFavorite(p)?'♥':'♡'}</button><button class="icon-button" data-remove="${i}" aria-label="Remover ${escapeHTML(p.name)}">×</button></div></article>`).join('');
  $('return-leg').innerHTML=state.roundtrip&&state.stops.length?legHTML(legs.at(-1)):'';
  const hasStops=state.stops.length>0;
  $('calculate').disabled=busy||searching||!hasStops;$('optimize').disabled=busy||searching||state.stops.length<2;
  if(busy)for(const element of document.querySelectorAll('button,input,select'))element.disabled=true;
  renderSummary();renderNavigation();drawMap();panel.scrollTop=scrollPosition;
}
function renderSummary(){
  $('total-time').textContent=route?duration(route.duration):'—';
  $('time-breakdown').textContent=route?`${duration(route.driving)} a conduzir + ${duration(route.delivery)} nas entregas`:busy?'A calcular o percurso…':state.stops.length?'Calcule para ver a duração completa.':'Adicione os locais para começar.';
  $('total-distance').textContent=route?decimal(route.distance/1000):'—';
  $('arrival-time').textContent=route?arrivalTime(state.departure,route.duration):'—';
  $('map-status').textContent=busy?'A calcular os percursos…':route?`${decimal(route.distance/1000)} km · ${duration(route.duration)} no total`:state.stops.length?`${state.stops.length} ${state.stops.length===1?'paragem':'paragens'} no mapa`:'Partida da Matisilva';
  const fuel=route?fuelEstimate(route.distance,state.consumption,state.fuelPrice):null;
  $('fuel-cost').textContent=fuel?money(fuel.cost):'Preencher veículo';$('fuel-preview').textContent=fuel?money(fuel.cost)+' combustível':'—';
  const toll=route?.toll??null;
  $('toll-cost').textContent=toll!==null?money(toll):'Por confirmar';
  const total=totalEstimate(fuel?.cost??null,toll);$('total-cost').textContent=total!==null?money(total):'—';
}
$('stop-list').onclick=event=>{
  if(busy)return;
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-heart')){toggleFavorite(state.stops[Number(button.dataset.heart)]);return;}
  if(button.hasAttribute('data-edit')){const i=Number(button.dataset.edit);beginPicker(state.stops[i],i);return;}
  if(button.hasAttribute('data-remove'))state.stops.splice(Number(button.dataset.remove),1);
  if(button.hasAttribute('data-up')){const i=Number(button.dataset.up);state.stops=moveStop(state.stops,i,i-1);}
  if(button.hasAttribute('data-down')){const i=Number(button.dataset.down);state.stops=moveStop(state.stops,i,i+1);}
  planChanged();
};
function legChange(event){if(busy)return;const select=event.target.closest('[data-leg-key]');if(!select)return;if(select.value)state.overrides[select.dataset.legKey]=select.value;else delete state.overrides[select.dataset.legKey];planChanged();}
$('stop-list').addEventListener('change',legChange);$('return-leg').addEventListener('change',legChange);
function globalMode(mode){if(busy)return;state.mode=mode;state.overrides={};planChanged();notify('Preferência aplicada a todos os trajetos. Pode voltar a alterar cada trecho.');}
$('allow-tolls').onclick=()=>globalMode('allow');$('avoid-tolls').onclick=()=>globalMode('avoid');
$('stop-list').addEventListener('dragstart',event=>{const card=event.target.closest('[data-stop-index]');if(!card||busy){event.preventDefault();return;}draggedIndex=Number(card.dataset.stopIndex);card.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(draggedIndex));});
$('stop-list').addEventListener('dragover',event=>{if(draggedIndex===null)return;const card=event.target.closest('[data-stop-index]');if(card){event.preventDefault();card.classList.add('drag-over');}});
$('stop-list').addEventListener('dragleave',event=>event.target.closest('[data-stop-index]')?.classList.remove('drag-over'));
$('stop-list').addEventListener('drop',event=>{event.preventDefault();const card=event.target.closest('[data-stop-index]');if(card&&draggedIndex!==null&&!busy){state.stops=moveStop(state.stops,draggedIndex,Number(card.dataset.stopIndex));draggedIndex=null;planChanged();}});
$('stop-list').addEventListener('dragend',()=>{draggedIndex=null;for(const card of document.querySelectorAll('.stop'))card.classList.remove('dragging','drag-over');});

async function requestJSON(url,options={}){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Serviço indisponível. Tente novamente dentro de alguns minutos.');
  return data;
}
let lastRoutingRequest=0;
async function routingRequest(endpoint,payload){
  const wait=Math.max(0,1100-(Date.now()-lastRoutingRequest));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  lastRoutingRequest=Date.now();
  return requestJSON('https://valhalla1.openstreetmap.de/'+endpoint+'?json='+encodeURIComponent(JSON.stringify(payload)),{headers:{'X-Client-Id':'gwazyjustcause.github.io/maticaminhos'}});
}
async function matrixFor(points,mode){
  const matrix=points.map(()=>points.map(()=>null)),batches=matrixBatches(points);
  for(let i=0;i<batches.length;i++){
    const batch=batches[i],locations=places=>places.map(p=>({lat:p.lat,lon:p.lon}));
    $('route-message').textContent=`A comparar paragens ${i+1} de ${batches.length} (${mode==='avoid'?'evitar':'permitir'} portagens)…`;
    const data=await routingRequest('sources_to_targets',{sources:locations(batch.sources),targets:locations(batch.targets),costing:'auto',costing_options:costing(mode),units:'kilometers'});
    if(!Array.isArray(data.sources_to_targets)||data.sources_to_targets.length!==batch.sources.length||data.sources_to_targets.some(row=>row.length!==batch.targets.length))throw new Error('O serviço não conseguiu comparar as paragens. Pode calcular na ordem atual.');
    data.sources_to_targets.forEach((row,source)=>row.forEach((cell,target)=>matrix[batch.sourceOffset+source][batch.targetOffset+target]=cell.time));
  }
  return matrix;
}
function setBusy(value){
  busy=value;
  for(const element of document.querySelectorAll('button,input,select'))element.disabled=value;
  $('calculate').textContent=value?'A calcular…':'Calcular rota';
  render();
}
async function calculate(reorder){
  if(busy||searching||!state.stops.length)return;
  clearTimeout(calculateTimer);cancelPicker();closeResults();setBusy(true);
  route=null;$('toll-amount').value='';render();
  try{
    let stops=[...state.stops];
    if(reorder&&stops.length>1){
      $('route-message').textContent='A comparar tempos de viagem para sugerir a ordem…';
      const points=[state.depot,...stops],matrices={};
      matrices[state.mode]=await matrixFor(points,state.mode);
      const other=state.mode==='avoid'?'allow':'avoid';
      if(Object.values(state.overrides).includes(other))matrices[other]=await matrixFor(points,other);
      const matrix=points.map((from,i)=>points.map((to,j)=>matrices[state.overrides[legKey(from,to)]||state.mode][i][j]));
      stops=optimizeOrder(matrix,state.roundtrip).map(i=>points[i]);
    }
    const legs=tripLegs(state.depot,stops,state.roundtrip,state.mode,state.overrides),computed=new Map();
    for(const leg of legs){const cached=legCache.get(leg.key+'|'+leg.mode);if(cached)computed.set(leg.index,{...cached,...leg});}
    const batches=routeBatches(legs.filter(leg=>!computed.has(leg.index)));
    for(let i=0;i<batches.length;i++){
      $('route-message').textContent=`A calcular percursos ${i+1} de ${batches.length}…`;
      const batch=batches[i],data=await routingRequest('route',routePayload(batch));
      for(const result of parseTrip(data,batch)){computed.set(result.index,result);legCache.set(result.key+'|'+result.mode,result);}
    }
    const orderedLegs=legs.map(leg=>computed.get(leg.index));
    state.stops=stops;route={...totalTrip(orderedLegs,stops.length,state.service),legs:orderedLegs,completed:0,toll:null};
    $('route-message').textContent=reorder?'Ordem sugerida pelos tempos de condução. Pode ajustar as paragens e cada trajeto.':'Rota calculada na ordem apresentada. As alterações recalculam o tempo total.';
    render();drawMap(true);persist();
  }catch(error){$('route-message').textContent=error.name==='TimeoutError'?'O serviço demorou demasiado. Tente calcular novamente.':error.message;notify($('route-message').textContent);}
  finally{setBusy(false);}
}
$('calculate').onclick=()=>calculate(false);$('optimize').onclick=()=>calculate(true);

let lastSearch=0;
$('search-form').onsubmit=async event=>{
  event.preventDefault();if(busy||searching)return;
  const raw=$('search').value.trim();if(raw.length<3)return notify('Escreva um nome, uma morada ou um código postal.');
  const coord=raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(coord){const lat=Number(coord[1]),lon=Number(coord[2]);if(Math.abs(lat)>90||Math.abs(lon)>180)return notify('Coordenadas inválidas.');beginPicker({lat,lon,name:'',address:raw});return;}
  if(raw.includes('maps.app.goo.gl'))return notify('Cole a morada, o nome do local ou as coordenadas do Google Maps.');
  if(Date.now()-lastSearch<1500)return;lastSearch=Date.now();searching=true;showingFavorites=false;
  $('results-panel').hidden=false;$('results-title').textContent='A procurar…';$('results').replaceChildren();$('search-button').disabled=true;render();
  try{
    const query=normalizeQuery(raw),cacheKey='photon-v3:'+query;
    let data;try{data=JSON.parse(sessionStorage.getItem(cacheKey));}catch{}
    if(!data){
      const params=new URLSearchParams({q:query,limit:'8',lat:state.depot.lat,lon:state.depot.lon});
      data=await requestJSON('https://photon.komoot.io/api/?'+params);
      try{sessionStorage.setItem(cacheKey,JSON.stringify(data));}catch{}
    }
    results=(data.features||[]).filter(f=>f.geometry?.type==='Point').map(feature=>{
      const p=feature.properties,postal=p.osm_value==='postcode',streetOnly=(!p.name||p.name===p.street||p.osm_key==='highway'||p.osm_key==='place')&&!p.housenumber;
      const address=[p.street||(p.osm_key==='highway'?p.name:null),p.housenumber,p.postcode||(postal?p.name:null),p.city||p.town||p.village,p.district,p.country].filter(Boolean).join(', ');
      return {name:postal?`Entrega ${p.name||raw}`:p.name||[p.street,p.housenumber].filter(Boolean).join(' ')||raw,address:address||p.name||raw,lat:feature.geometry.coordinates[1],lon:feature.geometry.coordinates[0],approximate:postal||streetOnly};
    });
    renderResults();
  }catch{$('results-title').textContent='Pesquisa indisponível';$('results').innerHTML='<p class="results-empty">Tente novamente ou use «Escolher no mapa» para marcar a entrada de entrega.</p>';}
  finally{searching=false;$('search-button').disabled=false;render();}
};
function renderResults(){
  const places=showingFavorites?state.saved:results;
  $('results-title').textContent=showingFavorites?'Os seus favoritos':'Escolha o local certo';
  $('results').innerHTML=places.length?places.map((p,i)=>`<div class="result"><button class="result-body" data-preview="${i}"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.address)}${p.approximate?' · Zona aproximada: confirme o pin':''}</small></button><button class="heart" data-result-heart="${i}" aria-label="${isFavorite(p)?'Retirar dos':'Guardar nos'} favoritos: ${escapeHTML(p.name)}" aria-pressed="${isFavorite(p)}">${isFavorite(p)?'♥':'♡'}</button><button class="add-result" data-result-add="${i}">${p.approximate?'No mapa':'Adicionar'}</button></div>`).join(''):`<p class="results-empty">${showingFavorites?'Ainda não há favoritos. Toque no coração de um local para o guardar.':'Sem resultados. Acrescente a localidade ou escolha o ponto no mapa. Não é necessário ter um nome comercial.'}</p>`;
}
$('saved-button').onclick=()=>{showingFavorites=true;$('results-panel').hidden=false;renderResults();};
$('results').onclick=event=>{
  if(busy)return;const places=showingFavorites?state.saved:results;
  const preview=event.target.closest('[data-preview]'),heart=event.target.closest('[data-result-heart]'),add=event.target.closest('[data-result-add]');
  if(preview)beginPicker(places[Number(preview.dataset.preview)]);
  if(heart){const place=places[Number(heart.dataset.resultHeart)];if(place.approximate&&!isFavorite(place)){beginPicker(place);pendingFavorite=true;$('picker-heart').textContent='♥';$('picker-heart').setAttribute('aria-pressed','true');}else toggleFavorite(place);}
  if(add){const place=places[Number(add.dataset.resultAdd)];if(place.approximate)beginPicker(place);else addPlace(place);}
};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeResults();cancelPicker();}});

function navigationURL(leg){const params=new URLSearchParams({api:'1',origin:`${leg.from.lat},${leg.from.lon}`,destination:`${leg.to.lat},${leg.to.lon}`,travelmode:'driving'});if(leg.mode==='avoid')params.set('avoid','tolls');return 'https://www.google.com/maps/dir/?'+params;}
function renderNavigation(){
  const leg=route?.legs[route.completed];$('next-stop').hidden=!route;
  if(!route)return;
  const done=!leg;$('next-label').textContent=done?'DIA CONCLUÍDO':route.completed>=state.stops.length?'REGRESSO À EMPRESA':`ENTREGA ${route.completed+1} DE ${state.stops.length}`;
  $('next-name').textContent=done?'Todas as entregas concluídas.':leg.to.name;
  $('navigate').hidden=done;$('delivered').hidden=done;
  if(leg){$('navigate').href=navigationURL(leg);$('delivered').textContent=route.completed>=state.stops.length?'Cheguei à empresa':'Entregue · Próxima';}
}
$('delivered').onclick=()=>{if(route){route.completed++;render();}};
$('departure-time').value=state.departure;
$('departure-time').oninput=()=>{state.departure=$('departure-time').value;persist();renderSummary();};
$('departure-time').onchange=$('departure-time').oninput;
$('roundtrip').checked=state.roundtrip;
$('roundtrip').onchange=()=>{state.roundtrip=$('roundtrip').checked;planChanged();};
$('service').value=state.service;
function updateService(){state.service=Math.max(0,Math.min(120,Number($('service').value)||0));if(route)Object.assign(route,totalTrip(route.legs,state.stops.length,state.service));persist();renderSummary();}
$('service').oninput=updateService;
$('service').onchange=()=>{updateService();$('service').value=state.service;};
$('toll-amount').oninput=()=>{if(route){route.toll=$('toll-amount').validity.valid?confirmedToll($('toll-amount').value):null;renderSummary();}};
$('settings-button').onclick=()=>$('settings-dialog').showModal();$('close-settings').onclick=()=>$('settings-dialog').close();
for(const [id,key] of [['consumption','consumption'],['fuel-price','fuelPrice']]){
  $(id).value=state[key]??'';$(id).oninput=()=>{state[key]=$(id).validity.valid?positive($(id).value):null;persist();renderSummary();};
}
$('toll-class').value=state.tollClass;
$('toll-class').onchange=()=>{state.tollClass=$('toll-class').value;if(route){route.toll=null;$('toll-amount').value='';}persist();renderSummary();};
$('print').onclick=()=>window.print();
$('export').onclick=()=>{
  if(!state.stops.length)return notify('Adicione locais primeiro.');
  const legs=currentLegs(),rows=[['Ordem','Origem','Destino','Morada','Latitude','Longitude','Portagens','Navegação'],...legs.map((leg,i)=>[i+1,leg.from.name,leg.to.name,leg.to.address,leg.to.lat,leg.to.lon,leg.mode==='avoid'?'Evitar':'Permitir',navigationURL(leg)])];
  const safe=value=>{const text=String(value);return '"'+(/^[=+@\-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';};
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),link=document.createElement('a'),url=URL.createObjectURL(blob);
  link.href=url;link.download='maticaminhos-rota.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
initializeMap();render();
