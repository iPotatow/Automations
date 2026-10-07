import test from 'node:test';import assert from 'node:assert/strict';
import {parseModelOutput,checkCompleteness,translationUnits,validateUnits,assembleUnits} from './translation-quality.mjs';
test('accept object and string responses, never reasoning or truncated output',()=>{
 const value={segments:[{id:'summary',text:'简介'}]};
 assert.deepEqual(parseModelOutput({response:value}),value);
 assert.deepEqual(parseModelOutput({choices:[{message:{content:'```json\n'+JSON.stringify(value)+'\n```',reasoning_content:'invalid'}}]}),value);
 assert.throws(()=>parseModelOutput({response:value,choices:[{finish_reason:'length'}]}),/truncated/);
 assert.throws(()=>parseModelOutput({choices:[{message:{reasoning_content:'{}'}}]}),/Missing/);
});
test('reject observed financial, commercial, permission and cost omissions',()=>{
 for(const [source,bad,good] of [
 ['Search your Notion pages','搜索概念页面','搜索 Notion 页面'],
 ['positions and open orders','位置和开放订单','持仓和未成交委托'],
 ['dropship and print on demand','降价店和需求业务','一件代发和按需印刷'],
 ['pitch deck','商业计划书','路演演示文稿'],
 ['Read-only. Free plan available, no credit card required.','连接账户即可。','只读。有免费套餐，无需信用卡。'],
 ['Buy 100 AAPL at $200. Member SIPC.','买入股票。','以200美元买入100股AAPL。SIPC会员。']
 ]){assert.throws(()=>checkCompleteness(source,bad));assert.equal(checkCompleteness(source,good),good);}
});
test('stable IDs allow reordering but reject duplicated or missing segments',()=>{
 const p={name:'Demo',summary:'Read',description:'First.\n\nSecond.'},units=translationUnits(p);
 const segments=units.map(u=>({id:u.id,text:'完整译文。'})).reverse();
 assert.deepEqual(assembleUnits(validateUnits({segments},units),p),{summary:'完整译文。',paragraphs:['完整译文。','完整译文。']});
 assert.throws(()=>validateUnits({segments:segments.slice(1)},units));
 assert.throws(()=>validateUnits({segments:[segments[0],segments[0],segments[2]]},units));
});
