import{cbtFirstRoundReward}from'../cbt/cbt-policy';
import { CBT_SIZE, CBT_TOTAL_POINTS, cbtReward } from '../cbt/cbt-policy';
import { studyReward } from '../wrong-notes/study-policy';

/** Final exam result shown next to a growth reward/deduction. Read from what the server already persisted when it graded
 *  the run (hanq.runs.score for a wrong-note challenge, hanq.cbt_runs.result for an official-round CBT run); never inferred.
 *  score is out of maxScore (always 100 for both kinds); correct/total are question counts. */
export interface ExamResult { score: number; maxScore: number; correct: number; total: number }

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const int = (x: unknown, min: number, max: number): x is number => Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max;

/** hanq.runs.score of a FINAL wrong-note-study challenge run (RunsService finalize): questions/correct counts, examScore =
 *  round(correct·100/questions), growthReward = studyReward(examScore), rewardEligible = true. Every field must agree with
 *  the others and with the ledger amount; otherwise the stored value is not trusted and null is returned. */
export function studyExamResult(score: unknown, amount: number): ExamResult | null {
  if (!isObj(score)) return null;
  const { questions, correct, examScore, growthReward, rewardEligible } = score;
  if (!int(questions, 1, 50) || !int(correct, 0, questions) || !int(examScore, 0, 100)) return null;
  if (examScore !== Math.round((correct * 100) / questions)) return null;
  if(score.growthPolicy==='per-question-original-points'){const earned=score.growthEarnedPoints,lost=score.growthLostPoints,raw=score.policyGrowthReward;if(rewardEligible!==true||!int(earned,0,150)||!int(lost,0,150)||raw!==earned-lost||!int(growthReward,-150,150)||growthReward!==amount||(Number(raw)>=0?growthReward!==raw:growthReward<Number(raw)||growthReward>0))return null;}else if (rewardEligible !== true || growthReward !== studyReward(examScore) || growthReward !== amount) return null;
  return { score: examScore, maxScore: 100, correct, total: questions };
}

/** hanq.cbt_runs.result of a FINAL CBT run (cbt-policy resultOf): weighted score out of maxScore = 100 over 50 questions,
 *  growthReward = cbtReward(score). Same rule: inconsistent or out-of-range data → null, never a guessed score. */
export function cbtExamResult(result: unknown, amount: number): ExamResult | null {
  if (!isObj(result)) return null;
  const { score, maxScore, correct, total, growthReward } = result;
  if (maxScore !== CBT_TOTAL_POINTS || total !== CBT_SIZE || !int(score, 0, CBT_TOTAL_POINTS) || !int(correct, 0, CBT_SIZE)) return null;
  if ((correct === 0 && score !== 0) || (correct === CBT_SIZE && score !== CBT_TOTAL_POINTS)) return null;
  if(result.growthPolicy==='round-first-score-bands-v1'){const raw=result.policyGrowthReward;if(typeof result.rewardEligible!=='boolean'||raw!==(result.rewardEligible?cbtFirstRoundReward(score):0)||growthReward!==amount||!int(growthReward,-10,10)||(Number(raw)>=0?growthReward!==raw:growthReward<Number(raw)||growthReward>0))return null;}else if(result.growthPolicy==='per-question-original-points'){const raw=result.policyGrowthReward,answeredPoints=result.growthAnsweredPoints;if(!int(answeredPoints,score,100)||raw!==2*score-answeredPoints||!int(growthReward,-100,100)||growthReward!==amount||(Number(raw)>=0?growthReward!==raw:growthReward<Number(raw)||growthReward>0))return null;}else if (growthReward !== cbtReward(score) || growthReward !== amount) return null;
  return { score, maxScore: CBT_TOTAL_POINTS, correct, total: CBT_SIZE };
}
