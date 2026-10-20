import { toGameError } from './GameError';
import type { ErrorCode, GameError } from './GameError';

/**
 * The outcome of an operation that can fail in an expected way. Failure is a value, so the compiler
 * makes the caller deal with it, and nothing unwinds through the game loop.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = GameError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Runs `action`, catching whatever it throws as a GameError. */
export function attempt<T>(action: () => T, code?: ErrorCode): Result<T> {
  try {
    return ok(action());
  } catch (thrown) {
    return err(toGameError(thrown, code));
  }
}

/** Awaits `action`, catching a throw or a rejection as a GameError. */
export async function attemptAsync<T>(action: () => Promise<T>, code?: ErrorCode): Promise<Result<T>> {
  try {
    return ok(await action());
  } catch (thrown) {
    return err(toGameError(thrown, code));
  }
}

/** The value, or `fallback` when the operation failed. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** The value; rethrows the error. For call sites where failure is truly exceptional. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

export function mapResult<T, U, E>(result: Result<T, E>, map: (value: T) => U): Result<U, E> {
  return result.ok ? ok(map(result.value)) : result;
}
