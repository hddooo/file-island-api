import {AppError} from '../common/app-error';
import {inspectCatalog,type ToeicCollection} from '../toeic-cbt/catalog';
import type {Queryable} from '../db/db.service';
import {storePrivateToeicCollection} from '../toeic-cbt/import';
export interface PublishQuestion {number:number;stem:string;choices:{id:string;text:string}[];correctOptionId:string;passage?:string;}
export interface PublishAsset {id:string;purpose:string;media_type:string;bytes:Buffer;sha256:string;}
export interface PublishGroup {id:string;questionNumbers:number[];audioAssetId?:string;passage?:string;}
export interface ToeicPublicationInput {
 requestId:string;sourceLabel:string;part:number;questions:PublishQuestion[];explanations:{number:number;explanation:string}[];
 mappings:{number:number;cleanImageAssetId?:string;groupId?:string}[];groups:PublishGroup[];assets:PublishAsset[];
}
const invalid=(message:string)=>new AppError(400,'publication_not_ready',message);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Pure preparation only. Caller must check ADMIN, frozen revision, both review stages and explicit owner sharing consent. */
export function buildToeicPublication(d:ToeicPublicationInput):{content:ToeicCollection;images:PublishAsset[];assetIds:string[]}{
 if(!uuid.test(d.requestId)||!d.sourceLabel.trim()||!Number.isInteger(d.part)||d.part<1||d.part>7||!d.questions.length)throw invalid('Invalid publication identity');
 if(new Set(d.mappings.map(m=>m.number)).size!==d.mappings.length||d.mappings.length!==d.questions.length||new Set(d.groups.map(g=>g.id)).size!==d.groups.length)throw invalid('One explicit mapping per question is required');
 const used=new Set<string>(),images=new Map<string,PublishAsset>(),ids=new Set(d.questions.map(q=>q.number));
 const groups=d.groups.map(g=>{if(!/^[a-zA-Z0-9_-]{1,60}$/.test(g.id)||!g.questionNumbers.length||new Set(g.questionNumbers).size!==g.questionNumbers.length||g.questionNumbers.some(n=>!ids.has(n)))throw invalid('Invalid group membership');
  if((d.part===3||d.part===4)&&g.questionNumbers.length!==3)throw invalid('Part3/4 requires the actual complete three-question group');
  if(d.part>=6&&!g.passage?.trim())throw invalid('Verified passage is required');
  let audioUrl:string|null=null;
  if(d.part<=4){const asset=d.assets.find(a=>a.id===g.audioAssetId&&a.purpose==='audio'&&['audio/mpeg','audio/wav'].includes(a.media_type));if(!asset)throw invalid('A reviewed MP3 or WAV audio asset is required');used.add(asset.id);audioUrl='private-audio:'+d.requestId+':'+asset.id;}
  return{id:g.id,questionNumbers:g.questionNumbers.slice(),audioUrl,audioVerified:d.part<=4,script:'',scriptStatus:'automatic-unverified' as const,...(d.part>=6?{passage:g.passage!.trim(),passageVerified:true}:{})};});
 const questions=d.questions.map(q=>{const mapping=d.mappings.find(m=>m.number===q.number),group=groups.find(g=>g.id===mapping?.groupId),explanation=d.explanations.find(e=>e.number===q.number)?.explanation?.trim();
  if(!mapping||!group||!group.questionNumbers.includes(q.number)||groups.filter(g=>g.questionNumbers.includes(q.number)).length!==1||!explanation)throw invalid('Question group and reviewed explanation are required');
  let photoUrl:string|null=null;if(mapping.cleanImageAssetId){const asset=d.assets.find(a=>a.id===mapping.cleanImageAssetId&&a.purpose==='clean_image'&&a.media_type.startsWith('image/'));if(!asset||! /^[a-f0-9]{64}$/.test(asset.sha256))throw invalid('Only explicitly mapped clean images can be published');images.set(asset.sha256,asset);used.add(asset.id);photoUrl='private-image:'+asset.sha256;}
  if(d.part===1&&!photoUrl)throw invalid('Part1 requires a confirmed clean photo');
  const expected=d.part===2?['A','B','C']:['A','B','C','D'];if(q.choices.length!==expected.length||q.choices.some((c,i)=>c.id!==expected[i])||!expected.includes(q.correctOptionId))throw invalid('Invalid manually entered answer or choices');
  return{number:q.number,part:d.part,groupId:group.id,stem:d.part<=2?null:q.stem.trim(),...(d.part===2?{audioOnly:true}:{}),answerProvenance:'user-entered-admin-reviewed' as const,questionVerified:true,choices:q.choices.map(c=>({id:c.id,text:d.part<=2?c.id:c.text.trim()})),choicesVerified:true,correctOptionId:q.correctOptionId,answerVerified:true,photoUrl,photoVerified:!!photoUrl,explanation};});
 const content:ToeicCollection={roundKey:'request:'+d.requestId,title:d.sourceLabel.trim(),wrongNumbers:questions.map(q=>q.number),groups,questions};
 const check=inspectCatalog(content);if(!check.ready)throw invalid('Collection readiness checks failed');return{content,images:[...images.values()],assetIds:[...used].sort()};
}
/** Append-only. Does not change existing collection versions or any attempts. Must run in the caller transaction. */
export async function storeToeicPublication(q:Queryable,commonOwner:string,built:ReturnType<typeof buildToeicPublication>){
 const id=await storePrivateToeicCollection(q,commonOwner,built.content);
 for(const a of built.images)await q.query('INSERT INTO hanq.toeic_cbt_images(user_id,collection_id,asset_key,media_type,bytes) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[commonOwner,id,a.sha256,a.media_type,a.bytes]);
 return{collectionId:id,sourceKey:built.content.roundKey,assetIds:built.assetIds};
}
