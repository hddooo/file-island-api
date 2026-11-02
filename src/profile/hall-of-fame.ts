import {COLLECTION_CHAINS,COLLECTION_NAMES,type CollectionFamily} from '../partner/collection';
import {recentOwnLearning} from './recent-own-learning';
import {Controller,Get,Injectable,Query,UseGuards} from '@nestjs/common';
import {Type} from 'class-transformer';import {IsInt,IsOptional,Max,Min} from 'class-validator';
import {CurrentAuth,JwtAuthGuard,type AuthContext} from '../auth/guards';import{DbService}from'../db/db.service';import{AppError}from'../common/app-error';
export class HallQuery{@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page?:number;@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(50) limit?:number;}
export function rankCharacter(points:number){const chain=[['botamon','깜몬',0],['koromon','코로몬',500],['agumon','아구몬',1000],['greymon','그레이몬',1200],['metalgreymon','메탈그레이몬',1500],['wargreymon','워그레이몬',1800]]as const;let at=0;while(at+1<chain.length&&points>=chain[at+1][2])at++;return{id:chain[at][0],name:chain[at][1]};}
export function rankPartner(family:unknown,stage:unknown){if(typeof family!=='string'||!(family in COLLECTION_CHAINS)||!Number.isInteger(stage)||Number(stage)<-1||Number(stage)>5)return null;const id=Number(stage)<0?'digitama':COLLECTION_CHAINS[family as CollectionFamily][Number(stage)];return{id,name:COLLECTION_NAMES[id]};}
export function publicRank(row:Record<string,unknown>|null|undefined){if(!row)return null;const points=Number(row.points),rank=Number(row.rank);if(!Number.isSafeInteger(points)||points<0||!Number.isSafeInteger(rank)||rank<1)throw new AppError(503,'ranking_unavailable','Ranking unavailable');const name=String(row.nickname||'').trim(),unsafe=Array.from(name).some(c=>c.charCodeAt(0)<32||c==='<'||c==='>');return{rank,nickname:!name||name.includes('@')||unsafe?'탐험가':Array.from(name).slice(0,40).join(''),points,character:rankPartner(row.family,row.stage)||rankCharacter(points),isMe:row.isMe===true};}
type HallPage={items:ReturnType<typeof publicRank>[];me:ReturnType<typeof publicRank>;page:number;limit:number;total:number;hasNext:boolean};
@Injectable()
export class HallService{
 private cache=new Map<string,{until:number;data:HallPage}>();private pending=new Map<string,Promise<HallPage>>();
 constructor(private readonly db:DbService){}
 async list(owner:string,q:HallQuery){const page=q.page||1,limit=q.limit||20,key=owner+':'+page+':'+limit,old=this.cache.get(key);if(old&&old.until>Date.now())return old.data;if(this.pending.has(key))return this.pending.get(key);const job=this.load(owner,page,limit).then(data=>{if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{until:Date.now()+10000,data});return data;}).finally(()=>this.pending.delete(key));this.pending.set(key,job);return job;}
 async myLearning(owner:string){return recentOwnLearning(this.db.pool,owner);}
 private async load(owner:string,page:number,limit:number):Promise<HallPage>{const r=await this.db.pool.query<{items:Record<string,unknown>[];me:Record<string,unknown>|null;total:string}>(`WITH scores AS MATERIALIZED (
 SELECT u.id,u.display_name nickname,coalesce(sum(g.xp),0)::bigint points,max(g.family) FILTER(WHERE g.equipped) family,max(g.stage) FILTER(WHERE g.equipped) stage
 FROM hanq.users u LEFT JOIN hanq.owned_digimon g ON g.user_id=u.id GROUP BY u.id,u.display_name
 ), ranked AS MATERIALIZED (SELECT *,rank() OVER(ORDER BY points DESC) position FROM scores)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('rank',p.position,'nickname',p.nickname,'points',p.points,'family',p.family,'stage',p.stage,'isMe',p.id=$1)) FROM (SELECT * FROM ranked ORDER BY points DESC,nickname COLLATE "C",id LIMIT $2 OFFSET $3)p),'[]'::jsonb) items,
 (SELECT jsonb_build_object('rank',position,'nickname',nickname,'points',points,'family',family,'stage',stage,'isMe',true) FROM ranked WHERE id=$1) me,(SELECT count(*)::text FROM ranked) total`,[owner,limit,(page-1)*limit]);const row=r.rows[0]||{items:[],me:null,total:'0'},total=Number(row.total);if(!Number.isSafeInteger(total)||total<0)throw new AppError(503,'ranking_unavailable','Ranking unavailable');return{items:row.items.map(publicRank),me:publicRank(row.me),page,limit,total,hasNext:page*limit<total};}
}
@Controller('api/v1/hall-of-fame') @UseGuards(JwtAuthGuard)
export class HallController{constructor(private readonly hall:HallService){}@Get('my-learning') myLearning(@CurrentAuth()who:AuthContext){return this.hall.myLearning(who.userId);}@Get()list(@CurrentAuth()who:AuthContext,@Query()q:HallQuery){return this.hall.list(who.userId,q);}}
