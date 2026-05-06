import pino, { type Logger, type LoggerOptions } from "pino";
import type { AppConfig } from "@/config/loadConfig";

export interface LogContext {
  module: string;
  timestamp: string;
  [key: string]: unknown;
}

export function createLogger(config: Pick<AppConfig, "nodeEnv" | "logLevel">): Logger {
  const options: LoggerOptions = {
    level: config.logLevel,
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  };

  if (config.nodeEnv === "development") {
    return pino(
      options,
      pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      }),
    );
  }

  return pino(options);
}

export function withLogContext(module: string, extra: Record<string, unknown> = {}): LogContext {
  return {
    module,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}
