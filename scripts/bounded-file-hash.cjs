'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),A=require('node:assert/strict');
// Bounded synchronous file hash preserves existing producer APIs. Not archive validation.
function fileHash(file){
 const before=fs.lstatSync(file,{bigint:true});A(before.isFile()&&!before.isSymbolicLink(),'regular file required');
 const fd=fs.openSync(file,'r');
 try{const opened=fs.fstatSync(fd,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs'])A.equal(opened[k],before[k],'file changed before open');
 const h=crypto.createHash('sha256'),b=Buffer.alloc(1024*1024);let n,total=0n;
 while((n=fs.readSync(fd,b,0,b.length,null))!==0){h.update(b.subarray(0,n));total+=BigInt(n);}A.equal(total,opened.size,'file changed while reading');
 const after=fs.fstatSync(fd,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs'])A.equal(after[k],opened[k],'file changed while hashing');
 const named=fs.lstatSync(file,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs'])A.equal(named[k],opened[k],'path replaced while hashing');return h.digest('hex');
 }finally{fs.closeSync(fd);}
}
module.exports={fileHash};
