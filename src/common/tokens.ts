/** Dependency-injection tokens for values that are not classes. */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const CLOCK = Symbol('CLOCK');

/** All business time comes from this clock (tests replace it). SQL never uses now() for business decisions. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
