import 'reflect-metadata';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {before,after,it,describe} from 'node:test';
import type {Pool} from 'pg';
import request from 'supertest';
import {freshDatabase} from '../helpers/db';
import {testConfig} from '../helpers/env';
import {signup,bearer,startApp,type TestApp,type Session} from '../helpers/app';
import {BattleService} from '../../src/battle/service';

// Site-wide presence and invitations: any signed-in page can be invited; only island users list and challenge.
describe('site-wide battle presence and invitations',()=>{
 let t:TestApp,pool:Pool,battles:BattleService;
 before(async()=>{pool=await freshDatabase(testConfig());t=await startApp();battles=t.app.get(BattleService);});
 after(async()=>{if(t)await t.close();if(pool)await pool.end();});
 const site=(u:Session,sessionId=randomUUID(),place:'site'|'island'='site')=>request(t.server).post('/api/v1/battle/presence').set(bearer(u.access)).send({sessionId,place}).expect(201).then(r=>({sessionId,body:r.body}));
 const enter=(u:Session)=>request(t.server).post('/api/v1/battle/enter').set(bearer(u.access)).send({family:'agumon',sessionId:randomUUID()}).expect(201).then(r=>r.body);
 const inbox=(u:Session)=>request(t.server).get('/api/v1/battle/invitations').set(bearer(u.access)).expect(200).then(r=>r.body);
 const challenge=(u:Session,opponent:string,expect=201)=>request(t.server).post('/api/v1/battle/challenges').set(bearer(u.access)).send({opponent,subject:'history',requestId:randomUUID()}).expect(expect).then(r=>r.body);
 const act=(u:Session,id:string,action:string)=>request(t.server).post(`/api/v1/battle/matches/${id}/${action}`).set(bearer(u.access)).send({});

 it('lists every signed-in user with activity, invites a learner on another page and reports outcomes to both sides',async()=>{
  const learner=await signup(t),host=await signup(t);
  await site(learner);await site(host);const lobby=await enter(host);
  assert.equal(lobby.sitePresence,true);
  const me=lobby.participants.find((p:{isMe:boolean})=>p.isMe),other=lobby.participants.find((p:{isMe:boolean})=>!p.isMe);
  assert.equal(me.activity,'available');assert.equal(other.activity,'learning');assert.equal(other.place,'site');
  assert(!JSON.stringify(lobby).includes(learner.userId),'public ids only');
  // Self invitation is refused by the server.
  await challenge(host,lobby.myId,409);
  const sent=await challenge(host,other.id);assert.equal(sent.status,'pending');assert.equal(sent.expiresAt-sent.serverNow,10000);
  const inc=await inbox(learner);assert.equal(inc.invitations.length,1);assert.equal(inc.invitations[0].direction,'incoming');assert.equal(inc.invitations[0].expiresAt,sent.expiresAt);
  assert.equal((await request(t.server).get('/api/v1/battle/lobby').set(bearer(host.access)).query({sessionId:randomUUID()})).status,409,'lobby list still needs an island lease');
  const relisted=await enter(host);assert.equal(relisted.participants.find((p:{id:string})=>p.id===other.id).activity,'invited');
  // Recipient declines: the challenger learns why.
  assert.equal((await act(learner,sent.id,'decline')).status,201);
  const outcome=await inbox(host);assert.equal(outcome.invitations.length,0);assert.deepEqual(outcome.closed.map((c:{id:string;reason:string;direction:string})=>[c.id,c.reason,c.direction]),[[sent.id,'declined','outgoing']]);
  // Challenger cancels: the recipient learns why.
  const again=await challenge(host,other.id);assert.equal((await act(host,again.id,'decline')).status,201);
  assert.equal((await inbox(learner)).closed.find((c:{id:string})=>c.id===again.id).reason,'cancelled');
  // Ten-second expiry, announced by the sweeper.
  const late=await challenge(host,other.id);t.clock.advance(10001);await site(learner);
  const swept=await battles.sweep();assert(swept>=2);
  assert.equal((await inbox(learner)).closed.find((c:{id:string})=>c.id===late.id).reason,'expired');
  assert.equal((await act(learner,late.id,'accept')).status,409,'expired invitation cannot be accepted');
  t.clock.advance(30000);
 });

 it('queues simultaneous invitations, keeps their expiry, and accepting one closes the rest as busy for everyone',async()=>{
  const target=await signup(t),b=await signup(t),c=await signup(t);
  await site(target);const lb=await enter(b);await enter(c);
  const tid=lb.participants.find((p:{isMe:boolean;activity:string})=>!p.isMe&&p.activity==='learning').id;
  const fromB=await challenge(b,tid);t.clock.advance(1500);const fromC=await challenge(c,tid);
  const q=await inbox(target);assert.deepEqual(q.invitations.map((i:{id:string})=>i.id),[fromB.id,fromC.id]);assert.equal(q.invitations[0].expiresAt,fromB.expiresAt);assert.equal(q.invitations[1].expiresAt,fromC.expiresAt);
  // Two tabs accept the same invitation at once (double click / multi-tab): one battle, one seat each.
  const [x,y]=await Promise.all([act(target,fromB.id,'accept'),act(target,fromB.id,'accept')]);
  assert.deepEqual([x.status,y.status],[201,201]);assert.equal(x.body.status,'ready');assert.equal(y.body.status,'ready');
  assert.equal(Number((await pool.query('SELECT count(*) FROM hanq.battle_seats WHERE match_id=$1',[fromB.id])).rows[0].count),2);
  assert.equal(Number((await pool.query("SELECT count(*) FROM hanq.battle_matches WHERE status IN('ready','playing','between') AND (challenger=$1 OR opponent=$1)",[target.userId])).rows[0].count),1);
  const other=await inbox(c);assert.equal(other.closed.find((x:{id:string})=>x.id===fromC.id).reason,'busy');
  assert.equal((await act(target,fromC.id,'accept')).status,409,'closed invitation stays closed');
  // A player in battle cannot be challenged; the server decides, not the button.
  const d=await signup(t);const ld=await enter(d);const busyId=ld.participants.find((p:{id:string})=>p.id===tid);assert.equal(busyId.activity,'battling');
  const busyRes=await request(t.server).post('/api/v1/battle/challenges').set(bearer(d.access)).send({opponent:tid,subject:'history'});assert.equal(busyRes.status,409);assert.equal(busyRes.body.error.code,'battle_busy');
  await act(b,fromB.id,'forfeit');t.clock.advance(30000);
 });

 it('treats tabs of one account as one presence: closing one tab keeps the invitation, losing the last one closes it',async()=>{
  const u=await signup(t),h=await signup(t);const tab1=await site(u);await site(u);
  const lh=await enter(h);const learners=lh.participants.filter((p:{isMe:boolean;activity:string})=>!p.isMe&&p.activity==='learning');
  assert.equal(learners.length,1,'one row per account, not per tab');const uid=learners[0].id;
  const inv=await challenge(h,uid);
  await request(t.server).post('/api/v1/battle/suspend').set(bearer(u.access)).send({sessionId:tab1.sessionId}).expect(201);
  assert.equal((await inbox(u)).invitations.length,1,'the other tab keeps the account online');
  await act(h,inv.id,'decline');
  // Network loss on the last tab: no suspend, only missing heartbeats. Expiry of the lease closes the invitation.
  const inv2=await challenge(h,uid);await pool.query('UPDATE hanq.battle_matches SET expires_at=$2 WHERE id=$1',[inv2.id,new Date(t.clock.t+60000)]);
  t.clock.advance(13000);await enter(h);t.clock.advance(13000);await enter(h);
  await battles.sweep();
  assert.equal((await inbox(h)).closed.find((c:{id:string})=>c.id===inv2.id).reason,'offline');
  assert.equal((await enter(h)).participants.some((p:{id:string})=>p.id===uid),false,'expired presence leaves the list');
  t.clock.advance(30000);
 });

 it('limits repeated invitations and rejects requests from outsiders',async()=>{
  const r=await signup(t),s=await signup(t),x=await signup(t);await site(r);const ls=await enter(s);const rid=ls.participants.find((p:{isMe:boolean;activity:string})=>!p.isMe&&p.activity==='learning').id;
  const first=await challenge(s,rid);
  // Same pair: no duplicate invitation.
  const dup=await request(t.server).post('/api/v1/battle/challenges').set(bearer(s.access)).send({opponent:rid,subject:'history'}).expect(200);assert.equal(dup.body.id,first.id);assert.equal(dup.body.challengeCreated,false);
  // Only the recipient accepts; an outsider sees nothing.
  assert.equal((await act(s,first.id,'accept')).status,403);assert.equal((await act(x,first.id,'accept')).status,404);
  await act(s,first.id,'decline');
  let limited=false;for(let i=0;i<8&&!limited;i++){const res=await request(t.server).post('/api/v1/battle/challenges').set(bearer(s.access)).send({opponent:rid,subject:'history',requestId:randomUUID()});if(res.status===429)limited=true;else await act(s,res.body.id,'decline');}
  assert(limited,'rapid invitations are rate limited');
  t.clock.advance(30000);
 });

 it('keeps the site stream out of match liveness and sends invitations with outcomes',async()=>{
  const u=await signup(t);const tab=await site(u);
  const server=t.app.getHttpServer().listen(0);const port=(server.address() as {port:number}).port;
  try{
   const ctl=new AbortController();const res=await fetch(`http://127.0.0.1:${port}/api/v1/battle/events?place=site&sessionId=${tab.sessionId}`,{headers:{Authorization:'Bearer '+u.access},signal:ctl.signal});
   assert.equal(res.status,200);const reader=res.body!.getReader();let text='';const deadline=Date.now()+3000;
   while(!text.includes('event: invitations')&&Date.now()<deadline){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}
   assert(text.includes('event: invitations'));const payload=JSON.parse(text.split('event: invitations\ndata: ')[1].split('\n')[0]);
   assert.deepEqual(Object.keys(payload).sort(),['closed','invitations','serverNow']);assert(!text.includes('event: snapshot')&&!text.includes('event: waiting'),'no match traffic on the site stream');
   assert.equal(battles.connections.has(u.userId),false,'site stream is not a match connection');
   ctl.abort();
   await new Promise(r=>setTimeout(r,100));
   assert.equal(Number((await pool.query('SELECT count(*) FROM hanq.battle_lobby_sessions WHERE user_id=$1',[u.userId])).rows[0].count),1,'closing the site stream keeps the tab lease');
  }finally{await new Promise(r=>server.close(()=>r(null)));}
 });
});
