import http from 'node:http';
import {readFile} from 'node:fs/promises';
const assets=new Map([
  ['/', ['index.html','text/html']],
  ['/index.html',['index.html','text/html']],
  ['/style.css',['style.css','text/css']],
  ['/app.js',['app.js','text/javascript']],
  ['/optimizer.mjs',['optimizer.mjs','text/javascript']],
  ['/costs.mjs',['costs.mjs','text/javascript']],
  ['/routing.mjs',['routing.mjs','text/javascript']],
  ['/search.mjs',['search.mjs','text/javascript']],
  ['/tolls.mjs',['tolls.mjs','text/javascript']],
  ['/toll-data.json',['toll-data.json','application/json']]
]);
const port=Number(process.env.PORT)||4173;
http.createServer(async(req,res)=>{
  const asset=assets.get(new URL(req.url,'http://localhost').pathname);
  if(!asset){res.writeHead(404).end('Not found');return;}
  try{
    const data=await readFile(new URL(asset[0],import.meta.url));
    res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-store'});
    res.end(data);
  }catch{res.writeHead(500).end('Unable to load asset');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
