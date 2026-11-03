import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
const target=process.env.JELLY_QA_TARGET, url=/^http:\/\/127\.0\.0\.1:/.test(target)?target:pathToFileURL(path.resolve(target)).href,out=path.resolve(process.env.JELLY_QA_OUTPUT);await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=default']});const context=await browser.newContext({offline:!url.startsWith('http:'),viewport:{width:1440,height:1000}});const page=await context.newPage();let errors=[];page.on('pageerror',e=>errors.push(String(e)));
if(url.startsWith('http:'))await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5194'?route.continue():route.abort());
await page.goto(url);await page.waitForFunction(()=>window.jellyZoo?.snapshot().ready);await page.mouse.move(720,450);await page.mouse.wheel(0,-240);await page.waitForTimeout(800);
const before=await page.evaluate(()=>window.jellyZoo.snapshot());await page.mouse.move(700,400);await page.mouse.down();await page.mouse.move(1020,340,{steps:24});await page.waitForTimeout(800);const held=await page.evaluate(()=>window.jellyZoo.snapshot());await page.screenshot({path:path.join(out,'held.png')});
await page.mouse.up();let values=[];for(let i=0;i<36;i++){await page.waitForTimeout(50);values.push(await page.evaluate(()=>window.jellyZoo.snapshot().pull));if([2,6,10].includes(i))await page.screenshot({path:path.join(out,`release-${i}.png`)});}
await page.waitForTimeout(2500);const rest=await page.evaluate(()=>window.jellyZoo.snapshot());await page.screenshot({path:path.join(out,'rest.png')});await browser.close();
const result={before,held,values,rest,errors};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({interaction:held.interaction,held:held.pull,minimumAfterRelease:Math.min(...values.map(v=>v[0])),rest:rest.pull,contacts:held.support.contact,errors}));if(held.interaction!=='press'||Math.abs(held.pull[0])<.5||Math.hypot(...rest.pull)>.01||errors.length)process.exitCode=1;
