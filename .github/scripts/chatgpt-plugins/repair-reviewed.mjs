import {readFile} from 'node:fs/promises';
import {directory,loadState,saveState,exportState} from './state.mjs';
import {sourceHash,validateTranslation} from './model.mjs';
import {QUALITY_VERSION} from './translation-quality.mjs';
const state=await loadState(),fixes=JSON.parse(await readFile(`${directory}/data/reviewed-translations.json`,'utf8'));let repaired=0;
for(const fix of fixes){const p=state.plugins[fix.id];if(!p||sourceHash(p)!==fix.sourceHash)continue;
 const validated=validateTranslation({summary:fix.summary,paragraphs:fix.description.split(/\n\s*\n/).filter(x=>x.trim())},p);
 p.translation={...validated,sourceHash:fix.sourceHash,status:'translated',model:'editorial-review',qualityVersion:QUALITY_VERSION,reviewedAt:new Date().toISOString(),translatedAt:new Date().toISOString()};
 state.translationCache[fix.sourceHash]=p.translation;delete p.translationError;repaired++;
}
await saveState(state);const manifest=await exportState(state);console.log(JSON.stringify({repaired,stats:manifest.stats}));
