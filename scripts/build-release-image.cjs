'use strict';
// Produces a private CI artifact only; never contacts a production host or DB.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {pipeline}=require('node:stream/promises');
const root=path.resolve(__dirname,'..'),base='node:24-bookworm-slim@sha256:a43f7fc3e52e87d12a905f46eea0275def84ca8f2981a5b53fed44d7fb398ee0';
function must(ok,msg){if(!ok)throw Error(msg);}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function verifyConfig(){
 const dockerfile=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
 must(dockerfile.split('\n').filter(l=>l.startsWith('FROM ')).every(l=>l.includes(base)),'Unpinned runtime base');
 must(dockerfile.includes('USER node')&&dockerfile.includes('CMD ["node", "/run/hanq-production/bootstrap.mjs"]'),'Approved nonroot/bootstrap contract missing');
 const rows=fs.readdirSync(path.join(root,'migrations')).filter(n=>/^\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort().map(version=>({version,checksum:sha(fs.readFileSync(path.join(root,'migrations',version)))}));
 must(rows.length===54&&rows.at(-1).version==='055_coin_eggs_timed_hatch.sql','Unexpected migration bundle');
 return{rows,privileges:sha(fs.readFileSync(path.join(root,'migrations/repeatable/privileges.sql')))};
}
function run(command,args,options={}){const r=cp.spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:900000,maxBuffer:4*1024*1024,...options});must(r.status===0,'Build operation failed: '+command+' '+args[0]);return r.stdout?.trim();}
async function fileSha(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function build(){
 const files=verifyConfig(),sourceCommit=process.env.GITHUB_SHA,runId=process.env.GITHUB_RUN_ID;
 must(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='blockmonkey1992/hanq_api','Trusted repository CI only');
 must(['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME),'PR artifact builds are forbidden');
 must(/^[a-f0-9]{40}$/.test(sourceCommit||'')&&/^\d+$/.test(runId||''),'Missing commit/run provenance');
 must(run('git',['rev-parse','HEAD'])===sourceCommit&&run('git',['status','--porcelain','--untracked-files=no'])==='','Checkout differs from source');
 const out=path.join(root,'release-artifact');fs.mkdirSync(out);const tag='hanq-api-candidate:'+sourceCommit;
 run('docker',['build','--platform','linux/amd64','--build-arg','SOURCE_COMMIT='+sourceCommit,'--tag',tag,'.'],{stdio:'inherit'});
 const info=JSON.parse(run('docker',['image','inspect',tag]))[0],imageId=info.Id;
 must(/^sha256:[a-f0-9]{64}$/.test(imageId)&&info.Architecture==='amd64'&&info.Os==='linux','Unexpected image identity/platform');
 must(info.Config.User==='node'&&info.Config.Labels['org.opencontainers.image.revision']===sourceCommit,'Image provenance/user mismatch');
 const code=`const fs=require('fs'),crypto=require('crypto');const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const rows=fs.readdirSync('/app/migrations').filter(n=>/^\\d{3}_[a-z0-9_]+\\.sql$/.test(n)).sort().map(version=>({version,checksum:hash('/app/migrations/'+version)}));require('/app/dist/src/bootstrap.js');require('argon2').hash('synthetic-ci-smoke').then(()=>console.log(JSON.stringify({rows,privileges:hash('/app/migrations/repeatable/privileges.sql')}))).catch(()=>process.exit(1));`;
 const inside=JSON.parse(run('docker',['run','--rm','--read-only','--network','none','--entrypoint','node',imageId,'-e',code]));
 must(JSON.stringify(inside)===JSON.stringify(files),'Image migration/privilege bytes differ from source');
 const archive=path.join(out,'hanq-api.tar.gz'),tar=path.join(out,'hanq-api.tar');
 run('docker',['save','--output',tar,imageId]);await pipeline(fs.createReadStream(tar),zlib.createGzip({level:6}),fs.createWriteStream(archive,{flags:'wx'}));fs.unlinkSync(tar);
 const proof={version:1,producer:'blockmonkey1992/hanq_api',sourceCommit,runId,runAttempt:process.env.GITHUB_RUN_ATTEMPT,imageId,archive:'hanq-api.tar.gz',archiveSha256:await fileSha(archive),baseImage:base,platform:'linux/amd64',migrations:files.rows,privilegesSha256:files.privileges,smoke:{network:'none',readOnly:true,user:'node',argon2:true,bootstrapImport:true},deploymentPerformed:false};
 fs.writeFileSync(path.join(out,'release.json'),JSON.stringify(proof,null,2)+'\n');
 fs.writeFileSync(path.join(out,'SHA256SUMS'),proof.archiveSha256+'  hanq-api.tar.gz\n'+await fileSha(path.join(out,'release.json'))+'  release.json\n');
 console.log(JSON.stringify({sourceCommit,runId,imageId,archiveSha256:proof.archiveSha256,deploymentPerformed:false}));
}
module.exports={verifyConfig};
if(require.main===module){if(process.argv[2]==='--verify-config'){verifyConfig();console.log('Pinned image configuration verified; no Docker/production action.');}else if(process.argv[2]==='--build'){build().catch(e=>{console.error(e.message);process.exitCode=1;});}else{console.error('Use --verify-config or --build');process.exitCode=1;}}
