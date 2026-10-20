import { ConsoleLog } from './ConsoleLog';
import { Log, LogLevel } from './Log';
import type { LogContext } from './Log';

export { Log, LogLevel } from './Log';
export type { LogContext, LogEntry } from './Log';
export { ConsoleLog } from './ConsoleLog';

/** Chatty while developing, informational and up in production builds. */
function defaultLevel(): LogLevel {
  return import.meta.env?.DEV ? LogLevel.Debug : LogLevel.Info;
}

let sink: Log = new ConsoleLog(defaultLevel());

/** Replaces where every module's log messages go, e.g. with a ServerLog; takes effect at once everywhere. */
export function useLog(log: Log): void {
  sink = log;
}

export function activeLog(): Log {
  return sink;
}

/** A module's handle on the log: fixes its scope and always writes to the sink installed right now. */
export type ScopedLog = {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
};

export function createLog(scope: string): ScopedLog {
  return {
    debug: (message, context) => sink.debug(scope, message, context),
    info: (message, context) => sink.info(scope, message, context),
    warn: (message, context) => sink.warn(scope, message, context),
    error: (message, error, context) => sink.error(scope, message, error, context),
  };
}
