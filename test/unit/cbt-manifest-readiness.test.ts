import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';
import { CbtAssetsService } from '../../src/cbt/cbt-assets.service';
import type { AppConfig } from '../../src/config/config';
it('a delayed manifest is a retryable timeout; retry clears rejected cache, listing never downloads image bytes',async()=>{
 let delayed=true,images=0;const server=createServer((req,res)=>{if(req.url!=='/manifest.json')images++;const answer=()=>{res.end(JSON.stringify({files:{'79-01.webp':'a'.repeat(64)}}));};if(delayed)setTimeout(answer,100);else answer();});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{const assets=new CbtAssetsService({cbt:{publicAssetBaseUrl:`http://127.0.0.1:${address.port}`}} as AppConfig);await assert.rejects(assets.verifyCatalog(['79-01.webp'],AbortSignal.timeout(20)),(e:{code?:string})=>e.code==='asset_check_timeout');delayed=false;assets.clearCatalogCache();await assets.verifyCatalog(['79-01.webp'],AbortSignal.timeout(1000));assert.equal(images,0);await assert.rejects(assets.verifyCatalog(['79-02.webp'],AbortSignal.timeout(1000)),(e:{code?:string})=>e.code==='asset_unavailable');}
 finally{server.closeAllConnections();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
