import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error';

const STATUS_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

/** PostgreSQL SQLSTATEs for a schema older than the code: 42P01 undefined_table, 42703 undefined_column. */
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703']);

/** Single error shape: { error: { code, message, details? } }. Internal errors are redacted (no SQL, stack or input). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = toBody(exception);
    if (status >= 500) {
      const e = exception as { name?: unknown; code?: unknown };
      // Only the error class and driver code: no message bodies (they can echo values), no request data.
      this.logger.error(`unhandled ${String(e?.name ?? 'error')}${e?.code ? ' code=' + String(e.code) : ''}`);
    }
    if (!res.headersSent) res.status(status).json(body);
  }
}

export function toBody(exception: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (exception instanceof AppError) {
    const r = exception.getResponse() as { code: string; message: string; details?: unknown };
    return { status: exception.getStatus(), body: { error: { code: r.code, message: r.message, ...(r.details ? { details: r.details } : {}) } } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'http_error');
    const r = exception.getResponse();
    let details: unknown;
    if (status === 400 && typeof r === 'object' && r && Array.isArray((r as { message?: unknown }).message)) {
      details = { fields: ((r as { message: unknown[] }).message).filter((m) => typeof m === 'string').slice(0, 20) };
    }
    const message = status === 429 ? 'Too many requests, slow down' : status === 404 ? 'Not found' : status === 400 ? 'Invalid request' : 'Request failed';
    return { status, body: { error: { code, message, ...(details ? { details } : {}) } } };
  }
  // A deploy ran ahead of its migration (undefined_table / undefined_column): a temporary 503, never the table or column name.
  const pgCode = (exception as { code?: unknown } | null)?.code;
  if (typeof pgCode === 'string' && MISSING_SCHEMA_CODES.has(pgCode)) {
    return { status: 503, body: { error: { code: 'schema_not_ready', message: 'Service is not ready, try again shortly' } } };
  }
  return { status: 500, body: { error: { code: 'internal_error', message: 'Internal error' } } };
}
