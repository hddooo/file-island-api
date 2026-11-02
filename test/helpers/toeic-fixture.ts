// Synthetic fixtures ONLY. Never imported by runtime modules, seeder or startup.
import type { ToeicCollection } from '../../src/toeic-cbt/catalog';
export function toeicFixture():ToeicCollection {
 const group=(id:string,numbers:number[])=>({id,questionNumbers:numbers,audioUrl:'https://toeic-fixture.invalid/'+id+'.wav',audioVerified:true,script:'Synthetic script for '+id,scriptStatus:'verified' as const});
 const question=(number:number,part:number,groupId:string,key:string)=>({number,part,groupId,stem:part===1?null:'Synthetic question '+number,questionVerified:true,choices:(part===2?['A','B','C']:['A','B','C','D']).map(id=>({id,text:'Synthetic option '+id+' for '+number})),choicesVerified:true,correctOptionId:key,answerVerified:true,photoUrl:part===1?'https://toeic-fixture.invalid/photo.svg':null,photoVerified:part===1,explanation:'Synthetic explanation '+number});
 return{roundKey:'synthetic-fixture-only',title:'합성 테스트 전용 회차',wrongNumbers:[1,16,37,38],groups:[group('p1',[1]),group('p2',[16]),group('p35-37',[35,36,37]),group('p38-40',[38,39,40])],questions:[question(1,1,'p1','B'),question(16,2,'p2','C'),question(37,3,'p35-37','A'),question(38,3,'p38-40','D')]};
}
