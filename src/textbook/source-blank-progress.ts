import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { TextbookService } from './textbook.service';
import { sequenceNumbersMatch } from './sequence-grading';
import { multipleAnswerDetails } from './multiple-answer-grading';

type Answer = { id: string; text: string };
export type GradingVersion = 1 | 2;
export function requestedGradingVersion(value:unknown):GradingVersion {
 if(value===undefined)return 1;
 if(value===1||value===2)return value;
 throw new AppError(400,'invalid_grading_version','Invalid grading version');
}
export function queryGradingVersion(value:unknown):GradingVersion {
 if(value===undefined)return 1;
 if(value==='1')return 1;
 if(value==='2')return 2;
 throw new AppError(400,'invalid_grading_version','Invalid grading version');
}
export function gradingStorageKey(key:string,version:GradingVersion):string {
 if(version===1)return key;
 const scoped='grading:v2:'+key;
 if(!key||key.startsWith('grading:')||!/^[a-zA-Z0-9:_-]+$/.test(key)||Buffer.byteLength(scoped,'utf8')>256)throw new AppError(400,'invalid_source_progress','Invalid source progress');
 return scoped;
}
export function gradingCapabilities(gradingVersion:GradingVersion){return {gradingVersion,supportedGradingVersions:[1,2],gradingStorageScope:gradingVersion===2?'isolated-v2':'legacy-v1'};}
type Slot = { id: string; answerIds: string[]; answer?: { orderMatters: boolean } };
export type SourceItem = { id: string; kind: string; verification: { status: string }; blanks: (Slot & { parts?: Slot[] })[]; responseSlots?: Slot[]; answers: Answer[]; answer: { text: string; orderMatters: boolean; sequenceTokens?: unknown; sequenceSeparator?: string } };
export type SourceProgress = { position: number; status: 'active' | 'paused' | 'completed'; responses: { itemId: string; values: string[]; correct: boolean }[]; draft: string[] };
export type ProgressMutation = { gradingVersion?:GradingVersion; version: string; revision: number; mutationId: string; action: 'draft' | 'answer' | 'pause'; position: number; values: string[] };
const invalid = () => new AppError(400, 'invalid_source_progress', 'Invalid source progress');
const conflict = () => new AppError(409, 'source_progress_conflict', 'Reload the saved progress before continuing');
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const normalized = (x: string) => x.normalize('NFC').replace(/\s+/g, '');
export type SourceAnswerPolicy = {sourceVersion:string;itemId:string;answerId:string;slotIds:string[];expectedNormalizedSHA:string;mode:string;allowedTokenIndexGroups:number[][];ordered:boolean;rationale:string};
export const sourceAnswerPolicies:SourceAnswerPolicy[] = [
 {
  "sourceVersion": "2377ae0ae1e6d624da655eac47bdedd7e8356e8b072669c97f52990d54c1e87d",
  "itemId": "81-2026:goryeo:q-aristocratic-03",
  "answerId": "81-2026:goryeo:q-aristocratic-03:a1",
  "slotIds": [
   "81-2026:goryeo:q-aristocratic-03:blank"
  ],
  "expectedNormalizedSHA": "c03cd1c5a0480ba940a8b441e317bbaefe44d77aaf0dfa348f12e0aae5a90fd4",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "2377ae0ae1e6d624da655eac47bdedd7e8356e8b072669c97f52990d54c1e87d",
  "itemId": "81-2026:goryeo:q-aristocratic-05",
  "answerId": "81-2026:goryeo:q-aristocratic-05:a1",
  "slotIds": [
   "81-2026:goryeo:q-aristocratic-05:blank"
  ],
  "expectedNormalizedSHA": "8c1ba0bc5e8de76ac6819e855c755fbf171d082e3cbe0fd7ba4d4198881734cc",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "2377ae0ae1e6d624da655eac47bdedd7e8356e8b072669c97f52990d54c1e87d",
  "itemId": "81-2026:goryeo:q-invasions-02",
  "answerId": "81-2026:goryeo:q-invasions-02:a1",
  "slotIds": [
   "81-2026:goryeo:q-invasions-02:blank"
  ],
  "expectedNormalizedSHA": "bf4084473c8f59e8c98eb92888b230593b428601733fdd845af3595131d405f3",
  "mode": "context-alternatives",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "CONTEXTUAL_ALTERNATIVES"
 },
 {
  "sourceVersion": "2377ae0ae1e6d624da655eac47bdedd7e8356e8b072669c97f52990d54c1e87d",
  "itemId": "81-2026:goryeo:q-invasions-09",
  "answerId": "81-2026:goryeo:q-invasions-09:a1",
  "slotIds": [
   "81-2026:goryeo:q-invasions-09:blank"
  ],
  "expectedNormalizedSHA": "dbe1048a1dd756cc0c6e01c6c48ea92f40439439f47113c7a6a369557ab2e3ec",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "53dab6c956b0e23622da6bab684a98fbf0c7c4a83159e8bf075b8c4a6728fe04",
  "itemId": "81-d54c1aa5:p122:organizations-regions:13",
  "answerId": "81-d54c1aa5:p122:organizations-regions:13:answer:1",
  "slotIds": [
   "81-d54c1aa5:p122:organizations-regions:13:blank:1"
  ],
  "expectedNormalizedSHA": "c648423a1cc6faf3cd449cd3433c8fad9e579809395b4d90f28d54430fd159dd",
  "mode": "context-alternatives",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "CONTEXTUAL_ALTERNATIVES"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L1962:group2:q4",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L1962:group2:q4:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L1962:group2:q4:blank"
  ],
  "expectedNormalizedSHA": "e1c543f38047284c6430a73a5f2eef7b51874dd615b9d4be6c58efcef9dcb1d8",
  "mode": "collective",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1,
    2
   ],
   [
    0,
    1,
    2
   ]
  ],
  "ordered": true,
  "rationale": "COLLECTIVE_EQUIVALENCE"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L2026:group3:q11",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L2026:group3:q11:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L2026:group3:q11:blank"
  ],
  "expectedNormalizedSHA": "196a19f0113dd9af0551e91d53ceaf6cd5a8fda338028be9c0c35f839730c909",
  "mode": "identity-alias",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "IDENTITY_ALIAS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L2026:group3:q13",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L2026:group3:q13:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L2026:group3:q13:blank"
  ],
  "expectedNormalizedSHA": "c754b0177b846ad315050228b38e53c05ceb1776b917931b4e6af59160b2ee99",
  "mode": "optional-prefix",
  "allowedTokenIndexGroups": [
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "OPTIONAL_PREFIX"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L2090:group5:q13",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L2090:group5:q13:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L2090:group5:q13:blank"
  ],
  "expectedNormalizedSHA": "4f1d75158fd8f91961c42a3d3f7dfc9cf55b0b0e63be558893beda4dfe2c8de2",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ],
   [
    0,
    2
   ],
   [
    0,
    1,
    2
   ]
  ],
  "ordered": true,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L2090:group5:q8",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L2090:group5:q8:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L2090:group5:q8:blank"
  ],
  "expectedNormalizedSHA": "f2e0f5fc635e2ef1a61beab4f2de543f154336821f797c9811b1078cb8c6165e",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L2090:group6:q2",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L2090:group6:q2:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L2090:group6:q2:blank"
  ],
  "expectedNormalizedSHA": "a75ca120ebad60ba2e64006714f7f293a4e3027b791d861088582ed1f4f7c017",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "REQUIRED_PAIRED_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L2090:group6:q5",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L2090:group6:q5:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L2090:group6:q5:blank"
  ],
  "expectedNormalizedSHA": "208014099ef66ca3dc08140b6406abe12379068912dfcaee057f32b36fac56e1",
  "mode": "identity-alias",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "IDENTITY_ALIAS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L2150:group6:q31",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L2150:group6:q31:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L2150:group6:q31:blank"
  ],
  "expectedNormalizedSHA": "7436563b5336a6f9e8b6ba9ea98273bb0b77b71d35f6c80344f9dab06aeba532",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L874:group1:q1",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L874:group1:q1:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L874:group1:q1:blank"
  ],
  "expectedNormalizedSHA": "60a46e5f141f920d8db850025be6afda4c8028d8a008baab293d6853ef70b5f1",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L874:group1:q13",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L874:group1:q13:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L874:group1:q13:blank"
  ],
  "expectedNormalizedSHA": "33efd4972bd4831608cb88ae0828a24f9d04240a485c41b48ad534339ee3be2a",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L874:group1:q7",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L874:group1:q7:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L874:group1:q7:blank"
  ],
  "expectedNormalizedSHA": "1b37d9bb08d9b8cd63accefe373f2cce747dbfa8778ed3fd5067c2285e0668d3",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q15",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q15:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L918:group1:q15:blank"
  ],
  "expectedNormalizedSHA": "2e0ae56fc34cd132793e790db4a001c678c4142df5e5c86c9ff1eaaea01cfab3",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q23",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q23:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L918:group1:q23:blank"
  ],
  "expectedNormalizedSHA": "9ba9a01f0b1a360fbc1cc942852a9e8fd1e0b124ef5cc1e7f2ec95deaf204e4f",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q30",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q30:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L918:group1:q30:blank"
  ],
  "expectedNormalizedSHA": "33efd4972bd4831608cb88ae0828a24f9d04240a485c41b48ad534339ee3be2a",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q31",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q31:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L918:group1:q31:blank"
  ],
  "expectedNormalizedSHA": "8dbd095a61d6b96ef335653a911cdb9835dc5cd97d478c7a3518def5ab986412",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q35",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q35:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L918:group1:q35:blank"
  ],
  "expectedNormalizedSHA": "70411e0cebb6b9c18c67bde3da012647e58b438999a3690bb4f5d9328047fc67",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q38",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L918:group1:q38:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L918:group1:q38:blank"
  ],
  "expectedNormalizedSHA": "9ba9a01f0b1a360fbc1cc942852a9e8fd1e0b124ef5cc1e7f2ec95deaf204e4f",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q42",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q42:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L986:group1:q42:blank"
  ],
  "expectedNormalizedSHA": "2e0ae56fc34cd132793e790db4a001c678c4142df5e5c86c9ff1eaaea01cfab3",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q43",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q43:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L986:group1:q43:blank"
  ],
  "expectedNormalizedSHA": "60a46e5f141f920d8db850025be6afda4c8028d8a008baab293d6853ef70b5f1",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q47",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q47:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L986:group1:q47:blank"
  ],
  "expectedNormalizedSHA": "2e0ae56fc34cd132793e790db4a001c678c4142df5e5c86c9ff1eaaea01cfab3",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "6a9f82ac4e33bf69b9a83886aa999656deb7af094916e15ce404fb711388c7b1",
  "itemId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q48",
  "answerId": "81-2026:joseon:script-8d0944e32d86-L986:group1:q48:a1",
  "slotIds": [
   "81-2026:joseon:script-8d0944e32d86-L986:group1:q48:blank"
  ],
  "expectedNormalizedSHA": "ce8644cbdd850d925106dafc7c792cd175cbccfcfc3b90f07ef8e41170c79665",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:10",
  "answerId": "81-d54c1aa5:p029:find-state:10:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:10:blank:1"
  ],
  "expectedNormalizedSHA": "4838c4050cfda9a034974fa57618616d06268a1455b8f035d16a67ec3c372759",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:11",
  "answerId": "81-d54c1aa5:p029:find-state:11:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:11:blank:1"
  ],
  "expectedNormalizedSHA": "ae39f28223ee622ebd0554cf74bc55817e4c90e90d9d0b6f0f19d6438a9759b2",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:15",
  "answerId": "81-d54c1aa5:p029:find-state:15:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:15:blank:1"
  ],
  "expectedNormalizedSHA": "1f94e3e43d0dd89826d12e20108e2c57463ee4c3aeec3864d029da58033c4c95",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:17",
  "answerId": "81-d54c1aa5:p029:find-state:17:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:17:blank:1"
  ],
  "expectedNormalizedSHA": "4b56c967cf2f0ddbdda17cbf7023fff1d212648d75bd38222adeec571c04406c",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:19",
  "answerId": "81-d54c1aa5:p029:find-state:19:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:19:blank:1"
  ],
  "expectedNormalizedSHA": "e5d42c3fa7c741bfa231cc61cc3c1a06d78182a4cbb82bf7411aa004edba678f",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:21",
  "answerId": "81-d54c1aa5:p029:find-state:21:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:21:blank:1"
  ],
  "expectedNormalizedSHA": "6947a2d21be1bba9d505c075f1d79eb02762a6b702949b8fb2e2ab9fd56601c7",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:22",
  "answerId": "81-d54c1aa5:p029:find-state:22:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:22:blank:1"
  ],
  "expectedNormalizedSHA": "89a9803007e5e75f96f8263b9771b1289b5b811060b3192cf4b00cd5e1230c95",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:24",
  "answerId": "81-d54c1aa5:p029:find-state:24:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:24:blank:1"
  ],
  "expectedNormalizedSHA": "3b7a5c66a4150535238d9b4fa94df28d91f4a6b33e466a14ba866009dc7c3f64",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:26",
  "answerId": "81-d54c1aa5:p029:find-state:26:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:26:blank:1"
  ],
  "expectedNormalizedSHA": "505e18b2995a5fbfe900b230a5befbd2fa796114385dc038e41294a3a3479334",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p029:find-state:29",
  "answerId": "81-d54c1aa5:p029:find-state:29:answer:1",
  "slotIds": [
   "81-d54c1aa5:p029:find-state:29:blank:1"
  ],
  "expectedNormalizedSHA": "f2254eb95863286ebe78d55608fcf46569d7188222be715ea1b77ee4e2648773",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p030:find-state:31",
  "answerId": "81-d54c1aa5:p030:find-state:31:answer:1",
  "slotIds": [
   "81-d54c1aa5:p030:find-state:31:blank:1"
  ],
  "expectedNormalizedSHA": "f2254eb95863286ebe78d55608fcf46569d7188222be715ea1b77ee4e2648773",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p030:find-state:32",
  "answerId": "81-d54c1aa5:p030:find-state:32:answer:1",
  "slotIds": [
   "81-d54c1aa5:p030:find-state:32:blank:1"
  ],
  "expectedNormalizedSHA": "0a445c0b37b062cd9a5117acf418fc3b0d0c452add194d97091b7c6fd3d59477",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "EXPLICIT_MULTI_FIELDS"
 },
 {
  "sourceVersion": "acacba973db635b5cf8672e5e482f5c82e8b2c8e703434b4da45ff37ae02f436",
  "itemId": "81-d54c1aa5:p030:find-state:33",
  "answerId": "81-d54c1aa5:p030:find-state:33:answer:1",
  "slotIds": [
   "81-d54c1aa5:p030:find-state:33:blank:1"
  ],
  "expectedNormalizedSHA": "735f2d4a4db7e599419088fdf1cab39d7d4d807cdf29a93d8601196c800253de",
  "mode": "head-only",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "REQUESTED_ENTITY_WITH_CONTEXT"
 },
 {
  "sourceVersion": "b99bb10af54f94e742eef7c1871606c79f4dc2a448a481173a0fa240d0ee1d7b",
  "itemId": "81-2026:opening:culture-q16",
  "answerId": "81-2026:opening:culture-q16:a1",
  "slotIds": [
   "81-2026:opening:culture-q16:blank"
  ],
  "expectedNormalizedSHA": "3b58b8ff58a66970d0b7bd1500f20317c75bd195505210fe7e4937f453695d1d",
  "mode": "identity-alias",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "IDENTITY_ALIAS"
 },
 {
  "sourceVersion": "b99bb10af54f94e742eef7c1871606c79f4dc2a448a481173a0fa240d0ee1d7b",
  "itemId": "81-2026:opening:opening-policy-9",
  "answerId": "81-2026:opening:opening-policy-9:a1",
  "slotIds": [
   "81-2026:opening:opening-policy-9:blank"
  ],
  "expectedNormalizedSHA": "37f4628980877948a12a94f53a763b050351f6e92f2f7cb0c50bdcd78416bde2",
  "mode": "all-components",
  "allowedTokenIndexGroups": [
   [
    0,
    1
   ]
  ],
  "ordered": true,
  "rationale": "REQUIRED_PAIRED_FIELDS"
 },
 {
  "sourceVersion": "c6ee6eca932208fcd228c3b1bd19ae29c13dfba92e16795031ca5a4a8128cbd1",
  "itemId": "81-d54c1aa5:p138:government:32",
  "answerId": "81-d54c1aa5:p138:government:32:answer:1",
  "slotIds": [
   "81-d54c1aa5:p138:government:32:blank:1"
  ],
  "expectedNormalizedSHA": "818cf7051cda91005f87276cc67c1d290759c39a66c8e1d7f8b726d384bc4174",
  "mode": "context-alternatives",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "CONTEXTUAL_ALTERNATIVES"
 },
 {
  "sourceVersion": "f0c14516b3743764d4608ae58f4be57d14b47562d57b919b384b612fa0dd9339",
  "itemId": "81-d54c1aa5:p015:gojoseon-and-states:24",
  "answerId": "81-d54c1aa5:p015:gojoseon-and-states:24:answer:1",
  "slotIds": [
   "81-d54c1aa5:p015:gojoseon-and-states:24:blank:1"
  ],
  "expectedNormalizedSHA": "5af4f09da198cce309ed18ed0415481db67a598107da03a4b2890a586d67fa9b",
  "mode": "context-alternatives",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "CONTEXTUAL_ALTERNATIVES"
 },
 {
  "sourceVersion": "f403ea0aa88ff51a92af58bbb1523540f4c4b440adc08fd72ee8758a4cf82cc0",
  "itemId": "81-d54c1aa5:p037:unified-silla:1",
  "answerId": "81-d54c1aa5:p037:unified-silla:1:answer:1",
  "slotIds": [
   "81-d54c1aa5:p037:unified-silla:1:blank:1"
  ],
  "expectedNormalizedSHA": "056ac9267191276f9b42f568ee1e06d944d73224e296ff5e8737ffb055eb8d88",
  "mode": "identity-alias",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "IDENTITY_ALIAS"
 },
 {
  "sourceVersion": "f403ea0aa88ff51a92af58bbb1523540f4c4b440adc08fd72ee8758a4cf82cc0",
  "itemId": "81-d54c1aa5:p039:unified-silla-culture:1",
  "answerId": "81-d54c1aa5:p039:unified-silla-culture:1:answer:1",
  "slotIds": [
   "81-d54c1aa5:p039:unified-silla-culture:1:blank:1"
  ],
  "expectedNormalizedSHA": "a4d9bc8a9a5980a809a9e7095ab9b80f92c144ff470fce69bc583040aa52f6d0",
  "mode": "identity-alias",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "IDENTITY_ALIAS"
 },
 {
  "sourceVersion": "f403ea0aa88ff51a92af58bbb1523540f4c4b440adc08fd72ee8758a4cf82cc0",
  "itemId": "81-d54c1aa5:p039:unified-silla-culture:2",
  "answerId": "81-d54c1aa5:p039:unified-silla-culture:2:answer:1",
  "slotIds": [
   "81-d54c1aa5:p039:unified-silla-culture:2:blank:1"
  ],
  "expectedNormalizedSHA": "a8d29c1646c85a6409cd4a4a44e03336f253795b1c8d8911e6f7c2a4858d6fa1",
  "mode": "identity-alias",
  "allowedTokenIndexGroups": [
   [
    0
   ],
   [
    1
   ],
   [
    0,
    1
   ]
  ],
  "ordered": false,
  "rationale": "IDENTITY_ALIAS"
 }
];
export function sourcePolicyMatches(value:string,expected:string,policy:SourceAnswerPolicy):boolean {
 const canonical=normalized(expected);
 if(createHash('sha256').update(canonical).digest('hex')!==policy.expectedNormalizedSHA)return false;
 const tokens=canonical.split(/[(),/=]/).filter(Boolean),given=value.split(/[,/]/).map(normalized);
 if(given.some(x=>!x)||new Set(given).size!==given.length)return false;
 return policy.allowedTokenIndexGroups.some(group=>{
  if(!group.length||group.some(index=>!Number.isInteger(index)||index<0||index>=tokens.length))return false;
  const selected=group.map(index=>tokens[index]);
  if(policy.mode==='optional-prefix'&&group.length>1&&given.length===1&&given[0]===selected.join(''))return true;
  if(given.length!==selected.length)return false;
  const actual=[...given];if(!policy.ordered){actual.sort();selected.sort();}
  return actual.every((part,index)=>part===selected[index]);
 });
}
function separatedAnswersMatch(value:string,expected:string[],ordered:boolean):boolean {
 // A slash/comma inside a canonical element may be a fraction or literal text.
 if(expected.some(part=>/[,/]/.test(part)))return false;
 const given=value.split(/[,/]/).map(normalized),parts=expected.map(normalized);
 if(given.length!==parts.length||given.some(x=>!x)||new Set(given).size!==given.length)return false;
 if(!ordered){given.sort();parts.sort();}
 return given.every((part,index)=>part===parts[index]);
}

