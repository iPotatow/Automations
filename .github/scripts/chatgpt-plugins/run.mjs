import {chromium} from 'playwright';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {CATEGORIES,canonicalPluginUrl,normalizeCards,chooseDescription,isBlocked,boundedInteger} from './helpers.mjs';
import {applyScan,counts,translationCurrent,CATEGORY_NAMES,detailReady,deferDetail,sanitizeInformation} from './model.mjs';
import {loadState,saveState,exportState,persist} from './state.mjs';
import {translate,providerReady,providerHeaders} from './translate.mjs';
import {runPool} from './pool.mjs';

const state=await loadState(),runId=process.env.GITHUB_RUN_ID||String(Date.now()),startedAt=new Date().toISOString(),runAttempt=process.env.GITHUB_RUN_ATTEMPT||'1',runInstance=runId+':'+runAttempt;
const translationReady=()=>process.env.PIPELINE_STAGE!=='collect'&&providerReady();
const mode=process.env.MODE||'incremental',limit=boundedInteger(process.env.DETAIL_LIMIT,10000,0,20000),maxScrolls=boundedInteger(process.env.MAX_SCROLLS,250,5,1000),translationLimit=boundedInteger(process.env.TRANSLATION_LIMIT,250,0,20000);
const deadline=Date.now()+boundedInteger(process.env.MAX_MINUTES,210,1,240)*60000;
const output=process.env.OUTPUT_DIR||'results';await mkdir(output,{recursive:true});let checkpointAt=Date.now();const errors=[];let blocked=false,aiBlocked=false,detailRequests=0,translationRequests=0,translationAttempts=0,consecutiveBlocks=0;
let checkpointQueue=Promise.resolve();
function checkpoint(force=false){checkpointQueue=checkpointQueue.then(()=>writeCheckpoint(force));return checkpointQueue;}
async function writeCheckpoint(force=false){state.lastRun={runId,runAttempt,startedAt,updatedAt:new Date().toISOString(),mode,detailRequests,translationRequests,translationAttempts,translationLimit,aiConfigured:translationReady(),blocked,aiBlocked,errors:errors.length,stats:counts(state)};const snapshot=structuredClone(state);await saveState(snapshot);if(force||Date.now()-checkpointAt>300000){await exportState(snapshot);persist();checkpointAt=Date.now();}}

if(mode==='full'&&state.lastFullRequest!==runId){for(const p of Object.values(state.plugins))if(p.status!=='removed')p.detailDue=true;state.lastFullRequest=runId;}
if(translationReady()){const headers=providerHeaders();console.log(JSON.stringify({providerUserAgent:headers['User-Agent'],providerOriginator:headers.originator}));}
console.log(`AI provider configured: ${translationReady()}; mode=${mode}; details limit=${limit}; translation limit=${translationLimit||'unlimited'}`);await checkpoint();
const browser=mode==='translate'?null:await chromium.launch({channel:'chromium',headless:false});
const context=browser?await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}}):null;
const page=context?await context.newPage():null;if(page){page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);}
async function navigate(url,selector){const response=await page.goto(url,{waitUntil:'domcontentloaded'});try{await page.locator(selector).first().waitFor({state:'visible',timeout:35000});}catch(e){const title=await page.title();e.blocked=[403,429].includes(response?.status())||isBlocked(title,page.url());e.message=`Page not ready, HTTP ${response?.status()}, ${title}`;throw e;}}
async function failure(kind,url,e){const id=errors.length+1;errors.push({kind,url,message:e.message,at:new Date().toISOString(),blocked:!!e.blocked,transient:!!e.transient});console.error(JSON.stringify(errors.at(-1)));if(page){await page.screenshot({path:`${output}/${kind}-${id}.png`}).catch(()=>{});await writeFile(`${output}/${kind}-${id}.txt`,(await page.locator('body').innerText().catch(()=>'' )).slice(0,16000));}await writeFile(`${output}/errors.json`,JSON.stringify(errors,null,2));await checkpoint();}
const cards=async()=>normalizeCards(await page.locator('main a[href*="/plugins/plugin_"]').evaluateAll(as=>as.map(a=>({href:a.href,text:a.innerText,heading:a.querySelector('h2,h3,h4')?.innerText,icon:a.querySelector('img')?.src}))));
const translationBatchFull=()=>translationLimit>0&&translationAttempts>=translationLimit;
async function translateOne(p){if(!translationReady()||aiBlocked||translationBatchFull()||!p.description||translationCurrent(p))return false;if(p.translationAttemptRun===runInstance)return false;p.translationAttemptRun=runInstance;translationAttempts++;try{p.translation=await translate(p,state.translationCache,{onRequest:()=>translationRequests++});delete p.translationError;}catch(e){p.translationError={at:new Date().toISOString(),message:e.message,transient:!!e.transient};if(e.stop)aiBlocked=true;await failure('translation',p.url,e);}return true;}

