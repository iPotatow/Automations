import {QUALITY_VERSION,checkCompleteness} from './translation-quality.mjs';
import {createHash} from 'node:crypto';
import {CATEGORIES} from './helpers.mjs';
export const CATEGORY_NAMES=['热门','新品推荐','小型企业','效率','创意','开发者工具','业务与运营','数据与分析','沟通','教育','科学研究','安全','金融','医疗健康','旅行','其他'];
const LEGAL_INFORMATION_LABELS=new Set(['privacy policy','privacy notice','privacy statement','terms of service','terms of use','terms and conditions','terms & conditions','service agreement','service terms','隐私政策','隐私声明','服务条款','服务协议','使用条款','用户协议']);
const normalizeInformationLabel=value=>String(value||'').trim().toLowerCase().replace(/[\s_-]+/g,' ').replace(/[：:]+$/,'');
export function isLegalInformationLabel(label){return LEGAL_INFORMATION_LABELS.has(normalizeInformationLabel(label));}
export function sanitizeInformation(information){return Array.isArray(information)?information.filter(item=>!isLegalInformationLabel(item?.label)):[];}
export function sanitizeState(state){if(!state||typeof state!=='object')return state;for(const plugin of Object.values(state.plugins||{}))if(plugin&&typeof plugin==='object')plugin.information=sanitizeInformation(plugin.information);return state;}
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const sourceHash=p=>hash({name:p.name,summary:p.summary||'',description:p.description||''});
export const emptyState=()=>({version:1,plugins:{},scans:[],events:[],translationCache:{}});
export function applyScan(state,categories,{at,runId,allowLargeRemoval=false}) {
 const seen=new Map();for(const c of categories)for(const p of c.items){let x=seen.get(p.id);if(!x){x={...p,categories:[]};seen.set(p.id,x);}x.categories.push(c.category);}
 const previous=Object.values(state.plugins).filter(p=>p.status!=='removed').length;
 const all=CATEGORIES.every(slug=>categories.some(c=>c.category===slug&&c.paginationStatus==='stable-observed'&&c.items.length));
 const complete=all&&(allowLargeRemoval||!previous||seen.size>=previous*.8);
 const scanId=String(runId),previousScan=state.scans.findIndex(s=>s.id===scanId),duplicate=previousScan!==-1;
 for(const [id,p] of seen){const old=state.plugins[id];const oldSummary=old?.summary;
  state.plugins[id]={...old,...p,categories:complete?p.categories:[...new Set([...(old?.categories||[]),...p.categories])],status:'active',missingCount:0,lastSeenAt:at,firstSeenAt:old?.firstSeenAt||at};
  if(!old||old.status==='removed')state.events.push({type:old?'restored':'added',id,at,runId});
  if(old&&(oldSummary!==p.summary||old.name!==p.name)){state.plugins[id].detailDue=true;state.events.push({type:'summary-changed',id,at,runId});}
 }
 if(complete&&!duplicate)for(const p of Object.values(state.plugins))if(!seen.has(p.id)&&p.status!=='removed'){
  // A rerun or multiple runs on one day never count as independent absence confirmations.
  if(p.lastMissingAt&&Date.parse(at)-Date.parse(p.lastMissingAt)<23*3600000)continue;
  p.lastMissingAt=at;p.missingCount=(p.missingCount||0)+1;p.status=p.missingCount>=2?'removed':'missing';
  state.events.push({type:p.status==='removed'?'removed':'missing',id:p.id,at,runId});
 }
 const record={id:scanId,at,complete,seen:seen.size,previous,categories:categories.map(c=>({category:c.category,count:c.items.length,status:c.paginationStatus}))};if(duplicate)state.scans.splice(previousScan,1);state.scans.push(record);
 state.scans=state.scans.slice(-60);state.events=state.events.slice(-10000);return {complete,duplicate,seen:seen.size,previous};
}
export function translationCurrent(p){return !!p.translation&&p.translation.sourceHash===sourceHash(p)&&p.translation.status==='translated'&&p.translation.qualityVersion===QUALITY_VERSION&&p.translation.model!=='@cf/meta/m2m100-1.2b';}
export function counts(state){const active=Object.values(state.plugins).filter(p=>p.status!=='removed');return {total:active.length,details:active.filter(p=>p.description).length,translated:active.filter(translationCurrent).length,missing:active.filter(p=>p.status==='missing').length,removed:Object.values(state.plugins).filter(p=>p.status==='removed').length,pendingDetails:active.filter(p=>!p.description||p.detailDue).length,pendingTranslations:active.filter(p=>!translationCurrent(p)).length};}
export function catalogRows(state){return CATEGORIES.flatMap((slug,categoryId)=>Object.values(state.plugins).filter(p=>p.status!=='removed'&&p.categories?.includes(slug)).map((p,ordinal)=>({id:p.id,categoryId,ordinal,payload:{id:p.id,name:p.name,description:translationCurrent(p)?p.translation.summary:(p.summary||'官方短简介暂缺'),icon:p.icon||undefined,officialUrl:p.url,summaryOriginal:p.summary||'',longDescriptionOriginal:p.description||undefined,longDescription:translationCurrent(p)?p.translation.description:undefined,contentStatus:p.description?'retrieved':'pending',translationStatus:translationCurrent(p)?'translated':'pending',availability:p.status,developer:p.information?.find(i=>i.label==='Developer')?.value||'',information:sanitizeInformation(p.information),checkedAt:p.detailCheckedAt||p.lastSeenAt}})));}
export function validateTranslation(result,source){
 const paragraphs=(source.description||'').split(/\n\s*\n/).filter(p=>p.trim());
 if(typeof result.summary!=='string'||!result.summary.trim()||!Array.isArray(result.paragraphs)||result.paragraphs.length!==paragraphs.length)throw new Error('Translation must include summary and every original paragraph');
 if(result.paragraphs.some((p,i)=>typeof p!=='string'||!p.trim()||p.length<Math.min(12,paragraphs[i].length*.1)))throw new Error('Translation contains an empty or suspiciously short paragraph');
 if(!/[\u3400-\u9fff]/.test(result.summary+result.paragraphs.join('')))throw new Error('Translation contains no Chinese text');
 const context=(source.name||'')+' '+(source.description||'');
 checkCompleteness(source.summary||source.name||'',result.summary,context);
 result.paragraphs.forEach((text,i)=>checkCompleteness(paragraphs[i],text,context));
 return {summary:result.summary.trim(),description:result.paragraphs.map(p=>p.trim()).join('\n\n')};
}

export function detailReady(p,now=Date.now()){
 if(p.status==='removed')return false;
 const due=!p.description||p.detailDue||!p.detailCheckedAt||now-Date.parse(p.detailCheckedAt)>7*86400000;
 const next=p.detailNextAttemptAt||(p.detailError?.at?new Date(Date.parse(p.detailError.at)+3600000).toISOString():null);
 return due&&(!next||Date.parse(next)<=now);
}
export function deferDetail(p,error,now=Date.now()){
 p.detailFailures=(p.detailFailures||0)+1;
 p.detailNextAttemptAt=new Date(now+Math.min(24,2**(p.detailFailures-1))*3600000).toISOString();
 p.detailError={at:new Date(now).toISOString(),message:error.message};
 p.detailDue=true;
}
