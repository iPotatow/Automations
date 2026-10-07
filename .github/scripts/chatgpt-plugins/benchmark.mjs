import {readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {directory,loadState} from './state.mjs';
import {hash} from './model.mjs';
import {TRANSLATION_SYSTEM_PROMPT} from './translate.mjs';
import {GLOSSARY,QUALITY_VERSION,translationUnits,validateUnits,parseModelOutput,translationPriority} from './translation-quality.mjs';
import {createWorkersAiQuotaGuard} from './cloudflare-usage.mjs';
const path=`${directory}/data/translation-benchmark.json`,models=['@cf/qwen/qwen3-30b-a3b-fp8','@cf/mistralai/mistral-small-3.1-24b-instruct','@cf/google/gemma-4-26b-a4b-it'];
let report;try{report=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!report){
 const state=await loadState(),all=Object.values(state.plugins).filter(p=>p.status!=='removed'&&p.description),selected=[];
 const add=p=>{if(p&&!selected.some(x=>x.id===p.id))selected.push(p);};
 all.filter(p=>translationPriority(p)<0).forEach(add);
 for(const category of [...new Set(all.flatMap(p=>p.categories||[]))])all.filter(p=>p.categories?.includes(category)).sort((a,b)=>hash(a.id).localeCompare(hash(b.id))).slice(0,3).forEach(add);
 all.sort((a,b)=>hash(a.id).localeCompare(hash(b.id))).forEach(p=>{if(selected.length<50)add(p);});
 report={version:QUALITY_VERSION,createdAt:new Date().toISOString(),models,samples:selected.slice(0,50).map(p=>{const units=translationUnits(p);const body=units.filter(u=>u.paragraph>=0);const chosen=body.find(u=>/require|free|paid|read.only|confirm|plan|positions|dropship|pitch deck/i.test(u.text))||body[0];return {id:p.id,name:p.name,categories:p.categories,sourceHash:hash({summary:p.summary,description:p.description}),units:[units[0],chosen].filter(Boolean)};}),results:{},complete:false};
}
async function save(){report.updatedAt=new Date().toISOString();await writeFile(path+'.tmp',JSON.stringify(report,null,2));await rename(path+'.tmp',path);}
await save();const guard=createWorkersAiQuotaGuard({env:{...process.env,CLOUDFLARE_AI_USAGE_CHECK_EVERY:'1'}}),deadline=Date.now()+20*60000;let attempts=0;
const system=TRANSLATION_SYSTEM_PROMPT+'\n术语表：'+GLOSSARY+'\n本次输出格式替换为 {"segments":[{"id":"原输入id","text":"完整中文译文"}]}。每个输入id必须恰好输出一次，禁止拆分、合并或添加id。不要输出summary或paragraphs字段。';
outer:for(const sample of report.samples)for(const model of models){
 const key=sample.id+'|'+model;if(report.results[key]?.completed)continue;
 if(Date.now()>deadline||attempts>=30)break outer;
 const decision=await guard.reserve();if(!decision.allowed){report.pauseReason=decision.reason;break outer;}
 attempts++;const start=Date.now();let record={sampleId:sample.id,model,at:new Date().toISOString(),completed:false};
 try{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:JSON.stringify({name:sample.name,segments:sample.units.map(({id,text})=>({id,text}))})}],max_tokens:5000,temperature:0.1,stream:false}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error('HTTP '+response.status);const body=await response.json();if(!body.success)throw new Error('Inference failed');
  record.usage=body.result?.usage||null;const parsed=parseModelOutput(body.result);record.output=parsed;record.completed=true;
  try{validateUnits(parsed,sample.units);record.checksPassed=true;}catch(e){record.checksPassed=false;record.validationError=e.message;}
 }catch(e){record.error=e.message;}
 record.elapsedMs=Date.now()-start;report.results[key]=record;await save();console.log(JSON.stringify({model,sample:sample.name,completed:record.completed,checksPassed:record.checksPassed,error:record.error}));
}
report.summary=models.map(model=>{const rows=Object.values(report.results).filter(r=>r.model===model),done=rows.filter(r=>r.completed);return {model,requested:report.samples.length,completed:done.length,checksPassed:done.filter(r=>r.checksPassed).length,errors:rows.filter(r=>r.error).length,reportedNeurons:rows.reduce((n,r)=>n+Number(r.usage?.neurons||0),0)};});
report.complete=report.summary.every(x=>x.completed===report.samples.length);await save();console.log(JSON.stringify(report.summary));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'\n## 同条件翻译模型对比\n\n'+JSON.stringify(report.summary,null,2)+'\n\n仅为规则检查通过数，不等同于人工质量评分。完整结果保存在 data/translation-benchmark.json。\n');
