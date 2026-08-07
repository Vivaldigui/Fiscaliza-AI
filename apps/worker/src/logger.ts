export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const priority: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export class StructuredLogger {
  constructor(private readonly minimumLevel: LogLevel) {}

  error(message: string, context: Record<string, unknown> = {}): void {
    this.write('error', message, context);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.write('warn', message, context);
  }

  info(message: string, context: Record<string, unknown> = {}): void {
    this.write('info', message, context);
  }

  debug(message: string, context: Record<string, unknown> = {}): void {
    this.write('debug', message, context);
  }

  private write(level: LogLevel, message: string, context: Record<string, unknown>): void {
    if (priority[level] > priority[this.minimumLevel]) return;
    const output = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: 'document-worker',
      message,
      ...context,
    });
    (level === 'error' ? process.stderr : process.stdout).write(`${output}\n`);
  }
}
