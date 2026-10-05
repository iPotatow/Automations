import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {directory,persist} from './state.mjs';
import {createSiteClient,runSiteSync} from './sync-client.mjs';
if(process.env.GITHUB_EVENT_NAME==='push'||process.env.GITHUB_EVENT_INPUTS_MODE==='sync'){execFileSync('git',['-C',directory,'fetch','origin','main']);execFileSync('git',['-C',directory,'merge','--ff-only','origin/main']);}
const commit=execFileSync('git',['-C',directory,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!process.env.ACTIONS_ID_TOKEN_REQUEST_URL||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw new Error('GitHub OIDC environment unavailable');
const client=createSiteClient({oidcUrl:process.env.ACTIONS_ID_TOKEN_REQUEST_URL,oidcRequestToken:process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN});
const result=await runSiteSync(client,commit,{summary:async text=>{console.log(text);if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,text+'\n',{flag:'a'});}});

if(!result.catalog.superseded){await writeFile(`${directory}/data/published.json`,JSON.stringify({id:result.catalog.id,commit,publishedAt:new Date().toISOString()},null,2)+"\n");persist();}
