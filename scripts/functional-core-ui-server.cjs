'use strict';
// Test-only wrapper around the actual candidate application. Never shipped in its runtime image.
require('reflect-metadata');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Pool}=require('pg'),{loadConfig}=require('/app/dist/src/config/config.js'),{createApp}=require('/app/dist/src/bootstrap.js'),{migrate}=require('/app/dist/src/db/migrator.js'),{loadFrontCatalog}=require('/app/dist/src/questions/catalog-loader.js'),{seedQuestions}=require('/app/dist/src/questions/question-seeder.js');
const origin='http://127.0.0.1:8790',root='/run/frontend',url=new URL(process.env.HANQ_TEST_DATABASE_URL);
assert.equal(process.env.NODE_ENV,'test');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/hanq_core_ui_test');
let now=Date.parse('2026-10-08T03:00:00Z');const clock={now:()=>new Date(now)},key=()=>crypto.randomBytes(32).toString('hex');
function semanticHash(){const rows=[],hash=x=>crypto.createHash('sha256').update(x).digest('hex'),base='/app/private-textbook-semantic-data';function walk(relative){for(const name of fs.readdirSync(path.join(base,relative)).sort((a,b)=>a.localeCompare(b,'en'))){const file=path.join(base,relative,name),s=fs.lstatSync(file);assert(!s.isSymbolicLink());if(s.isDirectory())walk(path.join(relative,name));else{assert(s.isFile());rows.push({path:path.join(relative,name).split(path.sep).join('/'),size:s.size,sha256:hash(fs.readFileSync(file))});}}}walk('');assert.equal(rows.length,298);return hash(JSON.stringify(rows));}
async function main(){
 assert.equal(semanticHash(),process.env.HANQ_QUAL_SEMANTIC_SHA256,'Readonly semantic identity changed');
 const pool=new Pool({connectionString:url.href,ssl:false,max:4}),manifest=JSON.parse(fs.readFileSync('/run/migration-manifest.json','utf8'));
 const result=await migrate(pool,'/app/migrations');assert.equal(result.applied.length,54);assert.deepEqual((await pool.query('SELECT version,checksum FROM hanq.schema_migrations ORDER BY version')).rows,manifest.migrations);
 await seedQuestions(pool,loadFrontCatalog(root),clock.now());
 const config=loadConfig({NODE_ENV:'test',HANQ_TEST_DATABASE_URL:url.href,HANQ_DB_SSL_MODE:'disable',HANQ_JWT_ISSUER:'hanq-core-ui-test',HANQ_JWT_ACCESS_SECRET:key(),HANQ_JWT_REFRESH_SECRET:key(),HANQ_CORS_ORIGINS:origin,HANQ_COOKIE_SAMESITE:'lax',HANQ_COOKIE_SECURE:'false',HANQ_PAYMENT_PROVIDER:'test',HANQ_CBT_PUBLIC_ASSET_BASE_URL:'off',HANQ_RATE_LIMIT_PER_MINUTE:'100000',HANQ_AUTH_RATE_LIMIT_PER_MINUTE:'100000',HANQ_LOGIN_FAILURES_PER_15MIN:'1000'});
 const app=await createApp(config,clock);await app.init();const realApi=app.getHttpAdapter().getInstance();
 const server=http.createServer(async(req,res)=>{try{
  const requestUrl=new URL(req.url,origin);
  if(requestUrl.pathname==='/__qualification/ready'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ready:true,sourceCommit:process.env.HANQ_QUAL_SOURCE_COMMIT,frontendCommit:process.env.HANQ_QUAL_FRONTEND_COMMIT,production:false,clock:'controlled synthetic test clock'}));}
  if(requestUrl.pathname==='/__qualification/clock'&&req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('Oversized test control');}const change=JSON.parse(body);assert(Number.isSafeInteger(change.advanceMs)&&change.advanceMs>=0&&change.advanceMs<=86400000);now+=change.advanceMs;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({serverNow:clock.now().toISOString()}));}
  if(requestUrl.pathname==='/__qualification/oracle'){const q=(await pool.query("SELECT v.question_id,v.version,v.correct_option_id,v.points FROM hanq.free_question_slots f JOIN hanq.question_versions v ON v.question_id=f.question_id AND v.is_current WHERE f.kind='quiz' ORDER BY f.chapter,f.position LIMIT 1")).rows[0];assert(q);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(q));}
  if(requestUrl.pathname==='/__qualification/ledger'){const id=requestUrl.searchParams.get('owner');assert(/^[a-f0-9-]{36}$/.test(id));const r=await pool.query('SELECT coalesce(sum(amount),0)::int xp FROM hanq.growth_ledger WHERE user_id=$1',[id]);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({xp:r.rows[0].xp}));}
  if(requestUrl.pathname.startsWith('/api/v1/'))return realApi(req,res);
  assert(['GET','HEAD'].includes(req.method));const relative=decodeURIComponent(requestUrl.pathname)==='/'?'index.html':decodeURIComponent(requestUrl.pathname).replace(/^\//,'');const file=path.resolve(root,relative);assert(file.startsWith(root+'/'));assert(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink());
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
 }catch{res.statusCode=404;res.end('Unavailable in isolated test fixture');}});
 await new Promise(resolve=>server.listen(8790,'127.0.0.1',resolve));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();app.close().finally(()=>pool.end()).finally(()=>process.exit(0));});
}
main().catch(()=>{console.error('Isolated core UI application setup failed; details withheld.');process.exitCode=1;});
