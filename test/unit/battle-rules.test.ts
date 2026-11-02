import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fighter,damage,attack,evasionPercent} from '../../src/battle/rules';
test('battle stats, stage-only LUK denominator and unnormalized one-hit damage',()=>{
 const points=[0,500,1000,1200,1500,1800],expected=[[50,10,5],[75,15,8],[113,23,11],[169,34,17],[253,51,25],[380,76,38]],f=points.map(p=>fighter('탐험가',p,'agumon'));
 for(let i=0;i<f.length;i++){assert.deepEqual([f[i].maxHp,f[i].atk,f[i].def],expected[i]);assert.equal(f[i].stageIndex,i+1);}
 const rates=[1,3,5,7,9,11];assert.equal(evasionPercent(f[5],f[0],rates),11);assert.equal(evasionPercent(f[5],f[5],rates),11/6);assert.equal(evasionPercent(f[3],f[3],rates),1.75);assert.equal(evasionPercent(f[0],f[5],rates),1/6);assert.equal(damage(f[0],f[5]),1);assert.equal(damage(f[5],f[0]),71);assert.equal(fighter('secret@example.test',0,'agumon').name,'탐험가');assert.equal(fighter('n',1800,'patamon').maxHp,253);
});
test('only exact server timestamps clash; one millisecond still chooses the faster correct answer',()=>{
 assert.deepEqual(attack('A',{option:'A',at:100},{option:'A',at:100}),{attacker:null,reason:'simultaneous'});
 assert.equal(attack('A',{option:'A',at:100},{option:'A',at:101}).attacker,'left');assert.equal(attack('A',{option:'B',at:1},{option:'A',at:101}).attacker,'right');assert.equal(attack('A',null,{option:'B',at:1}).attacker,null);
});

import {battleDelta} from '../../src/battle/rewards';
test('battle XP follows frozen stage difference, without a rematch cap',()=>{
 assert.deepEqual([0,1,2,3,-1,-2,-3].map(d=>battleDelta(3,3+d,true)),[100,150,200,200,50,25,25]);
 assert.deepEqual([0,1,2,3,-1,-2,-3].map(d=>battleDelta(3,3+d,false)),[-100,-50,-25,-25,-150,-200,-200]);
});

test('static stats use base times 1.5 power rounding without changing damage or LUK',()=>{const points=[0,500,1000,1200,1500,1800],f=points.map(p=>fighter('fixture',p,'agumon'));for(let i=0;i<f.length;i++){assert.deepEqual([f[i].maxHp,f[i].atk,f[i].def],[50,10,5].map(n=>Math.round(n*1.5**i)));assert.equal(damage(f[i],f[i]),Math.max(1,f[i].atk-f[i].def));assert.equal(Math.ceil(f[i].maxHp/damage(f[i],f[i]))>=10,true);}const old={...f[2],hp:100,maxHp:100,atk:25,def:10};assert.equal(damage(old,old),15);assert.equal(damage(f[2],f[2]),12);assert.equal(old.maxHp,100);});
