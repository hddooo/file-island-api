import {createHash} from 'node:crypto';
import type {AuthContext} from '../auth/guards';
/** Older tabs have no per-tab key. Keep their shared lease separate from all v4 tab keys.
 * Authenticated user + login session scope only; never derived from an untrusted header/body.
 * Its cleanup is TTL-only, since one old tab cannot identify another old tab sharing the login.
 */
export function legacyLobbySessionId(auth:AuthContext){
 const bytes=createHash('sha256').update('hanq:battle-legacy:v1:'+auth.userId+':'+auth.sessionId).digest().subarray(0,16);
 bytes[6]=(bytes[6]&0x0f)|0x80;bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
