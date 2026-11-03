import test from 'node:test';
import assert from 'node:assert/strict';
import {originOf,parseProvenance,publicProvenance,redactEvidence} from '../../src/common/question-provenance';

const source={schemaVersion:1 as const,origin:'user_provided_textbook' as const,sourceKey:'book-a',title:'교재',page:'12',questionNo:7,officialStatus:'confirmed' as const,evidenceRef:'internal-only'};
test('explicit source and answer status remain separate; absent legacy metadata is unknown',()=>{
 assert.equal(originOf(undefined),'unknown');assert.equal(originOf({origin:'invented'}),'unknown');assert.deepEqual(parseProvenance(undefined),{schemaVersion:1,origin:'unknown',officialStatus:'unverified'});
 assert.throws(()=>parseProvenance({...source,evidenceRef:undefined}));assert.throws(()=>parseProvenance({...source,origin:'unknown'}));assert.throws(()=>parseProvenance({...source,schemaVersion:2}));
 assert.equal(publicProvenance(source).origin,'user_provided_textbook');assert(!('evidenceRef' in publicProvenance(source)));
});
test('recursive public redaction removes evidence references without mutating stored JSON',()=>{
 const raw={provenance:source,nested:[{evidenceRef:'another-secret',text:'ok'}]},safe=redactEvidence(raw);assert(!JSON.stringify(safe).includes('internal-only'));assert(!JSON.stringify(safe).includes('another-secret'));assert.equal(raw.provenance.evidenceRef,'internal-only');assert.equal(safe.nested[0].text,'ok');
});
