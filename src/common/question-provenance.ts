/** Source identity is independent of answer verification and generated explanations. */
export const ORIGINS=['ai_generated','user_provided_textbook','unknown'] as const;
export type QuestionOrigin=typeof ORIGINS[number];
export type OfficialStatus='confirmed'|'unverified'|'not_applicable';
export interface QuestionProvenance {schemaVersion:1;origin:QuestionOrigin;sourceKey?:string;title?:string;page?:string;questionNo?:number;officialStatus:OfficialStatus;evidenceRef?:string;}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'&&v.trim().length>0&&v.length<=500;
/** Missing legacy provenance is intentionally unknown; invalid explicit metadata must not be imported. */
export function parseProvenance(v:unknown):QuestionProvenance {
 if(v===undefined||v===null)return{schemaVersion:1,origin:'unknown',officialStatus:'unverified'};
 if(!object(v)||v.schemaVersion!==1||!ORIGINS.includes(v.origin as QuestionOrigin)||!['confirmed','unverified','not_applicable'].includes(String(v.officialStatus)))throw Error('Invalid question provenance');
 if(Object.keys(v).some(k=>!['schemaVersion','origin','sourceKey','title','page','questionNo','officialStatus','evidenceRef'].includes(k)))throw Error('Invalid question provenance field');
 for(const k of ['sourceKey','title','page','evidenceRef'])if(v[k]!==undefined&&!text(v[k]))throw Error('Invalid question provenance field');
 if(v.questionNo!==undefined&&(!Number.isSafeInteger(v.questionNo)||Number(v.questionNo)<1))throw Error('Invalid question number');
 if(v.officialStatus==='confirmed'&&(v.origin!=='user_provided_textbook'||!text(v.evidenceRef)))throw Error('Confirmed provenance requires source evidence');
 return {...v} as unknown as QuestionProvenance;
}
export function originOf(v:unknown):QuestionOrigin {try{return parseProvenance(v).origin;}catch{return 'unknown';}}
export function publicProvenance(v:unknown):Omit<QuestionProvenance,'evidenceRef'> {let p:QuestionProvenance;try{p=parseProvenance(v);}catch{p=parseProvenance(undefined);}const {evidenceRef:ignored,...safe}=p;void ignored;return safe;}
/** Remove internal evidence references at every response depth, without mutating stored values. */
export function redactEvidence<T>(value:T):T {if(Array.isArray(value))return value.map(redactEvidence) as T;if(object(value)){const out:Record<string,unknown>={};for(const [k,v] of Object.entries(value))if(k!=='evidenceRef')out[k]=redactEvidence(v);return out as T;}return value;}
