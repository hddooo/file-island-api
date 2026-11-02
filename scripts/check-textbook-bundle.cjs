'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'../private-textbook-semantic-data');
const {validateSemanticJson}=require('../dist/src/textbook/semantic-data');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));validateSemanticJson('manifest.json',manifest);
const held=new Set(['p009-figure-5','p009-figure-6']);let bytes=0;
for(const f of manifest.figures){assert(!held.has(f.id),'held figure must remain absent');const ext=f.extension||'jpeg',file=path.join(root,`assets/${f.id}.${ext}`),data=fs.readFileSync(file);assert(data.length<=2*1024*1024);if(f.bytes)assert.equal(data.length,f.bytes);if(f.sha256)assert.equal(crypto.createHash('sha256').update(data).digest('hex'),f.sha256);assert(ext==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data[0]===255&&data[1]===216);bytes+=data.length;}
for(const p of manifest.pages){const file=`pages/page-${String(p.pdfPage).padStart(3,'0')}.json`;const data=JSON.parse(fs.readFileSync(path.join(root,file)));validateSemanticJson(file,data);assert.equal(data.pdfPage,p.pdfPage);assert.equal(data.sourceSha256,manifest.source.sha256);}
for(const id of held)assert(!fs.readdirSync(path.join(root,'assets')).some(f=>f.startsWith(id+'.')),'held asset must never be copied');
const files=fs.readdirSync(path.join(root,'assets'));assert.equal(files.length,manifest.figures.length,'unlisted image assets are forbidden');
console.log(JSON.stringify({pages:manifest.pages.length,figures:manifest.figures.length,bytes,manifestIntegrity:true,heldFilesAbsent:true}));
