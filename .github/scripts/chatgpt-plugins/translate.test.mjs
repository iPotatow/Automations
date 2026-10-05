import test from 'node:test';import assert from 'node:assert/strict';
import {translate,providerHeaders,retryableStatus,retryAfterMs,providerKind} from './translate.mjs';import {runPool} from './pool.mjs';

const ENV_NAMES=['AI_API_KEY','AI_BASE_URL','AI_MODEL','AI_USER_AGENT','AI_ORIGINATOR','AI_MAX_RETRIES','AI_RETRY_BASE_MS','AI_REQUEST_TIMEOUT_MS','AI_TRANSLATION_BACKEND','SITE_BASE_URL','ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'];
function saveEnv(){return Object.fromEntries(ENV_NAMES.map(name=>[name,process.env[name]]));}
function restoreEnv(saved){for(const name of ENV_NAMES)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
function configure(){process.env.AI_TRANSLATION_BACKEND='external';process.env.AI_API_KEY='test-only';process.env.AI_BASE_URL='https://provider.invalid/v1';process.env.AI_MODEL='test-model';process.env.AI_USER_AGENT='codex_cli_rs/0.160.0';process.env.AI_ORIGINATOR='codex_cli_rs';process.env.AI_MAX_RETRIES='2';process.env.AI_RETRY_BASE_MS='1';process.env.AI_REQUEST_TIMEOUT_MS='5000';}

test('provider translation preserves paragraphs, caches identical source and rejects HTML provider pages',async()=>{
 const oldFetch=globalThis.fetch,saved=saveEnv();configure();let calls=0;const p={name:'Sample',summary:'Read files',description:'Read local files.\n\nRequires authorization.'};const cache={};
 try{globalThis.fetch=async(url,options)=>{assert.equal(url,'https://provider.invalid/v1/chat/completions');assert.equal(options.headers['User-Agent'],'codex_cli_rs/0.160.0');assert.equal(options.headers.originator,'codex_cli_rs');assert.equal(options.headers.Authorization,'Bearer test-only');const body=JSON.parse(options.body);assert.equal(JSON.parse(body.messages[1].content).paragraphs.length,2);calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'读取文件',paragraphs:['读取本地文件。','需要获得授权。']})}}],usage:{total_tokens:100}});};let actualRequests=0;const [result,twin]=await Promise.all([translate(p,cache,{onRequest:()=>actualRequests++}),translate(p,cache,{onRequest:()=>actualRequests++})]);assert.equal(actualRequests,1);assert.equal(result.description,twin.description);assert.equal(result.description,'读取本地文件。\n\n需要获得授权。');assert.equal(result.usage.total_tokens,100);await translate(p,cache);assert.equal(calls,1);globalThis.fetch=async()=>new Response('<!doctype html><html>Provider website</html>',{headers:{'content-type':'text/html'}});await assert.rejects(translate({...p,description:p.description+' HTML'},cache),e=>e.stop===true&&e.message.includes('returned HTML'));globalThis.fetch=async()=>new Response('<html>CF_APP_WAF verification</html>',{headers:{'content-type':'text/html'}});await assert.rejects(translate({...p,description:p.description+' waf'},cache),e=>e.stop===true&&e.message.includes('WAF verification'));process.env.AI_BASE_URL='provider.invalid';await assert.rejects(translate({...p,description:p.description+' invalid'},cache),e=>e.stop===true&&e.message.includes('valid HTTPS'));}finally{globalThis.fetch=oldFetch;restoreEnv(saved);}
});

test('provider retries rate limits, network errors and rejected model output before succeeding',async()=>{const oldFetch=globalThis.fetch,saved=saveEnv();configure();const cache={};const p={name:'Retry',summary:'Test retries',description:'One paragraph.'};let calls=0;try{globalThis.fetch=async()=>{calls++;if(calls===1)return new Response(JSON.stringify({error:{message:'slow down'}}),{status:429,headers:{'content-type':'application/json','retry-after':'0'}});if(calls===2)throw new TypeError('temporary network reset');if(calls===3)return Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]});return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'测试重试',paragraphs:['一个段落。']})}}]});};process.env.AI_MAX_RETRIES='4';const result=await translate(p,cache);assert.equal(result.description,'一个段落。');assert.equal(calls,4);}finally{globalThis.fetch=oldFetch;restoreEnv(saved);}});

