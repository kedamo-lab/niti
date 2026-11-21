'use strict';
// Local development only: both terminals, the actual API, and a private SQLite DB.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const masterPort=Number(process.env.NITI_MASTER_PORT || 8000),playerPort=Number(process.env.NITI_PLAYER_PORT || 8787);
for(const port of[masterPort,playerPort])if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose ports from 1024 to 65535.');
if(masterPort===playerPort)throw Error('The two terminals need different ports.');
const masterOrigin='http://127.0.0.1:'+masterPort,playerOrigin='http://127.0.0.1:'+playerPort;
const compiled=path.join(root,'players/dist/server/index.js');
if(!fs.existsSync(compiled))throw Error('First run: python3 players/scripts/build-worker.py');
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
const db=new DatabaseSync(path.join(root,'.local/niti.sqlite'));
if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='niti_rooms'").get()){
  db.exec(fs.readFileSync(path.join(root,'players/drizzle/0000_petite_bullseye.sql'),'utf8'));
}
class Statement{
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.sql,values);}
  async first(column){const row=db.prepare(this.sql).get(...this.values);return row?(column?row[column]:{...row}):null;}
  async all(){return{success:true,results:db.prepare(this.sql).all(...this.values).map(row=>({...row}))};}
  async run(){const row=db.prepare(this.sql).run(...this.values);return{success:true,meta:{changes:Number(row.changes),last_row_id:Number(row.lastInsertRowid)}};}
}
const env={DB:{prepare:sql=>new Statement(sql)}};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const servers=[];
(async()=>{
  const worker=await import(pathToFileURL(compiled).href);
  async function handle(req,res,isPlayer){
    try{
      const origin=isPlayer?playerOrigin:masterOrigin,url=new URL(req.url,origin);
      if(isPlayer){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const init={method:req.method,headers:req.headers};
        if(!['GET','HEAD'].includes(req.method)&&chunks.length)init.body=Buffer.concat(chunks);
        const request=new Request(url,init);
        const response=url.pathname.startsWith('/api/')
          ?await worker.handleApi(request,env,{allowedOrigins:[masterOrigin,playerOrigin]})
          :await worker.default.fetch(request,env);
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const folder=path.join(root,'master/dist'),name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1),file=path.resolve(folder,name);
      if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
      let data=fs.readFileSync(file);
      if(path.extname(file)==='.html')data=Buffer.from(data.toString().replace('<head>','<head><script>window.NITI_SESSION_API_BASE='+JSON.stringify(playerOrigin+'/api')+';window.NITI_SESSION_PLAYER_URL='+JSON.stringify(playerOrigin+'/')+';</script>'));
      res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});res.end('Local server error. See the terminal.');console.error(error.message);}
  }
  for(const[port,isPlayer]of[[masterPort,false],[playerPort,true]]){
    const server=http.createServer((req,res)=>handle(req,res,isPlayer));
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});servers.push(server);
  }
  console.log('Master:  '+masterOrigin);console.log('Players: '+playerOrigin);console.log('Local database: .local/niti.sqlite');console.log('Stop: Ctrl+C');
})().catch(error=>{console.error(error.message);for(const server of servers)server.close();db.close();process.exitCode=1;});
for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>{for(const server of servers)server.close();db.close();process.exit(0);});
