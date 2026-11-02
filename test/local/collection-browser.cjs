/* Isolated native API + actual browser end-to-end verification. */
/* global localStorage, window, document, innerWidth, getComputedStyle */
// Only synthetic authentication is adapted. Collection reads/commands use real Nest HTTP
// and independent native PostgreSQL transactions. No production endpoint is contacted.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright'),f=require('./lobby-evolution.cjs');
const front=path.resolve(process.env.HANQ_FRONT_DIR||'../fe'),out=path.resolve(process.env.HANQ_COLLECTION_OUT||path.resolve(front,'../evidence/real-collection'));fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/result.json',JSON.stringify({passed:false,status:'running',productionConnected:false}));
let server,browser,ticker,dropClaim=false,delayClaim=false,delayedClaimRelease=null;const posts=[],report=[];
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
async function state(i){return f.http(i,'GET','me/partners');}
async function sameSum(i){const p=await state(i),r=await f.db.pool.query('SELECT sum(amount)::text xp FROM hanq.growth_ledger WHERE user_id=$1',[f.users[i].id]);assert.equal(p.totalPoints,Number(r.rows[0].xp));assert.equal(p.items.filter(d=>d.equipped).length,1);return p;}
(async()=>{
 await f.start();
 server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://fixture.invalid').pathname,i=Number(req.headers['x-fixture-user']||0),user=f.users[i];
  if(pathname==='/api/v1/auth/refresh'||pathname==='/api/v1/auth/signin')return json(res,{accessToken:user.token,accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),user:{id:user.id,displayName:user.name,email:'synthetic@example.invalid'}});
  if(pathname==='/api/v1/auth/logout')return json(res,{revoked:true});
  if(pathname==='/api/v1/me'||pathname.startsWith('/api/v1/me/partners')||pathname.startsWith('/api/v1/battle/')){
   let body='';for await(const chunk of req)body+=chunk;
   const r=await fetch(f.origin+req.url,{method:req.method,headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json'},...(!['GET','HEAD'].includes(req.method)?{body:body||'{}'}:{})});
   if(pathname.includes('/partners/')&&req.method==='POST'){posts.push({user:i,path:pathname,body:JSON.parse(body),status:r.status});if(delayClaim&&pathname.endsWith('/claim')&&r.ok){delayClaim=false;await new Promise(resolve=>{delayedClaimRelease=resolve;});}if(dropClaim&&pathname.endsWith('/claim')&&r.ok){await r.arrayBuffer();res.destroy();return;}}
   res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json'});for await(const chunk of r.body)res.write(chunk);res.end();return;
  }
  // These panels are outside this scenario. Empty synthetic records carry no XP or ownership.
  if(pathname.startsWith('/api/'))return json(res,{items:[],notes:[],days:[],archived:[],total:0,today:false,plan:{},checkout:{available:false},testFreePass:{available:false}});
  const file=path.resolve(front,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));if(!file.startsWith(front+path.sep)){res.writeHead(403);res.end();return;}
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
  fs.readFile(file,(err,bytes)=>{res.writeHead(err?404:200,{'Content-Type':type});res.end(err?'':bytes);});
 }catch{if(!res.headersSent)json(res,{error:'isolated_proxy_error'},500);else res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 for(const [ei,engine]of (process.env.HANQ_MOTION_ONLY?[]:['chromium','webkit']).entries()){
  browser=await ({chromium,webkit})[engine].launch(engine==='chromium'?{channel:'chrome'}:{});
  for(const [wi,width]of [320,390,1440].entries()){
   const i=ei*3+wi,context=await browser.newContext({viewport:{width,height:width===320?568:900},extraHTTPHeaders:{'X-Fixture-User':String(i)}});
   await context.addInitScript(()=>{localStorage.setItem('hanqacct:signedIn','1');localStorage.setItem('hanq:display-mode:v1','terminal');});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>{if(!/due to access control checks/.test(e.message))errors.push(e.message);});
   await page.goto(base+'/#rainbow');await page.locator('.ri-game').waitFor();
   await page.locator('[data-select="gabumon"]').click();await page.locator('[data-action="claim"]').waitFor();assert.equal(await page.locator('[data-action="claim"]').isEnabled(),true);
   const before=posts.length;dropClaim=true;await page.locator('[data-action="claim"]').dblclick();await page.waitForFunction(()=>document.querySelector('.ri-status')?.textContent.includes('아직 확인'));
   assert(posts.length>=before+1);assert.equal(new Set(posts.slice(before).map(x=>x.body.requestId)).size,1);assert.equal((await state(i)).items.length,2);dropClaim=false;
   await page.locator('[data-action="claim"]').click();await page.locator('.ri-purchase-complete').waitFor();assert.match(await page.locator('.ri-purchase-complete').innerText(),/파피몬 알을 구매 완료했습니다/);
   assert.equal(posts[before].body.requestId,posts[before+1].body.requestId);let p=await sameSum(i),egg=p.items.find(d=>d.family==='gabumon');assert.equal(egg.points,0);assert.equal(egg.stage,-1);
   await page.screenshot({path:out+'/'+engine+'-'+width+'-purchase.png'});
   await page.locator('.ri-overlay-actions a').click();await page.locator('.ac-inventory-grid').waitFor();await page.locator('[data-inventory="wardrobe"]').click();assert.match(await page.locator('.ac-wardrobe-note').innerText(),/새로운 옷장을 준비/);
   await page.locator('[data-inventory="equip"][data-id="'+egg.id+'"]').click();await page.waitForFunction(id=>window.HanqApi.state().partners.equippedId===id,egg.id);p=await state(i);egg=p.items.find(d=>d.id===egg.id);const deadline=egg.hatchReadyAt;assert.equal(Date.parse(deadline)-Date.parse(egg.hatchStartedAt),60000);
   await page.locator('.ac-inventory').screenshot({path:out+'/'+engine+'-'+width+'-inventory.png'});
   await page.evaluate(()=>{window.__realNow=Date.now;Date.now=()=>9999999999999;});await page.waitForTimeout(1100);assert.equal((await state(i)).items.find(d=>d.id===egg.id).stage,-1);await page.evaluate(()=>{Date.now=window.__realNow;});
   await page.reload();await page.locator('.ac-inventory-grid').waitFor();assert.equal((await state(i)).items.find(d=>d.id===egg.id).hatchReadyAt,deadline);
   if(engine==='chromium'&&width===390){
    const wallStart=Date.now();ticker=setInterval(()=>f.advance(100),100);console.log('Real-time60second UI countdown started');
    await page.locator('.is-hatching').waitFor({timeout:70000});clearInterval(ticker);ticker=null;assert(Date.now()-wallStart>=59000);console.log('Real-time60second automatic UI hatch confirmed');
   }else{
    await context.setOffline(true);f.advance(60000);await page.evaluate(()=>window.HanqApi.me().catch(()=>{}));assert.equal(await page.evaluate(()=>window.HanqApi.state().profileStatus),'error');await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.locator('.is-hatching').waitFor({timeout:15000});
   }
   p=await sameSum(i);egg=p.items.find(d=>d.id===egg.id);assert.equal(egg.stage,0);assert.equal(egg.hatchedAt,deadline);assert.equal(egg.points,0);assert.equal(p.totalPoints,1000);
   await page.locator('.ac-inventory').screenshot({path:out+'/'+engine+'-'+width+'-hatched.png'});
   await page.reload();await page.locator('.ac-inventory-grid').waitFor();assert.equal((await state(i)).items.find(d=>d.id===egg.id).stage,0);
   await page.emulateMedia({reducedMotion:'reduce'});await page.goto(base+'/#rainbow');await page.locator('.ri-game').waitFor();assert.equal(await page.locator('.ri-game').getAttribute('data-paused'),'true');await page.locator('[data-select="gabumon"]').click();assert.equal(await page.locator('[data-action="claim"]').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
   if(engine==='chromium'&&width===390){
    await page.getByRole('button',{name:'선택 닫기'}).click();await page.locator('[data-select=patamon]').click();delayClaim=true;await page.locator('[data-action=claim]').click();for(let n=0;n<50&&!delayedClaimRelease;n++)await page.waitForTimeout(50);assert(delayedClaimRelease,'server committed pending purchase');
    await page.evaluate(()=>window.HanqApi.logout());await context.setExtraHTTPHeaders({'X-Fixture-User':'7'});await page.evaluate(()=>window.HanqApi.signin('synthetic7@example.invalid','synthetic-fixture-only',false));delayedClaimRelease();delayedClaimRelease=null;await page.goto(base+'/#account');await page.locator('.ac-inventory-grid').waitFor();assert.equal(await page.locator('.ac-partner-card').count(),1);assert.equal(await page.locator('[data-partner="'+egg.id+'"]').count(),0);assert.equal(await page.locator('.ri-purchase-complete').count(),0);assert.equal((await state(7)).items.length,1);
   }
   report.push({engine,width,passed:true,realNestCollection:true,nativePostgres:true,lostResponseSameKey:true,serverDeadlinePreserved:true,hatch:width===390&&engine==='chromium'?'real60second automatic countdown':'controlled server clock +failed read +offline reconnect',xpPreserved:true,accountSwitchRace:engine==='chromium'&&width===390,reducedMotion:true,pageErrors:errors});console.log(engine,width,'PASS');await context.close();
  }
  await browser.close();browser=null;
 }
 // New motion is also checked against real collection commands and server snapshots.
 browser=await chromium.launch({channel:'chrome'});
 const motionContext=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'X-Fixture-User':'6'}});
 await motionContext.addInitScript(()=>{localStorage.setItem('hanqacct:signedIn','1');localStorage.setItem('hanq:display-mode:v1','terminal');});
 const motionPage=await motionContext.newPage(),motion=[];
 for(const family of ['gabumon','patamon']){
  await motionPage.goto(base+'/#rainbow');await motionPage.locator('[data-select="'+family+'"]').click();await motionPage.locator('[data-action="claim"]').click();await motionPage.locator('.ri-purchase-complete').waitFor();await motionPage.locator('.ri-overlay-actions a').click();await motionPage.locator('.ac-inventory-grid').waitFor();
  let p=await state(6),egg=p.items.find(d=>d.family===family);const id=egg.id;
  await motionPage.locator('[data-inventory="equip"][data-id="'+id+'"]').click();await motionPage.waitForFunction(id=>window.HanqApi.state().partners.equippedId===id,id);
  f.advance(60000);await motionPage.evaluate(()=>window.HanqApi.me());await motionPage.locator('[data-partner="'+id+'"].is-hatching').waitFor();
  await motionPage.locator('[data-partner="'+id+'"] .cm-life.cm-ready').waitFor();await motionPage.locator('[data-partner="'+id+'"]').screenshot({path:out+'/real-motion-'+family+'-hatched.png'});
  await f.points(6,1800);await motionPage.evaluate(()=>window.HanqApi.me());const forms=[];
  for(let stage=1;stage<=5;stage++){
   await motionPage.locator('[data-inventory="evolve"][data-id="'+id+'"]').click();await motionPage.waitForFunction(({id,stage})=>window.HanqApi.state().partners.items.find(d=>d.id===id).stage===stage,{id,stage});
   p=await sameSum(6);const form=p.items.find(d=>d.id===id);forms.push(form.character);
   const art=motionPage.locator('[data-partner="'+id+'"] .cm-life[data-character="'+form.character+'"]');await art.waitFor();await motionPage.locator('[data-partner="'+id+'"] .cm-evolving').waitFor();
   await motionPage.locator('[data-partner="'+id+'"]').screenshot({path:out+'/real-motion-'+form.character+'-evolve.png'});
   if(stage===2||stage===5){
    await motionPage.goto(base+'/#battle');await motionPage.getByRole('button',{name:'봇과 연습'}).waitFor();const response=motionPage.waitForResponse(r=>r.url().endsWith('/battle/practice')&&r.request().method()==='POST');await motionPage.getByRole('button',{name:'봇과 연습'}).click();const practiceResponse=await response;assert.equal(practiceResponse.status(),201);const match=await practiceResponse.json();
    await motionPage.locator('.bi-arena').waitFor();await motionPage.locator('.bi-avatar-frame .cm-life.cm-ready[data-character="'+form.character+'"]').first().waitFor();
    assert.equal((await f.http(6,'GET','battle/matches/'+match.id)).fighters.left.character,form.character);
    const backgrounds=await motionPage.locator('.bi-avatar-frame .cm-core').evaluateAll(ns=>ns.map(n=>getComputedStyle(n).backgroundImage));assert.equal(backgrounds.length,2);
    for(const background of backgrounds){assert(!background.includes('/media/media/'),'external CSS must resolve the actual asset');const url=background.match(/url\(["']?(.*?)["']?\)/)[1];const image=await motionPage.request.get(url);assert.equal(image.status(),200);assert((await image.body()).length>1000);}

    const readyResponse=motionPage.waitForResponse(r=>r.url().endsWith('/'+match.id+'/ready')&&r.request().method()==='POST');await motionPage.locator('.bi-ready-button').click();const readyReply=await readyResponse;assert.equal(readyReply.status(),201);const readyState=await readyReply.json();
    f.advance(readyState.start-readyState.serverNow+100);await f.http(6,'GET','battle/matches/'+match.id);const choice=motionPage.locator('.bi-choice[data-option="A"]').first();await motionPage.waitForFunction(()=>{const b=document.querySelector('.bi-choice[data-option="A"]');return b&&!b.disabled;});await choice.click();
    const answerResponse=motionPage.waitForResponse(r=>r.url().endsWith('/'+match.id+'/answers')&&r.request().method()==='POST');await motionPage.locator('.bi-submit').click();assert.equal((await answerResponse).status(),201);
    await f.http(6,'GET','battle/matches/'+match.id);await motionPage.locator('.bi-combat-active').waitFor({timeout:15000});await motionPage.locator('.bi-collection-pose').first().waitFor({timeout:15000});if(form.character==='patamon')await motionPage.locator('.bi-collection-pose[data-art-source="patamon-actions-v2"]').first().waitFor({timeout:10000});
    await motionPage.locator('.bi-arena').screenshot({path:out+'/real-motion-'+form.character+'-battle-combat.png'});
    const inspect=()=>motionPage.locator('.bi-fighter').evaluateAll(nodes=>nodes.map(n=>({side:n.dataset.fighter,nodes:Array.from(n.querySelectorAll('.bi-pose,.bi-avatar-frame,.bi-avatar,.cm-life,.cm-core,.cm-fallback,.bi-state-frame,.bi-hurt-frame')).map(x=>{const c=getComputedStyle(x),r=x.getBoundingClientRect();return{tag:x.tagName,classes:x.className,visibility:c.visibility,opacity:c.opacity,display:c.display,rect:[r.x,r.y,r.width,r.height],transform:c.transform,backgroundImage:c.backgroundImage,position:c.backgroundPosition,mask:c.maskImage};})})));
    const during=await inspect();await motionPage.waitForTimeout(3200);const after=await inspect();fs.writeFileSync(out+'/real-motion-'+form.character+'-battle-dom.json',JSON.stringify({during,after},null,2));await motionPage.locator('.bi-arena').screenshot({path:out+'/real-motion-'+form.character+'-battle-after.png'});

    await f.act(6,match.id,'forfeit');await motionPage.goto(base+'/#account');await motionPage.locator('.ac-inventory-grid').waitFor();await motionPage.locator('[data-partner="'+id+'"] .cm-ready').waitFor();await motionPage.locator('.ac-inventory').screenshot({path:out+'/real-motion-'+form.character+'-account.png'});
   }
  }
  motion.push({family,forms,realNestCommands:true,nativePostgres:true,equip:true,serverConfirmedHatch:true,serverConfirmedEvolution:true,rookieAndFinalBattleIdle:true,realRoundAnswerAndCombat:true});
 }
 assert.equal((await sameSum(6)).totalPoints,4600);assert.equal((await state(6)).items.find(d=>d.firstPartner).points,1000);
 report.push({motion,isolatedRewards:'synthetic local ledger only;1800XP per equipped family',allXpPreserved:true});
 await motionContext.close();await browser.close();browser=null;
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,authentication:'synthetic adapter',unrelatedPanels:'empty fixtures',productionConnected:false,report,posts},null,2)+'\n');
})().catch(e=>{fs.writeFileSync(out+'/failure.json',JSON.stringify({error:e.stack,report,posts},null,2));console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(delayedClaimRelease)delayedClaimRelease();if(ticker)clearInterval(ticker);if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await f.close();});
