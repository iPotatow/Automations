import {readFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {directory,loadState} from './state.mjs';
import {translationCurrent} from './model.mjs';
export function operation({requested='',event='',schedule=''}={}){
  if(requested)return requested;
  if(event==='push')return 'translate';
  return schedule==='0 4,8,12 * * *'?'translate':'incremental';
}
export function plan(state,manifest,published,mode){
  const pending=Object.values(state.plugins).filter(p=>p.status!=='removed'&&p.description&&!translationCurrent(p)).length;
  return {ready:true,mode,needs_translation:mode!=='sync'&&pending>0,needs_publish:mode==='sync'||manifest.id!==published?.id,pending};
}
async function optionalJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const mode=operation({requested:process.env.REQUESTED_MODE,event:process.env.EVENT_NAME,schedule:process.env.EVENT_SCHEDULE});
  if(!['incremental','full','translate','sync'].includes(mode))throw new Error('Invalid pipeline mode');
  const manifest=await optionalJson(`${directory}/data/manifest.json`);
  if(!manifest?.id)throw new Error('Publication manifest missing');
  const result=plan(await loadState(),manifest,await optionalJson(`${directory}/data/published.json`),mode);
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,Object.entries(result).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
}
