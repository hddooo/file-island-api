import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Test} from '@nestjs/testing';
import request from 'supertest';
import {AttemptsController} from '../../src/attempts/attempts.controller';
import {AttemptsService} from '../../src/attempts/attempts.service';
import {ImportService} from '../../src/attempts/import.service';
import {MyRecordsService} from '../../src/attempts/my-records';
import {JwtAuthGuard} from '../../src/auth/guards';
import type {ExecutionContext} from '@nestjs/common';

test('record HTTP endpoint rejects anonymous and uses guarded owner instead of a supplied user id',async()=>{
 const seen:unknown[]=[];
 const module=await Test.createTestingModule({controllers:[AttemptsController],providers:[{provide:AttemptsService,useValue:{}},{provide:ImportService,useValue:{}},{provide:MyRecordsService,useValue:{list:async(owner:string,filter:unknown)=>{seen.push({owner,filter});return{items:[],total:0};}}}]}).overrideGuard(JwtAuthGuard).useValue({canActivate:(context:ExecutionContext)=>{const req=context.switchToHttp().getRequest<{headers:{authorization?:string};auth?:{userId:string}}>();if(req.headers.authorization!=='Bearer synthetic-owner')return false;req.auth={userId:'owner-A'};return true;}}).compile();
 const app=module.createNestApplication();await app.init();try{await request(app.getHttpServer()).get('/api/v1/me/records').expect(403);await request(app.getHttpServer()).get('/api/v1/me/records?userId=foreign-B&subject=history&source=battle&page=2').set('Authorization','Bearer synthetic-owner').expect(200);assert.deepEqual(seen,[{owner:'owner-A',filter:{subject:'history',source:'battle',page:'2',snapshot:undefined}}]);}finally{await app.close();}
});
