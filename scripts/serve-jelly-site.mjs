/** Only serves the prepared local static website on the loopback interface. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.join(project,'jelly-site');
if(!fs.existsSync(path.join(root,'index.html')))throw new Error('Website missing; run npm run build then node scripts/build-jelly-site.mjs first.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{
 if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405).end();return;}
 let name;try{name=decodeURIComponent(new URL(req.url??'/','http://127.0.0.1').pathname);}catch{res.writeHead(400).end();return;}
 if(name.includes('\0')){res.writeHead(400).end();return;}if(name==='/')name='/index.html';
 const file=path.resolve(root,'.'+name),relative=path.relative(root,file);
 if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative)){res.writeHead(403).end();return;}
 fs.stat(file,(error,stat)=>{
  if(error||!stat.isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Local file not found');return;}
  const tag=`"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const headers={'Content-Type':types[path.extname(file).toLowerCase()]??'application/octet-stream','Content-Length':String(stat.size),'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','ETag':tag};
  if(req.headers['if-none-match']===tag){delete headers['Content-Length'];res.writeHead(304,headers).end();return;}
  res.writeHead(200,headers);if(req.method==='HEAD'){res.end();return;}const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
 });
}).listen(5194,'127.0.0.1',()=>console.log('Jelly Elephant: http://127.0.0.1:5194/ (local files only)'));
