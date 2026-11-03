'use strict';
// Builds an unqualified image artifact. Never contacts production or applies a release.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {pipeline}=require('node:stream/promises');
const M=require('./migration-build-profile.cjs');
const C=require('./image-build-contract.cjs'),root=path.resolve(__dirname,'..');
function run(command,args,options={}){const result=cp.spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:900000,maxBuffer:8*1024*1024,windowsHide:true,...options});if(result.status!==0)throw Error('Build operation failed: '+command+' '+args[0]+' (exit '+result.status+')');return result.stdout?.trim();}
function verifyConfig(profile=M.SCHEMA54){const commit=C.git(root,['rev-parse','HEAD']).trim();return C.sourceManifest(root,commit,profile);}
async function fileHash(file){const digest=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))digest.update(bytes);return digest.digest('hex');}
function cleanSource(root,commit,profile,status){if(status.trim())throw Error('Clean committed checkout required');return C.sourceManifest(root,commit,profile);}
async function build(local,profile=M.SCHEMA54){
 const commit=C.git(root,['rev-parse','HEAD']).trim(),identity=C.identity(process.env,commit,local);
 const schema=cleanSource(root,commit,profile,C.git(root,['status','--porcelain'])),work=fs.mkdtempSync(path.join(os.tmpdir(),'file-island-image-')),context=path.join(work,'context'),source=C.stageContext(root,commit,context),out=path.join(root,'release-artifact');
 if(fs.existsSync(out))throw Error('Preserve existing release-artifact; choose a fresh checkout');fs.mkdirSync(out);const tag='file-island-api-build:'+commit.slice(0,12)+'-'+crypto.randomBytes(4).toString('hex');
 // Single OCI manifest matches the archive gate; authenticated GitHub provenance is still separately required.
 run('docker',['build','--platform','linux/amd64','--provenance=false','--sbom=false','--build-arg','SOURCE_COMMIT='+commit,'--tag',tag,context],{stdio:'inherit'});
 const image=JSON.parse(run('docker',['image','inspect',tag]))[0];if(image.Os!=='linux'||image.Architecture!=='amd64'||image.Config.User!=='node'||image.Config.Labels['org.opencontainers.image.revision']!==commit)throw Error('Runtime image identity mismatch');
 const code="const fs=require('fs'),crypto=require('crypto');const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const rows=fs.readdirSync('/app/migrations').filter(n=>/^\\d{3}_[a-z0-9_]+\\.sql$/.test(n)).sort().map(version=>({version,checksum:hash('/app/migrations/'+version)}));require('/app/dist/src/bootstrap.js');require('argon2').hash('synthetic-image-smoke').then(()=>console.log(JSON.stringify({rows,privilegesSha256:hash('/app/migrations/repeatable/privileges.sql'),bootstrapImport:true,argon2:true,privateBundleAbsent:!fs.existsSync('/app/private-textbook-semantic-data'),externalBootstrapAbsent:!fs.existsSync('/run/hanq-production/bootstrap.mjs')}))).catch(()=>{console.error('Synthetic smoke failed');process.exit(1)});";
 const smoke=JSON.parse(run('docker',['run','--rm','--read-only','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--entrypoint','node',image.Id,'-e',code]));
 if(JSON.stringify(smoke.rows)!==JSON.stringify(schema.rows)||smoke.privilegesSha256!==schema.privilegesSha256||!smoke.argon2||!smoke.bootstrapImport||!smoke.privateBundleAbsent||!smoke.externalBootstrapAbsent)throw Error('Image source/schema/smoke mismatch');
 const tar=path.join(out,'hanq-api.tar');run('docker',['save','--output',tar,image.Id]);const archiveBytes=fs.readFileSync(tar);let configId;C.tarEntries(archiveBytes,entry=>{if(entry.name==='manifest.json'){const manifest=JSON.parse(entry.data);if(manifest.length!==1)throw Error('Ambiguous Docker archive');configId='sha256:'+manifest[0].Config.split('/').at(-1);}});
 const proof=C.verifyOciArchive(archiveBytes,{imageId:image.Id,configId,sourceCommit:commit}),gzip=path.join(out,'hanq-api.tar.gz');await pipeline(fs.createReadStream(tar),zlib.createGzip({level:6}),fs.createWriteStream(gzip,{flags:'wx'}));
 const receipt={version:2,kind:'api-image-build-only',...identity,migrationProfile:schema.migrationProfile,imageId:image.Id,imageConfigDigest:configId,archive:'hanq-api.tar.gz',archiveSha256:await fileHash(gzip),platform:'linux/amd64',baseImage:C.BASE,dockerfile:{path:C.DOCKERFILE,sha256:source.dockerfileSha256},context:{fileCount:source.files.length,privateMaterialIncluded:false,gitBlobBytes:true},migrations:schema.rows,migrationManifestSha256:schema.manifestSha256,privilegesSha256:schema.privilegesSha256,smoke:{network:'none',readOnly:true,argon2:true,bootstrapImport:true,schemaMatch:true,privateBundleAbsent:true},ociProof:proof,...C.qualification(profile)};
 C.validateSourceReceipt(commit,schema,receipt);
 fs.writeFileSync(path.join(out,'release.json'),JSON.stringify(receipt,null,2)+'\n');fs.writeFileSync(path.join(out,'context-manifest.json'),JSON.stringify(source,null,2)+'\n');fs.writeFileSync(path.join(out,'SHA256SUMS'),receipt.archiveSha256+'  hanq-api.tar.gz\n'+await fileHash(path.join(out,'release.json'))+'  release.json\n');
 console.log(JSON.stringify({sourceCommit:commit,imageId:image.Id,imageConfigDigest:configId,artifactDirectory:out,archiveSha256:receipt.archiveSha256,mode:identity.mode,productionQualified:false,deploymentPerformed:false},null,2));
}
function options(args){
 const action=args[0];if(!['--verify-config','--build','--local-build'].includes(action))throw Error('Explicit image action required');
 if(args.length!==1&&(args.length!==3||args[1]!=='--migration-profile'))throw Error('Use one optional --migration-profile value');
 return {action,profile:M.validateName(args.length===1?M.SCHEMA54:args[2])};
}
module.exports={verifyConfig,build,options,cleanSource};
if(require.main===module){try{const {action,profile}=options(process.argv.slice(2));if(action==='--verify-config'){verifyConfig(profile);console.log('Committed Git image inventory verified; no Docker/production action.');}else build(action==='--local-build',profile).catch(error=>{console.error(error.message);process.exitCode=1;});}catch(error){console.error(error.message);process.exitCode=1;}}
