import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const url=process.env.JELLY_QA_URL||'http://127.0.0.1:5194/';
const out=path.resolve(process.env.JELLY_QA_OUTPUT||'artifacts/qa/transparency-review');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=default']});const ctx=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});const page=await ctx.newPage();const report={errors:[],external:[],states:{}};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('request',r=>{if(new URL(r.url()).origin!==new URL(url).origin)report.external.push(r.url());});
try{
 await page.goto(url);await page.waitForFunction(()=>window.jellyZoo?.snapshot().ready,null,{timeout:45000});
 await page.mouse.move(720,450);await page.mouse.wheel(0,-240);await page.waitForTimeout(800);
 const capture=async name=>{await page.waitForTimeout(650);report.states[name]=await page.evaluate(()=>window.jellyZoo.snapshot());await page.screenshot({path:path.join(out,name+'.png')});};
 for(const [name,opacity] of [['opaque',100],['medium',60],['transparent',20]]){await page.locator('#jelly-opacity').fill(String(opacity));await capture(name);}
 await page.locator('#mode-orbit').click();await page.mouse.move(720,450);await page.mouse.down();await page.mouse.move(900,450,{steps:15});await page.mouse.up();await capture('transparent-side');
 await page.locator('#jelly-opacity').fill('100');await capture('opaque-side');
 await page.locator('#jelly-color').fill('#7d9ed1');await page.locator('#jelly-opacity').fill('20');await capture('blue-transparent');
 await page.locator('#jelly-color-reset').click();await page.locator('#jelly-opacity').fill('100');await capture('restored');
 if(report.states.opaque.appearance.visualOpacity!==1||report.states.medium.appearance.visualOpacity!==.6||report.states.transparent.appearance.visualOpacity!==.2||report.states.restored.appearance.visualOpacity!==1)throw Error('Opacity state does not follow the control');
 if(report.states.transparent.appearance.materials[0].opacity!==.2||report.states.restored.appearance.materials[0].transparent)throw Error('Material opacity did not update or restore');
}catch(e){report.failure=String(e);process.exitCode=1;}finally{await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({errors:report.errors,external:report.external,failure:report.failure,states:Object.fromEntries(Object.entries(report.states).map(([k,v])=>[k,{visualOpacity:v.appearance.visualOpacity,materials:v.appearance.materials}]))},null,2));}
if(report.errors.length||report.external.length)process.exitCode=1;
