// Bounded work queue: stop scheduling after a provider block or deadline; finish in-flight work.
export async function runPool(items,{concurrency=3,shouldStop=()=>false}={},task){
 let next=0;
 async function worker(){while(next<items.length&&!shouldStop()){const item=items[next++];await task(item);}}
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));
}
