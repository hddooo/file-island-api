import assert from 'node:assert/strict';
import {it} from 'node:test';
import {SiteGateRateLimit} from '../../src/auth/site-gate-rate-limit';
it('static gate budgets distinguish sessions, bound memory/global load, and reset',()=>{
 const gate=new SiteGateRateLimit();
 for(let i=0;i<2000;i++)assert.equal(gate.allow('session-a',1000),true);
 assert.equal(gate.allow('session-a',1000),false);
 assert.equal(gate.allow('session-b',1000),true);
 assert.equal(gate.allow('session-a',62000),true);
 const keys=new SiteGateRateLimit();
 for(let i=0;i<2048;i++)assert.equal(keys.allow('session-'+i,1000),true);
 assert.equal(keys.allow('overflow',1000),false);
 const global=new SiteGateRateLimit();
 for(let i=0;i<12000;i++)assert.equal(global.allow('session-'+(i%10),1000),true);
 assert.equal(global.allow('next',1000),false);
});