// User-approved answer shorthand, not a claim that these treaties are identical.
const treatyAnswerAliases = [
  [
    [
      "조일무역규칙 (조일통상장정)",
      "조일무역규칙",
      "조일통상장정"
    ],
    [
      "조일"
    ]
  ],
  [
    [
      "수호조규부록",
      "조일수호조규부록"
    ],
    [
      "조일수호조규",
      "조일조규"
    ]
  ],
  [
    [
      "개정된 통상장정"
    ],
    [
      "개정된 조일통상장정",
      "개정된 무역통상장정"
    ]
  ],
  [
    [
      "조청상민수륙무역장정"
    ],
    [
      "조청"
    ]
  ],
  [
    [
      "조미수호통상조약"
    ],
    [
      "조미"
    ]
  ],
  [
    [
      "조프통상조약"
    ],
    [
      "조프"
    ]
  ],
  [
    [
      "조영통상조약"
    ],
    [
      "조영"
    ]
  ]
];
function treatyAliasMatches(value:string,expected:string):boolean{
 const clean=(s:string)=>String(s).normalize('NFC').replace(/\s+/g,'');
 return treatyAnswerAliases.some(([keys,aliases])=>keys.some(key=>clean(key)===clean(expected))&&aliases.some(alias=>clean(alias)===clean(value)));
}

