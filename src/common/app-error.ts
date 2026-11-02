import { HttpException } from '@nestjs/common';

/** API error with a stable machine code. The message is a fixed, safe sentence (never user input or internals). */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = () => new AppError(404, 'not_found', 'Not found');
export const unauthorized = (code = 'unauthorized') => new AppError(401, code, 'Authentication required');
export const premiumRequired = () => new AppError(403, 'premium_required', 'An active premium pass is required for this action');
