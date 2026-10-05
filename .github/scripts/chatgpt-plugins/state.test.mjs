import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {emptyState} from './model.mjs';
test('unchanged catalog publishes a fresh verified scan without changing plugin data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'catalog-state-'));process.env.STATE_DIR=dir;
 const {exportState}=await import('./state.mjs');const state=emptyState();
 state.plugins.plugin_sample={id:'plugin_sample',url:'https://chatgpt.com/plugins/plugin_sample',name:'Sample',summary:'Read files',description:'Official full body',categories:['featured'],status:'active'};
 try{
  state.scans=[{id:'1',at:'2026-10-03T00:00:00Z',complete:true}];const first=await exportState(state);const a=await readFile(join(dir,first.parts[0].path),'utf8');
  state.scans.push({id:'2',at:'2026-10-04T00:00:00Z',complete:true});const next=await exportState(state);const b=await readFile(join(dir,next.parts[0].path),'utf8');
  assert.notEqual(first.id,next.id,'Publication must advance the verified scan even when plugin rows do not change');assert.equal(a,b);assert.equal(next.lastScan.id,'2');
 }finally{await rm(dir,{recursive:true,force:true});delete process.env.STATE_DIR;}
});

test('loading, saving and exporting scrub privacy and terms metadata from historical state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'catalog-state-'));process.env.STATE_DIR=dir;await mkdir(join(dir,'data'),{recursive:true});
 const raw=emptyState();raw.plugins.plugin_sample={id:'plugin_sample',url:'https://chatgpt.com/plugins/plugin_sample',name:'Sample',summary:'Read files',description:'Official full body',categories:['featured'],status:'active',information:[{label:'Developer',value:'Example'},{label:'Privacy Policy',links:['https://example.com/privacy']},{label:'Terms of Service',links:['https://example.com/terms']},{label:'Website',links:['https://example.com/']}]};raw.scans=[{id:'1',at:'2026-10-03T00:00:00Z',complete:true}];
 try{
  await writeFile(join(dir,'data/state.json'),JSON.stringify(raw));
  const {loadState,saveState,exportState}=await import(`./state.mjs?sanitize=${Date.now()}`);const state=await loadState();assert.deepEqual(state.plugins.plugin_sample.information.map(item=>item.label),['Developer','Website']);
  await saveState(state);const saved=JSON.parse(await readFile(join(dir,'data/state.json'),'utf8'));assert.deepEqual(saved.plugins.plugin_sample.information.map(item=>item.label),['Developer','Website']);
  const manifest=await exportState(state);const rows=JSON.parse(await readFile(join(dir,manifest.parts[0].path),'utf8'));assert.deepEqual(rows[0].payload.information.map(item=>item.label),['Developer','Website']);
 }finally{await rm(dir,{recursive:true,force:true});delete process.env.STATE_DIR;}
});
