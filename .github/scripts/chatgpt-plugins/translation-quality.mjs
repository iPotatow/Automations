export const QUALITY_VERSION=2;
export const GLOSSARY='Notion、Canva、Shopify、HubSpot等品牌名保持原文；positions在金融中=持仓或头寸，在其他领域按上下文译为位置、局面、立场或职位；open orders=未成交委托；P&L=盈亏；dropship=一件代发；print on demand=按需印刷；pitch deck=路演演示文稿；CRM tickets=工单；log calls=记录通话；feature flags=功能开关。';
export function parseModelOutput(result){
 const choice=result?.choices?.[0];
 if(choice?.finish_reason==='length')throw new Error('Translation output truncated');
 const value=typeof result==='string'?result:result?.response??choice?.message?.content;
 if(value&&typeof value==='object'&&!Array.isArray(value))return value;
 if(typeof value!=='string')throw new Error('Missing final translation output');
 return JSON.parse(value.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
}
const rules=[
 [/\bpositions\b/i,/持仓|头寸/, 'positions'],
 [/\bopen orders\b/i,/未(?:成交|结|完成)|挂单/, 'open orders'],
 [/\bdropship(?:ping)?\b/i,/一件代发|代发货/, 'dropship'],
 [/\bprint on demand\b/i,/按需(?:印刷|打印)/, 'print on demand'],
 [/\bpitch deck\b/i,/路演|融资(?:演示|推介)|商业推介/, 'pitch deck'],
 [/\bfeature flags?\b/i,/功能(?:开关|标志|标记)/, 'feature flags'],
 [/\blog calls\b/i,/记录(?:电话|通话)/, 'log calls'],
 [/\bfree (?:plan|tier)\b/i,/免费/, 'free plan'],
 [/\bno credit card required\b/i,/(?:无需|不需要|不用|不需).{0,6}信用卡/, 'no credit card'],
 [/\bread.only\b/i,/只读/, 'read-only'],
 [/\b(?:confirm|confirmation|approval)\b/i,/确认|批准|审批|核准|获批|证实/, 'confirmation'],
 [/\b(?:requires?|required|requirements)\b/i,/需要|需|要求|必须|须|必填|必要/, 'requirement'],
 [/\b(?:credits|paid|pricing|costs?|fees?)\b/i,/积分|额度|点数|付费|价格|定价|报价|费用|收费|成本|消耗|缴税|税费|支付|付款|收款|年费|保费|手续费|花费|多少钱/, 'cost'],
 [/never submits orders directly/i,/(?:不会|从不|绝不).{0,12}(?:提交|下单)/, 'no direct orders'],
];
function positionTerms(source){
 if(/astrolog|planet|natal|horoscope|nakshatra|cuspal|zodiac/i.test(source))return /位置|宫位|度数|落点/;
 if(/checkers|draughts|chess|endgame|board game/i.test(source))return /局面|棋局|棋盘|位置/;
 if(/debate|argue|viewpoints|stance/i.test(source))return /立场|观点/;
 if(/recruit|vacanc|job positions|hiring|candidate/i.test(source))return /岗位|职位/;
 return /持仓|头寸/;
}
export function checkCompleteness(source,target,context=''){
 if(typeof target!=='string'||!target.trim())throw new Error('Empty translation');
 for(const [input,output,label] of rules){
  const checked=label==='cost'?source.replace(/\b(?:get|getting)\s+paid\b/gi,''):source;
  const expected=label==='positions'?positionTerms(source+' '+context):output;
  if(input.test(checked)&&!expected.test(target))throw new Error('Translation missing or mistranslating '+label);
 }
 for(const brand of ['Notion','Canva','Shopify','HubSpot','SIPC','Windsor','IBKR','AAPL','Codex'])if(new RegExp('\\b'+brand+'\\b','i').test(source)&&!target.toLowerCase().includes(brand.toLowerCase()))throw new Error('Translation lost protected name '+brand);
 for(let token of source.match(/https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d+(?:\.\d+)?\b/g)||[]){
  if(/^https?:\/\//.test(token)){
   token=token.replace(/[.,;:!?]+$/,'');
   while(token.endsWith(')')&&(token.match(/\)/g)||[]).length>(token.match(/\(/g)||[]).length)token=token.slice(0,-1);
  }
  if(!target.includes(token))throw new Error('Translation lost protected value '+token);
 }
 if(/[讓與實體為這個權帳]/.test(target))throw new Error('Translation must use simplified Chinese');
 return target;
}
export function translationUnits(p){
 const units=[{id:'summary',text:p.summary||p.name,paragraph:-1}];
 for(const [paragraph,text] of (p.description||'').split(/\n\s*\n/).filter(x=>x.trim()).entries()){
  // Split at original line or sentence boundaries; never split in the middle of a token.
  const parts=text.split(/\n|(?<=[.!?])\s+(?=[A-Z@])/).filter(x=>x.trim());let chunk='',part=0;
  for(const line of parts){if(chunk&&(chunk.length+line.length>1200)){units.push({id:`p${paragraph}.${part++}`,text:chunk,paragraph});chunk='';}chunk+=(chunk?'\n':'')+line;}
  if(chunk)units.push({id:`p${paragraph}.${part}`,text:chunk,paragraph});
 }
 return units.map(u=>({...u,context:(p.name||'')+' '+(p.summary||'')}));
}
export function unitBatches(units){const batches=[];let batch=[],size=0;for(const u of units){if(batch.length&&(size+u.text.length>3000||batch.length>=8)){batches.push(batch);batch=[];size=0;}batch.push(u);size+=u.text.length;}if(batch.length)batches.push(batch);return batches;}
export function validateUnits(output,units){
 if(!Array.isArray(output?.segments)||output.segments.length!==units.length)throw new Error('Translation must preserve every segment ID');
 const map=new Map();for(const s of output.segments){if(typeof s?.id!=='string'||map.has(s.id)||typeof s.text!=='string')throw new Error('Duplicate or invalid segment ID');map.set(s.id,s.text);}
 return units.map(u=>{if(!map.has(u.id))throw new Error('Missing segment '+u.id);return {id:u.id,text:checkCompleteness(u.text,map.get(u.id),u.context||''),paragraph:u.paragraph};});
}
export function assembleUnits(translated,p){const paragraphs=(p.description||'').split(/\n\s*\n/).filter(x=>x.trim()).map((_,i)=>translated.filter(u=>u.paragraph===i).map(u=>u.text).join('\n'));return {summary:translated.find(u=>u.id==='summary')?.text,paragraphs};}
export function translationPriority(p){return (p.categories?.includes('featured')?0:100)+(p.categories?.includes('finance')?0:10)+(['Canva','Shopify','HubSpot','Interactive Brokers (IBKR)','Notion','Windsor.ai'].includes(p.name)?-200:0);}
