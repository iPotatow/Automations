import {test} from 'node:test';import assert from 'node:assert/strict';import {canonicalPluginUrl,normalizeCards,boundedInteger,isBlocked,CATEGORIES} from './helpers.mjs';
test('accept only official URLs and remove category query',()=>{assert.equal(canonicalPluginUrl('/plugins/plugin_asdk_abc?category=featured'),'https://chatgpt.com/plugins/plugin_asdk_abc');for(const value of ['https://evil.example/plugins/plugin_a','/plugins?category=featured','/plugins/not-a-plugin','javascript:alert(1)'])assert.equal(canonicalPluginUrl(value),null);});
test('same names keep different IDs; duplicate URLs collapse',()=>{const rows=normalizeCards([{href:'/plugins/plugin_a?category=featured',text:'Same\nFirst description'},{href:'/plugins/plugin_a?category=other',text:'Same\nFirst description'},{href:'/plugins/plugin_b',text:'Same\nSecond description'}]);assert.equal(rows.length,2);assert.equal(rows[0].summary,'First description');assert.notEqual(rows[0].id,rows[1].id);});
test('limits and challenge detection',()=>{assert.equal(CATEGORIES.length,16);assert.equal(boundedInteger('',2,1,16),2);for(const value of ['x',1.2,0,17])assert.throws(()=>boundedInteger(value,2,1,16));assert.ok(isBlocked('Just a moment…','https://chatgpt.com/plugins'));assert.ok(isBlocked('ChatGPT','https://chatgpt.com/auth/login'));assert.equal(isBlocked('Captcha Builder','https://chatgpt.com/plugins/plugin_a','Build captcha tools'),false);});
import {chooseDescription} from './helpers.mjs';
test('isolate actual description and preserve paragraphs, excluding prompts/privacy',()=>{
 const long='Manage projects.\n\nExecute SQL and review logs.';
 const value=chooseDescription({metadata:'Manage projects. Execute SQL and review logs.',candidates:[{text:'@Supabase Is my database secure?'},{text:long},{text:'When connected to Supabase, ChatGPT may share chats.'}]});
 assert.equal(value.description,long);assert.match(value.method,/rendered/);
 assert.throws(()=>chooseDescription({metadata:'Manage projects.',candidates:[{text:'@Supabase Manage projects.'}]}));
 assert.throws(()=>chooseDescription({metadata:'Discover and add plugins that extend ChatGPT.',candidates:[]}));
});
