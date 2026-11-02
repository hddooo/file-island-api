import 'reflect-metadata';
import assert from 'node:assert/strict';
import {it} from 'node:test';
import {ValidationPipe} from '@nestjs/common';
import {Test} from '@nestjs/testing';
import {APP_GUARD} from '@nestjs/core';
import {ThrottlerGuard,ThrottlerModule} from '@nestjs/throttler';
import request from 'supertest';
import {MemberController} from '../../src/portal/member.controller';
import {DbService} from '../../src/db/db.service';
import {CLOCK} from '../../src/common/tokens';
import {AuthService} from '../../src/auth/auth.service';
import {AUTH_RATE_LIMITED} from '../../src/auth/guards';
import {ApiExceptionFilter} from '../../src/common/api-exception.filter';
it('public email check returns only availability, normalizes input, validates and rate limits requests',async()=>{
 const queries:unknown[][]=[];const m=await Test.createTestingModule({imports:[ThrottlerModule.forRoot([{name:'auth',ttl:60000,limit:3,skipIf:ctx=>!Reflect.getMetadata(AUTH_RATE_LIMITED,ctx.getHandler())}])],controllers:[MemberController],providers:[{provide:AuthService,useValue:{authenticate:async()=>null}},{provide:DbService,useValue:{pool:{query:async(sql:string,args:unknown[])=>{assert.equal(sql,'SELECT 1 FROM hanq.users WHERE email_normalized=$1');queries.push(args);return{rowCount:args[0]==='taken@example.test'?1:0}}}}},{provide:CLOCK,useValue:{now:()=>new Date()}},{provide:APP_GUARD,useClass:ThrottlerGuard}]}).compile();const app=m.createNestApplication();app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));app.useGlobalFilters(new ApiExceptionFilter());await app.init();try{const server=app.getHttpServer();const available=await request(server).post('/api/v1/auth/email-availability').send({email:' New@Example.test '});assert.equal(available.status,201);assert.deepEqual(available.body,{available:true});const taken=await request(server).post('/api/v1/auth/email-availability').send({email:'TAKEN@example.test'});assert.deepEqual(taken.body,{available:false});const bad=await request(server).post('/api/v1/auth/email-availability').send({email:'invalid'});assert.equal(bad.status,400);assert.deepEqual(queries,[['new@example.test'],['taken@example.test']]);const limited=await request(server).post('/api/v1/auth/email-availability').send({email:'new@example.test'});assert.equal(limited.status,429);}finally{await app.close();}
});
