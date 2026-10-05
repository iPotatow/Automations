const GRAPHQL_ENDPOINT='https://api.cloudflare.com/client/v4/graphql';
export const CLOUDFLARE_FREE_DAILY_NEURONS=10000;
export const DEFAULT_DAILY_NEURON_LIMIT=8500;
export const DEFAULT_USAGE_CHECK_EVERY=5;

function numberSetting(env,name,fallback,{min,max,integer=false}){
 const raw=env[name];const value=raw==null||raw===''?fallback:Number(raw);
 if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new Error(`${name} must be ${integer?'an integer ':' '}between ${min} and ${max}`);
 return value;
}

export function cloudflareQuotaConfig(env=process.env){
 const token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
 const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 const limit=numberSetting(env,'CLOUDFLARE_AI_DAILY_NEURON_LIMIT',DEFAULT_DAILY_NEURON_LIMIT,{min:1,max:CLOUDFLARE_FREE_DAILY_NEURONS});
 const checkEvery=numberSetting(env,'CLOUDFLARE_AI_USAGE_CHECK_EVERY',DEFAULT_USAGE_CHECK_EVERY,{min:1,max:50,integer:true});
 return {token,accountId,limit,checkEvery,configured:!!(token&&accountId)};
}

export function utcDayStart(now=new Date()){
 return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())).toISOString();
}

export async function fetchDailyWorkersAiUsage({fetcher=fetch,token,accountId,now=new Date()}={}){
 if(!token)throw new Error('CLOUDFLARE_API_TOKEN is missing');
 if(!accountId)throw new Error('CLOUDFLARE_ACCOUNT_ID is missing');
 const start=utcDayStart(now),end=now.toISOString();
 const query=`query WorkersAiUsage($accountTag: string, $start: Time, $end: Time) {
  viewer {
   accounts(filter: {accountTag: $accountTag}) {
    aiInferenceAdaptiveGroups(limit: 1, filter: {datetime_geq: $start, datetime_leq: $end}) {
     count
     sum { totalNeurons totalInputTokens totalOutputTokens }
    }
   }
  }
 }`;
 let response;
 try{response=await fetcher(GRAPHQL_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{accountTag:accountId,start,end}}),signal:AbortSignal.timeout(30000)});}catch(cause){throw new Error(`Cloudflare Analytics request failed: ${cause?.message||cause}`);}
 let body;try{body=await response.json();}catch{throw new Error(`Cloudflare Analytics returned invalid JSON (HTTP ${response.status})`);}
 if(!response.ok||body?.errors?.length){const detail=(body?.errors||[]).map(x=>String(x?.message||'')).filter(Boolean).join('; ').slice(0,400);throw new Error(`Cloudflare Analytics HTTP ${response.status}${detail?`: ${detail}`:''}`);}
 const accounts=body?.data?.viewer?.accounts;if(!Array.isArray(accounts)||accounts.length!==1)throw new Error('Cloudflare Analytics returned no matching account');
 const row=accounts[0]?.aiInferenceAdaptiveGroups?.[0];
 const neurons=Number(row?.sum?.totalNeurons||0),count=Number(row?.count||0),inputTokens=Number(row?.sum?.totalInputTokens||0),outputTokens=Number(row?.sum?.totalOutputTokens||0);
 if(![neurons,count,inputTokens,outputTokens].every(Number.isFinite)||neurons<0||count<0)throw new Error('Cloudflare Analytics returned invalid Workers AI usage');
 return {neurons,count,inputTokens,outputTokens,start,end,checkedAt:new Date().toISOString()};
}

export function createWorkersAiQuotaGuard({fetcher=fetch,env=process.env,clock=()=>new Date(),log=console.log}={}){
 const config=cloudflareQuotaConfig(env);let lastUsage=null,reservations=0,blocked=false,inFlight=null,lastError=null;
 async function refresh(){
  const usage=await fetchDailyWorkersAiUsage({fetcher,token:config.token,accountId:config.accountId,now:clock()});
  lastUsage={...usage,limit:config.limit,freeAllocation:CLOUDFLARE_FREE_DAILY_NEURONS,remainingToSafetyLimit:Math.max(0,config.limit-usage.neurons)};reservations=0;blocked=usage.neurons>=config.limit;lastError=null;
  log(`Cloudflare Workers AI official usage: ${usage.neurons.toFixed(3)} / ${config.limit} Neurons safety limit (${usage.count} inferences today)`);
  return lastUsage;
 }
 async function ensureFresh(){
  if(!config.configured)throw new Error('Cloudflare quota API credentials are missing');
  if(!lastUsage||reservations>=config.checkEvery){if(!inFlight)inFlight=refresh().finally(()=>{inFlight=null;});await inFlight;}else if(inFlight)await inFlight;
 }
 return {
  config,
  status:()=>({configured:config.configured,blocked,lastUsage,reservations,lastError:lastError?.message||null}),
  async reserve(){
   if(blocked)return {allowed:false,reason:'limit',usage:lastUsage,limit:config.limit};
   try{await ensureFresh();}catch(error){lastError=error;return {allowed:false,reason:'api_error',error,usage:lastUsage,limit:config.limit};}
   if(blocked)return {allowed:false,reason:'limit',usage:lastUsage,limit:config.limit};
   reservations++;return {allowed:true,reason:'ok',usage:lastUsage,limit:config.limit};
  }
 };
}
