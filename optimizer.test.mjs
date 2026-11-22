import assert from 'node:assert/strict';
import {optimizeOrder,routeCost} from './optimizer.mjs';
for(const roundtrip of [true,false]){
  for(const n of [1,3,20,25]){
    const matrix=Array.from({length:n+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===j?0:((i*37+j*19+i*j*7)%151)+1));
    const original=Array.from({length:n},(_,i)=>i+1);const order=optimizeOrder(matrix,roundtrip);
    assert.deepEqual([...order].sort((a,b)=>a-b),original);
    assert.ok(routeCost(order,matrix,roundtrip)<=routeCost(original,matrix,roundtrip));
  }
}
assert.deepEqual(optimizeOrder([[0,5,2],[3,0,1],[1,6,0]],false),[1,2]);
assert.throws(()=>optimizeOrder([[0,null],[1,0]]));
assert.throws(()=>optimizeOrder([[0,1],[Infinity,0]]));
console.log('Passed: asymmetric road times, 1–25 stops, fixed depot, optional return, unreachable stops, and non-increasing travel cost.');
