import type { SessionSummary } from "@/types/diagnostics";

export interface SessionReporter {
  writeSummary(summary: SessionSummary): Promise<void>;
}
