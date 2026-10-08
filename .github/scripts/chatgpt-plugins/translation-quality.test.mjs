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

test('payment received and URL punctuation do not reject faithful Chinese',()=>{
 assert.equal(checkCompleteness('Book clients, get paid','承接客户业务并收款'),'承接客户业务并收款');
 assert.throws(()=>checkCompleteness('A paid plan is required','需要套餐'),/cost/);
 checkCompleteness('Read [document](https://example.org/terms).','阅读[文档](https://example.org/terms)。');
 checkCompleteness('See https://example.org/spec.json.','参见 https://example.org/spec.json。');
 assert.throws(()=>checkCompleteness('See https://example.org/terms.','参见 https://example.org/other。'),/protected value/);
 assert.throws(()=>checkCompleteness('See https://example.org/wiki/A_(B).','参见 https://example.org/wiki/A_。'),/protected value/);
});

test('positions follows source domain without weakening securities checks',()=>{
 checkCompleteness('planetary positions','行星位置');
 checkCompleteness('custom positions','自定义局面','Checkers');
 checkCompleteness('argue their positions','阐述各自立场');
 checkCompleteness('open positions','空缺职位','Recruiting');
 checkCompleteness('positions that match your experience','找到符合经验的职位','Fresenius Medical Care Careers');
 checkCompleteness('repeated positions on a Go board','禁止围棋棋盘局面重复','Go Game by BlueMoon');
 checkCompleteness('review Search Console clicks and positions','查看 Search Console 点击量和排名','SEO');
 assert.throws(()=>checkCompleteness('positions and open orders','位置和开放订单','Brokerage'),/positions|open orders/);
 const units=translationUnits({name:'Checkers',summary:'Play a game',description:'Load custom positions.'});
 validateUnits({segments:[{id:'summary',text:'玩一局游戏'},{id:'p0.0',text:'加载自定义局面。'}]},units);
});

test('accepts job position context and faithful cost phrasing',()=>{
 assert.equal(checkCompleteness('available positions at SonicJobs show job opportunities','展示可申请的职位机会','SonicJobs employment opportunities'),'展示可申请的职位机会');
 assert.equal(checkCompleteness('Cost-effective capture, monthly pricing and delivery fees','成本效益高；月费和配送费',''),'成本效益高；月费和配送费');
 assert.equal(checkCompleteness('Clear, competitive pricing','清晰且有竞争力的票价',''),'清晰且有竞争力的票价');
 checkCompleteness('positions that match your experience','找到符合经验的职位','Fresenius Medical Care Careers');
 checkCompleteness('repeated positions on a Go board','禁止围棋棋盘局面重复','Go Game by BlueMoon');
});

test('accepts usage-based pricing as a cost term',()=>{
 assert.equal(checkCompleteness('usage-based pricing','按使用量计费'),'按使用量计费');
});
