import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {emptyState,catalogRows,CATEGORY_NAMES,counts,hash,sanitizeState} from './model.mjs';
export const directory=process.env.STATE_DIR||'.';
export async function loadState(){try{return sanitizeState(JSON.parse(await readFile(`${directory}/data/state.json`,'utf8')));}catch(e){if(e.code==='ENOENT')return emptyState();throw e;}}
export async function saveState(state){sanitizeState(state);await mkdir(`${directory}/data`,{recursive:true});await writeFile(`${directory}/data/state.json.tmp`,JSON.stringify(state,null,2));await rename(`${directory}/data/state.json.tmp`,`${directory}/data/state.json`);}
export async function exportState(state){
 sanitizeState(state);const rows=catalogRows(state),generatedAt=new Date().toISOString();const id=hash({rows,counts:counts(state),lastScan:state.scans.at(-1)||null});
 await rm(`${directory}/data/exports`,{recursive:true,force:true});await mkdir(`${directory}/data/exports/${id}`,{recursive:true});const parts=[];
 for(let i=0;i<rows.length;i+=100){const path=`data/exports/${id}/${String(i/100).padStart(4,'0')}.json`;const text=JSON.stringify(rows.slice(i,i+100));await writeFile(`${directory}/${path}`,text);parts.push({path,sha256:hash(text),rows:Math.min(100,rows.length-i)});}
 const manifest={version:1,id,generatedAt,categories:CATEGORY_NAMES,parts,rows:rows.length,stats:counts(state),lastScan:state.scans.at(-1)||null};
 await writeFile(`${directory}/data/manifest.json`,JSON.stringify(manifest,null,2));
 await writeFile(`${directory}/data/status.json`,JSON.stringify({generatedAt,...counts(state),lastRun:state.lastRun||null,lastScan:state.scans.at(-1)||null},null,2));return manifest;
}
export function persist(){
 if(!process.env.GITHUB_TOKEN)return null;
 const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64')}`};
 const git=(...args)=>execFileSync('git',['-C',directory,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('config','user.name','github-actions[bot]');git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com');git('add','data');
 if(git('status','--porcelain','--','data')){git('commit','-m','data: checkpoint plugin catalog [skip ci]');git('fetch','origin','main');git('rebase','origin/main');git('push','origin','HEAD:refs/heads/main');}
 return git('rev-parse','HEAD');
}
if(import.meta.url===`file://${process.argv[1]}`){const state=await loadState();await saveState(state);const manifest=await exportState(state);const commit=persist();console.log(JSON.stringify({commit,manifest:manifest.id,stats:manifest.stats}));if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`commit=${commit||''}\n`,{flag:'a'});}
