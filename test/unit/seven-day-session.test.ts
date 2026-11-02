import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { AuthService } from '../../src/auth/auth.service';
import { TokenService } from '../../src/auth/token.service';
import { loadConfig } from '../../src/config/config';
it('restoring a login keeps the original seven-day deadline and rejects refresh at that boundary', async () => {
 const config=loadConfig({NODE_ENV:'development',DATABASE_URL:'postgresql://u@127.0.0.1/unit_test',HANQ_JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),HANQ_JWT_REFRESH_SECRET:randomBytes(32).toString('hex')});
 const start=new Date('2026-10-22T00:00:00Z'),uid=randomUUID(),family=randomUUID(),real=new TokenService(config);let time=new Date(start.getTime()+6*86400000),inserts=0,used=0;
 const service: AuthService=Object.assign(Object.create(AuthService.prototype),{config,clock:{now:()=>time},db:{tx:async (fn:(q:object)=>unknown)=>fn({})},tokens:{verifyRefresh:async()=>({jti:'fixture',familyId:family,userId:uid}),signAccess:real.signAccess.bind(real),signRefresh:async()=> 'fixture'},users:{findById:async()=>({id:uid,email_display:'fixture@example.test',display_name:'fixture',created_at:start})},sessions:{lockRefresh:async()=>({id:randomUUID(),family_id:family,user_id:uid,family_created_at:start,family_expires_at:new Date(start.getTime()+30*86400000),expires_at:new Date(start.getTime()+14*86400000),used_at:null,family_revoked_at:null}),insertRefresh:async()=>{inserts++},markUsed:async()=>{used++}}});
 const issued=await service.refresh('fixture');assert.equal(decodeJwt(issued.accessToken).exp,start.getTime()/1000+604800);assert.equal(used,1);assert.equal(inserts,1);
 time=new Date(start.getTime()+7*86400000);await assert.rejects(service.refresh('fixture'),(e:{status?:number;code?:string})=>e.code==='invalid_refresh');assert.equal(inserts,1);assert.equal(used,1);
});
