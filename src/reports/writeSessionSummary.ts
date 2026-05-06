import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ScannerSessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  ticks: number;
  marketsScanned: number;
  opportunitiesFound: number;
  rejectedByLiquidity: number;
  rejectedByStaleData: number;
  rejectedByLowEdge: number;
  avgNetEdgePct: number;
  paperTradesOpened: number;
  paperTradesRejected: number;
  partialFills: number;
  unmatchedRiskEvents: number;
  startingBalance: number;
  endingBalance: number;
  realizedPaperPnl: number;
  maxOpenExposure: number;
  bestOpportunity: {
    id: string;
    eventId: string;
    eventName: string;
    marketType: string;
    selection: string;
    netEdgePct: number;
    estimatedProfit: number;
    detectedAt: string;
  } | null;
  configSnapshot: Record<string, unknown>;
}

export async function writeSessionSummary(summary: ScannerSessionSummary): Promise<string> {
  const outputDir = path.join(process.cwd(), "reports");
  await mkdir(outputDir, { recursive: true });

  const fileName = `scanner-session-${summary.sessionId}.json`;
  const filePath = path.join(outputDir, fileName);
  const json = JSON.stringify(summary, null, 2);

  await writeFile(filePath, json, "utf-8");
  return filePath;
}
