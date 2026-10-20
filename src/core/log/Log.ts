/** Severity of a log entry; entries below a sink's threshold are dropped before they are built. */
export const LogLevel = {
  Debug: 0,
  Info: 1,
  Warn: 2,
  Error: 3,
  Silent: 4,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export type LogContext = Readonly<Record<string, unknown>>;

/** One message as a sink receives it: everything needed to print it, store it or ship it elsewhere. */
export type LogEntry = {
  level: LogLevel;
  /** Subsystem that wrote it ('ai', 'network', 'assets'...). */
  scope: string;
  message: string;
  context?: LogContext;
  error?: unknown;
  /** Milliseconds since the page opened, as `performance.now()` reports them. */
  time: number;
};

/**
 * Template for every log sink. Subclasses decide only where an entry goes (`write`); filtering by level
 * and building the entry happen here, so a `ServerLog` or `MemoryLog` is a single method away:
 *
 * ```ts
 * class ServerLog extends Log {
 *   protected write(entry: LogEntry): void { void fetch('/log', { method: 'POST', body: JSON.stringify(entry) }); }
 * }
 * useLog(new ServerLog(LogLevel.Warn));
 * ```
 */
export abstract class Log {
  constructor(private threshold: LogLevel = LogLevel.Debug) {}

  get level(): LogLevel {
    return this.threshold;
  }

  setLevel(level: LogLevel): void {
    this.threshold = level;
  }

  enabled(level: LogLevel): boolean {
    return level >= this.threshold && this.threshold !== LogLevel.Silent;
  }

  debug(scope: string, message: string, context?: LogContext): void {
    this.emit(LogLevel.Debug, scope, message, undefined, context);
  }

  info(scope: string, message: string, context?: LogContext): void {
    this.emit(LogLevel.Info, scope, message, undefined, context);
  }

  warn(scope: string, message: string, context?: LogContext): void {
    this.emit(LogLevel.Warn, scope, message, undefined, context);
  }

  error(scope: string, message: string, error?: unknown, context?: LogContext): void {
    this.emit(LogLevel.Error, scope, message, error, context);
  }

  /** Delivers one entry to wherever this sink keeps its messages. */
  protected abstract write(entry: LogEntry): void;

  private emit(level: LogLevel, scope: string, message: string, error?: unknown, context?: LogContext): void {
    if (!this.enabled(level)) return;
    this.write({ level, scope, message, error, context, time: performance.now() });
  }
}
