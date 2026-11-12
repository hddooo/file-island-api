import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectOpeningHistory81} from '../../src/textbook/opening-history81-quiz';
import {OPENING_HISTORY81_MAPPING} from '../../src/textbook/opening-history81.mapping';

test('opening immutable mapping covers all questions/fields and all four candidate banks',()=>{
 const rows=OPENING_HISTORY81_MAPPING;
 assert.equal(rows.length,118);assert.equal(rows.reduce((n,r)=>n+r.fields.length,0),119);
 assert.equal(new Set(rows.map(r=>r.id)).size,118);assert.equal(new Set(rows.flatMap(r=>r.fields.map(f=>f.id))).size,119);
 assert.equal(rows.filter(r=>r.options.length).length,4);assert.equal(rows.reduce((n,r)=>n+r.options.length,0),41);
 assert.throws(()=>projectOpeningHistory81({source:{sha256:'0'.repeat(64)},markdown:'corrupt'}),{code:'source_quiz_unavailable'});
});

