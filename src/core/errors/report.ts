import { createLog } from '../log';
import { toGameError } from './GameError';
import type { GameError } from './GameError';

const log = createLog('error');

/** Logs a failure with its code and context, and hands back the normalised error. */
export function report(thrown: unknown, message: string, scope = 'error'): GameError {
  const error = toGameError(thrown);
  const target = scope === 'error' ? log : createLog(scope);
  target.error(message, error, { code: error.code, ...error.context });
  return error;
}

/** Fire-and-forget promises still get their failures logged instead of vanishing. */
export function reportRejection(promise: Promise<unknown>, message: string, scope?: string): void {
  promise.catch((thrown: unknown) => report(thrown, message, scope));
}

let installed = false;

/**
 * Last line of defence: anything thrown outside a handler (a Pixi ticker callback, a PeerJS event,
 * a forgotten promise) is logged once with its stack instead of failing silently.
 */
export function installGlobalErrorHandlers(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (event) => {
    report(event.error ?? event.message, 'Uncaught error');
  });
  target.addEventListener('unhandledrejection', (event) => {
    report(event.reason, 'Unhandled promise rejection');
  });
}
