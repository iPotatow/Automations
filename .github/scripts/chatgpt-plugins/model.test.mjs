import test from 'node:test';import assert from 'node:assert/strict';
import {CATEGORIES} from './helpers.mjs';import {emptyState,applyScan,sourceHash,translationCurrent,validateTranslation,catalogRows,detailReady,deferDetail,sanitizeInformation,sanitizeState} from './model.mjs';
const scan=ids=>CATEGORIES.map(category=>({category,paginationStatus:'stable-observed',items:ids.map(id=>({id,name:id,url:'https://chatgpt.com/plugins/'+id,summary:'short'}))}));
test('only full independent scans can remove; failures, reruns and large drops preserve records',()=>{
 const s=emptyState();applyScan(s,scan(['plugin_a','plugin_b']),{at:'2026-10-01T00:00:00Z',runId:'1'});
 applyScan(s,scan(['plugin_a']).slice(0,2),{at:'2026-10-02T00:00:00Z',runId:'2'});assert.equal(s.plugins.plugin_b.status,'active');
 applyScan(s,scan(['plugin_a']),{at:'2026-10-02T01:00:00Z',runId:'3'});assert.equal(s.plugins.plugin_b.status,'active');
 applyScan(s,scan(['plugin_a']),{at:'2026-10-02T02:00:00Z',runId:'4',allowLargeRemoval:true});assert.equal(s.plugins.plugin_b.status,'missing');
 applyScan(s,scan(['plugin_a']),{at:'2026-10-02T03:00:00Z',runId:'5',allowLargeRemoval:true});assert.equal(s.plugins.plugin_b.status,'missing');
 applyScan(s,scan(['plugin_a']),{at:'2026-10-03T02:00:00Z',runId:'6',allowLargeRemoval:true});assert.equal(s.plugins.plugin_b.status,'removed');
 assert.ok(catalogRows(s).every(r=>r.id!=='plugin_b'));
 applyScan(s,scan(['plugin_a','plugin_b']),{at:'2026-10-04T02:00:00Z',runId:'7'});assert.equal(s.plugins.plugin_b.status,'active');
});
test('source changes invalidate translation and reject omitted paragraphs',()=>{
 const p={name:'Demo',summary:'short',description:'First paragraph.\n\nSecond paragraph.'};p.translation={qualityVersion:2,sourceHash:sourceHash(p),status:'translated',summary:'简介',description:'第一段。\n\n第二段。'};assert.ok(translationCurrent(p));p.description+=' changed';assert.equal(translationCurrent(p),false);
 assert.throws(()=>validateTranslation({summary:'简介',paragraphs:['第一段。']},p));assert.throws(()=>validateTranslation({summary:'summary',paragraphs:['First paragraph.','Second paragraph.']},p));
 assert.equal(validateTranslation({summary:'简介',paragraphs:['完整第一段。','完整第二段。']},p).description,'完整第一段。\n\n完整第二段。');
});

test('failed pages stay pending while backoff allows other pages to progress',()=>{
 const now=Date.parse('2026-10-03T16:00:00Z'), failed={status:'active',detailDue:true},fresh={status:'active'};
 deferDetail(failed,new Error('temporary upstream failure'),now);
 assert.equal(detailReady(failed,now),false);assert.equal(detailReady(fresh,now),true);
 assert.equal(detailReady(failed,now+3600000),true);assert.equal(failed.detailDue,true);
 deferDetail(failed,new Error('retry failure'),now+3600000);
 assert.equal(detailReady(failed,now+7200000),false);assert.equal(detailReady(failed,now+10800000),true);
 const legacy={status:'active',detailError:{at:new Date(now).toISOString()}};assert.equal(detailReady(legacy,now),false);
});

test('rerunning a job accepts new cards and restoration but cannot confirm another absence',()=>{
 const state=emptyState();applyScan(state,scan(['plugin_a','plugin_b']),{at:'2026-10-01T00:00:00Z',runId:'1'});
 applyScan(state,scan(['plugin_a']),{at:'2026-10-02T00:00:00Z',runId:'2',allowLargeRemoval:true});
 const result=applyScan(state,scan(['plugin_a','plugin_c']),{at:'2026-10-03T00:00:00Z',runId:'2'});
 assert.equal(result.complete,true);assert.equal(result.duplicate,true);assert.equal(state.plugins.plugin_c.status,'active');assert.equal(state.plugins.plugin_b.missingCount,1);
 assert.equal(state.scans.filter(s=>s.id==='2').length,1);
});

test('privacy policies and service terms are removed from state and publication rows',()=>{
 const information=[
  {label:'Developer',value:'Example'},
  {label:'Privacy Policy',value:'',links:['https://example.com/privacy']},
  {label:'Terms of Service',value:'',links:['https://example.com/terms']},
  {label:'Service Agreement',value:'',links:['https://example.com/agreement']},
  {label:'隐私政策',value:'https://example.com/privacy-cn'},
  {label:'服务协议',value:'https://example.com/terms-cn'},
  {label:'Website',value:'',links:['https://example.com/']}
 ];
 assert.deepEqual(sanitizeInformation(information).map(item=>item.label),['Developer','Website']);
 const state=emptyState();state.plugins.plugin_sample={id:'plugin_sample',url:'https://chatgpt.com/plugins/plugin_sample',name:'Sample',summary:'Short',description:'Body',categories:['featured'],status:'active',information};
 sanitizeState(state);assert.deepEqual(state.plugins.plugin_sample.information.map(item=>item.label),['Developer','Website']);
 const row=catalogRows(state)[0];assert.deepEqual(row.payload.information.map(item=>item.label),['Developer','Website']);assert.equal(row.payload.developer,'Example');
});
