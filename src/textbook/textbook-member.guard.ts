import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthContext } from '../auth/guards';
import { AppError, unauthorized } from '../common/app-error';

export const textbookUnavailable = () => new AppError(503, 'textbook_unavailable', 'Private textbook is not configured');

/** Runs after JWT/live-session authentication. Every authenticated member may read; no role or premium pass is required. */
@Injectable()
export class TextbookMemberGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    const auth = http.getRequest<Request & { auth?: AuthContext }>().auth;
    if (!auth) throw unauthorized();
    return true;
  }
}
