export const ROUND_MS=30_000, START_MS=3_000, READY_POP_MS=1_000, BETWEEN_MS=4_000, GRACE_MS=10_000, LIVE_MS=5_000, TIE_MS=0;
export type Side='left'|'right';
export interface Fighter {name:string;character:string;characterName:string;technique:string;hp:number;maxHp:number;atk:number;def:number;stageIndex:number;luk:number;}
// Static HP/ATK/DEF = round([50,10,5] * 1.5^stage). Other battle rules are unchanged.
const forms=[['botamon','깜몬','거품방울',50,10,5],['koromon','코로몬','거품방울',75,15,8],['agumon','아구몬','꼬마불꽃',113,23,11],['greymon','그레이몬','메가파이어',169,34,17],['metalgreymon','메탈그레이몬','미사일',253,51,25],['wargreymon','워그레이몬','에너지 구체',380,76,38]] as const;
export function fighter(name:string,points:number,family:string,storedStage?:number):Fighter {
 let n=0,id:string,characterName:string,technique:string;
 if(family==='patamon') {if(Number.isInteger(storedStage))points=[0,1200,1500,1800][Math.max(0,Math.min(3,storedStage!))];const p=points>=1800?['magnaangemon','홀리엔젤몬',4]:points>=1500?['angemon','엔젤몬',3]:points>=1200?['patamon','파닥몬',2]:['tokomon','토코몬',1];id=String(p[0]);characterName=String(p[1]);n=Number(p[2]);technique='빛의 타격';}
 else {const thresholds=[0,500,1000,1200,1500,1800];if(Number.isInteger(storedStage))points=thresholds[Math.max(0,Math.min(5,storedStage!))];while(n<5&&points>=thresholds[n+1])n++;[id,characterName,technique]=forms[n];}
 const f=forms[n];return{name:publicName(name),character:id,characterName,technique,hp:f[3],maxHp:f[3],atk:f[4],def:f[5],stageIndex:n+1,luk:0};
}
export function publicName(s:string){s=Array.from(String(s||'')).filter(c=>c.charCodeAt(0)>31&&c!=='<'&&c!=='>').join('').trim();return !s||s.includes('@')?'탐험가':Array.from(s).slice(0,24).join('');}
export interface Choice {id:string;text:string;}
export interface BattleQuestion {key:string;version:string;prompt:string;choices:Choice[];answer:string;explanation:string;}
export interface Submission {option:string;at:number;}
export function attack(answer:string,a:Submission|null,b:Submission|null):{attacker:Side|null;reason:string} {
 const ac=a?.option===answer,bc=b?.option===answer;
 if(ac&&bc){if(Math.abs(a!.at-b!.at)<=TIE_MS)return{attacker:null,reason:'simultaneous'};return{attacker:a!.at<b!.at?'left':'right',reason:'faster_correct'};}
 return{attacker:ac?'left':bc?'right':null,reason:ac||bc?'one_correct':'neither_correct'};
}
export const damage=(a:Fighter,b:Fighter)=>Math.max(1,a.atk-b.def);
// HP is integer-valued: discard the fractional third, then preserve the one-point floor.
export const weakDamage=(a:Fighter,b:Fighter)=>Math.max(1,Math.floor(damage(a,b)/3));
export function battleOutcome(status:string,winner:Side|null,reason:string|null,side:Side){return reason==='cancelled_before_start'?'cancelled':status==='void'?'void':status==='finished'&&winner===null&&reason==='double_ko'?'draw':winner===side?'win':'loss';}
export interface BattleItem {id:string;number:number;prompt:string;choices:Choice[];answer:string;explanation:string;}
export interface Bundle {script?:string;scriptStatus?:string;key:string;version:string;part:number;prompt:string;passage:string|null;items:BattleItem[];durationMs:number;audio:{url:string;seconds:number;sha256:string}|null;images:string[];}
export interface BundleSubmission {answers:{id:string;optionId:string;at?:number}[];at:number;}
export function score(bundle:Bundle,s:BundleSubmission|null){return s?bundle.items.filter(i=>s.answers.some(a=>a.id===i.id&&a.optionId===i.answer)).length:0;}
export function bundleAttack(bundle:Bundle,a:BundleSubmission|null,b:BundleSubmission|null){const ac=score(bundle,a),bc=score(bundle,b);if(!ac&&!bc)return{attacker:null as Side|null,reason:'neither_correct'};if(ac!==bc)return{attacker:(ac>bc?'left':'right')as Side,reason:'more_correct'};if(a&&b&&Math.abs(a.at-b.at)<=TIE_MS)return{attacker:null as Side|null,reason:'simultaneous'};return{attacker:(a&&(!b||a.at<b.at)?'left':'right')as Side,reason:'faster_correct'};}

export function evasionPercent(defender:Fighter,attacker:Fighter,rates:number[]){return rates[defender.stageIndex-1]/attacker.stageIndex;}
