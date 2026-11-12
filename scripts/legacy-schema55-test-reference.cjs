'use strict';
// Test-only historical reference. Never selects production/API qualification inputs.
const A=require('node:assert/strict'),crypto=require('node:crypto');
const CURRENT='schema61-local-private-retained-base',REF='def9ba0506f83f50688f30bc0d7e7532a7d57be6',FILE='ops-prep/functional-schema55-test-inventory.json',BLOB='c5d7ee3f646c755092b91910fe19e9cfae50eb44',SHA='749bdd1802b7ec60f5fc768243cf02591247deffefb5d76ce88c5716bdadb29b';
function select(root,profile,git){A([undefined,'schema54','schema55-qualification',CURRENT].includes(profile),'Explicit known qualification profile only');const historical=profile===CURRENT,ref=historical?REF:'HEAD';if(historical){A.equal(git(root,['rev-parse',REF+'^{commit}']).trim(),REF);A.equal(git(root,['rev-parse',REF+':'+FILE]).trim(),BLOB);}const bytes=git(root,['show',ref+':'+FILE],true);if(historical)A.equal(crypto.createHash('sha256').update(bytes).digest('hex'),SHA);const commit=git(root,['rev-parse',ref]).trim();A(/^[a-f0-9]{40}$/.test(commit));if(historical)A.equal(commit,REF);return {commit,bytes,historicalReferenceOnly:historical};}
module.exports={select,REF,FILE,BLOB,SHA,CURRENT};
