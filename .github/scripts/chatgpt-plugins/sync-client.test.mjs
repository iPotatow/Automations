import test from 'node:test';import assert from 'node:assert/strict';
import {createSiteClient,runSiteSync} from './sync-client.mjs';
test('transient failures retry and expired OIDC identity renews',async()=>{
 let tokens=0,calls=0;const delays=[];
 const client=createSiteClient({baseUrl:"https://catalog.example",oidcUrl:'https://token.invalid/request',oidcRequestToken:'test-only',delay:async ms=>delays.push(ms),fetcher:async(url,options)=>{
  if(String(url).startsWith('https://token.invalid')){tokens++;return Response.json({value:'test-'+tokens});}
  calls++;if(calls===1)return new Response(null,{status:503});if(calls===2)return new Response(null,{status:401});assert.equal(options.headers.Authorization,'Bearer test-2');return Response.json({complete:true});
 }});
 assert.deepEqual(await client.post('/api/admin/sync',{commit:'test'}),{complete:true});assert.equal(tokens,2);assert.equal(calls,3);assert.deepEqual(delays,[1000]);
});
test('custom https site target is used without weakening OIDC auth',async()=>{
 const seen=[];const client=createSiteClient({baseUrl:"https://catalog.example",baseUrl:'https://preview.example.test/',oidcUrl:'https://token.invalid',oidcRequestToken:'test-only',fetcher:async(url)=>{seen.push(String(url));return String(url).startsWith('https://token.invalid')?Response.json({value:'token'}):Response.json({complete:true});}});
 await client.post('/api/admin/sync',{});assert.equal(seen[1],'https://preview.example.test/api/admin/sync');assert.throws(()=>createSiteClient({baseUrl:"https://catalog.example",baseUrl:'http://preview.example.test',oidcUrl:'https://token.invalid',oidcRequestToken:'x'}),/must use https/);
});
test('protection failures stop without attempting a bypass',async()=>{
 let calls=0;const client=createSiteClient({baseUrl:"https://catalog.example",oidcUrl:'https://token.invalid',oidcRequestToken:'test-only',fetcher:async url=>{calls++;return String(url).startsWith('https://token.invalid')?Response.json({value:'test'}):new Response('blocked',{status:403});}});
 await assert.rejects(client.post('/api/admin/sync',{}),/HTTP 403/);assert.equal(calls,2);
});
test('D1 finishes before R2 and source-unavailable icons remain visible in summary',async()=>{
 const paths=[],summaries=[];let catalogCalls=0,assetCalls=0;
 const result=await runSiteSync({post:async(path,body)=>{paths.push(path);if(path.endsWith('/sync'))return {complete:++catalogCalls===2,id:'a'.repeat(64)};assert.equal(body.generation,'a'.repeat(64));return {complete:++assetCalls===2,phase:'complete',cached:8,failed:2,removed:3};}},'b'.repeat(40),{log:()=>{},summary:async s=>summaries.push(s)});
 assert.equal(result.assets.failed,2);assert.deepEqual(paths,['/api/admin/sync','/api/admin/sync','/api/admin/assets','/api/admin/assets']);assert.match(summaries[0],/unavailable: 2/);
});
test('superseded publications skip icon mutations',async()=>{
 let calls=0;await runSiteSync({post:async()=>{calls++;return {complete:true,superseded:true,id:'a'.repeat(64)};}},'b'.repeat(40),{log:()=>{}});assert.equal(calls,1);
});

test('first icon cache may exceed 35 minutes while remaining bounded',async()=>{
 let elapsed=0,assetCalls=0;
 const result=await runSiteSync({post:async path=>{
  if(path.endsWith('/sync'))return {complete:true,id:'a'.repeat(64)};
  elapsed+=20*60000;return {complete:++assetCalls===3,phase:'icons',cached:4000,failed:5,removed:0};
 }},'b'.repeat(40),{now:()=>elapsed,log:()=>{}});
 assert.equal(assetCalls,3);assert.equal(result.assets.complete,true);
 elapsed=0;assetCalls=0;
 await assert.rejects(runSiteSync({post:async path=>{
  if(path.endsWith('/sync'))return {complete:true,id:'a'.repeat(64)};
  elapsed+=20*60000;assetCalls++;return {complete:false};
 }},'b'.repeat(40),{now:()=>elapsed,log:()=>{}}),/saved checkpoint/);
 assert.equal(assetCalls,3);
});
