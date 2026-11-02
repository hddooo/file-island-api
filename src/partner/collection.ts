import {randomUUID} from 'node:crypto';
import type {Queryable} from '../db/db.service';
import {AppError} from '../common/app-error';
import {lockOwner} from '../common/owner-lock';

// HanQ chooses these Adventure branches; XP thresholds are product rules, not official lore.
export const COLLECTION_CHAINS = {
 agumon: ['botamon','koromon','agumon','greymon','metalgreymon','wargreymon'],
 gabumon: ['punimon','tsunomon','gabumon','garurumon','weregarurumon','metalgarurumon'],
 patamon: ['poyomon','tokomon','patamon','angemon','magnaangemon','seraphimon'],
} as const;
export const COLLECTION_NAMES:Record<string,string>={digitama:'디지몬 알',punimon:'푸니몬',tsunomon:'뿔몬',gabumon:'파피몬',garurumon:'가루몬',weregarurumon:'워가루몬',metalgarurumon:'메탈가루몬',poyomon:'포요몬',tokomon:'토코몬',patamon:'파닥몬',angemon:'엔젤몬',magnaangemon:'홀리엔젤몬',agumon:'아구몬',botamon:'깜몬',koromon:'코로몬',greymon:'그레이몬',metalgreymon:'메탈그레이몬',wargreymon:'워그레이몬',seraphimon:'세라피몬'};
export type CollectionFamily=keyof typeof COLLECTION_CHAINS;
export const COLLECTION_THRESHOLDS=[100,500,1000,1200,1500,1800] as const;
export interface OwnedDigimon {id:string;user_id:string;family:CollectionFamily;xp:string;stage:number;revision:number;equipped:boolean;first_partner:boolean;hatch_started_at?:Date|null;hatch_ready_at?:Date|null;hatched_at?:Date|null;}
export function describePartner(p:OwnedDigimon) {
 const chain=COLLECTION_CHAINS[p.family],next=p.stage<0?null:chain[p.stage+1],points=Number(p.xp),threshold=p.stage<0?null:COLLECTION_THRESHOLDS[p.stage+1]??null;
 const iso=(d:Date|null|undefined)=>d?new Date(d).toISOString():null;
 return {id:p.id,family:p.family,points,stage:p.stage,revision:p.revision,equipped:p.equipped,firstPartner:p.first_partner,character:p.stage<0?'digitama':chain[p.stage],nextCharacter:next??null,nextThreshold:threshold,eligible:p.stage>=0&&!!next&&points>=threshold!,final:p.stage>=0&&!next,hatchStartedAt:iso(p.hatch_started_at),hatchReadyAt:iso(p.hatch_ready_at),hatchedAt:iso(p.hatched_at)};
}
export async function collection(q:Queryable,user:string,now:Date=new Date()) {
 const rows=(await q.query<OwnedDigimon>('SELECT * FROM hanq.owned_digimon WHERE user_id=$1 ORDER BY first_partner DESC,created_at,id',[user])).rows;
 const items=rows.map(describePartner),equipped=items.find(p=>p.equipped);
 if(!equipped)throw new AppError(503,'collection_unavailable','디지몬 정보를 확인할 수 없어요.');
 const products=(await q.query<{id:string;kind:string;family:CollectionFamily;name:string;price_coin:string}>("SELECT id,kind,family,name,price_coin FROM hanq.shop_products WHERE active AND kind='egg' ORDER BY id")).rows.map(p=>({id:p.id,kind:p.kind,family:p.family,name:p.name,priceCoin:Number(p.price_coin),owned:items.some(d=>d.family===p.family)}));
 const coinBalance=Number((await q.query<{balance:string}>('SELECT balance FROM hanq.coin_accounts WHERE user_id=$1',[user])).rows[0]?.balance||0);
 return {version:1,beta:true,claimEnabled:true,purchaseEnabled:true,equipEnabled:true,hatchEnabled:true,hatchSeconds:60,serverNow:now.toISOString(),coinBalance,products,revision:items.reduce((n,p)=>n+p.revision,0),totalPoints:items.reduce((n,p)=>n+p.points,0),equippedId:equipped.id,items,availableFamilies:(['gabumon','patamon'] as const).filter(f=>!items.some(p=>p.family===f))};
}
// Call inside a transaction after the owner lock. Completion is persisted at the scheduled
// server deadline, even when the next authenticated read happens much later.
export async function finishDueHatches(q:Queryable,user:string,now:Date) {
 await q.query('UPDATE hanq.owned_digimon SET stage=0,hatched_at=hatch_ready_at,revision=revision+1 WHERE user_id=$1 AND stage=-1 AND hatch_ready_at<=$2',[user,now]);
}
export async function equippedPartner(q:Queryable,user:string,now:Date=new Date()) {
 await lockOwner(q,user);await finishDueHatches(q,user,now);
 const p=(await q.query<OwnedDigimon>('SELECT * FROM hanq.owned_digimon WHERE user_id=$1 AND equipped',[user])).rows[0];
 if(!p)throw new AppError(503,'collection_unavailable','디지몬 정보를 확인할 수 없어요.');
 return p;
}
export type CollectionCommand = {command:'claim';family:'gabumon'|'patamon';priceCoin?:number}|{command:'equip';id:string;revision:number}|{command:'evolve';id:string;revision:number};
export async function command(q:Queryable,user:string,requestId:string,input:CollectionCommand,clock:()=>Date=()=>new Date()) {
 // Equip/evolve use BattleService's lobby -> owner order; claims only need their owner lock.
 if(input.command!=='claim')await q.query("SELECT pg_advisory_xact_lock(hashtext('hanq.battle.lobby'))");
 await lockOwner(q,user);
 const now=clock();
 const prior=(await q.query<{input:CollectionCommand;result:Record<string,unknown>}>('SELECT input,result FROM hanq.digimon_commands WHERE user_id=$1 AND request_id=$2',[user,requestId])).rows[0];
 if(prior){if(JSON.stringify(prior.input,Object.keys(prior.input).sort())!==JSON.stringify(input,Object.keys(input).sort()))throw new AppError(409,'collection_request_conflict','다른 요청에 사용한 번호예요.');return {...prior.result,replayed:true};}
 await finishDueHatches(q,user,now);
 let id:string;
 if(input.command==='claim'){
  const product=(await q.query<{id:string;price_coin:string}>("SELECT id,price_coin FROM hanq.shop_products WHERE family=$1 AND kind='egg' AND active FOR SHARE",[input.family])).rows[0];
  if(!product||Number(product.price_coin)!==0||input.priceCoin!==undefined&&input.priceCoin!==0)throw new AppError(400,'egg_price_changed','알 가격을 다시 확인해 주세요.');
  const existing=(await q.query<{id:string}>('SELECT id FROM hanq.owned_digimon WHERE user_id=$1 AND family=$2',[user,input.family])).rows[0];
  if(existing)throw new AppError(409,'egg_already_claimed','이미 이 계열의 알을 받았어요.');
  await q.query('INSERT INTO hanq.coin_accounts(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',[user]);
  id=randomUUID();await q.query('INSERT INTO hanq.owned_digimon(id,user_id,family,stage,revision,product_id) VALUES($1,$2,$3,-1,1,$4)',[id,user,input.family,product.id]);
 }else{
  const p=(await q.query<OwnedDigimon>('SELECT * FROM hanq.owned_digimon WHERE user_id=$1 AND id=$2',[user,input.id])).rows[0];
  if(!p)throw new AppError(404,'partner_not_found','내 디지몬을 찾을 수 없어요.');
  const busy=(await q.query("SELECT 1 FROM hanq.battle_matches WHERE (challenger=$1 OR opponent=$1) AND (status IN('ready','playing','between') OR (status='pending' AND expires_at>$2)) UNION ALL SELECT 1 FROM hanq.battle_practice_matches WHERE owner_id=$1 AND status IN('ready','playing','between') LIMIT 1",[user,now])).rows.length;
  if(busy)throw new AppError(409,'partner_in_battle','대전 신청과 전투를 마친 뒤 바꿀 수 있어요.');
  if(input.command==='equip'){
   if((await collection(q,user,now)).revision!==input.revision)throw new AppError(409,'collection_changed','디지몬 정보가 바뀌었어요. 다시 확인해 주세요.');
   if(!p.equipped){await q.query('UPDATE hanq.owned_digimon SET equipped=false,revision=revision+1 WHERE user_id=$1 AND equipped',[user]);await q.query('UPDATE hanq.owned_digimon SET equipped=true,revision=revision+1 WHERE user_id=$1 AND id=$2',[user,p.id]);}
   await q.query("UPDATE hanq.owned_digimon SET hatch_started_at=$3,hatch_ready_at=$3::timestamptz+interval '60 seconds',revision=revision+1 WHERE user_id=$1 AND id=$2 AND stage=-1 AND hatch_started_at IS NULL",[user,p.id,now]);
  }else{
   if(p.revision!==input.revision)throw new AppError(409,'evolution_changed','디지몬 정보가 바뀌었어요. 다시 확인해 주세요.');
   if(!describePartner(p).eligible)throw new AppError(409,'evolution_not_ready','아직 진화할 수 없어요.');
   await q.query('UPDATE hanq.owned_digimon SET stage=stage+1,revision=revision+1 WHERE user_id=$1 AND id=$2',[user,p.id]);
  }
  id=p.id;
 }
 const saved=(await q.query<OwnedDigimon>('SELECT * FROM hanq.owned_digimon WHERE user_id=$1 AND id=$2',[user,id])).rows[0];
 const result={confirmed:true,replayed:false,command:input.command,partnerId:id,...(input.command==='claim'?{priceCoin:0,currency:'Coin'}:{}),...describePartner(saved)};
 await q.query('INSERT INTO hanq.digimon_commands(user_id,request_id,command,input,result) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[user,requestId,input.command,JSON.stringify(input),JSON.stringify(result)]);
 return result;
}
