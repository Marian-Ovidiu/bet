import { loadConfig } from "@/config/loadConfig";
import { createSessionDiagnostics } from "@/diagnostics/sessionDiagnostics";
import { createLogger, withLogContext } from "@/utils/logger";

function bootstrap(): void {
  const config = loadConfig();
  const logger = createLogger(config);
  const nowIso = new Date().toISOString();
  const sessionId = `session-${Date.now()}`;
  const diagnostics = createSessionDiagnostics(sessionId, nowIso);

  logger.info(
    withLogContext("bootstrap", {
      configLoadedAt: config.loadedAt,
      sessionId: diagnostics.sessionId,
      startedAt: diagnostics.startedAt,
    }),
    "Arbitrage scanner architecture initialized in paper mode",
  );
}

bootstrap();
