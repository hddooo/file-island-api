import {Injectable,OnModuleDestroy} from '@nestjs/common';
import type {Request,Response} from 'express';
import {AuthService} from '../auth/auth.service';
import {BattleService} from './service';
type Client={site?:{sessionId:string};legacySessionId?:string;user:string;token:string;res:Response;busy:boolean;dirty:boolean;closed:boolean;lastRevision:number;match:string|null;practice:boolean;wake:ReturnType<typeof setTimeout>|null;close:()=>void};
/** Existing bearer authentication and same-origin HTTP stream. No token in URLs or persistent credentials. */
@Injectable()
export class BattleStream implements OnModuleDestroy {
 private destroyed=false;private clients=new Set<Client>();private sweeping=false;private sweeper:ReturnType<typeof setInterval>;private timers=new Map<string,{at:number;timer:ReturnType<typeof setTimeout>}>();
 constructor(private readonly battles:BattleService,private readonly auth:AuthService){this.battles.events.on('change',this.changed);this.sweeper=setInterval(()=>{if(this.sweeping||this.destroyed)return;this.sweeping=true;void this.battles.sweep().catch(()=>{}).finally(()=>{this.sweeping=false;});},1000);this.sweeper.unref();}
 private changed=(users:string[])=>{for(const c of this.clients)if(users.includes(c.user))void this.send(c);};
 private arm(d:Awaited<ReturnType<BattleService['act']>>){
  if(this.destroyed)return;const now=Date.now(),due=d.grace?.end||(d.status==='pending'?d.expiresAt:d.status==='playing'?(d.start!>now?d.start!:Math.min(d.deadline!,d.botAt||d.deadline!)):d.status==='between'?d.result!.at+Math.max(4000,d.result!.presentationMs||((d.result!.events.length||1)*2200+1200)):d.status==='ready'?d.preparationDeadline:0),previous=this.timers.get(d.id);
  if(!due){if(previous)clearTimeout(previous.timer);this.timers.delete(d.id);return;}
  if(previous?.at===due)return;if(previous)clearTimeout(previous.timer);
  this.timers.set(d.id,{at:due,timer:setTimeout(()=>{this.timers.delete(d.id);const clients=[...this.clients].filter(x=>x.match===d.id);if(clients.length){for(const c of clients)void this.send(c);}else if(d.practice){void this.battles.tickPractice(d.id).then(next=>{if(next)this.arm(next);}).catch(()=>this.battles.markPracticeUncertain(d.id));}},Math.max(50,due-now+10))});
 }
 private async send(c:Client){if(c.closed||c.res.destroyed)return;if(c.busy){c.dirty=true;return;}c.busy=true;try{
  const who=await this.auth.authenticate(c.token);if(!who||who.userId!==c.user){c.res.write('event: auth\ndata: {}\n\n');c.close();return;}
  if(c.legacySessionId)await this.battles.touchLegacyLobby(c.user,c.legacySessionId);
  // Site scope: invitation inbox only (the tab renews its own lease); match play stays on the island stream.
  if(c.site){const state=await this.battles.invitationState(c.user);if(!c.closed)c.res.write('event: invitations\ndata: '+JSON.stringify(state)+'\n\n');return;}
  const state=await this.battles.invitationState(c.user);if(c.closed)return;c.res.write('event: invitations\ndata: '+JSON.stringify(state)+'\n\n');
  const d=await this.battles.live(c.user,c.match);if(c.closed)return;
  if(d){if(c.match!==d.id||c.lastRevision<d.revision){c.match=d.id;c.lastRevision=d.revision;c.res.write('event: snapshot\ndata: '+JSON.stringify(d)+'\n\n');}
   c.practice=!!d.practice;this.arm(d);

  }else{c.match=null;c.res.write('event: waiting\ndata: {}\n\n');}
 }catch{if(!c.closed)c.res.write('event: server-error\ndata: {"retryable":true}\n\n');}finally{c.busy=false;if(c.dirty&&!c.closed){c.dirty=false;void this.send(c);}}}
 open(user:string,token:string,req:Request,res:Response,sessionId?:string,legacySessionId?:string){if(this.destroyed){res.status(503).end();return;}res.status(200);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','private, no-store, no-transform');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();res.write(': connected\n\n');const c:Client={legacySessionId,user,token,res,busy:false,dirty:false,closed:false,lastRevision:0,match:null,practice:false,wake:null,close:()=>{if(c.closed)return;c.closed=true;clearInterval(heartbeat);this.clients.delete(c);this.battles.connected(user,false);if(sessionId&&!this.destroyed)void this.battles.suspend(user,sessionId).catch(()=>{});if(!res.destroyed)res.end();if(c.match){const id=c.match;if(!c.practice&&![...this.clients].some(x=>x.match===id)){const t=this.timers.get(id);if(t)clearTimeout(t.timer);this.timers.delete(id);if(!this.destroyed)void this.battles.disconnected(id).catch(()=>{});}setTimeout(()=>{for(const x of this.clients)if(x.match===id)void this.send(x);},5100).unref();}}};this.clients.add(c);this.battles.connected(user,true);req.on('close',c.close);res.on('error',c.close);const heartbeat=setInterval(()=>{if(c.closed)return;if(res.destroyed){c.close();return;}if(res.writableLength>256*1024){c.close();return;}res.write(': heartbeat\n\n');void this.send(c);},15000);void this.send(c);}
 // One per signed-in tab outside the island. Never counted as a match connection, never removes the tab lease on close
 // (the island may take over in the same tab); the lease ends by explicit suspend or by expiry.
 openSite(user:string,token:string,req:Request,res:Response,sessionId:string){if(this.destroyed){res.status(503).end();return;}res.status(200);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','private, no-store, no-transform');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();res.write(': connected\n\n');const c:Client={site:{sessionId},user,token,res,busy:false,dirty:false,closed:false,lastRevision:0,match:null,practice:false,wake:null,close:()=>{if(c.closed)return;c.closed=true;clearInterval(heartbeat);this.clients.delete(c);if(!res.destroyed)res.end();}};this.clients.add(c);req.on('close',c.close);res.on('error',c.close);const heartbeat=setInterval(()=>{if(c.closed)return;if(res.destroyed){c.close();return;}if(res.writableLength>256*1024){c.close();return;}res.write(': heartbeat\n\n');void this.send(c);},10000);void this.send(c);}
 onModuleDestroy(){this.destroyed=true;clearInterval(this.sweeper);this.battles.events.off('change',this.changed);for(const c of this.clients)c.close();for(const t of this.timers.values())clearTimeout(t.timer);this.timers.clear();}
}
