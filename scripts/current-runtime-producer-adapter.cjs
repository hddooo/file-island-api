'use strict';
// Adapter only. This does NOT build/export/load an image and cannot issue a qualification receipt.
const C=require('./current-runtime-contract.cjs');
async function inspectFrozenLocalArchive({withVerifiedArchive,options,pins,baselineInventory,candidateConfig,consume}){
 C.resolvedPins(pins);
 if(typeof withVerifiedArchive!=='function'||typeof consume!=='function')throw Error('Reviewed frozen streaming verifier/consumer required');
 if(options?.path!==pins.archivePath)throw Error('Exact frozen local archive path required');
 if(options?.currentRuntime!==undefined)throw Error('Use reviewed approval contract, not caller profile overrides');
 return withVerifiedArchive({...options,consume:async(stream,proof)=>{
  const privateProof=C.localPrivate(proof,pins,baselineInventory,candidateConfig);
  await consume(stream,proof); // Must consume completely once; verifier owns final stream accounting.
  return {privateProof,productionQualified:false,authenticated:false};
 }});
}
module.exports={inspectFrozenLocalArchive};
