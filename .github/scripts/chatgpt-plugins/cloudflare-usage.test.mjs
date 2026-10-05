import test from 'node:test';import assert from 'node:assert/strict';
import {CLOUDFLARE_FREE_DAILY_NEURONS,cloudflareQuotaConfig,createWorkersAiQuotaGuard,fetchDailyWorkersAiUsage,utcDayStart} from './cloudflare-usage.mjs';

const responseFor=(neurons,{count=3,input=100,output=200}={})=>Response.json({data:{viewer:{accounts:[{aiInferenceAdaptiveGroups:[{count,sum:{totalNeurons:neurons,totalInputTokens:input,totalOutputTokens:output}}]}]}}});

test('official usage query uses the UTC day and reads totalNeurons',async()=>{
 const now=new Date('2026-10-04T11:07:58.304Z');let request;
 const usage=await fetchDailyWorkersAiUsage({token:'secret',accountId:'account',now,fetcher:async(url,options)=>{request={url,options};return responseFor(282.9529535770416,{count:19,input:3344,output:8434});}});
 assert.equal(request.url,'https://api.cloudflare.com/client/v4/graphql');const payload=JSON.parse(request.options.body);assert.equal(payload.variables.start,'2026-10-04T00:00:00.000Z');assert.equal(payload.variables.end,now.toISOString());assert.match(payload.query,/aiInferenceAdaptiveGroups/);assert.match(payload.query,/totalNeurons/);assert.equal(usage.neurons,282.9529535770416);assert.equal(usage.count,19);assert.equal(usage.inputTokens,3344);assert.equal(usage.outputTokens,8434);assert.equal(utcDayStart(now),'2026-10-04T00:00:00.000Z');
});

test('quota guard checks the API periodically and stops before the free allocation',async()=>{
 let calls=0;const values=[100,8500];const env={CLOUDFLARE_API_TOKEN:'secret',CLOUDFLARE_ACCOUNT_ID:'account',CLOUDFLARE_AI_DAILY_NEURON_LIMIT:'8500',CLOUDFLARE_AI_USAGE_CHECK_EVERY:'2'};
 const guard=createWorkersAiQuotaGuard({env,log:()=>{},fetcher:async()=>responseFor(values[Math.min(calls++,values.length-1)])});
 assert.equal((await guard.reserve()).allowed,true);assert.equal((await guard.reserve()).allowed,true);const stopped=await guard.reserve();assert.equal(stopped.allowed,false);assert.equal(stopped.reason,'limit');assert.equal(stopped.usage.neurons,8500);assert.equal(calls,2);
});

test('quota API errors fail closed and configuration cannot exceed free allocation',async()=>{
 const env={CLOUDFLARE_API_TOKEN:'secret',CLOUDFLARE_ACCOUNT_ID:'account'};const guard=createWorkersAiQuotaGuard({env,log:()=>{},fetcher:async()=>Response.json({errors:[{message:'denied'}]},{status:403})});const result=await guard.reserve();assert.equal(result.allowed,false);assert.equal(result.reason,'api_error');assert.match(result.error.message,/HTTP 403/);
 assert.throws(()=>cloudflareQuotaConfig({...env,CLOUDFLARE_AI_DAILY_NEURON_LIMIT:String(CLOUDFLARE_FREE_DAILY_NEURONS+1)}),/between 1 and 10000/);
});
