import {optimizeOrder} from './optimizer.mjs';
import {fuelEstimate,totalEstimate,confirmedToll} from './costs.mjs';

const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format(value);
const decimal=value=>new Intl.NumberFormat('pt-PT',{maximumFractionDigits:1}).format(value);
const defaultDepot={name:'Matisilva — Carnes Lda',address:'Zona Industrial · Condeixa-a-Nova',lat:40.1299257,lon:-8.5240277};
const validPlace=p=>p&&typeof p.name==='string'&&typeof p.address==='string'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180;
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
let state={depot:defaultDepot,stops:[],saved:[],roundtrip:true,service:10,consumption:null,fuelPrice:null,tollClass:''};
try{
  const data=JSON.parse(localStorage.getItem('maticaminhos-v1'));
  if(data)state={
    depot:validPlace(data.depot)?data.depot:defaultDepot,
    stops:Array.isArray(data.stops)?data.stops.filter(validPlace).slice(0,25):[],
    saved:Array.isArray(data.saved)?data.saved.filter(validPlace).slice(0,500):[],
    roundtrip:data.roundtrip!==false,
    service:Number.isFinite(data.service)?Math.max(0,Math.min(120,data.service)):10,
    consumption:positive(data.consumption),fuelPrice:positive(data.fuelPrice),
    tollClass:/^[1-4]$/.test(data.tollClass)?String(data.tollClass):''
  };
}catch{}
let route=null,busy=false,searching=false,changingDepot=false,pending=null,toastTimer;
let map,markers,line;

function notify(message){$('status').textContent=message;$('status').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('status').hidden=true,6500);}
function persist(){try{localStorage.setItem('maticaminhos-v1',JSON.stringify(state));}catch{notify('Não foi possível guardar. Use «Exportar lista» em Mais opções.');}}
const samePlace=(a,b)=>Math.abs(a.lat-b.lat)<0.00003&&Math.abs(a.lon-b.lon)<0.00003;
const coordinates=p=>`${p.lon},${p.lat}`;
const googleURL=p=>`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.lat+','+p.lon)}&travelmode=driving`;
const wazeURL=p=>`https://waze.com/ul?ll=${encodeURIComponent(p.lat+','+p.lon)}&navigate=yes`;