test('fatal provider auth errors stop immediately without exhausting retries',async()=>{const oldFetch=globalThis.fetch,saved=saveEnv();configure();const cache={};let calls=0;try{globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{message:'bad key'}}),{status:401,headers:{'content-type':'application/json'}});};await assert.rejects(translate({name:'Auth',summary:'Auth',description:'Auth test.'},cache),e=>e.stop===true&&e.message.includes('HTTP 401'));assert.equal(calls,1);}finally{globalThis.fetch=oldFetch;restoreEnv(saved);}});

test('retry classification understands provider transient responses and Retry-After',()=>{assert.equal(retryableStatus(429),true);assert.equal(retryableStatus(503),true);assert.equal(retryableStatus(401),false);assert.equal(retryAfterMs('2',0),2000);assert.equal(retryAfterMs(new Date(5000).toUTCString(),0),5000);});

test('translation pool respects concurrency and stops scheduling after provider failure',async()=>{let active=0,max=0,completed=0,stop=false;const gates=[];const task=runPool([1,2,3,4,5,6],{concurrency:3,shouldStop:()=>stop},async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>gates.push(resolve));completed++;active--;});assert.equal(active,3);stop=true;for(const resolve of gates)resolve();await task;assert.equal(max,3);assert.equal(completed,3);});

test('default approved client identifiers include version, runtime OS and terminal',()=>{const old=process.env.AI_USER_AGENT;delete process.env.AI_USER_AGENT;try{const headers=providerHeaders();assert.match(headers['User-Agent'],/^codex_cli_rs\/0\.160\.0 \(.+; .+\) .+/);assert.equal(headers.originator,'codex_cli_rs');}finally{if(old===undefined)delete process.env.AI_USER_AGENT;else process.env.AI_USER_AGENT=old;}});

test('Workers AI direct backend uses Cloudflare credentials',()=>{const saved=saveEnv();try{process.env.AI_TRANSLATION_BACKEND='workers-ai';process.env.CLOUDFLARE_API_TOKEN='test-only';process.env.CLOUDFLARE_ACCOUNT_ID='test-account';process.env.ACTIONS_ID_TOKEN_REQUEST_URL='https://oidc.example/token';process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN='request-token';assert.equal(providerKind(),'workers-ai');}finally{restoreEnv(saved);}});

test('Actions calls Workers AI directly with quota visibility and caches validated output',async()=>{
 const saved=saveEnv(),oldFetch=globalThis.fetch;
 try{
  process.env.AI_TRANSLATION_BACKEND='workers-ai';process.env.CLOUDFLARE_API_TOKEN='cf-test';process.env.CLOUDFLARE_ACCOUNT_ID='account-test';delete process.env.AI_MODEL;
  let inference=0;
  globalThis.fetch=async(url,options)=>{
   if(String(url).endsWith('/graphql'))return Response.json({data:{viewer:{accounts:[{aiInferenceAdaptiveGroups:[{count:0,sum:{totalNeurons:0}}]}]}}});
   assert.equal(String(url),'https://api.cloudflare.com/client/v4/accounts/account-test/ai/run/@cf/qwen/qwen3-30b-a3b-fp8');
   assert.equal(options.headers.Authorization,'Bearer cf-test');inference++;
   return Response.json({success:true,result:{response:JSON.stringify({summary:'直接翻译',paragraphs:['原始段落。']})}});
  };
  const cache={},p={name:'Direct',summary:'Translate directly',description:'Original paragraph.'};
  const result=await translate(p,cache);assert.equal(result.description,'原始段落。');await translate(p,cache);assert.equal(inference,1);
 }finally{globalThis.fetch=oldFetch;restoreEnv(saved);}
});
