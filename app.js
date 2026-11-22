import {optimizeOrder} from './optimizer.mjs?v=6';
import {fuelEstimate,totalEstimate,tollForLegs} from './costs.mjs?v=11';
import {tollTracePayload,priceTollTrace,totalTollPrices,selectedTollPrice} from './tolls.mjs?v=15';
import {pointKey,legKey,tripLegs,routeBatches,routePayload,parseTrip,totalTrip,moveStop,normalizeQuery,costing,matrixBatches,matrixTimes,accessKey,roadAccessPayload,resolveRoadAccess,routingLocation,distanceMetres,restoreAccessMemory,rememberAccess,withRememberedAccess} from './routing.mjs?v=18';
import {findPlaces,googleLookupURL,googleMapsURL,resolveMapsLink,portugueseFeature} from './search.mjs?v=17';

const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(value);
const decimal=value=>new Intl.NumberFormat('pt-PT',{maximumFractionDigits:1}).format(value);
const duration=seconds=>{const minutes=Math.round(seconds/60);return minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:`${minutes} min`;};
const defaultDepot={name:'Matisilva — Carnes Lda',address:'Zona Industrial · Condeixa-a-Nova',lat:40.1299257,lon:-8.5240277};
const validPlace=p=>p&&typeof p.name==='string'&&typeof p.address==='string'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180;
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
const modeValue=value=>value==='avoid'?'avoid':'allow';
const defaultGroups=[{id:'restaurants',name:'Restaurantes'},{id:'continentes',name:'Continente'},{id:'pingo-doce',name:'Pingo Doce'}];
let state={depot:defaultDepot,stops:[],saved:[],groups:defaultGroups,roundtrip:true,service:10,consumption:null,fuelPrice:null,tollClass:'',mode:'allow',overrides:{},mapStyle:'street',theme:'light',accesses:[]};
try{
  const data=JSON.parse(localStorage.getItem('maticaminhos-v1'));
  if(data)state={
    depot:validPlace(data.depot)?data.depot:defaultDepot,
    stops:Array.isArray(data.stops)?data.stops.filter(validPlace).slice(0,25):[],
    saved:Array.isArray(data.saved)?data.saved.filter(validPlace).slice(0,500):[],
    groups:Array.isArray(data.groups)?data.groups.filter(g=>g&&typeof g.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(g.id)&&typeof g.name==='string'&&g.name.trim()).slice(0,100).map(g=>({id:g.id,name:g.name.trim().slice(0,40)})):defaultGroups,
    roundtrip:data.roundtrip!==false,service:Number.isFinite(data.service)?Math.max(0,Math.min(120,data.service)):10,
    consumption:positive(data.consumption),fuelPrice:positive(data.fuelPrice),tollClass:/^[1-4]$/.test(data.tollClass)?String(data.tollClass):'',
    mode:modeValue(data.mode),overrides:Object.fromEntries(Object.entries(data.overrides||{}).filter(([,v])=>v==='allow'||v==='avoid')),
    accesses:restoreAccessMemory(data.accesses),
    mapStyle:data.mapStyle==='satellite'?'satellite':'street',theme:data.theme==='dark'?'dark':'light'
  };
}catch{}
state.groups=state.groups.map(g=>g.id==='continentes'&&g.name==='Continentes'?{...g,name:'Continente'}:g);
state.saved=state.saved.map(p=>({...p,groupId:state.groups.some(g=>g.id===p.groupId)?p.groupId:''}));
// Migrate entrances already attached to saved addresses or the current route.
for(const place of [...state.saved,state.depot,...state.stops]){
  if(place.manualAccess&&!state.accesses.some(p=>pointKey(p)===pointKey(place)))state.accesses=rememberAccess(state.accesses,place);
}
state.depot=withRememberedAccess(state.depot,state.accesses);
state.stops=state.stops.map(p=>withRememberedAccess(p,state.accesses));
state.saved=state.saved.map(p=>withRememberedAccess(p,state.accesses));
let selectedGroup='all',editingGroup=null,selectedStop=null;
let route=null,busy=false,searching=false,changingDepot=false,pending=null,pendingMarker=null,pendingFavorite=false,toastTimer,calculateTimer,results=[],showingFavorites=false,draggedIndex=null;
let map,markers,routeLines,streetTiles,satelliteTiles,tileErrors=0;
const legCache=new Map();
const roadCache=new Map(state.accesses.filter(p=>p.road).map(p=>[accessKey(p),p.road]));
const tollTraceCache=new Map();
let tollCatalogPromise;
let accessIssue=null;
let clearedPlan=null;
const roadFor=p=>roadCache.get(accessKey(p));
const samePlace=(a,b)=>pointKey(a)===pointKey(b);
const isFavorite=place=>state.saved.some(p=>samePlace(p,place));
function notify(message){$('status').textContent=message;$('status').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('status').hidden=true,6500);}
function persist(){try{localStorage.setItem('maticaminhos-v1',JSON.stringify(state));}catch{notify('Não foi possível guardar neste navegador. Exporte a lista nas opções.');}}
function applyTheme(){
  document.documentElement.dataset.theme=state.theme;
  $('theme-button').textContent=state.theme==='dark'?'Modo claro':'Modo escuro';
  $('theme-button').setAttribute('aria-pressed',String(state.theme==='dark'));
  document.querySelector('meta[name="theme-color"]').content=state.theme==='dark'?'#242628':'#ed5732';
}
$('theme-button').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();persist();};
applyTheme();
function initializeMap(){
  if(!window.L){$('map').innerHTML='<p style="padding:70px 20px">O mapa não carregou. Atualize a página para tentar novamente. Pode continuar a pesquisar locais.</p>';return;}
  map=L.map('map',{scrollWheelZoom:true,zoomControl:false,maxZoom:21}).setView([state.depot.lat,state.depot.lon],11);
  L.control.zoom({position:'topleft'}).addTo(map);
  streetTiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxNativeZoom:19,maxZoom:21,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'});
  setMapStyle(state.mapStyle,false);
  markers=L.layerGroup().addTo(map);routeLines=L.layerGroup().addTo(map);
  map.on('click',event=>{
    if(busy)return;
    if(pending){pending.lat=event.latlng.lat;pending.lon=event.latlng.lng;pending.approximate=false;pendingMarker?.setLatLng(event.latlng);$('picker-help').textContent=pending.accessOnly?'Pin ajustado. Confirme o acesso de viatura.':'Pin ajustado. Confirme o nome e adicione a paragem.';}
    else beginPicker({name:'',address:`${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`,lat:event.latlng.lat,lon:event.latlng.lng});
  });
  new ResizeObserver(()=>map.invalidateSize()).observe($('map'));
  drawMap(true);
}
function setMapStyle(style,save=true){
  if(!map)return;
  state.mapStyle=style==='satellite'?'satellite':'street';tileErrors=0;
  document.querySelector('.map-panel').dataset.mapStyle=state.mapStyle;
  if(state.mapStyle==='satellite'&&!satelliteTiles){
    satelliteTiles=L.tileLayer.wms('https://ortos.dgterritorio.gov.pt/wms/ortosat2023',{
      layers:'ortoSat2023-CorVerdadeira',format:'image/png',version:'1.1.1',transparent:true,
      maxZoom:21,maxNativeZoom:20,noWrap:true,bounds:[[36.9,-9.6],[42.2,-6.1]],
      attribution:'&copy; <a href="https://www.dgterritorio.gov.pt/dados-abertos">DGT</a> · OrtoSat2023 · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>'
    });
    satelliteTiles.on('tileerror',()=>{
      if(state.mapStyle==='satellite'&&++tileErrors===3){setMapStyle('street');notify('Imagem de satélite indisponível. A mostrar o mapa de ruas.');}
    });
    satelliteTiles.on('tileload',()=>{tileErrors=0;});
  }
  // Keep streets underneath so sea/outside-imagery areas remain usable.
  if(!map.hasLayer(streetTiles))streetTiles.addTo(map);
  if(state.mapStyle==='satellite'){
    if(!map.hasLayer(satelliteTiles))satelliteTiles.addTo(map);
  }else if(satelliteTiles&&map.hasLayer(satelliteTiles))map.removeLayer(satelliteTiles);
  $('map-street').setAttribute('aria-pressed',String(state.mapStyle==='street'));
  $('map-satellite').setAttribute('aria-pressed',String(state.mapStyle==='satellite'));
  if(save)persist();
}
$('map-street').onclick=()=>setMapStyle('street');
$('map-satellite').onclick=()=>setMapStyle('satellite');
function drawMap(fit=false){
  if(!map)return;
  markers.clearLayers();routeLines.clearLayers();
  [state.depot,...state.stops].forEach((p,i)=>L.marker([p.lat,p.lon],{title:i?'Paragem '+i+' · '+p.name:'Partida · '+p.name,alt:i?'Paragem '+i+' · '+p.name:'Partida · '+p.name,bubblingMouseEvents:false,icon:L.divIcon({className:'map-pin'+(!i?' depot-pin':''),html:i||'⌂',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(markers).bindPopup(`<strong>${escapeHTML(p.name)}</strong><br>${escapeHTML(p.address)}`).on('click',()=>i?showStop(i-1):showRouteTop()));
  if(route){
    route.legs.forEach(leg=>{
      L.geoJSON(leg.geometry,{style:{color:'white',weight:8,opacity:.8},interactive:false}).addTo(routeLines);
      L.geoJSON(leg.geometry,{style:{color:leg.mode==='avoid'?'#16867c':'#7166ab',weight:5,opacity:.95}}).addTo(routeLines);
    });
    for(const p of [state.depot,...state.stops]){const road=roadFor(p);if(road&&road.offset>5){
      L.polyline([[p.lat,p.lon],[road.lat,road.lon]],{color:'#738377',weight:2,dashArray:'3 5',opacity:.7}).addTo(routeLines);
      L.circleMarker([road.lat,road.lon],{bubblingMouseEvents:false,radius:5,color:'#17684b',fillColor:'white',fillOpacity:1,weight:2}).addTo(routeLines).bindPopup(`Acesso de viatura · ${Math.round(road.offset)} m de ${escapeHTML(p.name)}`).on('click',()=>{const index=state.stops.findIndex(stop=>samePlace(stop,p));if(index>=0)showStop(index);else showRouteTop();});
    }}
  }
  if(fit)fitMap();
}
function fitMap(){
  if(!map)return;
  const points=[state.depot,...state.stops].map(p=>[p.lat,p.lon]);
  if(route)route.legs.forEach(leg=>leg.geometry.coordinates.forEach(([lon,lat])=>points.push([lat,lon])));
  map.fitBounds(L.latLngBounds(points),{padding:[40,55],maxZoom:14});
}
$('fit').onclick=fitMap;
function revealRoutePanel(){
  if(showingFavorites&&getComputedStyle(document.querySelector('.route-panel')).display==='none')toggleSaved(false);
}
function showStop(index){
  const place=state.stops[index];if(!place)return;
  revealRoutePanel();selectedStop=pointKey(place);
  const panel=document.querySelector('.route-panel'),card=$('stop-list').querySelector('[data-stop-index="'+index+'"]');
  if(!card)return;
  for(const stop of $('stop-list').querySelectorAll('.stop'))stop.classList.toggle('is-selected',stop===card);
  // Scroll this panel only: scrolling the document would move the permanent map.
  panel.scrollTo({top:Math.max(0,panel.scrollTop+card.getBoundingClientRect().top-panel.getBoundingClientRect().top-16),behavior:'instant'});
}
function showRouteTop(){
  revealRoutePanel();selectedStop=null;
  for(const card of $('stop-list').querySelectorAll('.is-selected'))card.classList.remove('is-selected');
  document.querySelector('.route-panel').scrollTo({top:0,behavior:'instant'});
}
function closeResults(){$('results-panel').hidden=true;}
$('close-results').onclick=closeResults;
function beginPicker(place,editIndex=null){
  if(busy)return;
  closeResults();pending={...place,editIndex};pendingFavorite=isFavorite(place);$('place-name').value=place.name;
  $('place-name').readOnly=false;$('picker-heart').hidden=false;
  $('picker-title').textContent=changingDepot?'Ponto de partida':editIndex!==null?'Editar paragem':place.approximate?'Confirmar a entrada de entrega':'Confirmar local';
  $('picker-help').textContent=place.note||(place.approximate?'Localização aproximada. Arraste o pin até à entrada.':'Arraste o pin para ajustar a entrada de entrega.');
  $('picker-heart').textContent=pendingFavorite?'♥':'♡';$('picker-heart').setAttribute('aria-pressed',String(pendingFavorite));
  $('confirm-place').textContent=editIndex!==null?'Guardar':'Adicionar';$('place-picker').hidden=false;
  if(map){
    pendingMarker?.remove();pendingMarker=L.marker([place.lat,place.lon],{draggable:true,icon:L.divIcon({className:'',html:'<div class="selection-pin"></div>',iconSize:[33,33],iconAnchor:[16,28]})}).addTo(map);
    pendingMarker.on('dragend',()=>{const p=pendingMarker.getLatLng();pending.lat=p.lat;pending.lon=p.lng;pending.approximate=false;$('picker-help').textContent=pending.accessOnly?'Pin ajustado. Confirme o acesso de viatura.':'Pin ajustado. Confirme o nome e adicione a paragem.';});
    map.flyTo([place.lat,place.lon],place.approximate?15:17,{duration:.4});
  }
}
function cancelPicker(){pending=null;pendingMarker?.remove();pendingMarker=null;$('place-picker').hidden=true;}
function beginAccessPicker(index){
  const place=index<0?state.depot:state.stops[index],road=roadFor(place)||place.manualAccess||place;
  beginPicker({...place,lat:road.lat,lon:road.lon,approximate:false},index);
  pending.accessOnly=true;pending.originalPlace=place;
  $('place-name').readOnly=true;$('picker-heart').hidden=true;
  $('picker-title').textContent='Entrada de viatura';$('picker-help').textContent='Mova o pin para a estrada ou entrada de cargas. O local mantém a sua posição.';$('confirm-place').textContent='Usar acesso';
}
$('cancel-picker').onclick=cancelPicker;
$('pick-map').onclick=()=>{if(!map)return notify('O mapa não está disponível. Atualize a página.');notify('Toque no mapa na entrada de entrega. Depois dê um nome ao local.');closeResults();};
$('picker-heart').onclick=()=>{pendingFavorite=!pendingFavorite;$('picker-heart').textContent=pendingFavorite?'♥':'♡';$('picker-heart').setAttribute('aria-pressed',String(pendingFavorite));};
$('confirm-place').onclick=()=>{
  if(!pending||busy)return;
  if(pending.accessOnly){
    const index=pending.editIndex,place=pending.originalPlace,willRecalculate=!!route;
    const updated={...place,manualAccess:{lat:pending.lat,lon:pending.lon}};
    if(distanceMetres(place,updated.manualAccess)>1000)return notify('Escolha uma entrada a menos de 1 km do local.');
    state.accesses=rememberAccess(state.accesses,updated);
    if(index<0)state.depot=updated;else state.stops[index]=updated;
    state.saved=state.saved.map(saved=>samePlace(saved,place)?{...saved,manualAccess:updated.manualAccess}:saved);
    state.stops=state.stops.map(stop=>samePlace(stop,place)?{...stop,manualAccess:updated.manualAccess}:stop);
    accessIssue=null;cancelPicker();planChanged();persist();
    if(!willRecalculate)calculate(false);
    return;
  }
  if(pending.localityFallback&&pending.approximate)return notify('Este pin marca apenas a localidade. Mova-o até à rua e à entrada corretas antes de adicionar.');
  const place={name:$('place-name').value.trim()||pending.name||pending.address,address:pending.address,lat:pending.lat,lon:pending.lon,approximate:pending.approximate===true};
  const editIndex=pending.editIndex;
  if(editIndex!==null){
    const old=state.stops[editIndex];
    if(samePlace(old,place)&&old.manualAccess)place.manualAccess=old.manualAccess;
    if(state.stops.some((p,i)=>i!==editIndex&&samePlace(p,place)))return notify('Este local já está na rota.');
    const oldSaved=state.saved.find(p=>samePlace(p,old));
    if(oldSaved)state.saved=state.saved.filter(p=>!samePlace(p,old));
    state.stops[editIndex]=withRememberedAccess(place,state.accesses);
    if(pendingFavorite&&!isFavorite(place))state.saved.push({...place,groupId:oldSaved?.groupId||''});
    cancelPicker();planChanged(true);persist();notify('Paragem atualizada.');
  }else{
    const save=pendingFavorite;
    if(!addPlace(place))return;
    if(save&&!isFavorite(place))state.saved.push(withRememberedAccess(place,state.accesses));
    render();persist();cancelPicker();
  }
};
function toggleFavorite(place){
  const existing=state.saved.findIndex(p=>samePlace(p,place));
  if(existing>=0)state.saved.splice(existing,1);else{if(state.saved.length>=500)return notify('Já tem 500 moradas guardadas.');state.saved.push({...place});}
  persist();render();if(!$('results-panel').hidden)renderResults();
}
function addPlace(place){
  if(busy)return false;
  place=withRememberedAccess(place,state.accesses);
  const wasDepot=changingDepot;
  if(changingDepot){state.depot={...place};changingDepot=false;$('change-depot').textContent='Alterar';$('search').placeholder='Loja, morada, código postal ou link do Google Maps';}
  else{
    if(state.stops.length>=25){notify('A rota já tem 25 paragens.');return false;}
    if(state.stops.some(p=>samePlace(p,place))){notify('Este local já está na rota.');return false;}
    state.stops.push({...place});
  }
  closeResults();$('search').value='';planChanged(true);persist();if(wasDepot)showRouteTop();else showStop(state.stops.length-1);notify('Local adicionado à rota. Use o coração para guardar a morada.');return true;
}
function planChanged(fit=false){
  clearedPlan=null;
  const recalculate=!!route;
  route=null;$('route-message').textContent=recalculate?'A atualizar a rota…':'Calcule a rota para atualizar os tempos.';render();drawMap(fit);persist();
  if(recalculate){clearTimeout(calculateTimer);calculateTimer=setTimeout(()=>calculate(false),180);}
}
$('clear-route').onclick=()=>{
  if(busy||searching||!state.stops.length)return;
  clearedPlan={stops:[...state.stops],overrides:{...state.overrides},route};
  clearTimeout(calculateTimer);calculateTimer=null;
  state.stops=[];state.overrides={};route=null;accessIssue=null;draggedIndex=null;
  cancelPicker();closeResults();results=[];changingDepot=false;
  $('change-depot').textContent='Alterar';$('search').placeholder='Loja, morada, código postal ou link do Google Maps';
  $('search').value='';$('town').value='';
  $('route-message').textContent='Rota limpa. As moradas guardadas foram mantidas.';
  render();drawMap(true);persist();notify('Rota limpa. Pode restaurá-la em «Restaurar rota».');
};
$('undo-clear').onclick=()=>{
  if(busy||searching||!clearedPlan)return;
  const previous=clearedPlan;clearedPlan=null;
  state.stops=previous.stops;state.overrides=previous.overrides;
  route=previous.route?{...previous.route,...totalTrip(previous.route.legs,state.stops.length,state.service)}:null;

  $('route-message').textContent='Rota restaurada.';
  render();drawMap(true);persist();notify('Rota restaurada.');
  if(route&&(!route.tollPricing||route.tollPricing.status==='loading'))void updateTollPrices(route);
};
$('change-depot').onclick=()=>{
  if(busy)return;
  changingDepot=!changingDepot;cancelPicker();
  $('change-depot').textContent=changingDepot?'Cancelar':'Alterar';
  $('search').placeholder=changingDepot?'Morada ou nome da empresa':'Loja, morada, código postal ou link do Google Maps';
  $('search').focus();notify(changingDepot?'Procure o novo ponto de partida ou escolha no mapa.':'Partida mantida.');
};
$('depot-access').onclick=()=>beginAccessPicker(-1);

function currentLegs(){return tripLegs(state.depot,state.stops,state.roundtrip,state.mode,state.overrides);}
function legHTML(leg){
  const result=route?.legs.find(p=>p.key===leg.key&&p.mode===leg.mode);
  const selected=state.overrides[leg.key]||'';
  return `<div class="leg"><p>${escapeHTML(leg.from.name)} → ${escapeHTML(leg.to.name)}</p><div class="leg-controls"><select data-leg-key="${escapeHTML(leg.key)}" aria-label="Portagens de ${escapeHTML(leg.from.name)} para ${escapeHTML(leg.to.name)}"><option value=""${selected===''?' selected':''}>${state.mode==='avoid'?'Evitar':'Permitir'} (geral)</option><option value="allow"${selected==='allow'?' selected':''}>Permitir portagens</option><option value="avoid"${selected==='avoid'?' selected':''}>Evitar portagens</option></select><span class="leg-time">${result?duration(result.duration)+' · '+decimal(result.distance/1000)+' km':busy?'A calcular…':'—'}</span></div></div>`;
}
function stopHTML(p,i,legs){
  const road=roadFor(p),failed=accessIssue===pointKey(p);
  return `${legHTML(legs[i])}<article class="stop${route&&i<route.completed?' done':''}${failed?' needs-access':''}${selectedStop===pointKey(p)?' is-selected':''}" draggable="true" data-stop-index="${i}"><div class="stop-main"><span class="number">${route&&i<route.completed?'✓':i+1}</span><div class="stop-text"><button class="stop-name" data-edit="${i}" aria-label="Editar ${escapeHTML(p.name)}">${escapeHTML(p.name)}</button><small>${escapeHTML(p.address)}${p.approximate?' · Pin aproximado':''}</small>${road?`<small class="access-note">${road.manual?'Entrada memorizada':'Acesso memorizado'}${road.offset>5?' · '+Math.round(road.offset)+' m do local':''}</small>`:p.manualAccess?'<small class="access-note">Entrada memorizada</small>':''}${failed?'<small class="access-error">Indique a entrada de viatura em «Acesso».</small>':''}</div></div><div class="stop-actions"><button class="move-button" data-up="${i}" aria-label="Subir ${escapeHTML(p.name)}" ${i===0?'disabled':''}>Subir</button><button class="move-button" data-down="${i}" aria-label="Descer ${escapeHTML(p.name)}" ${i===state.stops.length-1?'disabled':''}>Descer</button><button class="move-button" data-access="${i}" aria-label="Ajustar acesso de ${escapeHTML(p.name)}">Acesso</button><button class="heart" data-heart="${i}" aria-label="${isFavorite(p)?'Remover das moradas guardadas':'Guardar morada'}: ${escapeHTML(p.name)}" aria-pressed="${isFavorite(p)}">${isFavorite(p)?'♥':'♡'}</button><button class="icon-button" data-remove="${i}" aria-label="Remover ${escapeHTML(p.name)}">×</button></div></article>`;
}
function render(){
  const panel=document.querySelector('.route-panel'),scrollPosition=panel.scrollTop;
  const legs=currentLegs();
  $('depot-name').textContent=state.depot.name;$('count').textContent=`${state.stops.length} ${state.stops.length===1?'paragem':'paragens'}`;
  $('saved-count').textContent=state.saved.length;$('empty').hidden=state.stops.length>0;
  $('saved-button').setAttribute('aria-label',`Moradas guardadas (${state.saved.length})`);
  $('saved-button').disabled=busy||searching;
  $('allow-tolls').setAttribute('aria-pressed',String(state.mode==='allow'));$('avoid-tolls').setAttribute('aria-pressed',String(state.mode==='avoid'));
  $('stop-list').innerHTML=state.stops.map((p,i)=>stopHTML(p,i,legs)).join('');
  $('return-leg').innerHTML=state.roundtrip&&state.stops.length?legHTML(legs.at(-1)):'';
  const hasStops=state.stops.length>0;
  $('calculate').disabled=busy||searching||!hasStops;$('optimize').disabled=busy||searching||!hasStops;
  $('clear-route').disabled=busy||searching||!hasStops;
  $('undo-clear').hidden=!clearedPlan;$('undo-clear').disabled=busy||searching;
  if(showingFavorites)renderResults(true);
  if(busy)for(const element of document.querySelectorAll('button,input,select'))element.disabled=true;
  renderSummary();renderNavigation();drawMap();panel.scrollTop=scrollPosition;
}
function renderSummary(){
  $('total-time').textContent=route?duration(route.duration):'—';
  $('time-breakdown').textContent=route?`${duration(route.driving)} a conduzir + ${duration(route.delivery)} nas entregas`:busy?'A calcular o percurso…':state.stops.length?'Calcule para ver a duração completa.':'Adicione os locais para começar.';
  $('total-distance').textContent=route?decimal(route.distance/1000):'—';
  $('map-status').textContent=busy?'A calcular os percursos…':route?`${decimal(route.distance/1000)} km · ${duration(route.duration)} no total`:state.stops.length?`${state.stops.length} ${state.stops.length===1?'paragem':'paragens'} no mapa`:'Partida da Matisilva';
  const fuel=route?fuelEstimate(route.distance,state.consumption,state.fuelPrice):null;
  $('fuel-cost').textContent=fuel?money(fuel.cost):'Preencher veículo';$('fuel-preview').textContent=fuel?money(fuel.cost)+' combustível':'—';
  const pricing=route?.tollPricing;
  const automatic=selectedTollPrice(pricing,state.tollClass);
  const toll=route?tollForLegs(route.legs,automatic):null;
  const tollFree=!!route&&route.legs.length>0&&route.legs.every(leg=>leg.hasToll===false);
  $('toll-cost').textContent=toll!==null?money(toll):!route?'Calcule a rota':!state.tollClass?'Escolha a classe':pricing?.status==='loading'?'A calcular…':'Tarifa não coberta';
  $('toll-status').textContent=!route?'Calcule a rota para ver os custos.':tollFree?'O percurso calculado não inclui portagens.':pricing?.status==='loading'?'A identificar as portagens do percurso…':pricing?.complete?`${state.tollClass?'Classe '+state.tollClass+' · ': 'Escolha a classe da viatura. '}Tabela estática de ${pricing.effectiveFrom}. Sem descontos pessoais.`:pricing?.status==='error'?'Não foi possível consultar as portagens. Tente novamente.':`${pricing?.missing||1} trajeto(s) com tarifa ainda não coberta.`;
  $('trip-toll-class').value=state.tollClass;
  $('trip-toll-class-label').hidden=tollFree;

  $('retry-tolls').hidden=!route||pricing?.status!=='error';
  $('toll-breakdown').hidden=!pricing?.legs||!state.tollClass||tollFree;
  $('toll-breakdown-list').innerHTML=(pricing?.legs||[]).map((price,i)=>`<div class="cost-line"><span>${escapeHTML(route.legs[i].from.name)} → ${escapeHTML(route.legs[i].to.name)}${!price.complete?`<small class="toll-issue">${escapeHTML(price.reason)}</small>`:''}</span><strong>${price.complete?money(price.cents[Number(state.tollClass)-1]/100):'Não coberto'}</strong></div>`).join('');
  const total=totalEstimate(fuel?.cost??null,toll);$('total-cost').textContent=total!==null?money(total):'—';
}
$('stop-list').onclick=event=>{
  if(busy)return;
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-heart')){toggleFavorite(state.stops[Number(button.dataset.heart)]);return;}
  if(button.hasAttribute('data-edit')){const i=Number(button.dataset.edit);beginPicker(state.stops[i],i);return;}
  if(button.hasAttribute('data-access')){beginAccessPicker(Number(button.dataset.access));return;}
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
let lastRoutingRequest=0,routingQueue=Promise.resolve();
function routingRequest(endpoint,payload){
  const run=async()=>{
    const wait=Math.max(0,1100-(Date.now()-lastRoutingRequest));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    lastRoutingRequest=Date.now();
    const headers={'X-Client-Id':'gwazyjustcause.github.io/maticaminhos'};
    if(endpoint==='trace_attributes')return requestJSON('https://valhalla1.openstreetmap.de/'+endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    return requestJSON('https://valhalla1.openstreetmap.de/'+endpoint+'?json='+encodeURIComponent(JSON.stringify(payload)),{headers});
  };
  const result=routingQueue.then(run);routingQueue=result.catch(()=>{});return result;
}
async function updateTollPrices(target){
  target.tollPricing={status:'loading'};renderSummary();
  try{
    tollCatalogPromise??=requestJSON('toll-data.json?v=15').catch(error=>{tollCatalogPromise=null;throw error;});
    const catalog=await tollCatalogPromise;if(route!==target)return;
    const legs=[];
    for(const leg of target.legs){
      if(route!==target)return;
      if(leg.hasToll===false){legs.push({complete:true,cents:[0,0,0,0],charges:[]});continue;}
      let price=tollTraceCache.get(leg.encodedShape);
      if(!price){price=priceTollTrace(await routingRequest('trace_attributes',tollTracePayload(leg)),catalog);tollTraceCache.set(leg.encodedShape,price);}
      legs.push(price);
    }
    if(route!==target)return;
    target.tollPricing={...totalTollPrices(legs),legs,status:'ready',effectiveFrom:catalog.effectiveFrom};renderSummary();
  }catch{
    if(route!==target)return;target.tollPricing={status:'error'};renderSummary();
  }
}
$('retry-tolls').onclick=()=>{if(route)updateTollPrices(route);};
async function prepareRoadPoints(points){
  const missing=points.filter(p=>!roadCache.has(accessKey(p)));
  for(let start=0;start<missing.length;start+=8){
    const batch=missing.slice(start,start+8);
    $('route-message').textContent=`A procurar acessos de viatura ${start+1}–${Math.min(start+8,missing.length)} de ${missing.length}…`;
    const data=await routingRequest('locate',roadAccessPayload(batch));
    if(!Array.isArray(data))throw new Error('Não foi possível verificar os acessos pela estrada. Tente novamente.');
    batch.forEach((point,i)=>{
      const road=resolveRoadAccess(point,data[i]);roadCache.set(accessKey(point),road);
      state.accesses=rememberAccess(state.accesses,point,road);
    });
    persist();
  }
  return points.map(p=>({...p,road:roadFor(p)}));
}
const routeCacheKey=leg=>`${leg.key}|${leg.mode}|${pointKey(routingLocation(leg.from))}>${pointKey(routingLocation(leg.to))}`;
async function matrixFor(points,mode){
  const matrix=points.map(()=>points.map(()=>null)),batches=matrixBatches(points);
  for(let i=0;i<batches.length;i++){
    const batch=batches[i],locations=places=>places.map(routingLocation);
    $('route-message').textContent=`A comparar paragens ${i+1} de ${batches.length} (${mode==='avoid'?'evitar':'permitir'} portagens)…`;
    const data=await routingRequest('sources_to_targets',{sources:locations(batch.sources),targets:locations(batch.targets),costing:'auto',costing_options:costing(mode),units:'kilometers'});
    const times=await matrixTimes(data.sources_to_targets,batch.sources,batch.targets,async(from,to)=>{
      const leg=tripLegs(from,[to],false,mode)[0],key=routeCacheKey(leg);
      const cached=legCache.get(key);if(cached)return cached.duration;
      $('route-message').textContent=`A confirmar o acesso por estrada a «${to.name}»…`;
      try{
        const result=parseTrip(await routingRequest('route',routePayload({mode,legs:[leg]})),{mode,legs:[leg]})[0];
        legCache.set(key,result);return result.duration;
      }catch(cause){
        if(cause.name==='TimeoutError')throw cause;
        const error=new Error(`Não foi possível confirmar o percurso de «${from.name}» a «${to.name}». ${cause.message}`);error.place=to;throw error;
      }
    });
    times.forEach((row,source)=>row.forEach((time,target)=>{
      matrix[batch.sourceOffset+source][batch.targetOffset+target]=time;
    }));
  }
  return matrix;
}
function setBusy(value){
  busy=value;
  for(const element of document.querySelectorAll('button,input,select'))element.disabled=value;
  $('calculate').textContent=value?'A calcular…':'Manter ordem';
  if(!value)$('optimize').textContent='Rota mais rápida';
  render();
}
async function calculate(reorder){
  if(busy||searching||!state.stops.length)return;
  clearTimeout(calculateTimer);cancelPicker();closeResults();setBusy(true);
  if(reorder)$('optimize').textContent='A otimizar…';
  route=null;render();
  let calculated=false;
  try{
    accessIssue=null;
    const prepared=await prepareRoadPoints([state.depot,...state.stops]),depot=prepared[0];
    let stops=prepared.slice(1);
    if(reorder&&stops.length>1){
      $('route-message').textContent='A comparar tempos de viagem para sugerir a ordem…';
      const points=[depot,...stops],matrices={};
      matrices[state.mode]=await matrixFor(points,state.mode);
      const other=state.mode==='avoid'?'allow':'avoid';
      if(Object.values(state.overrides).includes(other))matrices[other]=await matrixFor(points,other);
      const matrix=points.map((from,i)=>points.map((to,j)=>matrices[state.overrides[legKey(from,to)]||state.mode][i][j]));
      stops=optimizeOrder(matrix,state.roundtrip).map(i=>points[i]);
    }
    const legs=tripLegs(depot,stops,state.roundtrip,state.mode,state.overrides),computed=new Map();
    for(const leg of legs){const cached=legCache.get(routeCacheKey(leg));if(cached)computed.set(leg.index,{...cached,...leg});}
    const batches=routeBatches(legs.filter(leg=>!computed.has(leg.index)));
    for(let i=0;i<batches.length;i++){
      $('route-message').textContent=`A calcular percursos ${i+1} de ${batches.length}…`;
      const batch=batches[i],data=await routingRequest('route',routePayload(batch));
      for(const result of parseTrip(data,batch)){computed.set(result.index,result);legCache.set(routeCacheKey(result),result);}
    }
    const orderedLegs=legs.map(leg=>computed.get(leg.index));
    state.stops=stops.map(({road,...place})=>place);route={...totalTrip(orderedLegs,stops.length,state.service),legs:orderedLegs,completed:0};
    $('route-message').textContent=reorder?'Ordem sugerida pelos tempos de condução. Pode ajustar as paragens e cada trajeto.':'Rota calculada na ordem apresentada. As alterações recalculam o tempo total.';
    calculated=true;render();drawMap(true);persist();void updateTollPrices(route);
  }catch(error){if(error.place){accessIssue=pointKey(error.place);map?.flyTo([error.place.lat,error.place.lon],16);}$('route-message').textContent=error.name==='TimeoutError'?'O serviço demorou demasiado. Tente calcular novamente.':error.message;notify($('route-message').textContent);}
  finally{setBusy(false);if(calculated)showRouteTop();}
}
$('calculate').onclick=()=>calculate(false);$('optimize').onclick=()=>calculate(true);

let lastSearch=0;
let lastPhotonRequest=0;
async function photonRequest(endpoint,params){
  const key='search-pt-v5:'+endpoint+'?'+params;
  try{const cached=JSON.parse(sessionStorage.getItem(key));if(cached)return cached;}catch{}
  const wait=Math.max(0,1100-(Date.now()-lastPhotonRequest));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastPhotonRequest=Date.now();
  const data=await requestJSON('https://photon.komoot.io/'+endpoint+'?'+params);
  try{sessionStorage.setItem(key,JSON.stringify(data));}catch{}
  return data;
}
async function importMapsLink(raw){
  const key='maps-link-v1:'+googleMapsURL(raw).href;
  try{
    const cached=JSON.parse(sessionStorage.getItem(key));
    if(cached&&Date.now()-cached.time<86400000&&Number.isFinite(cached.place?.lat)&&Number.isFinite(cached.place?.lon)&&typeof cached.place.name==='string')return cached.place;
  }catch{}
  const place=await resolveMapsLink(raw,requestJSON);
  try{sessionStorage.setItem(key,JSON.stringify({time:Date.now(),place}));}catch{}
  return place;
}
$('search-form').onsubmit=async event=>{
  event.preventDefault();if(busy||searching)return;
  const raw=$('search').value.trim();if(raw.length<3)return notify('Escreva um nome, uma morada ou um código postal.');
  const coord=raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(coord){const lat=Number(coord[1]),lon=Number(coord[2]);if(Math.abs(lat)>90||Math.abs(lon)>180)return notify('Coordenadas inválidas.');beginPicker({lat,lon,name:'',address:raw});return;}
  const mapsLink=googleMapsURL(raw);
  if(/https?:\/\//i.test(raw)&&!mapsLink)return notify('Cole um link válido de um único local do Google Maps, ou escreva a morada.');
  if(Date.now()-lastSearch<1500)return;lastSearch=Date.now();searching=true;
  renderSavedTools();$('results-panel').hidden=false;$('results-title').textContent='A procurar…';$('results').replaceChildren();$('search-button').disabled=true;render();
  try{
    if(mapsLink){
      $('results-title').textContent='A abrir o link do Google Maps…';
      const imported=await importMapsLink(raw);
      const data=await photonRequest('reverse',new URLSearchParams({lat:imported.lat,lon:imported.lon,radius:'1',limit:'1'}));
      const feature=(data.features||[])[0];
      if(!portugueseFeature(feature))throw new Error('Este local não foi confirmado em Portugal.');
      const p=feature.properties;
      beginPicker({...imported,name:imported.name||'Local do Google Maps',address:[p.street,p.housenumber,p.postcode,p.city||p.town||p.village,'Portugal'].filter(Boolean).join(', '),note:imported.approximate?'Localização aproximada. Confirme o pin na entrada de entrega.':'Local do Google Maps. Confirme a entrada de entrega antes de adicionar.'});
      return;
    }
    const found=await findPlaces(normalizeQuery(raw),$('town').value,state.depot,photonRequest);
    results=found.places;
    renderResults();
  }catch(error){$('results-title').textContent='Não foi possível localizar';$('results').innerHTML=`<p class="results-empty">${escapeHTML(error.message||'Tente novamente ou escolha o ponto no mapa.')}</p>${lookupHTML()}`;}
  finally{searching=false;$('search-button').disabled=false;render();}
};
function lookupHTML(){
  const query=$('search').value.trim(),link=googleMapsURL(query);
  if(link)return `<div class="lookup-help"><a href="${escapeHTML(link.href)}" target="_blank" rel="noopener">Abrir o local no Google Maps</a><small>Se o link estiver indisponível, copie a morada ou escolha a entrada no mapa.</small></div>`;
  return query?`<div class="lookup-help"><span>Falta um estabelecimento?</span><a href="${escapeHTML(googleLookupURL(query,$('town').value))}" target="_blank" rel="noopener">Procurar no Google Maps</a><small>Depois cole aqui a morada ou o link partilhado pelo Google Maps.</small></div>`:'';
}
function resultPlaces(saved=false){return saved?state.saved.filter(p=>selectedGroup==='all'||(p.groupId||'')===(selectedGroup==='none'?'':selectedGroup)):results;}
function groupOptions(selected){return `<option value=""${!selected?' selected':''}>Sem grupo</option>`+state.groups.map(g=>`<option value="${escapeHTML(g.id)}"${g.id===selected?' selected':''}>${escapeHTML(g.name)}</option>`).join('');}
function renderSavedTools(){

  if(!['all','none'].includes(selectedGroup)&&!state.groups.some(g=>g.id===selectedGroup))selectedGroup='all';
  $('group-filter').innerHTML=`<option value="all">Todas (${state.saved.length})</option><option value="none">Sem grupo (${state.saved.filter(p=>!p.groupId).length})</option>`+state.groups.map(g=>`<option value="${escapeHTML(g.id)}">${escapeHTML(g.name)} (${state.saved.filter(p=>p.groupId===g.id).length})</option>`).join('');
  $('group-filter').value=selectedGroup;
  $('rename-group').hidden=['all','none'].includes(selectedGroup);
}
function renderResults(saved=false){
  if(saved)renderSavedTools();
  const places=resultPlaces(saved);
  if(!saved)$('results-title').textContent='Escolha o local certo';
  const entries=places.length?places.map((p,i)=>`<div class="result${saved?' saved-result':''}"><button class="result-body" data-preview="${i}"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.address)}${p.note?' · '+escapeHTML(p.note):p.approximate?' · Zona aproximada: confirme o pin':''}</small>${p.source?'<small>Localização publicada pelo estabelecimento</small>':''}</button><button class="heart" data-result-heart="${i}" aria-label="${isFavorite(p)?'Remover das moradas guardadas':'Guardar morada'}: ${escapeHTML(p.name)}" aria-pressed="${isFavorite(p)}">${isFavorite(p)?'♥':'♡'}</button><button class="add-result" data-result-add="${i}">${p.approximate?'No mapa':'Adicionar'}</button>${saved?`<label class="address-group">Grupo<select data-address-group="${i}" aria-label="Grupo de ${escapeHTML(p.name)}">${groupOptions(p.groupId)}</select></label>`:''}</div>`).join(''):`<p class="results-empty">${saved?(state.saved.length?'Ainda não há moradas neste grupo. Escolha «Todas» para organizar as suas moradas.':'Ainda não tem moradas guardadas. Toque no coração para guardar uma morada.'):'Sem correspondência em Portugal. Indique a rua e a cidade/vila, ou escolha o ponto no mapa.'}</p>`;
  $(saved?'saved-results':'results').innerHTML=entries+(saved?'':lookupHTML());
}
function toggleSaved(open=!showingFavorites){
  showingFavorites=open;$('saved-panel').hidden=!open;
  document.querySelector('.workspace').classList.toggle('saved-open',open);
  $('saved-button').setAttribute('aria-expanded',String(open));
  if(open){closeResults();renderResults(true);}else $('group-editor').hidden=true;
}
$('saved-button').onclick=()=>toggleSaved();
$('close-saved').onclick=()=>{toggleSaved(false);$('saved-button').focus();};
$('group-filter').onchange=()=>{selectedGroup=$('group-filter').value;$('group-editor').hidden=true;renderResults(true);};
function openGroupEditor(id){
  editingGroup=id;$('group-name').value=state.groups.find(g=>g.id===id)?.name||'';
  $('group-editor-title').textContent=id?'Renomear grupo':'Novo grupo';$('group-error').textContent='';$('group-editor').hidden=false;$('group-name').focus();
}
$('new-group').onclick=()=>openGroupEditor(null);
$('rename-group').onclick=()=>openGroupEditor(selectedGroup);
$('cancel-group').onclick=()=>{$('group-editor').hidden=true;};
$('group-editor').onsubmit=event=>{
  event.preventDefault();if(busy)return;
  const name=$('group-name').value.trim();
  if(!name){$('group-error').textContent='Indique um nome para o grupo.';return;}
  if(state.groups.some(g=>g.id!==editingGroup&&g.name.toLocaleLowerCase('pt-PT')===name.toLocaleLowerCase('pt-PT'))){$('group-error').textContent='Já existe um grupo com esse nome.';return;}
  if(editingGroup){const group=state.groups.find(g=>g.id===editingGroup);if(group)group.name=name;}
  else{
    if(state.groups.length>=100){$('group-error').textContent='Já tem 100 grupos.';return;}
    const group={id:crypto.randomUUID(),name};state.groups.push(group);selectedGroup='all';
  }
  $('group-editor').hidden=true;persist();renderResults(true);notify('Grupo guardado. Pode escolhê-lo no campo «Grupo» de cada morada.');
};
$('saved-results').onchange=event=>{
  if(busy)return;const select=event.target.closest('[data-address-group]');if(!select||!showingFavorites)return;
  const place=resultPlaces(true)[Number(select.dataset.addressGroup)];if(!place)return;
  place.groupId=state.groups.some(g=>g.id===select.value)?select.value:'';persist();renderResults(true);notify('Grupo da morada atualizado.');
};
function resultClick(event,saved=false){
  if(busy)return;const places=resultPlaces(saved);
  const preview=event.target.closest('[data-preview]'),heart=event.target.closest('[data-result-heart]'),add=event.target.closest('[data-result-add]');
  if(preview)beginPicker(places[Number(preview.dataset.preview)]);
  if(heart){const place=places[Number(heart.dataset.resultHeart)];if(place.approximate&&!isFavorite(place)){beginPicker(place);pendingFavorite=true;$('picker-heart').textContent='♥';$('picker-heart').setAttribute('aria-pressed','true');}else toggleFavorite(place);}
  if(add){const place=places[Number(add.dataset.resultAdd)];if(place.approximate)beginPicker(place);else addPlace(place);}
};
$('results').onclick=event=>resultClick(event);
$('saved-results').onclick=event=>resultClick(event,true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeResults();cancelPicker();if(showingFavorites){toggleSaved(false);$('saved-button').focus();}}});

function navigationURL(leg){const from=leg.from.road||roadFor(leg.from)||leg.from,to=leg.to.road||roadFor(leg.to)||leg.to;const params=new URLSearchParams({api:'1',origin:`${from.lat},${from.lon}`,destination:`${to.lat},${to.lon}`,travelmode:'driving'});if(leg.mode==='avoid')params.set('avoid','tolls');return 'https://www.google.com/maps/dir/?'+params;}
function renderNavigation(){
  const leg=route?.legs[route.completed];$('next-stop').hidden=!route;
  if(!route)return;
  const done=!leg;$('next-label').textContent=done?'DIA CONCLUÍDO':route.completed>=state.stops.length?'REGRESSO À EMPRESA':`ENTREGA ${route.completed+1} DE ${state.stops.length}`;
  $('next-name').textContent=done?'Todas as entregas concluídas.':leg.to.name;
  $('navigate').hidden=done;$('delivered').hidden=done;
  if(leg){$('navigate').href=navigationURL(leg);$('delivered').textContent=route.completed>=state.stops.length?'Cheguei à empresa':'Entregue · Próxima';}
}
$('delivered').onclick=()=>{if(route){route.completed++;render();if(route.completed>=route.legs.length)showRouteTop();}};
$('roundtrip').checked=state.roundtrip;
$('roundtrip').onchange=()=>{state.roundtrip=$('roundtrip').checked;planChanged();};
$('service').value=state.service;
function updateService(){state.service=Math.max(0,Math.min(120,Number($('service').value)||0));if(route)Object.assign(route,totalTrip(route.legs,state.stops.length,state.service));persist();renderSummary();}
$('service').oninput=updateService;
$('service').onchange=()=>{updateService();$('service').value=state.service;};
$('settings-button').onclick=()=>$('settings-dialog').showModal();$('close-settings').onclick=()=>$('settings-dialog').close();
for(const [id,key] of [['consumption','consumption'],['fuel-price','fuelPrice']]){
  $(id).value=state[key]??'';$(id).oninput=()=>{state[key]=$(id).validity.valid?positive($(id).value):null;persist();renderSummary();};
}
function changeTollClass(value){state.tollClass=value;$('toll-class').value=value;persist();renderSummary();}
$('toll-class').value=state.tollClass;
$('toll-class').onchange=()=>changeTollClass($('toll-class').value);
$('trip-toll-class').onchange=()=>changeTollClass($('trip-toll-class').value);
$('print').onclick=()=>window.print();
$('export').onclick=()=>{
  if(!state.stops.length)return notify('Adicione locais primeiro.');
  const legs=currentLegs(),rows=[['Ordem','Origem','Destino','Morada','Latitude','Longitude','Portagens','Navegação'],...legs.map((leg,i)=>[i+1,leg.from.name,leg.to.name,leg.to.address,leg.to.lat,leg.to.lon,leg.mode==='avoid'?'Evitar':'Permitir',navigationURL(leg)])];
  const safe=value=>{const text=String(value);return '"'+(/^[=+@\-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';};
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),link=document.createElement('a'),url=URL.createObjectURL(blob);
  link.href=url;link.download='maticaminhos-rota.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
initializeMap();render();
