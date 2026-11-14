import { AppError } from '../common/app-error';

/** Integer comparisons avoid promoting a rounded percentage across an XP boundary. */
export function sourceAttemptXp(correct: number, total: number): 0 | 1 | 5 | 10 {
  if (!Number.isSafeInteger(total) || total < 1 || total > 200 || !Number.isSafeInteger(correct) || correct < 0 || correct > total) {
    throw new AppError(400, 'invalid_source_attempt', 'Invalid full quiz attempt');
  }
  return correct * 100 >= total * 80 ? 10 : correct * 100 >= total * 70 ? 5 : correct * 100 >= total * 60 ? 1 : 0;
}
