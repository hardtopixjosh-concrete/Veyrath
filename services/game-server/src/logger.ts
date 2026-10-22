export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function isLogLevel(value: string): value is LogLevel {
  return value in ORDER;
}

function format(level: string, message: string, fields?: LogFields): string {
  let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) line += ` ${key}=${value}`;
    }
  }
  return line;
}

/** Plain single-line logs (`<time> <LEVEL> message key=value ...`), easy to grep and diff. */
export function createLogger(level: LogLevel, sink: (line: string) => void = console.log): Logger {
  const enabled = (l: LogLevel): boolean => ORDER[l] >= ORDER[level];
  const make =
    (l: Exclude<LogLevel, 'silent'>) =>
    (message: string, fields?: LogFields): void => {
      if (enabled(l)) sink(format(l, message, fields));
    };
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
}

export const silentLogger: Logger = createLogger('silent');
