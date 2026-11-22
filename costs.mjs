export function fuelEstimate(distanceMetres,consumption,price){
  if(!Number.isFinite(distanceMetres)||distanceMetres<0||!Number.isFinite(consumption)||consumption<=0||!Number.isFinite(price)||price<=0)return null;
  const litres=distanceMetres/1000*consumption/100;
  return {litres,cost:litres*price};
}
export function confirmedToll(value){return typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;}
export function tollForLegs(legs,confirmed=null){
  if(Number.isFinite(confirmed)&&confirmed>=0)return confirmed;
  return Array.isArray(legs)&&legs.length>0&&legs.every(leg=>leg.hasToll===false)?0:null;
}
export function totalEstimate(fuel,toll){return fuel!==null&&Number.isFinite(fuel)&&fuel>=0&&toll!==null&&Number.isFinite(toll)&&toll>=0?fuel+toll:null;}
