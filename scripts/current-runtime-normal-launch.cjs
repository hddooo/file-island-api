'use strict';
// Synthetic values only, in disposable container tmpfs. Never imports an administrative CLI mode.
const fs=require('node:fs'),crypto=require('node:crypto');if(process.argv.length!==2)throw Error('Normal-only launcher');for(const n of ['db-password','jwt-access','jwt-refresh'])fs.writeFileSync('/run/hanq-secrets/'+n,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});fs.writeFileSync('/run/hanq-secrets/jwt-issuer','current61-isolated-normal-runtime',{mode:0o600,flag:'wx'});import('/run/hanq-production/bootstrap.mjs');
