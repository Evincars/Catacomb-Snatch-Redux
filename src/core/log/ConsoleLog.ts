import { Log, LogLevel } from './Log';
import type { LogEntry } from './Log';

type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error';

const METHODS = {
  [LogLevel.Debug]: 'debug',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.Silent]: 'debug',
} satisfies Record<LogLevel, ConsoleMethod>;

/** Prints entries to the browser (or Node) console, tagged with the subsystem that wrote them. */
export class ConsoleLog extends Log {
  protected write(entry: LogEntry): void {
    const line = `[${entry.scope}] ${entry.message}`;
    const extras: unknown[] = [];
    if (entry.context) extras.push(entry.context);
    if (entry.error !== undefined) extras.push(entry.error);
    console[METHODS[entry.level]](line, ...extras);
  }
}
