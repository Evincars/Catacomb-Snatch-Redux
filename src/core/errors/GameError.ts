/**
 * Every failure the game raises on purpose is a GameError with a machine-readable `code`, so callers
 * branch on `error.code` (or `instanceof` a subclass) instead of parsing messages, and the log gets
 * structured context instead of string concatenation.
 */
export type ErrorCode =
  /** Data that does not have the shape it must have: saves, network packets, map files. */
  | 'invalid-data'
  /** Something that should be there could not be fetched or decoded: art, sound, a level. */
  | 'load-failed'
  /** The peer-to-peer link failed, or the other side broke the protocol. */
  | 'network'
  /** The program reached a state it must never be in (a scene that was never registered...). */
  | 'invalid-state'
  /** Not ours: something thrown by a library or the browser, wrapped on the way in. */
  | 'unexpected';

export type ErrorContext = Readonly<Record<string, unknown>>;

export class GameError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, message: string, options: { cause?: unknown; context?: ErrorContext } = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.context = options.context ?? {};
  }
}

export class ValidationError extends GameError {
  constructor(message: string, context?: ErrorContext) {
    super('invalid-data', message, { context });
  }
}

export class LoadError extends GameError {
  constructor(message: string, options: { cause?: unknown; context?: ErrorContext } = {}) {
    super('load-failed', message, options);
  }
}

export class NetworkError extends GameError {
  constructor(message: string, options: { cause?: unknown; context?: ErrorContext } = {}) {
    super('network', message, options);
  }
}

export class StateError extends GameError {
  constructor(message: string, context?: ErrorContext) {
    super('invalid-state', message, { context });
  }
}

/** Turns anything that was thrown into a GameError, keeping the original as `cause`. */
export function toGameError(thrown: unknown, code: ErrorCode = 'unexpected'): GameError {
  if (thrown instanceof GameError) return thrown;
  if (thrown instanceof Error) return new GameError(code, thrown.message, { cause: thrown });
  return new GameError(code, String(thrown), { cause: thrown });
}

/** A message fit to show a player. */
export function errorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** Throws a ValidationError unless `condition` holds; narrows like an assertion. */
export function ensure(condition: unknown, message: string, context?: ErrorContext): asserts condition {
  if (!condition) throw new ValidationError(message, context);
}