function singleAnswerMatches(value: string, expected: string): boolean {
 const cleaned=normalized(value), canonical=normalized(expected);
 if(cleaned===canonical||treatyAliasMatches(value,expected))return true;
 const alias=canonical.match(/^([\p{L}\p{N}]+)\(=([\p{L}\p{N}]+)\)$/u);
 if(alias)return cleaned===alias[1]||cleaned===alias[2];
 // Project explicit parentheses to separators, retaining every source token in
 // order, including A(B)C -> A,B,C. Never infer replacement-word synonyms.
 // A numeric comma may be a thousands separator, not an answer boundary.
 if(/\p{N},\p{N}/u.test(canonical))return false;
 if(!/^[\p{L}\p{N}]+(?:\([\p{L}\p{N}]+(?:,[\p{L}\p{N}]+)*\)[\p{L}\p{N}]*)+$/u.test(canonical))return false;
 const parts=canonical.replace(/[()]/g,',').split(',').filter(Boolean);
 const given=value.split(/[,/]/).map(normalized);
 return given.length===parts.length&&given.every((part,i)=>part===parts[i]);
}
export function sourceSlots(item: SourceItem): Slot[] { return item.kind === 'classification' ? item.responseSlots! : item.blanks.flatMap(b => b.parts || [b]); }
export function sourceGrade(item: SourceItem, values: string[],gradingVersion:GradingVersion=2,sourceVersion?:string): boolean {
 return sourceSlots(item).every((slot, i) => {
  const value = values[i], expected = slot.answerIds.map(id => item.answers.find(a => a.id === id)!.text);
  if (item.answer.sequenceTokens && normalized(value) === normalized(item.answer.text)) return true;
  if (item.kind === 'sequence') return sequenceNumbersMatch(value,expected);
  const ordered=slot.answer?.orderMatters??item.answer.orderMatters;
  if(gradingVersion===2&&expected.length>1&&separatedAnswersMatch(value,expected,ordered))return true;
  if (expected.length>1 && !(slot.answer?.orderMatters ?? item.answer.orderMatters)) return multipleAnswerDetails(value,expected).correct;
  if (expected.length === 1) {
   if(gradingVersion===1)return normalized(value)===normalized(expected[0]);
   if(normalized(value)===normalized(expected[0]))return true;
   const policy=sourceAnswerPolicies.find(p=>p.sourceVersion===sourceVersion&&p.itemId===item.id&&p.answerId===slot.answerIds[0]&&p.slotIds.includes(slot.id)&&p.ordered===ordered&&p.expectedNormalizedSHA===createHash('sha256').update(normalized(expected[0])).digest('hex'));
   return policy?sourcePolicyMatches(value,expected[0],policy):singleAnswerMatches(value,expected[0]);
  }
  const given = value.split(',').map(normalized), parts = expected.map(normalized);
  if (given.length !== parts.length || given.some(x => !x)) return false;
  if (!(slot.answer?.orderMatters ?? item.answer.orderMatters)) { given.sort(); parts.sort(); }
  return given.every((x, j) => x === parts[j]);
 });
}
export function initialSourceProgress(): SourceProgress { return { position: 0, status: 'active', responses: [], draft: [] }; }
export function applySourceMutation(items: SourceItem[], current: SourceProgress, m: ProgressMutation,gradingVersion:GradingVersion=2,sourceVersion?:string): SourceProgress {
 if (!m || !['draft', 'answer', 'pause'].includes(m.action) || !Number.isInteger(m.position) || m.position !== current.position
  || !Array.isArray(m.values) || m.values.some(v => typeof v !== 'string' || v.length > 2000)) throw invalid();
 const next: SourceProgress = structuredClone(current), item = items[current.position];
 if (item && (item.verification.status !== 'source-verified')) throw invalid();
 if (!item) { if (m.action !== 'pause' || m.values.length) throw conflict(); return next; }
 if (m.values.length !== sourceSlots(item).length) throw invalid();
 next.draft = m.values;
 if (m.action === 'answer') {
  if (m.values.some(v => !normalized(v))) throw invalid();
  next.responses.push({ itemId: item.id, values: m.values, correct: sourceGrade(item, m.values,gradingVersion,sourceVersion) });
  next.position++; next.draft = []; next.status = next.position === items.length ? 'completed' : 'active';
 } else next.status = m.action === 'pause' ? 'paused' : 'active';
 return next;
}
export type SourceWorkspace = { cursor: number; status: 'active' | 'paused' | 'completed'; responses: Record<string, { values: string[]; submitted: boolean; correct: boolean | null; checkedSlots?: boolean[] }> };
export type SourceBatch = { gradingVersion?:GradingVersion; version: string; revision: number; mutationId: string; cursor: number; status: 'active' | 'paused' | 'completed'; updates: { itemId: string; values: string[]; submitted: boolean; checkedSlots?: boolean[] }[] };
export function workspaceFromLegacy(progress: SourceProgress, count: number): SourceWorkspace {
 const responses: SourceWorkspace['responses'] = {};
 progress.responses.forEach(r => { responses[r.itemId] = { values: r.values, submitted: true, correct: r.correct, checkedSlots: r.values.map(()=>true) }; });
 return { cursor: Math.min(progress.position, count-1), status: progress.status, responses };
}
export function applySourceBatch(items: SourceItem[], current: SourceWorkspace, batch: SourceBatch,gradingVersion:GradingVersion=2,sourceVersion?:string): SourceWorkspace {
 if (!Number.isInteger(batch.cursor) || batch.cursor<0 || batch.cursor>=items.length || !['active','paused','completed'].includes(batch.status) || !Array.isArray(batch.updates) || batch.updates.length>items.length) throw invalid();
 const next=structuredClone(current), seen=new Set<string>();
 for(const update of batch.updates) {
  const item=items.find(i=>i.id===update.itemId);
  if(!item || item.verification.status!=='source-verified' || seen.has(update.itemId) || typeof update.submitted!=='boolean' || !Array.isArray(update.values) || update.values.length!==sourceSlots(item).length || update.values.some(v=>typeof v!=='string'||v.length>2000)) throw invalid();
  if(update.checkedSlots!==undefined&&(!Array.isArray(update.checkedSlots)||update.checkedSlots.length!==update.values.length||update.checkedSlots.some(v=>typeof v!=='boolean')))throw invalid();
  seen.add(update.itemId);const checkedSlots=(update.checkedSlots||update.values.map(()=>update.submitted)).map((v,i)=>v&&!!normalized(update.values[i]));const submitted=checkedSlots.every(Boolean)&&update.values.every(v=>!!normalized(v));
  next.responses[item.id]={values:update.values,submitted,correct:submitted?sourceGrade(item,update.values,gradingVersion,sourceVersion):null,checkedSlots};
 }
 // Explicit completion ends the session, not the unanswered items. Preserve their masks and grades.
 next.cursor=batch.cursor;next.status=batch.status==='completed'?'completed':batch.status==='paused'?'paused':items.every(i=>next.responses[i.id]?.submitted)?'completed':'active';return next;
}
@Injectable()
export class SourceBlankProgressService {
 constructor(private readonly db: DbService, private readonly textbook: TextbookService) {}
 private async source(id: string, textbook = this.textbook) {
  const quiz = await textbook.semanticQuiz(id) as Record<string, unknown>;
  const items = quiz.items as SourceItem[];
  return { items, version: digest({ schema: quiz.schemaVersion, source: quiz.source, items }) };
 }
 async get(userId: string, id: string, textbook = this.textbook, requested?:GradingVersion) {
  const gradingVersion=requestedGradingVersion(requested),key=gradingStorageKey(id,gradingVersion);
  const { version } = await this.source(id, textbook);
  const result = await this.db.pool.query('SELECT revision,progress,updated_at FROM hanq.source_blank_progress WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3', [userId, key, version]);
  const row = result.rows[0];
  return { version, revision: row?.revision || 0, progress: row?.progress || initialSourceProgress(), updatedAt: row?.updated_at || null,...gradingCapabilities(gradingVersion) };
 }
 async save(userId: string, id: string, m: ProgressMutation, textbook = this.textbook) {
  const gradingVersion=requestedGradingVersion(m?.gradingVersion),key=gradingStorageKey(id,gradingVersion);
  const { items, version } = await this.source(id, textbook);
  if (!m || m.version !== version || !Number.isInteger(m.revision) || m.revision < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.mutationId || '')) throw invalid();
  const hash = digest(m);
  return this.db.tx(async q => {
   // Serializes first insertion and later writes for this account/source, without touching other records.
   await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId + ':' + key + ':' + version]);
   const result = await q.query('SELECT revision,progress,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_progress WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3 FOR UPDATE', [userId,key,version]);
   const row = result.rows[0];
   if (row?.mutation_id === m.mutationId) { if (row.mutation_hash !== hash) throw conflict(); return { version, revision: row.revision, progress: row.progress, updatedAt: row.updated_at,...gradingCapabilities(gradingVersion) }; }
   if ((row?.revision || 0) !== m.revision) throw conflict();
   const progress = applySourceMutation(items, row?.progress || initialSourceProgress(), m,gradingVersion,version), revision = m.revision + 1;
   const saved = await q.query(`INSERT INTO hanq.source_blank_progress (user_id,quiz_id,source_version,revision,progress,mutation_id,mutation_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id,quiz_id,source_version) DO UPDATE SET revision=EXCLUDED.revision,progress=EXCLUDED.progress,mutation_id=EXCLUDED.mutation_id,mutation_hash=EXCLUDED.mutation_hash,updated_at=now() RETURNING updated_at`, [userId,key,version,revision,progress,m.mutationId,hash]);
   return { version, revision, progress, updatedAt: saved.rows[0].updated_at,...gradingCapabilities(gradingVersion) };
  });
 }
 private async legacyWorkspace(q: { query: DbService['pool']['query'] }, userId: string, id: string, version: string, items: SourceItem[]) {
  const legacy=await q.query('SELECT progress FROM hanq.source_blank_progress WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3',[userId,id,version]);
  const progress: SourceProgress=legacy.rows[0]?.progress || initialSourceProgress();
  const workspace=workspaceFromLegacy(progress,items.length);
  if(progress.draft.length && progress.position<items.length) {
   workspace.responses[items[progress.position].id]={values:progress.draft,submitted:false,correct:null};
  }
  return workspace;
 }
 async getWorkspace(userId: string, id: string, textbook = this.textbook, requested?:GradingVersion) {
  const gradingVersion=requestedGradingVersion(requested),key=gradingStorageKey(id,gradingVersion);
  const {items,version}=await this.source(id, textbook);
  const result=await this.db.pool.query('SELECT revision,workspace,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3',[userId,key,version]),row=result.rows[0];
  return {version,revision:row?.revision||0,workspace:row?.workspace||(gradingVersion===2?workspaceFromLegacy(initialSourceProgress(),items.length):await this.legacyWorkspace(this.db.pool,userId,id,version,items)),updatedAt:row?.updated_at||null,...gradingCapabilities(gradingVersion)};
 }
 async saveWorkspace(userId: string, id: string, m: SourceBatch, textbook = this.textbook) {
  const gradingVersion=requestedGradingVersion(m?.gradingVersion),key=gradingStorageKey(id,gradingVersion);
  const {items,version}=await this.source(id, textbook);
  if(!m||m.version!==version||!Number.isInteger(m.revision)||m.revision<0||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.mutationId||''))throw invalid();
  const hash=digest(m);
  return this.db.tx(async q=>{
   await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':'+key+':'+version]);
   const result=await q.query('SELECT revision,workspace,mutation_id,mutation_hash,updated_at FROM hanq.source_blank_workspaces WHERE user_id=$1 AND quiz_id=$2 AND source_version=$3 FOR UPDATE',[userId,key,version]),row=result.rows[0];
   if(row?.mutation_id===m.mutationId){if(row.mutation_hash!==hash)throw conflict();return {version,revision:row.revision,workspace:row.workspace,updatedAt:row.updated_at,...gradingCapabilities(gradingVersion)};}
   if((row?.revision||0)!==m.revision)throw conflict();
   const initial=row?.workspace||(gradingVersion===2?workspaceFromLegacy(initialSourceProgress(),items.length):await this.legacyWorkspace(q,userId,id,version,items)),workspace=applySourceBatch(items,initial,m,gradingVersion,version),revision=m.revision+1;
   const saved=await q.query(`INSERT INTO hanq.source_blank_workspaces (user_id,quiz_id,source_version,revision,workspace,mutation_id,mutation_hash) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(user_id,quiz_id,source_version) DO UPDATE SET revision=EXCLUDED.revision,workspace=EXCLUDED.workspace,mutation_id=EXCLUDED.mutation_id,mutation_hash=EXCLUDED.mutation_hash,updated_at=now() RETURNING updated_at`,[userId,key,version,revision,workspace,m.mutationId,hash]);
   return {version,revision,workspace,updatedAt:saved.rows[0].updated_at,...gradingCapabilities(gradingVersion)};
  });
 }

}