function initializeMap(){
  if(map)return;
  if(!window.L){$('map').textContent='Mapa indisponível. Pode continuar a pesquisar e calcular a rota.';return;}
  map=L.map('map',{scrollWheelZoom:false}).setView([state.depot.lat,state.depot.lon],11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  markers=L.layerGroup().addTo(map);
  map.on('click',event=>openCoordinates(event.latlng.lat,event.latlng.lng));
  drawMap();
}
function drawMap(){
  if(!map)return;
  markers.clearLayers();
  [state.depot,...state.stops].forEach((p,i)=>L.marker([p.lat,p.lon],{icon:L.divIcon({className:'map-pin'+(!i?' depot-pin':''),html:i||'⌂',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(markers).bindPopup(`<strong>${escapeHTML(p.name)}</strong><br>${escapeHTML(p.address)}`));
  if(line){line.remove();line=null;}
  if(route)line=L.geoJSON(route.geometry,{style:{color:'#196547',weight:5,opacity:.85}}).addTo(map);
  map.fitBounds(L.latLngBounds([state.depot,...state.stops].map(p=>[p.lat,p.lon])),{padding:[35,35],maxZoom:14});
}
$('map-details').addEventListener('toggle',()=>{if($('map-details').open){initializeMap();requestAnimationFrame(()=>{map?.invalidateSize();drawMap();});}});

function invalidate(){route=null;$('trip').hidden=true;drawMap();}
function renderStops(){
  $('depot-name').textContent=state.depot.name;
  $('count').textContent=`${state.stops.length} / 25`;
  $('empty').hidden=state.stops.length>0;
  $('saved-count').textContent=state.saved.length;
  $('action-count').textContent=state.stops.length?`${state.stops.length} ${state.stops.length===1?'restaurante':'restaurantes'}`:'Adicione os restaurantes';
  $('action-hint').textContent=route?'Pode recalcular se precisar':'Até 25 entregas';
  $('optimize').disabled=busy||searching||!state.stops.length;
  $('stop-list').innerHTML=state.stops.map((p,i)=>`<div class="stop${route&&i<route.completed?' done':''}"><span class="number">${route&&i<route.completed?'✓':i+1}</span><div><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.address)}</small></div><button data-remove="${i}" aria-label="Remover ${escapeHTML(p.name)}">×</button></div>`).join('');
  $('saved-list').innerHTML=state.saved.map((p,i)=>`<div class="saved-item"><div><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.address)}</small></div><button class="add-saved" data-add="${i}">Adicionar</button><button data-forget="${i}" aria-label="Esquecer ${escapeHTML(p.name)}">×</button></div>`).join('');
  drawMap();
}
function addPlace(place){
  if(busy)return;
  if(changingDepot){state.depot=place;changingDepot=false;$('search').placeholder='Nome do restaurante e localidade';$('change-depot').textContent='Alterar';notify('Ponto de partida atualizado.');}
  else{
    if(state.stops.length>=25)return notify('Já tem 25 restaurantes nesta rota.');
    if(state.stops.some(p=>samePlace(p,place)))return notify('Este restaurante já está na lista.');
    state.stops.push(place);
    if(!state.saved.some(p=>samePlace(p,place)))state.saved.push(place);
    notify('Restaurante adicionado.');
  }
  invalidate();renderStops();persist();$('results').replaceChildren();$('search').value='';
}
function openCoordinates(lat,lon){
  if(busy)return;
  pending={lat,lon,address:`${lat.toFixed(6)}, ${lon.toFixed(6)}`};
  $('coordinate-description').textContent=`${changingDepot?'Partida':'Paragem'} em ${pending.address}.`;
  $('place-name').value='';$('coordinate-dialog').showModal();
}
$('coordinate-dialog').addEventListener('close',()=>{
  if($('coordinate-dialog').returnValue==='confirm'&&pending&&$('place-name').value.trim())addPlace({...pending,name:$('place-name').value.trim()});
  pending=null;
});
$('change-depot').onclick=()=>{
  if(busy)return;
  changingDepot=!changingDepot;
  $('change-depot').textContent=changingDepot?'Cancelar':'Alterar';
  $('search').placeholder=changingDepot?'Nome ou morada da empresa':'Nome do restaurante e localidade';
  $('search').focus();notify(changingDepot?'Procure o novo ponto de partida.':'Partida mantida.');
};
$('saved-button').onclick=()=>$('saved-list').hidden=!$('saved-list').hidden;
$('saved-list').onclick=event=>{
  if(busy)return;
  const add=event.target.closest('[data-add]'),forget=event.target.closest('[data-forget]');
  if(add)addPlace(state.saved[Number(add.dataset.add)]);
  if(forget){state.saved.splice(Number(forget.dataset.forget),1);renderStops();persist();}
};
$('stop-list').onclick=event=>{
  const button=event.target.closest('[data-remove]');
  if(!button||busy)return;
  state.stops.splice(Number(button.dataset.remove),1);invalidate();renderStops();persist();
};

async function requestJSON(url,options={}){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Serviço indisponível. Tente novamente.');
  return response.json();
}
let lastSearch=0;
$('search-form').onsubmit=async event=>{
  event.preventDefault();if(busy||searching)return;
  const query=$('search').value.trim();if(query.length<3)return notify('Escreva o nome e a localidade.');
  const match=query.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(match){const lat=Number(match[1]),lon=Number(match[2]);if(Math.abs(lat)>90||Math.abs(lon)>180)return notify('Coordenadas inválidas.');openCoordinates(lat,lon);return;}
  if(query.includes('maps.app.goo.gl')||query.includes('google.com/maps'))return notify('Escreva o nome do restaurante e a localidade.');
  if(Date.now()-lastSearch<1500)return;lastSearch=Date.now();searching=true;
  $('search-button').disabled=true;$('results').textContent='A procurar…';renderStops();
  try{
    let data;try{data=JSON.parse(sessionStorage.getItem('photon:'+query));}catch{}
    if(!data){
      const params=new URLSearchParams({q:query,limit:'5',lat:state.depot.lat,lon:state.depot.lon});
      data=await requestJSON('https://photon.komoot.io/api/?'+params);
      try{sessionStorage.setItem('photon:'+query,JSON.stringify(data));}catch{}
    }
    $('results').replaceChildren();
    const features=(data.features||[]).filter(f=>f.geometry?.type==='Point');
    if(!features.length){$('results').textContent='Não encontrámos. Tente a morada ou escolha o local em «Ver mapa».';return;}
    features.forEach(feature=>{
      const p=feature.properties;
      const place={name:p.name||p.street||query,address:[p.street,p.housenumber,p.postcode,p.city||p.town||p.village,p.country].filter(Boolean).join(', '),lon:feature.geometry.coordinates[0],lat:feature.geometry.coordinates[1]};
      const button=document.createElement('button');button.type='button';button.className='result';
      button.innerHTML=`<div><strong>${escapeHTML(place.name)}</strong><small>${escapeHTML(place.address)}</small></div><span class="add-label">Adicionar</span>`;
      button.onclick=()=>addPlace(place);$('results').append(button);
    });
  }catch{$('results').textContent='Pesquisa indisponível. Tente novamente ou escolha o local em «Ver mapa».';}
  finally{searching=false;$('search-button').disabled=false;renderStops();}
};

function duration(seconds){const minutes=Math.round(seconds/60);return minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:`${minutes} min`;}
function setBusy(value){
  busy=value;
  for(const element of document.querySelectorAll('button,input,select'))element.disabled=value;
  $('optimize').textContent=value?'A calcular…':'Calcular rota';
  if(!value)renderStops();
}
$('optimize').onclick=async()=>{
  if(busy||searching||!state.stops.length)return;
  setBusy(true);
  try{
    const places=[state.depot,...state.stops];
    const table=await requestJSON('https://router.project-osrm.org/table/v1/driving/'+places.map(coordinates).join(';')+'?annotations=duration');
    if(table.code!=='Ok')throw new Error('Não foi possível ligar as paragens. Confirme as localizações.');
    const order=optimizeOrder(table.durations,state.roundtrip);
    const ordered=order.map(i=>places[i]);
    const points=[state.depot,...ordered,...(state.roundtrip?[state.depot]:[])];
    const data=await requestJSON('https://router.project-osrm.org/route/v1/driving/'+points.map(coordinates).join(';')+'?overview=full&geometries=geojson&steps=false');
    if(data.code!=='Ok'||!data.routes?.[0])throw new Error('Não foi possível calcular esta rota. Confirme os restaurantes.');
    const result=data.routes[0];
    state.stops=ordered;
    route={...result,points,completed:0,toll:null};
    $('toll-amount').value='';
    persist();renderTrip();
    $('trip').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){notify(error.name==='TimeoutError'?'O cálculo demorou demasiado. Tente novamente.':error.message);}
  finally{setBusy(false);}
};
function renderTrip(){
  if(!route)return;
  $('trip').hidden=false;
  $('trip-summary').textContent=`${decimal(route.distance/1000)} km · ${duration(route.duration+state.service*60*state.stops.length)} com entregas${state.roundtrip?' · inclui regresso à empresa':''}`;
  renderCosts();renderNextStop();renderStops();
}
function renderCosts(){
  if(!route)return;
  const fuel=fuelEstimate(route.distance,state.consumption,state.fuelPrice);
  $('fuel-cost').textContent=fuel?money(fuel.cost):'—';
  $('fuel-detail').textContent=fuel?`${decimal(fuel.litres)} litros estimados`:'Preencher consumo e preço';
  const toll=route.toll;
  $('toll-cost').textContent=toll!==null?money(toll):'—';
  $('toll-detail').textContent=toll!==null?`Valor indicado${state.tollClass?' · Classe '+state.tollClass:''}`:'Por confirmar · Tocar para indicar';
  const total=totalEstimate(fuel?.cost??null,toll);
  $('total-cost').textContent=total!==null?money(total):'—';
  $('total-detail').textContent=total!==null?'Combustível + portagens indicadas':!fuel?'Preencha os dados do veículo':'Confirme as portagens para obter o total';
}
function openVehicle(field){$('vehicle-settings').open=true;$('vehicle-settings').scrollIntoView({behavior:'smooth',block:'center'});$(field).focus({preventScroll:true});}
$('fuel-card').onclick=()=>openVehicle(!state.consumption?'consumption':'fuel-price');
$('toll-card').onclick=()=>{$('toll-settings').open=true;$('toll-settings').scrollIntoView({behavior:'smooth',block:'center'});$('toll-amount').focus({preventScroll:true});};
$('toll-amount').addEventListener('input',()=>{if(route){route.toll=$('toll-amount').validity.valid?confirmedToll($('toll-amount').value):null;renderCosts();}});
for(const [id,key] of [['consumption','consumption'],['fuel-price','fuelPrice']]){
  $(id).value=state[key]??'';
  $(id).addEventListener('input',()=>{
    state[key]=$(id).validity.valid?positive($(id).value):null;
    persist();renderCosts();
  });
}
$('toll-class').value=state.tollClass;
$('toll-class').onchange=()=>{state.tollClass=$('toll-class').value;if(route){route.toll=null;$('toll-amount').value='';}persist();renderCosts();};

function renderNextStop(){
  if(!route)return;
  const index=route.completed;
  const isReturn=index>=state.stops.length;
  const destination=isReturn?state.depot:state.stops[index];
  const finished=isReturn&&(!state.roundtrip||index>state.stops.length);
  $('next-label').textContent=finished?'DIA CONCLUÍDO':isReturn?'REGRESSO À EMPRESA':`ENTREGA ${index+1} DE ${state.stops.length}`;
  $('next-name').textContent=finished?'Bom trabalho!':destination.name;
  $('next-address').textContent=finished?'Todas as entregas estão concluídas.':destination.address;
  $('navigate').hidden=finished;$('google-navigation').hidden=finished;$('delivered').hidden=finished;
  $('navigate').href=wazeURL(destination);$('google-navigation').href=googleURL(destination);
  $('delivered').textContent=isReturn?'Cheguei à empresa':'Entregue · Próxima paragem';
}
$('delivered').onclick=()=>{if(!route)return;route.completed++;renderNextStop();renderStops();};
$('roundtrip').checked=state.roundtrip;
$('roundtrip').onchange=()=>{state.roundtrip=$('roundtrip').checked;invalidate();persist();renderStops();};
$('service').value=state.service;
$('service').onchange=()=>{state.service=Math.max(0,Math.min(120,Number($('service').value)||0));$('service').value=state.service;persist();if(route)renderTrip();};
$('print').onclick=()=>window.print();
$('export').onclick=()=>{
  if(!state.stops.length)return notify('Adicione restaurantes primeiro.');
  const rows=[['Ordem','Nome','Morada','Latitude','Longitude','Navegação'],...[state.depot,...state.stops,...(state.roundtrip?[state.depot]:[])].map((p,i)=>[i,p.name,p.address,p.lat,p.lon,googleURL(p)])];
  const safe=value=>{const text=String(value);return '"'+(/^[=+@\-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';};
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='maticaminhos-rota.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
renderStops();
