/**
 * Structured logger: one JSON line per event, parseable by any log shipper.
 * Level ordering makes filtering trivial (debug < info < warn < error).
 */

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error"
}

export interface LogContext {
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40
};

export interface StructuredLoggerOptions {
  minLevel?: LogLevel;
  service?: string;
  instance?: string;
}

export class StructuredLogger {
  private readonly minLevel: LogLevel;
  private readonly service: string;
  private readonly instance: string;

  constructor(options: StructuredLoggerOptions = {}) {
    this.minLevel = options.minLevel ?? LogLevel.INFO;
    this.service = options.service ?? "websocket-server";
    this.instance = options.instance ?? `instance-${process.pid}`;
  }

  debug(message: string, context?: LogContext): void {
    this.write(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write(LogLevel.WARN, message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write(LogLevel.ERROR, message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      instance: this.instance,
      message,
      ...context
    };

    const line = JSON.stringify(entry);
    if (level === LogLevel.ERROR) {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }
}

/** Process-wide default logger; modules may create their own with a custom level. */
export const logger = new StructuredLogger();
