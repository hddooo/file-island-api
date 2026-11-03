'use strict';
// Synthetic test-only values, created in container tmpfs and never exported or passed as Docker env.
const fs=require('node:fs'),crypto=require('node:crypto');for(const name of ['db-password','jwt-access','jwt-refresh'])fs.writeFileSync('/run/hanq-secrets/'+name,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});fs.writeFileSync('/run/hanq-secrets/jwt-issuer','schema55-isolated-bootstrap-test',{mode:0o600,flag:'wx'});import('/run/hanq-production/bootstrap.mjs');
