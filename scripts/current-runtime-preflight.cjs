'use strict';
// Deliberately fail-closed deployment barrier. Do not remove until named integration gaps pass review.
const C=require('./current-runtime-contract.cjs');
const fs=require('node:fs');
if(require.main===module){try{const file=process.env.HANQ_FUNCTIONAL_CURRENT_RUNTIME_PINS_FILE;if(!file)throw Error('Reviewed current-runtime pins file required');const pins=C.resolvedPins(JSON.parse(fs.readFileSync(file,'utf8')));C.producer(process.env,pins.sourceCommit);throw Error('Current-runtime schema61/API/core-UI adapters and independent controller review are not integrated; no qualification permitted');}catch(e){console.error(e.message);process.exitCode=1;}}
