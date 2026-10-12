import { inspect } from 'node:util';
import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { logs, SeverityNumber, type Logger } from '@opentelemetry/api-logs';

const SEVERITY: Record<LogLevel, [SeverityNumber, string]> = {
  verbose: [SeverityNumber.TRACE, 'TRACE'],
  debug: [SeverityNumber.DEBUG, 'DEBUG'],
  log: [SeverityNumber.INFO, 'INFO'],
  warn: [SeverityNumber.WARN, 'WARN'],
  error: [SeverityNumber.ERROR, 'ERROR'],
  fatal: [SeverityNumber.FATAL, 'FATAL'],
};

const text = (message: unknown): string =>
  typeof message === 'string' ? message : message instanceof Error ? message.message : inspect(message);

/**
 * The server's console logger, which also emits every line as an OpenTelemetry log record.
 * Records carry the active span's trace_id and span_id, so a log line links to its trace.
 */
export class OtelBridgeLogger extends ConsoleLogger {
  private readonly otel: Logger = logs.getLogger('darkbeacon');

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    super.printMessages(messages, context, logLevel, writeStreamType, errorStack, params);
    const [severityNumber, severityText] = SEVERITY[logLevel];
    for (const message of messages) {
      this.otel.emit({
        severityNumber,
        severityText,
        body: text(message),
        attributes: {
          ...(context ? { 'logger.name': context } : {}),
          ...(typeof errorStack === 'string' ? { 'exception.stacktrace': errorStack } : {}),
        },
      });
    }
  }
}
