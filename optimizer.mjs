export function routeCost(order, matrix, roundtrip) {
  let cost=0, previous=0;
  for(const index of order){cost+=matrix[previous][index];previous=index;}
  return cost+(roundtrip&&order.length?matrix[previous][0]:0);
}
export function optimizeOrder(matrix, roundtrip=true) {
  if(!matrix.length||matrix.some(row=>row.length!==matrix.length||row.some(v=>v===null||!Number.isFinite(v)||v<0))) throw new Error('Não foi possível ligar todas as paragens por estrada. Confirme as localizações.');
  const n=matrix.length-1;
  if(n<1)return [];
  let best=Array.from({length:n},(_,i)=>i+1), bestCost=routeCost(best,matrix,roundtrip);
  // Try every first stop; improve full directed costs, including the fixed depot.
  for(let first=1;first<=n;first++){
    const remaining=new Set(best);remaining.delete(first);let order=[first],current=first;
    while(remaining.size){const next=[...remaining].reduce((a,b)=>matrix[current][a]<matrix[current][b]?a:b);order.push(next);remaining.delete(next);current=next;}
    let score=routeCost(order,matrix,roundtrip),improved=true,passes=0;
    while(improved&&passes++<80){improved=false;for(let i=0;i<n-1;i++)for(let j=i+1;j<n;j++){
      const candidate=[...order.slice(0,i),...order.slice(i,j+1).reverse(),...order.slice(j+1)];const next=routeCost(candidate,matrix,roundtrip);
      if(next<score-0.01){order=candidate;score=next;improved=true;}
    }}
    if(score<bestCost){best=order;bestCost=score;}
  }
  return best;
}
