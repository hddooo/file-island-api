import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { HISTORY81_PDF } from './history81-quiz';
import { History81Service } from './history81.service';
import { TextbookService } from './textbook.service';
import { SourceAttemptRepository } from './source-attempt-repository';
import { sourceAttemptXp } from './source-attempt-score';
import { sourceGrade, sourceSlots, type GradingVersion, type SourceItem } from './source-blank-progress';

export type FullSourceAttempt = {
  attemptId: string;
  mode: 'full';
  status: 'completed';
  version: string;
  gradingVersion: GradingVersion;
  responses: { itemId: string; values: string[] }[];
};
const invalid = () => new AppError(400, 'invalid_source_attempt', 'Invalid full quiz attempt');
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exactKeys = (value: object, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

function validateSubmission(body: FullSourceAttempt) {
  if (!body || !exactKeys(body, ['attemptId', 'mode', 'status', 'version', 'gradingVersion', 'responses']) ||
      body.mode !== 'full' || body.status !== 'completed' || typeof body.version !== 'string' || !/^[0-9a-f]{64}$/.test(body.version) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.attemptId || '') ||
      (body.gradingVersion !== 1 && body.gradingVersion !== 2) || !Array.isArray(body.responses) ||
      body.responses.length < 1 || body.responses.length > 200) throw invalid();
  const responses = new Map<string, string[]>();
  for (const response of body.responses) {
    if (!response || !exactKeys(response, ['itemId', 'values']) || typeof response.itemId !== 'string' || response.itemId.length < 1 || response.itemId.length > 200 || responses.has(response.itemId) ||
        !Array.isArray(response.values) || response.values.length < 1 || response.values.length > 30 || response.values.some(value => typeof value !== 'string' || value.length > 2000 || !value.normalize('NFC').replace(/\s+/g, ''))) throw invalid();
    responses.set(response.itemId, response.values);
  }
  return responses;
}

/** Completion is independent from the practice workspace's permissive completed flag. */
export function gradeFullSourceAttempt(items: SourceItem[], version: string, body: FullSourceAttempt) {
  const responses = validateSubmission(body);
  if (body.version !== version || items.length < 1 || items.length > 200 || responses.size !== items.length || new Set(items.map(item => item.id)).size !== items.length) throw invalid();
  const canonical = items.map(item => {
    const values = responses.get(item.id), slots = sourceSlots(item);
    if (item.verification.status !== 'source-verified' || !['blank', 'fill-in', 'sequence', 'classification'].includes(item.kind) ||
        !values || !slots.length || slots.length > 30 || values.length !== slots.length) throw invalid();
    return { itemId: item.id, values: [...values], correct: sourceGrade(item, values, body.gradingVersion, version) };
  });
  const correct = canonical.filter(response => response.correct).length;
  return { correct, total: items.length, xpAward: sourceAttemptXp(correct, items.length), canonical };
}

@Injectable()
export class SourceAttemptService {
  constructor(private readonly repository: SourceAttemptRepository, private readonly textbook: TextbookService, private readonly history: History81Service) {}

  private async source(id: string, sourceRevision?: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw invalid();
    if (sourceRevision === HISTORY81_PDF && ['joseon', 'goryeo', 'opening'].includes(id)) {
      const quiz = await this.history.quiz(sourceRevision, id);
      return { items: quiz.items, version: quiz.version };
    }
    const selected = sourceRevision === undefined ? this.textbook : await this.textbook.forRevision(sourceRevision);
    const quiz = await selected.semanticQuiz(id) as Record<string, unknown>;
    return { items: quiz.items as SourceItem[], version: digest({ schema: quiz.schemaVersion, source: quiz.source, items: quiz.items }) };
  }

  async complete(userId: string, id: string, body: FullSourceAttempt, sourceRevision?: string) {
    const responses = validateSubmission(body);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || (sourceRevision !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(sourceRevision))) throw invalid();
    const scope = { quizId: id, sourceVersion: body.version, gradingVersion: body.gradingVersion, sourceRevision: sourceRevision ?? 'current' };
    const attemptId = body.attemptId.toLowerCase();
    const canonical = [...responses].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([itemId, values]) => ({ itemId, values }));
    const payloadHash = Buffer.from(digest({ schema: 1, attemptId, scope, mode: body.mode, status: body.status, responses: canonical }), 'hex');
    // Immutable owned receipts remain replayable after the current source or grading policy changes.
    // No new score is accepted on this path: only an exact match to a previously graded request.
    const replay = await this.repository.replay(userId, attemptId, payloadHash);
    if (replay) return replay;
    const { items, version } = await this.source(id, sourceRevision);
    const result = gradeFullSourceAttempt(items, version, body);
    return this.repository.complete(userId, { attemptId, payloadHash, scope, correct: result.correct, total: result.total });
  }

  async list(userId: string, id: string, gradingVersion: GradingVersion, sourceRevision?: string) {
    const { version } = await this.source(id, sourceRevision);
    return this.repository.list(userId, { quizId: id, sourceVersion: version, gradingVersion, sourceRevision: sourceRevision ?? 'current' });
  }
}
