import pino from 'pino';
export type LogFields = Readonly<Record<string, unknown>>;
export type Logger = {
  info: (fields: LogFields, message: string) => void;
  warn: (fields: LogFields, message: string) => void;
  error: (fields: LogFields, message: string) => void;
  child: (fields: LogFields) => Logger;
};
export function createLogger({
  service,
  level = 'info',
  appVersion = 'development',
  gitCommit = 'unknown',
  destination,
}: {
  service: string;
  level?: string;
  appVersion?: string;
  gitCommit?: string;
  destination?: { write: (text: string) => void };
}): Logger {
  const options = {
    level,
    base: { service, appVersion, gitCommit },
    redact: {
      paths: [
        'password',
        'token',
        'secret',
        'authorization',
        'cookie',
        'DATABASE_URL',
        'REDIS_URL',
        '*.password',
        '*.token',
        '*.secret',
        '*.authorization',
        '*.cookie',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  };
  const instance = destination ? pino(options, destination) : pino(options);
  const wrap = (logger: pino.Logger): Logger => ({
    info: (fields, message) => logger.info(fields, message),
    warn: (fields, message) => logger.warn(fields, message),
    error: (fields, message) => logger.error(fields, message),
    child: (fields) => wrap(logger.child(fields)),
  });
  return wrap(instance);
}
