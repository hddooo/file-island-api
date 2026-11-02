import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/db.service';
import { requireUuid,sha256hex } from '../common/util';
import { inspectCatalog,replaySelection,httpsAsset,imageAsset,type ToeicCollection,type ToeicTiming,type ToeicTutorExplanation,type ToeicSourceIdentity } from './catalog';
export interface PendingManifest {
 scope:string;accountId:string|null;round:{id:string;title:string};wrongQuestionNumbers:number[];
 audioGroups:{id:string;questionNumbers:number[];s3Url:string;transcript:string;passage?:string;passageVerified?:boolean;scriptVerified?:boolean;audioVerified?:boolean;timing?:ToeicTiming}[];
 questions:{number:number;part:number;groupId:string;stem:string|null;choices:{id:string;text:string}[];correctOptionId:string|null;answerVerification:string;questionVerified?:boolean;choicesVerified?:boolean;image:string|null;photoVerified?:boolean;sourceIdentity?:ToeicSourceIdentity;answerStatus?:'assistant_inferred_not_officially_verified';explanation?:string|null;tutorExplanation?:ToeicTutorExplanation}[];
}
/** Explicit preparation only. Removing transcription warnings or HEAD success never sets any verification flag. */
export function prepareToeicCollection(m:PendingManifest){
 if(m.scope!=='requesting-user-only')throw new Error('Only private requesting-user sources are supported');
 const content:ToeicCollection={roundKey:m.round.id,title:m.round.title,wrongNumbers:m.wrongQuestionNumbers.slice(),groups:m.audioGroups.map(g=>({id:g.id,questionNumbers:g.questionNumbers.slice(),audioUrl:httpsAsset(g.s3Url)?g.s3Url:null,audioVerified:g.audioVerified===true,script:g.transcript,scriptStatus:g.scriptVerified===true?'verified':'automatic-unverified',...(g.passage!==undefined?{passage:g.passage,passageVerified:g.passageVerified===true}:{}),...(g.timing?{timing:g.timing}:{})})),questions:m.questions.map(q=>({number:q.number,part:q.part,...(q.sourceIdentity?{sourceIdentity:q.sourceIdentity}:{}),...(q.answerStatus?{answerStatus:q.answerStatus}:{}),groupId:q.groupId,stem:q.stem,questionVerified:q.questionVerified===true,choices:q.choices.map(o=>({id:o.id,text:o.text})),choicesVerified:q.choicesVerified===true,correctOptionId:q.correctOptionId,answerVerified:q.answerVerification==='verified',photoUrl:imageAsset(q.image)?q.image:null,photoVerified:q.photoVerified===true,explanation:q.explanation||null,...(q.tutorExplanation?{tutorExplanation:q.tutorExplanation}:{})}))};
 content.replayNumbers=replaySelection(content).numbers;
 return{accountId:m.accountId,version:sha256hex(JSON.stringify(content)),content,readiness:inspectCatalog(content)};
}
/** No HTTP import route or automatic startup seed. Caller must explicitly authorize and verify the owner first. */
export async function storePrivateToeicCollection(q:Queryable,ownerId:string,content:ToeicCollection){
 requireUuid(ownerId);const version=sha256hex(JSON.stringify(content)),id=randomUUID();
 await q.query(`INSERT INTO hanq.toeic_cbt_collections(id,user_id,source_key,version,title,content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,source_key,version) DO NOTHING`,[id,ownerId,content.roundKey,version,content.title,JSON.stringify(content)]);
 return (await q.query<{id:string}>('SELECT id FROM hanq.toeic_cbt_collections WHERE user_id=$1 AND source_key=$2 AND version=$3',[ownerId,content.roundKey,version])).rows[0].id;
}
