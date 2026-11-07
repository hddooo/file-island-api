import 'reflect-metadata';
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {test} from 'node:test';import request from 'supertest';
import {bearer,signup,startApp} from '../helpers/app';import {freshDatabase} from '../helpers/db';import {testConfig} from '../helpers/env';
test('private question request: owner isolation, replay-safe binary uploads and two review gates',async()=>{
 const pool=await freshDatabase(testConfig()),app=await startApp();
 try{
 const owner=await signup(app),other=await signup(app),admin=await signup(app);await pool.query("INSERT INTO hanq.member_roles VALUES($1,'ADMIN')",[admin.userId]);
 const payload={requestId:randomUUID(),subject:'toeic',part:5,sourceLabel:'Synthetic source',questions:[{number:101,stem:'Synthetic question?',choices:['A','B','C','D'].map(id=>({id,text:'Choice '+id})),correctOptionId:'C'}]};
 const base='/api/v1/question-requests',created=await request(app.server).post(base).set(bearer(owner.access)).send(payload);assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.id,path=base+'/'+id;
 assert.equal((await request(app.server).post(base).set(bearer(owner.access)).send(payload)).body.id,id);
 assert.equal((await request(app.server).get(path)).status,401);assert.equal((await request(app.server).get(path).set(bearer(other.access))).status,404);assert.equal((await request(app.server).get('/api/v1/ops/question-requests').set(bearer(owner.access))).status,403);
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),assetId=randomUUID();
 const url=path+'/assets?assetId='+assetId+'&purpose=source_image&mediaType=image/png&expectedRevision=1';
 const upload=()=>request(app.server).post(url).set(bearer(owner.access)).set('Content-Type','application/octet-stream').send(image);
 const up=await upload();assert.equal(up.status,201,JSON.stringify(up.body));assert.equal(up.body.revision,2);assert.equal((await upload()).body.replayed,true);
 assert.equal((await request(app.server).get(path+'/assets/'+assetId).set(bearer(other.access))).status,404);
 assert.equal((await request(app.server).get(path+'/assets/'+assetId).set(bearer(owner.access))).headers['content-type'],'image/png');
 assert.equal((await request(app.server).post(path+'/submit').set(bearer(owner.access)).send({expectedRevision:1})).status,409);
 assert.equal((await request(app.server).post(path+'/submit').set(bearer(owner.access)).send({expectedRevision:2})).body.status,'submitted');
 const ops='/api/v1/ops/question-requests/'+id;
 assert.equal((await request(app.server).patch(ops).set(bearer(admin.access)).send({expectedRevision:3,status:'ready_for_publish',reviewNote:'Invalid skip',cleanImageChecked:true})).status,409);
 const checked=await request(app.server).patch(ops).set(bearer(admin.access)).send({expectedRevision:3,status:'content_reviewed',reviewNote:'Synthetic check',sourceChecked:true,explanations:[{number:101,explanation:'Synthetic explanation'}]});assert.equal(checked.status,200,JSON.stringify(checked.body));
 assert.equal((await request(app.server).patch(ops).set(bearer(admin.access)).send({expectedRevision:4,status:'ready_for_publish',reviewNote:'Missing clean image',cleanImageChecked:true})).status,400);
 const clean=await request(app.server).post(path+'/assets?assetId='+randomUUID()+'&purpose=clean_image&mediaType=image/png&expectedRevision=4').set(bearer(owner.access)).set('Content-Type','application/octet-stream').send(image);assert.equal(clean.status,201,JSON.stringify(clean.body));
 const final=await request(app.server).patch(ops).set(bearer(admin.access)).send({expectedRevision:5,status:'ready_for_publish',reviewNote:'Second image check',cleanImageChecked:true});assert.equal(final.body.status,'ready_for_publish');
 const detail=await request(app.server).get(path).set(bearer(owner.access));assert.equal(detail.body.capabilities.publish,false);assert.equal(detail.body.request.payload.questions[0].correctOptionId,'C');assert.equal(detail.body.request.review_payload.explanations[0].explanation,'Synthetic explanation');assert.equal(detail.body.assets.length,2);
 assert.equal((await request(app.server).patch(ops).set(bearer(admin.access)).send({expectedRevision:6,status:'published',reviewNote:'No fake publish'})).status,400);
 }finally{await app.close();await pool.end();}
});
