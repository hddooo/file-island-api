'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {CI_UNIT_EXCLUSIONS}=require('./functional-api-test-container.cjs');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'dist/test/unit'),all=fs.readdirSync(dir).filter(x=>x.endsWith('.test.js')).sort();assert.equal(all.length,67,'Exact source inventory required');for(const name of CI_UNIT_EXCLUSIONS)assert(all.includes(name));const files=all.filter(x=>!CI_UNIT_EXCLUSIONS.includes(x));assert.equal(files.length,62);const r=cp.spawnSync(process.execPath,['--test','--test-concurrency=1',...files.map(x=>path.join(dir,x))],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=r.status===0?0:1;
