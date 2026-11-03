import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Test} from '@nestjs/testing';
import request from 'supertest';
import {HallController,HallService} from '../../src/profile/hall-of-fame';
import {AuthService} from '../../src/auth/auth.service';
import type {DbService} from '../../src/db/db.service';
import {AppError} from '../../src/common/app-error';

test('public profile returns exactly three activity summaries and per-Digimon XP, not private record details',async()=>{
 const records=Array.from({length:4},(_,n)=>({key:'private-record-'+n,at:'2026-10-31T01:43:00Z',subject:n%2?'toeic':'history',source:n?'unknown':'battle',detail:{selected:'private-answer',email:'private@example.test',token:'private-token',question:{answer:'private-key'}},children:[{detail:{selected:'private-child-answer'}}]}));
 const original=structuredClone(records);
 const pool={query:async(sql:string,args:string[])=>{
  if(sql.startsWith('SELECT id FROM hanq.users')){assert.deepEqual(args,['a'.repeat(32)]);return{rows:[{id:'private-owner-id'}]};}
  assert.deepEqual(args,['private-owner-id']);
  if(sql.includes('member_access_logs'))return{rows:[{at:'2026-10-31T01:43:00Z',email:'private@example.test'}]};
  if(sql.includes('owned_digimon'))return{rows:[{family:'agumon',stage:2,xp:'1000',equipped:true},{family:'patamon',stage:-1,xp:'40',equipped:false}]};
  throw new Error('Unexpected public profile query');
 }};
 const tx={query:async(sql:string)=>sql.startsWith('SET ')?{rows:[]}:sql.includes('count(*)::text total')?{rows:[{total:'4'}]}:{rows:structuredClone(records)}};
 const db={pool,tx:async<T>(fn:(q:unknown)=>Promise<T>)=>fn(tx)} as unknown as DbService;
 const result=await new HallService(db).publicProfile('a'.repeat(32));
 assert.deepEqual(Object.keys(result).sort(),['lastSigninAt','monsters','recent','totalXp']);
 assert.equal(result.lastSigninAt,'2026-10-31T01:43:00.000Z');
 assert.equal(result.totalXp,1040);assert.equal(result.totalXp,result.monsters.reduce((sum,p)=>sum+p.xp,0));
 assert.deepEqual(result.monsters,[{character:{id:'agumon',name:'아구몬'},xp:1000,equipped:true},{character:{id:'digitama',name:'디지몬 알'},xp:40,equipped:false}]);
 assert.equal(result.recent.length,3);assert.equal(result.recent[0].kind,'battle');
 for(const item of result.recent)assert.deepEqual(Object.keys(item).sort(),['at','kind','subject']);
 const encoded=JSON.stringify(result);for(const secret of ['private-','selected','email','token','answer','children'])assert(!encoded.includes(secret),secret);
 assert.deepEqual(records,original);
});

test('malformed public references fail before accessing a member',async()=>{
 const service=new HallService({pool:{query:()=>{throw Error('must not query');}}} as unknown as DbService);
 for(const ref of ['','private-owner-id','A'.repeat(32),'a'.repeat(31),'a'.repeat(33)])await assert.rejects(service.publicProfile(ref),error=>error instanceof AppError&&error.getStatus()===404);
});

test('public profile HTTP remains authenticated and passes only the opaque reference',async()=>{
 const seen:string[]=[];
 const module=await Test.createTestingModule({controllers:[HallController],providers:[{provide:HallService,useValue:{publicProfile:async(ref:string)=>{seen.push(ref);return{monsters:[],recent:[],totalXp:0,lastSigninAt:null};}}},{provide:AuthService,useValue:{authenticate:async(token:string)=>token==='a'.repeat(24)?{userId:'synthetic-viewer',sessionId:'synthetic-session'}:null}}]}).compile();
 const app=module.createNestApplication({logger:false});await app.init();
 try{const path='/api/v1/hall-of-fame/profiles/'+'b'.repeat(32);await request(app.getHttpServer()).get(path).expect(401);await request(app.getHttpServer()).get(path).set('Authorization','Bearer '+'a'.repeat(24)).expect(200);assert.deepEqual(seen,['b'.repeat(32)]);}finally{await app.close();}
});
