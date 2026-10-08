export function createSiteClient({fetcher=fetch,oidcUrl,oidcRequestToken,baseUrl=process.env.SITE_BASE_URL,serviceToken=process.env.SITES_SERVICE_TOKEN,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
 const target=new URL(baseUrl);if(target.protocol!=='https:')throw new Error('SITE_BASE_URL must use https');target.pathname=target.pathname.replace(/\/$/,'');
 const tokenUrl=new URL(oidcUrl);tokenUrl.searchParams.set('audience','plugin-catalog-sync');let bearer;
 async function refresh(){const r=await fetcher(tokenUrl,{headers:{Authorization:`Bearer ${oidcRequestToken}`},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('GitHub OIDC token unavailable');const value=(await r.json()).value;if(typeof value!=='string'||!value)throw new Error('Invalid GitHub OIDC response');bearer=value;}
 return {async post(path,payload){
  if(!bearer)await refresh();
  for(let attempt=0;attempt<8;attempt++){
   let response;
   try{response=await fetcher(new URL(path,target).href,{method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json',...(serviceToken?{'OAI-Sites-Authorization':`Bearer ${serviceToken}`}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});}catch{if(attempt===7)throw new Error('Site sync network retries exhausted');await delay(Math.min(30000,1000*2**attempt));continue;}
   if(response.status===401&&attempt<7){await response.body?.cancel();await refresh();continue;}
   if((response.status===408||response.status===429||response.status>=500)&&attempt<7){const seconds=Number(response.headers.get('Retry-After'));await response.body?.cancel();await delay(Math.min(30000,seconds>0?seconds*1000:1000*2**attempt));continue;}
   if(!response.ok){let detail='';try{detail=(await response.text()).trim().replace(/\s+/g,' ').slice(0,800);}catch{}const suffix=detail?`: ${detail}`:'';throw new Error(response.status===403?`Site sync HTTP 403: access protection rejected the Actions request${suffix}`:`Site sync HTTP ${response.status}${suffix}`);}
   let data;try{data=await response.json();}catch{throw new Error('Site returned invalid JSON');}return data;
  }
  throw new Error('Site sync retry budget exhausted');
 }};
}
export async function runSiteSync(client,commit,{now=Date.now,log=console.log,summary=async()=>{}}={}){
 let catalog;
 const catalogDeadline=now()+20*60000;
 for(let i=0;i<300&&now()<catalogDeadline;i++){catalog=await client.post('/api/admin/sync',{commit});log(`D1 sync: ${JSON.stringify(catalog)}`);if(catalog.complete)break;}
 if(!catalog?.complete||!/^[a-f0-9]{64}$/.test(catalog.id))throw new Error('D1 sync exceeded its bounded budget');
 if(catalog.superseded){await summary('Skipped an older publication; the live catalog is newer.');return {catalog};}
 let assets;const assetDeadline=now()+60*60000;
 for(let i=0;i<10000&&now()<assetDeadline;i++){assets=await client.post('/api/admin/assets',{generation:catalog.id});log(`R2 sync: phase=${assets.phase}, cached=${assets.cached}, failed=${assets.failed}, removed=${assets.removed}`);if(assets.complete)break;}
 if(!assets?.complete)throw new Error('R2 sync budget reached; the saved checkpoint will resume on the next run');
 await summary(`Catalog and icons synchronized. Cached: ${assets.cached}; unavailable: ${assets.failed}; obsolete icons removed: ${assets.removed}.`);
 return {catalog,assets};
}
