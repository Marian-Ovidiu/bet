import { loadConfig } from "@/config/loadConfig";
import {
  buildSessionSummary,
  createSessionDiagnostics,
  incrementPaperTradesOpened,
  recordOpportunity,
} from "@/diagnostics/sessionDiagnostics";
import { createLogger, withLogContext } from "@/utils/logger";

function runPaperSession(): void {
  const config = loadConfig();
  const logger = createLogger(config);

  const startedAt = new Date().toISOString();
  const sessionId = `paper-${Date.now()}`;
  let diagnostics = createSessionDiagnostics(sessionId, startedAt);

  diagnostics = recordOpportunity(diagnostics, 1.8, new Date().toISOString());
  diagnostics = incrementPaperTradesOpened(diagnostics, new Date().toISOString());

  const summary = buildSessionSummary(diagnostics, new Date().toISOString());

  logger.info(
    withLogContext("paper-session", {
      sessionId,
      summary,
    }),
    "Paper session summary generated",
  );
}

runPaperSession();
