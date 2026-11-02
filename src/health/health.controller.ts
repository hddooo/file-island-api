import type {Response} from 'express';
import { Controller, Get, HttpException, Res } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  /** Liveness + database reachability. No versions, hosts or counts. */
  @Get()
  async health() {
    const ok = await this.db.ping();
    if (!ok) throw new HttpException({ code: 'unavailable' }, 503);
    return { status: 'ok' };
  }
  /** Short, bounded transport probe: same public health value, no user data or database writes. */
  @Get('stream')
  stream(@Res()res:Response){res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-store, no-transform');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();res.write('event: health\ndata: {"status":"ok","step":1}\n\n');const job=setTimeout(()=>{if(!res.destroyed){res.write('event: health\ndata: {"status":"ok","step":2}\n\n');res.end();}},400);res.on('close',()=>clearTimeout(job));}
}
