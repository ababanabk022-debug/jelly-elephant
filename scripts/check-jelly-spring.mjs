import {chromium} from 'playwright';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const target=process.env.JELLY_QA_TARGET,url=/^http:\/\/127\.0\.0\.1:/.test(target)?target:pathToFileURL(path.resolve(target)).href,out=path.resolve(process.env.JELLY_QA_OUTPUT);await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=default']}),ctx=await browser.newContext({offline:!url.startsWith('http:'),viewport:{width:1440,height:1000}}),page=await ctx.newPage();let errors=[];page.on('pageerror',e=>errors.push(String(e)));if(url.startsWith('http:'))await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:5194'?r.continue():r.abort());
await page.goto(url);await page.waitForFunction(()=>window.jellyZoo?.snapshot().ready);await page.mouse.move(720,450);await page.mouse.wheel(0,-240);await page.waitForTimeout(800);
const cases=[];for(const distance of [85,320]){
 await page.mouse.move(700,400);await page.mouse.down();await page.mouse.move(700+distance,400,{steps:20});await page.waitForTimeout(1000);const held=await page.evaluate(()=>window.jellyZoo.snapshot());
 if(held.interaction!=='press')throw Error('Drag missed model');
 const recording=page.evaluate(()=>new Promise(resolve=>{const frames=[];let start;function frame(t){start??=t;frames.push({t:t-start,pull:window.jellyZoo.snapshot().pull[0]});if(t-start<2600)requestAnimationFrame(frame);else resolve(frames);}requestAnimationFrame(frame);}));
 await page.mouse.up();const frames=await recording;await page.waitForTimeout(1400);const rest=await page.evaluate(()=>window.jellyZoo.snapshot());
 cases.push({distance,held:held.pull[0],frames,rest:rest.pull[0]});
}
await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify({cases,errors},null,2));
const measure=c=>{const early=c.frames.filter(f=>f.t>50&&f.t<180);return {distance:c.distance,held:c.held,firstOpposite:Math.min(...c.frames.map(f=>f.pull)),earlySpeed:(c.held-early.at(-1).pull)/(early.at(-1).t/1000),rest:c.rest}};
const metrics=cases.map(measure);console.log(JSON.stringify({metrics,errors}));if(metrics[1].earlySpeed<metrics[0].earlySpeed*1.5||metrics[1].firstOpposite>-.12||Math.abs(metrics[1].rest)>.01||errors.length)process.exitCode=1;