try{
 if(translationReady())for(const p of Object.values(state.plugins).filter(p=>p.status!=='removed'&&p.description&&!translationCurrent(p)).slice(0,5)){if(translationBatchFull()||aiBlocked)break;await translateOne(p);await checkpoint();}
 if(mode!=='translate'){
  const categories=[];
  for(const category of CATEGORIES){if(Date.now()>deadline||blocked)break;const url=`https://chatgpt.com/plugins?category=${category}`;try{
   await navigate(url,'main a[href*="/plugins/plugin_"]');const found=new Map();let stable=0,previous=-1,done=false;
   for(let i=0;i<maxScrolls&&Date.now()<deadline;i++){for(const p of await cards())found.set(p.id,p);const more=page.getByRole('button',{name:/^(load more|show more|加载更多|显示更多)$/i}).first();const canLoad=await more.isVisible().catch(()=>false)&&await more.isEnabled().catch(()=>false);
    if(canLoad)await more.click();else await page.evaluate(()=>{const as=[...document.querySelectorAll('main a[href*="/plugins/plugin_"]')];as.at(-1)?.scrollIntoView({block:'end'});window.scrollTo(0,document.documentElement.scrollHeight);for(const n of document.querySelectorAll('main,main div'))if(/auto|scroll/.test(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight)n.scrollTop=n.scrollHeight;});
    await page.waitForTimeout(1000);for(const p of await cards())found.set(p.id,p);stable=found.size===previous&&!canLoad?stable+1:0;previous=found.size;if(stable>=4){done=true;break;}}
   categories.push({category,url,items:[...found.values()],paginationStatus:done?'stable-observed':'scroll-limit-reached'});console.log(`${category}: ${found.size} (${done?'stable':'limited'})`);
  }catch(e){await failure('category',url,e);if(e.blocked)blocked=true;}}
  const scan=applyScan(state,categories,{at:new Date().toISOString(),runId,allowLargeRemoval:process.env.ALLOW_LARGE_REMOVALS==='true'});console.log(`Scan: ${JSON.stringify(scan)}`);await checkpoint(true);
  const queue=Object.values(state.plugins).filter(p=>detailReady(p)).sort((a,b)=>Number(!!a.description)-Number(!!b.description)||(a.detailCheckedAt||'').localeCompare(b.detailCheckedAt||'')).slice(0,limit);
  for(const p of queue){if(blocked||Date.now()>deadline)break;p.detailDue=true;detailRequests++;try{
   await navigate(p.url,'main h1');
   if(canonicalPluginUrl(page.url())!==p.url)throw new Error('Redirected to another plugin; keeping previous record');
   const d=await page.evaluate(()=>({name:document.querySelector('main h1')?.innerText||'',metadata:document.querySelector('meta[name="description"]')?.content||'',candidates:[...document.querySelectorAll('main p,main div[class*="whitespace"],main div[style*="--description-fade"]')].map(n=>({text:n.textContent||'',fade:(n.getAttribute('style')||'').includes('--description-fade'),preformatted:/whitespace-pre/.test(n.className)})),information:[...document.querySelectorAll('main dl dt')].map(dt=>({label:dt.innerText,value:dt.nextElementSibling?.innerText||'',links:[...(dt.nextElementSibling?.querySelectorAll('a[href]')||[])].map(a=>a.href)}))}));
   const extracted=chooseDescription(d);p.name=d.name.trim()||p.name;p.description=extracted.description;p.information=sanitizeInformation(d.information);p.extractionMethod=extracted.method;p.detailCheckedAt=new Date().toISOString();p.detailDue=false;delete p.detailError;delete p.detailNextAttemptAt;p.detailFailures=0;consecutiveBlocks=0;await translateOne(p);
   if(detailRequests%25===0)console.log(`Details ${detailRequests}: ${JSON.stringify(counts(state))}`);
  }catch(e){deferDetail(p,e);await failure('detail',p.url,e);if(e.blocked){consecutiveBlocks++;console.log(`Challenge on one URL; cooling down before the next independent page (${consecutiveBlocks}/3).`);await page.waitForTimeout(30000);if(consecutiveBlocks>=3)blocked=true;}}await checkpoint();await page.waitForTimeout(1200);}
 }
 if(translationReady()&&!aiBlocked&&!translationBatchFull()){
  const pending=Object.values(state.plugins).filter(p=>p.status!=='removed'&&p.description&&!translationCurrent(p)&&p.translationAttemptRun!==runInstance).sort((a,b)=>(a.translationError?.at||'').localeCompare(b.translationError?.at||'')||String(a.id).localeCompare(String(b.id)));
  await runPool(pending,{concurrency:boundedInteger(process.env.AI_CONCURRENCY,3,1,8),shouldStop:()=>Date.now()>deadline||aiBlocked||translationBatchFull()},async p=>{await translateOne(p);await checkpoint();});
 }
}finally{await context?.close();await browser?.close();await checkpoint(true);}
const stats=counts(state),summary={...state.lastRun,finishedAt:new Date().toISOString(),stats,listsComplete:!!state.scans.at(-1)?.complete,detailsComplete:stats.pendingDetails===0,translationsComplete:stats.pendingTranslations===0,translationBlocked:!translationReady()||aiBlocked,translationBatchExhausted:translationBatchFull()&&stats.pendingTranslations>0,complete:!!state.scans.at(-1)?.complete&&stats.pendingDetails===0&&stats.pendingTranslations===0,checkpointSaved:true};
await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## 插件目录自动更新\n\n- 完整完成：${summary.complete}\n- 有效插件：${stats.total}\n- 完整正文：${stats.details}\n- 当前原文版本译文：${stats.translated}\n- 待抓取：${stats.pendingDetails}\n- 待翻译：${stats.pendingTranslations}\n- 本轮翻译条目：${translationAttempts}${translationLimit?` / ${translationLimit}`:' / 不限'}\n- 翻译批次已满：${summary.translationBatchExhausted}\n- AI 配置就绪：${translationReady()}\n- 进度已持久化，下次自动续跑。\n`);
if(blocked||aiBlocked)process.exitCode=1;
