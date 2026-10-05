import {chromium} from 'playwright';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CATEGORIES,boundedInteger,normalizeCards,isBlocked,canonicalPluginUrl,chooseDescription} from './helpers.mjs';
const categoryLimit=boundedInteger(process.env.CATEGORY_LIMIT,2,1,16);
const detailLimit=boundedInteger(process.env.DETAIL_LIMIT,10,0,100);
const maxScrolls=boundedInteger(process.env.MAX_SCROLLS,30,5,100);
const output=process.env.OUTPUT_DIR||'results';await mkdir(output,{recursive:true});
const startedAt=new Date().toISOString();const categories=[],details=[],errors=[];
const save=()=>Promise.all([writeFile(`${output}/categories.json`,JSON.stringify(categories,null,2)),writeFile(`${output}/details.json`,JSON.stringify(details,null,2)),writeFile(`${output}/errors.json`,JSON.stringify(errors,null,2))]);await save();
const browserMode=process.env.BROWSER_MODE||'chromium-headless';
if(!['chromium-headless','chromium-headed'].includes(browserMode))throw new Error('Unsupported browser mode');
const browser=await chromium.launch({channel:'chromium',headless:browserMode!=='chromium-headed'});
const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}});
const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
const navigations=[];
let initialResponse=null;
page.on('response',async response=>{
  if(!response.request().isNavigationRequest()||response.frame()!==page.mainFrame())return;
  const headers=await response.allHeaders();
  navigations.push({url:response.url(),status:response.status(),headers:Object.fromEntries(['server','cf-ray','cf-mitigated','content-type','retry-after'].filter(k=>headers[k]).map(k=>[k,headers[k]]))});
});
async function navigate(url,selector){
  initialResponse=await page.goto(url,{waitUntil:'domcontentloaded'});
  // An initial loading/challenge response is not a successful scrape: wait for actual page content.
  try{await page.locator(selector).first().waitFor({state:'visible',timeout:35000});}
  catch(error){
    const title=await page.title();const text=(await page.locator('body').innerText()).slice(0,3000);
    const status=initialResponse?.status();const failure=new Error(`Page content unavailable: HTTP ${status||'unknown'}; title=${title}; ${error.message}`);
    failure.blocked=status===403||status===429||isBlocked(title,page.url(),text);throw failure;
  }
}
async function collectCards(){return normalizeCards(await page.locator('main a[href*="/plugins/plugin_"]').evaluateAll(anchors=>anchors.map(a=>({href:a.getAttribute('href'),text:a.innerText,heading:a.querySelector('h2,h3,h4')?.innerText,icon:a.querySelector('img')?.src}))));}
async function captureError(kind,url,error){
  const name=`${kind}-${errors.length+1}`;
  await page.screenshot({path:`${output}/${name}.png`}).catch(()=>{});
  const text=(await page.locator('body').innerText().catch(()=>''));
  const candidates=await page.evaluate(()=>[...document.querySelectorAll('main p, main div[class*="whitespace"]')].map(n=>({tag:n.tagName,class:n.className,text:n.innerText}))).catch(()=>[]);
  const diagnostic={browserMode,candidates,navigations:navigations.slice(-10),title:await page.title(),bodyText:text.slice(0,8000)};
  if(initialResponse&&initialResponse.status()>=400)await writeFile(`${output}/${name}-response.html`,(await initialResponse.text().catch(()=>'')).slice(0,65536));
  await writeFile(`${output}/${name}-diagnostic.json`,JSON.stringify(diagnostic,null,2));
  errors.push({kind,url,message:String(error.message),blocked:!!error.blocked,observedUrl:page.url(),at:new Date().toISOString()});
  console.error(JSON.stringify({kind,url,blocked:!!error.blocked,diagnostic}));await save();
}
async function attempt(fn){for(let retry=0;;retry++){try{return await fn();}catch(e){if(e.blocked||retry>=1)throw e;await page.waitForTimeout(2000);}}}
let blocked=false;
try {
  for(const category of CATEGORIES.slice(0,categoryLimit)) {
    const url=`https://chatgpt.com/plugins?category=${category}`;
    try {
      const result=await attempt(async()=>{
        await navigate(url,'main a[href*="/plugins/plugin_"]');
        const found=new Map();let stable=0,previousCount=-1,stopped=false;
        for(let round=0;round<maxScrolls;round++) {
          for(const card of await collectCards())found.set(card.url,card);
          const more=page.getByRole('button',{name:/^(load more|show more|加载更多|显示更多)$/i}).first();const canLoad=await more.isVisible().catch(()=>false);
          if(canLoad){if(await more.isEnabled())await more.click();}
          else await page.evaluate(()=>{const anchors=[...document.querySelectorAll('main a[href*="/plugins/plugin_"]')];anchors.at(-1)?.scrollIntoView({block:'end'});window.scrollTo(0,document.documentElement.scrollHeight);for(const node of document.querySelectorAll('main,main div')){const style=getComputedStyle(node);if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight)node.scrollTop=node.scrollHeight;}});
          await page.waitForTimeout(1200);for(const card of await collectCards())found.set(card.url,card);
          stable=found.size===previousCount&&!canLoad?stable+1:0;previousCount=found.size;if(stable>=4){stopped=true;break;}
        }
        if(!found.size)throw new Error('No plugin cards found; empty result is not a successful snapshot');
        return {category,url,items:[...found.values()],paginationStatus:stopped?'stable-observed':'scroll-limit-reached',checkedAt:new Date().toISOString()};
      });categories.push(result);await save();console.log(`${category}: ${result.items.length} plugins (${result.paginationStatus})`);
    }catch(error){await captureError('category',url,error);if(error.blocked){blocked=true;break;}}
  }
  const queue=[...new Map(categories.flatMap(c=>c.items).map(p=>[p.url,p])).values()].slice(0,detailLimit);
  if(!blocked)for(const item of queue){
    try {
      const detail=await attempt(async()=>{
        await navigate(item.url,'main h1');
        if(canonicalPluginUrl(page.url())!==item.url)throw new Error('Detail redirected to a different plugin or route');
        await page.locator('main h1').first().waitFor({state:'visible',timeout:20000});
        const rendered=await page.evaluate(()=>({
          metadata:document.querySelector('meta[name="description"]')?.content||'',
          candidates:[...document.querySelectorAll('main p, main div[class*="whitespace"], main div[style*="--description-fade"]')].map(node=>({text:node.innerText||'',fade:(node.getAttribute('style')||'').includes('--description-fade'),preformatted:/whitespace-pre/.test(node.className)})),
        }));
        const extracted=chooseDescription(rendered);const description=extracted.description;
        const name=(await page.locator('main h1').first().innerText()).trim();
        const information=await page.locator('main dl').evaluateAll(nodes=>nodes.flatMap(dl=>[...dl.querySelectorAll('dt')].map(dt=>({label:dt.innerText,value:dt.nextElementSibling?.innerText||''}))));
        return {id:item.id,url:item.url,name,description,information,extractionMethod:extracted.method,sourceHash:createHash('sha256').update(description).digest('hex'),checkedAt:new Date().toISOString(),status:'retrieved'};
      });details.push(detail);await save();console.log(`Detail: ${detail.name}`);
    }catch(error){await captureError('detail',item.url,error);if(error.blocked){blocked=true;break;}}
    await page.waitForTimeout(1000);
  }
}finally{await context.close();await browser.close();}
const uniquePlugins=new Set(categories.flatMap(c=>c.items.map(p=>p.id))).size;
const limitedCategories=categories.filter(c=>c.paginationStatus==='scroll-limit-reached').length;
const expectedDetails=Math.min(detailLimit,uniquePlugins);
const success=categories.length===categoryLimit&&details.length===expectedDetails&&!errors.length&&!limitedCategories;
const summary={browserMode,startedAt,finishedAt:new Date().toISOString(),scope:'sample; not a complete catalog certification',requestedCategories:categoryLimit,collectedCategories:categories.length,uniquePlugins,requestedDetails:detailLimit,expectedDetails,retrievedDetails:details.length,errors:errors.length,scrollLimitedCategories:limitedCategories,blocked,success};
await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2));
const markdown=`## ChatGPT 插件采集验证\n\n- 状态：${success?'采样完成':'未通过，请查看错误和截图'}\n- 分类：${categories.length}/${categoryLimit}\n- 不同插件：${uniquePlugins}\n- 详情：${details.length}/${expectedDetails}\n- 错误：${errors.length}\n- 滚动上限未确认列表：${limitedCategories}\n\n本次为采样验证，不代表完整目录。未运行 AI 翻译或写入 D1。\n`;
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown);
console.log(JSON.stringify(summary));if(!success)process.exitCode=1;
