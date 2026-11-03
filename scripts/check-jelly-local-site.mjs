import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const out='artifacts/qa/jelly-local-site';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=default']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),report={requests:[],external:[],errors:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('request',r=>report.requests.push(r.url()));
await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port==='5194')return route.continue();report.external.push(url.href);return route.abort();});
try {await page.goto('http://127.0.0.1:5194/');await page.waitForFunction(()=>window.jellyZoo?.snapshot().ready,null,{timeout:45000});await page.waitForTimeout(400);report.state=await page.evaluate(()=>window.jellyZoo.snapshot());await page.screenshot({path:out+'/default.png'});if(!report.requests.some(u=>u.endsWith('/models/jelly-elephant.glb')))throw Error('Model did not load as separate asset');if(report.external.length||report.errors.length)throw Error('External request or browser error');}
catch(e){report.failure=String(e);process.exitCode=1;}finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({requests:report.requests,external:report.external,errors:report.errors,failure:report.failure,look:report.state?.appearance?.variant}));}
