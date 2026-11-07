import {sha256} from '../common/util';
/** Static asset checks are bursty. Do not merge every browser behind the reverse proxy into one 120/min key. */
export class SiteGateRateLimit {
 private start=0; private count=0;
 private keys=new Map<string,{until:number,count:number}>();
 allow(token:string,now:number):boolean{
  if(now-this.start>=60000){this.start=now;this.count=0;this.keys.clear();}
  if(++this.count>12000)return false;
  const key=sha256(token).toString('hex');
  let entry=this.keys.get(key);
  if(!entry){if(this.keys.size>=2048)return false;entry={until:now+60000,count:0};this.keys.set(key,entry);}
  if(entry.until<=now){entry.until=now+60000;entry.count=0;}
  return ++entry.count<=2000;
 }
}
