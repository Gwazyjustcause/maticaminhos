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
  if(locality&&normalize(term).endsWith(' '+normalize(locality)))term=term.slice(0,term.length-locality.length).trim().replace(/,$/,'');
  if(street&&!locality){
    const saint=term.match(/^(.+?\s+.+?)\s+(S(?:ão|ao|anta|anto)\s+.+)$/i);
    if(saint){term=saint[1];locality=saint[2];}
    else{const numbered=term.match(/^(.+?\s+\d+[a-z]?)\s+([A-Za-zÀ-ÿ].+)$/i);if(numbered){term=numbered[1];locality=numbered[2];}}
  }
  const house=street?term.match(/(?:\s|,)(?:n[.º°\s]*)?(\d+[a-z]?)\s*$/i)?.[1]||'':'';
  return {raw,term:expandStreet(term),town:locality,street,business:/^(o |a |restaurante\b|cafe\b|continente\b|pingo doce\b|centro comercial\b|shopping\b)/.test(normalize(term)),house,streetName:house?term.replace(new RegExp('(?:\\s|,)(?:n[.º°\\s]*)?'+house+'\\s*$','i'),'').trim():term};
}
export function portugueseFeature(feature){const p=feature?.properties,c=feature?.geometry?.coordinates;return String(p?.countrycode||'').toUpperCase()==='PT'&&feature.geometry.type==='Point'&&Array.isArray(c)&&Number.isFinite(c[0])&&Number.isFinite(c[1]);}
const adminNames=p=>[p.city,p.town,p.village,p.district,p.locality,p.name].filter(Boolean);
export function inferTown(features,parsed){
  const query=normalize(parsed.term);
  const names=features.filter(portugueseFeature).flatMap(f=>adminNames(f.properties)).filter(name=>query.endsWith(' '+normalize(name))&&normalize(name).length>=3);
  return names.sort((a,b)=>normalize(b).length-normalize(a).length)[0]||'';
}
function distance(a,b){const rad=x=>x*Math.PI/180,dLat=rad(a.lat-b.lat),dLon=rad(a.lon-b.lon);return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2)));}
function bbox(context){const lat=context.geometry.coordinates[1],lon=context.geometry.coordinates[0],dLat=.045,dLon=.045/Math.cos(lat*Math.PI/180);return [lon-dLon,lat-dLat,lon+dLon,lat+dLat].join(',');}
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
    return (data.features||[]).filter(portugueseFeature).find(f=>['place','boundary'].includes(f.properties.osm_key)&&normalize(f.properties.name)===normalize(parsed.town))||null;
  }
  context=await resolveTown();
  const query=()=>call('api/',{q:parsed.town&&!context?`${parsed.term}, ${parsed.town}`:parsed.term,lat:context?.geometry.coordinates[1]??depot.lat,lon:context?.geometry.coordinates[0]??depot.lon,...(context?{bbox:bbox(context)}:{})});
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
export function parseMapsCoordinates(raw){
  let url;try{url=new URL(raw);}catch{return null;}
  if(url.protocol!=='https:'||!['google.com','www.google.com','maps.google.com','google.pt','www.google.pt','maps.google.pt','www.google.es','www.google.fr','www.google.de','www.google.co.uk'].includes(url.hostname))return null;
  let text;try{text=decodeURIComponent(raw);}catch{text=raw;}
  const exact=text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)||text.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const match=exact||text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if(!match)return null;const lat=Number(match[1]),lon=Number(match[2]);return Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon,approximate:!exact}:null;
}
