import {readFile,readdir} from 'node:fs/promises';
import {directory,loadState,saveState,exportState} from './state.mjs';
import {sourceHash,validateTranslation} from './model.mjs';
import {QUALITY_VERSION} from './translation-quality.mjs';
const state=await loadState(),fixes=JSON.parse(await readFile(`${directory}/data/reviewed-translations.json`,'utf8'));let repaired=0;
try{
 for(const file of (await readdir(`${directory}/data/reviewed-translations`)).filter(f=>f.endsWith('.json')).sort())fixes.push(...JSON.parse(await readFile(`${directory}/data/reviewed-translations/${file}`,'utf8')));
}catch(error){if(error.code!=='ENOENT')throw error;}
for(const fix of fixes){const p=state.plugins[fix.id];if(!p||sourceHash(p)!==fix.sourceHash)continue;
 const validated=validateTranslation({summary:fix.summary,paragraphs:fix.description.split(/\n\s*\n/).filter(x=>x.trim())},p);
 p.translation={...validated,sourceHash:fix.sourceHash,status:'translated',model:fix.model||'editorial-review',qualityVersion:QUALITY_VERSION,reviewedAt:new Date().toISOString(),translatedAt:new Date().toISOString()};
 state.translationCache[fix.sourceHash]=p.translation;delete p.translationError;repaired++;
}
await saveState(state);const manifest=await exportState(state);console.log(JSON.stringify({repaired,stats:manifest.stats}));
