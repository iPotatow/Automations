export const CATEGORIES=['featured','new-and-noteworthy','small-business','productivity','creativity','developer-tools','business-and-operations','data-and-analytics','communication','education-and-research','scientific-research','security','finance','healthcare','travel','other'];
export function boundedInteger(value,fallback,min,max){const n=value==null||value===''?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Expected integer ${min}–${max}`);return n;}
export function canonicalPluginUrl(href){try{const url=new URL(href,'https://chatgpt.com');if(url.origin!=='https://chatgpt.com'||!/^\/plugins\/plugin_[A-Za-z0-9_-]+\/?$/.test(url.pathname))return null;return url.origin+url.pathname.replace(/\/$/,'');}catch{return null;}}
export function normalizeCards(cards){const result=new Map();for(const card of cards){const url=canonicalPluginUrl(card.href);const lines=(card.text||'').split('\n').map(x=>x.trim()).filter(Boolean);const name=(card.heading||lines[0]||'').trim();if(!url||!name)continue;result.set(url,{id:new URL(url).pathname.split('/').pop(),url,name,summary:lines.filter((line,i)=>i>0&&line!==name).join('\n'),icon:card.icon||null});}return [...result.values()];}
export function isBlocked(title,url,text=''){return /just a moment|access denied|attention required|verify.*human/i.test(title)||/\/auth\/(login|signin)/.test(url)||/^\s*(verify you are human|checking your browser|error code: 1010)/i.test(text);}
// Metadata is used only to identify an actually rendered description element.
// Never publish metadata alone, example prompts, or the whole page text as a description.
export function chooseDescription({metadata='',candidates=[]}) {
  const normalize=s=>s.replace(/\s+/g,' ').trim();
  const reference=normalize(metadata);
  const explicit=candidates.find(c=>c.fade&&c.text.trim());
  if(explicit)return {description:explicit.text.trim(),method:'description-fade'};
  if(!reference||reference.length<1||/^Discover and add plugins|^Use ChatGPT to answer/i.test(reference))throw new Error('No usable official description reference');
  const exact=candidates.filter(c=>normalize(c.text)===reference).sort((a,b)=>a.text.length-b.text.length)[0];
  if(exact)return {description:exact.text.trim(),method:'rendered-description-metadata-match'};
  // A shortened SEO description may identify a longer, explicitly preformatted UI block.
  const prefix=reference.replace(/(?:\.\.\.|…)$/,'').trim();
  const extended=candidates.filter(c=>c.preformatted&&normalize(c.text).startsWith(prefix)&&!normalize(c.text).includes('When connected to')).sort((a,b)=>a.text.length-b.text.length)[0];
  if(extended)return {description:extended.text.trim(),method:'rendered-preformatted-description'};
  throw new Error('Could not isolate rendered official description');
}
