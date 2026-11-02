import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ToeicNotesController } from '../../src/toeic-notes/toeic-notes.module';
import { ToeicNotesService } from '../../src/toeic-notes/toeic-notes.service';
import { AuthService } from '../../src/auth/auth.service';
import { JwtAuthGuard } from '../../src/auth/guards';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
const id='22222222-2222-4222-8222-222222222222';
const body={part:'3-4',expression:'synthetic fixture',meaning:'',structure:'',example:'',confusion:'',sourceText:'',sourceReference:'',revision:0};
test('HTTP real guard scopes operations to live owners and rejects anonymous, injected owner and invalid DTO',async()=>{
 const seen:unknown[][]=[];
 const services={list:async(owner:string)=>{seen.push(['list',owner]);return {notes:[]};},save:async(owner:string,noteId:string,d:unknown)=>{seen.push(['save',owner,noteId,d]);return {note:{id:noteId}};},merge:async(owner:string,noteId:string,d:unknown)=>{seen.push(['merge',owner,noteId,d]);return {note:{id:noteId}};}};
 const module=await Test.createTestingModule({controllers:[ToeicNotesController],providers:[JwtAuthGuard,{provide:ToeicNotesService,useValue:services},{provide:AuthService,useValue:{authenticate:async(token:string)=>token==='A'.repeat(24)?{userId:'owner-A',sessionId:'session-A'}:token==='B'.repeat(24)?{userId:'owner-B',sessionId:'session-B'}:null}}]}).compile();
 const app=module.createNestApplication();app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalFilters(new ApiExceptionFilter());await app.init();const client=request(app.getHttpServer());const bearer=(x:string)=>'Bearer '+x.repeat(24);
 try{
  await client.get('/api/v1/toeic-notes').expect(401);
  await client.get('/api/v1/toeic-notes').set('Authorization',bearer('X')).expect(401);
  assert.equal(seen.length,0);
  await client.get('/api/v1/toeic-notes').set('Authorization',bearer('A')).expect(200,{notes:[]});
  await client.get('/api/v1/toeic-notes').set('Authorization',bearer('B')).expect(200,{notes:[]});
  await client.put('/api/v1/toeic-notes/'+id).set('Authorization',bearer('A')).send({...body,userId:'owner-B'}).expect(400);
  await client.put('/api/v1/toeic-notes/not-a-uuid').set('Authorization',bearer('A')).send(body).expect(400);
  await client.put('/api/v1/toeic-notes/'+id).set('Authorization',bearer('A')).send({...body,part:'3'}).expect(400);
  assert.equal(seen.length,2);
  await client.put('/api/v1/toeic-notes/'+id).set('Authorization',bearer('A')).send(body).expect(200);
  await client.post('/api/v1/toeic-notes/'+id+'/merge').set('Authorization',bearer('B')).send({sourceId:'33333333-3333-4333-8333-333333333333',sourceRevision:1,targetRevision:1}).expect(201);
  assert.deepEqual(seen.map(x=>x.slice(0,2)),[['list','owner-A'],['list','owner-B'],['save','owner-A'],['merge','owner-B']]);
 }finally{await app.close();}
});
