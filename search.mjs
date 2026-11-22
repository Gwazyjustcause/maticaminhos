// Supplemental, source-verified listings that are missing from the public search index.
export const localPlaces=[{name:'Restaurante O Casimiro',address:'Rua Estrada Nacional 2-3, n.º 21, Silveirinho, 3360-259 São Pedro de Alva, Penacova, Portugal',lat:40.2637622,lon:-8.2775141,countrycode:'PT',source:'https://restauranteocasimiro.eatbu.com/?lang=pt',localities:['São Pedro de Alva','Silveirinho','Penacova']}];
export const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function expandStreet(value){return value.trim().replace(/^r\.(?=\s)/i,'Rua').replace(/^av\.(?=\s)/i,'Avenida').replace(/^tv\.(?=\s)/i,'Travessa').replace(/^p[çc]\.(?=\s)/i,'Praça').replace(/^estr\.(?=\s)/i,'Estrada').replace(/^lg\.(?=\s)/i,'Largo');}
const roadPattern=/^(rua|avenida|travessa|praça|praca|estrada|largo|alameda|beco|calçada|calcada|urbanização|urbanizacao|rotunda)\b/i;
const stopWords=new Set(['rua','avenida','travessa','praca','estrada','largo','alameda','beco','calcada','da','de','do','das','dos','a','o','e','restaurante','restaurantes','cafe']);
const tokens=value=>normalize(value).split(' ').filter(word=>word&&!stopWords.has(word));
const includesTokens=(text,words)=>{const haystack=new Set(normalize(text).split(' '));return words.every(word=>haystack.has(word));};
export function parseSearch(raw,town=''){
  const expanded=expandStreet(raw),parts=expanded.split(',').map(s=>s.trim()).filter(Boolean).filter(s=>normalize(s)!=='portugal');
  let locality=town.trim(),term=expanded;
  const street=roadPattern.test(expanded);
  if(parts.length>1){term=parts.slice(0,-1).join(', ');if(!locality)locality=parts.at(-1);}
  if(locality&&normalize(term).endsWith(' '+normalize(locality)))term=term.slice(0,term.length-locality.length).trim().replace(/(?:,|\s+(?:em|no|na))$/i,'').trim();
  if(street&&!locality){
    const saint=term.match(/^(.+?\s+.+?)\s+(S(?:ão|ao|anta|anto)\s+.+)$/i);
    if(saint){term=saint[1];locality=saint[2];}
    else{const numbered=term.match(/^(.+?\s+\d+[a-z]?)\s+([A-Za-zÀ-ÿ].+)$/i);if(numbered){term=numbered[1];locality=numbered[2];}}
  }
  const house=street?term.match(/(?:\s|,)(?:n[.º°\s]*)?(\d+[a-z]?)\s*$/i)?.[1]||'':'';
  const supermarket=/^(continente|pingo doce|lidl|aldi|auchan|intermarche|minipreco)\b/.test(normalize(term));
  return {raw,term:expandStreet(term),town:locality,street,supermarket:!street&&supermarket,business:supermarket||/^(o |a |restaurante\b|cafe\b|centro comercial\b|shopping\b)/.test(normalize(term)),house,streetName:house?term.replace(new RegExp('(?:\\s|,)(?:n[.º°\\s]*)?'+house+'\\s*$','i'),'').trim():term};
}
export function portugueseFeature(feature){const p=feature?.properties,c=feature?.geometry?.coordinates;return String(p?.countrycode||'').toUpperCase()==='PT'&&feature.geometry.type==='Point'&&Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[1]);}
const adminNames=p=>[p.city,p.town,p.village,p.district,p.locality,p.name].filter(Boolean);
export function inferTown(features,parsed){
  const query=normalize(parsed.term);
  const names=features.filter(portugueseFeature).flatMap(f=>adminNames(f.properties)).filter(name=>query.endsWith(' '+normalize(name))&&normalize(name).length>=3);
  return names.sort((a,b)=>normalize(b).length-normalize(a).length)[0]||'';
}
function distance(a,b){const rad=x=>x*Math.PI/180,dLat=rad(a.lat-b.lat),dLon=rad(a.lon-b.lon);return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2)));}
function bbox(context){
  const e=context.properties.extent;
  if(Array.isArray(e)&&e.length===4&&e.every(Number.isFinite)&&e[0]<e[2]&&e[3]<e[1]&&e[2]-e[0]<2&&e[1]-e[3]<2)return [e[0],e[3],e[2],e[1]].join(',');
  const lat=context.geometry.coordinates[1],lon=context.geometry.coordinates[0],dLat=.045,dLon=.045/Math.cos(lat*Math.PI/180);return [lon-dLon,lat-dLat,lon+dLon,lat+dLat].join(',');
}
export function matchesFeature(feature,parsed,context=null){
  if(!portugueseFeature(feature))return false;
  const p=feature.properties;
  if(parsed.town&&!adminNames(p).some(name=>normalize(name)===normalize(parsed.town))){
    if(context&&['city','town'].includes(context.properties.osm_value)&&(p.city||p.town||p.village))return false;
    if(!context||distance({lat:feature.geometry.coordinates[1],lon:feature.geometry.coordinates[0]},{lat:context.geometry.coordinates[1],lon:context.geometry.coordinates[0]})>2000)return false;
  }
  if(parsed.street){
    if(!includesTokens(p.street||(p.osm_key==='highway'?p.name:''),tokens(parsed.streetName)))return false;
    if(parsed.house&&p.housenumber&&normalize(p.housenumber)!==normalize(parsed.house))return false;
  }else{
    if(parsed.supermarket&&(p.osm_key!=='shop'||!['supermarket','convenience'].includes(p.osm_value)))return false;
    if(parsed.business&&(p.osm_key==='highway'||p.type==='street'))return false;
    const words=tokens(parsed.term.replace(/\bportugal\b/ig,''));
    if(words.length&&!includesTokens([p.name,p.postcode].filter(Boolean).join(' '),words))return false;
  }
  return true;
}
function toPlace(feature,parsed){
  const p=feature.properties,postal=p.osm_value==='postcode';
  const approximate=postal||((!p.name||p.name===p.street||p.osm_key==='highway'||p.osm_key==='place')&&!p.housenumber);
  const address=[p.street||(p.osm_key==='highway'?p.name:null),p.housenumber,p.postcode||(postal?p.name:null),p.city||p.town||p.village,p.district,p.country].filter(Boolean).join(', ');
  return {name:postal?`Entrega ${p.name||parsed.term}`:p.name||[p.street,p.housenumber].filter(Boolean).join(' ')||parsed.term,address:address||parsed.term,lat:feature.geometry.coordinates[1],lon:feature.geometry.coordinates[0],countrycode:'PT',approximate,streetMatch:p.osm_key==='highway',note:parsed.house&&!p.housenumber?'Número de porta não confirmado. Ajuste o pin.':''};
}
export function catalogMatches(parsed){return localPlaces.filter(p=>!parsed.street&&tokens(parsed.term).length>0&&includesTokens([p.name,...p.localities].join(' '),tokens(parsed.term))&&(!parsed.town||p.localities.some(name=>normalize(name)===normalize(parsed.town))));}
export async function findPlaces(raw,town,depot,fetchPhoton){
  let parsed=parseSearch(raw,town),context=null;
  const base={countrycode:'PT',limit:'12'};
  const call=(endpoint,params)=>fetchPhoton(endpoint,new URLSearchParams({...base,...params}));
  async function resolveTown(){
    if(!parsed.town)return null;
    const data=await call('api/',{q:parsed.town});
    const rank=f=>({city:0,town:1,village:2,suburb:3,hamlet:4}[f.properties.osm_value]??({city:0,locality:2,district:5,county:6}[f.properties.type]??7));
    return (data.features||[]).filter(portugueseFeature).filter(f=>['place','boundary'].includes(f.properties.osm_key)&&normalize(f.properties.name)===normalize(parsed.town)).sort((a,b)=>rank(a)-rank(b))[0]||null;
  }
  context=await resolveTown();
  const query=()=>call('api/',{q:parsed.town&&!context?`${parsed.term}, ${parsed.town}`:parsed.term,lat:context?.geometry.coordinates[1]??depot.lat,lon:context?.geometry.coordinates[0]??depot.lon,...(context?{bbox:bbox(context)}:{}),...(parsed.supermarket?{osm_tag:'shop:supermarket'}:{})});
  let data=await query();
  if(!parsed.town){const inferred=inferTown(data.features||[],parsed);if(inferred){parsed=parseSearch(raw,inferred);context=await resolveTown();data=await query();}}
  let features=(data.features||[]).filter(f=>matchesFeature(f,parsed,context));
  if(parsed.street&&parsed.town&&!features.length){
    try{const structured=await call('structured',{street:parsed.streetName,city:context?.properties.city||parsed.town,...(parsed.house?{housenumber:parsed.house}:{}),...(context?{bbox:bbox(context)}:{})});features=(structured.features||[]).filter(f=>matchesFeature(f,parsed,context));}catch{}
  }
  const places=[...catalogMatches(parsed),...features.map(f=>toPlace(f,parsed))];
  places.sort((a,b)=>(a.source?-1:0)-(b.source?-1:0)||(parsed.street&&!parsed.house?(a.streetMatch?-1:0)-(b.streetMatch?-1:0):0)||distance(a,depot)-distance(b,depot));
  const unique=[...new Map(places.map(p=>[`${normalize(p.name)}|${p.lat.toFixed(6)},${p.lon.toFixed(6)}`,p])).values()].slice(0,8);
  if(!unique.length&&context&&parsed.street){
    unique.push({name:`${parsed.term}, ${parsed.town}`,address:`${parsed.town}, Portugal`,lat:context.geometry.coordinates[1],lon:context.geometry.coordinates[0],countrycode:'PT',approximate:true,localityFallback:true,note:'Rua não localizada. Este pin marca a localidade, não a rua. Mova-o até à entrada correta.'});
  }
  return {places:unique,parsed,context};
}
export function googleLookupURL(raw,town=''){return 'https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:[expandStreet(raw),town,'Portugal'].filter(Boolean).join(', ')});}
const googleDomains=new Set(['com','pt','es','fr','de','co.uk','it','nl','be','ch','at','ie','lu','pl','com.br','ca','com.au','co.in','co.jp']);
export function googleMapsURL(raw){
  // Google/WhatsApp shares can include the business name and punctuation around the URL.
  const links=String(raw).match(/https?:\/\/[^\s<>"\u201c\u201d]+/gi)||[];
  if(links.length!==1)return null;
  let candidate=links[0].replace(/[.,;]+$/,'');
  for(const [open,close] of [['(',')'],['[',']'],['{','}']]){
    while(candidate.endsWith(close)&&candidate.split(close).length>candidate.split(open).length)candidate=candidate.slice(0,-1);
  }
  let url;try{url=new URL(candidate);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  const host=url.hostname,path=url.pathname;
  if(host==='maps.app.goo.gl'&&/^\/[^/]+\/?$/.test(path))return url;
  if(host==='goo.gl'&&/^\/maps\/[^/]+\/?$/.test(path))return url;
  if(host==='g.co'&&/^\/maps\/[^/]+\/?$/.test(path))return url;
  if(['g.page','share.google'].includes(host)&&path!=='/')return url;
  const google=host.match(/^(?:(www|maps)\.)?google\.(.+)$/);
  return google&&googleDomains.has(google[2])&&(google[1]==='maps'||/^\/maps(?:\/|$)/.test(path))?url:null;
}
const validCoordinates=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
const coordinatePair=value=>String(value||'').match(/^(?:loc:)?(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s*\([^)]*\))?$/i);
export function parseMapsCoordinates(raw){
  const url=googleMapsURL(raw);if(!url||!/^(?:(?:www|maps)\.)?google\./.test(url.hostname))return null;
  let text;try{text=decodeURIComponent(url.href);}catch{text=url.href;}
  // A camera's @lat,lon is not necessarily the business pin: prefer the place data.
  let exact=text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if(!exact)for(const key of ['destination','query','q','ll']){exact=coordinatePair(url.searchParams.get(key));if(exact)break;}
  if(!exact)try{exact=coordinatePair(decodeURIComponent(url.pathname.match(/^\/maps\/(?:search|place)\/([^/]+)/)?.[1]||''));}catch{}
  const match=exact||text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if(!match)return null;const lat=Number(match[1]),lon=Number(match[2]);return validCoordinates(lat,lon)?{lat,lon,approximate:!exact}:null;
}
export async function resolveMapsLink(raw,fetchJSON){
  const url=googleMapsURL(raw);
  if(!url)throw new Error('Cole um link válido de um local do Google Maps.');
  // A route contains several pins; never accidentally import the first origin as a delivery.
  if(/^\/maps\/dir(?:\/|$)/.test(url.pathname)||url.searchParams.has('waypoints'))throw new Error('Este link é de uma rota. Partilhe o link de um único local no Google Maps.');
  const coordinates=parseMapsCoordinates(url.href);
  let pathName='';try{pathName=decodeURIComponent(url.pathname.match(/\/place\/([^/]+)/)?.[1]||'').replaceAll('+',' ');}catch{}
  if(coordinates&&!coordinates.approximate)return {...coordinates,name:coordinatePair(pathName)?'':pathName};
  let data;
  try{data=await fetchJSON('https://mapu.retiolus.net/unshortener?'+new URLSearchParams({link:url.href}));}
  catch{throw new Error('Não foi possível abrir o link agora. Tente novamente ou cole a morada do local.');}
  if(data?.points?.length>1)throw new Error('Este link contém vários locais. Partilhe o link de um único local no Google Maps.');
  if(!validCoordinates(data?.lat,data?.long))throw new Error('O link não devolveu uma localização válida. Cole a morada ou escolha o ponto no mapa.');
  return {lat:data.lat,lon:data.long,name:typeof data.name==='string'?data.name.trim().slice(0,120):pathName,approximate:data.nominatim===true||data.approximate===true};
}
