import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArbitrageOpportunity } from "@/types/arbitrage";
import type { PaperTrade } from "@/types/paper";

export interface ScannerOutputPaths {
  outputDir: string;
  sessionSummaryFile: string;
  tradeLogFile: string;
  bestOpportunityFile: string;
}

export interface ScannerSessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  outputDir: string;
  tradeLogFile: string;
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
  totalGrossProfit: number;
  totalCommissionPaid: number;
  realizedPaperPnl: number;
  maxOpenExposure: number;
  avgProfitPerTrade: number;
  bestTrade: PaperTrade | null;
  worstTrade: PaperTrade | null;
  partialFillRate: number;
  unmatchedRiskRate: number;
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

export function createScannerOutput(sessionId: string): ScannerOutputPaths {
  const outputDir = path.join(process.cwd(), "output", "scanner", sessionId);
  mkdirSync(outputDir, { recursive: true });

  const paths = {
    outputDir,
    sessionSummaryFile: path.join(outputDir, "session_summary.json"),
    tradeLogFile: path.join(outputDir, "paper_trades.jsonl"),
    bestOpportunityFile: path.join(outputDir, "best_opportunity.json"),
  };

  writeFileSync(paths.tradeLogFile, "", { encoding: "utf-8", flag: "w" });
  return paths;
}

export function appendPaperTradeLog(tradeLogFile: string, trade: PaperTrade): void {
  const json = JSON.stringify(trade);
  if (typeof json !== "string") {
    throw new Error("Paper trade log append failed: trade is not JSON serializable");
  }

  appendFileSync(tradeLogFile, `${json}\n`, { encoding: "utf-8", flag: "a" });
}

export async function writeSessionSummary(
  summary: ScannerSessionSummary,
  bestOpportunity: ArbitrageOpportunity | null,
): Promise<string> {
  const sessionSummaryFile = path.join(summary.outputDir, "session_summary.json");
  writeJsonFile(sessionSummaryFile, summary);

  if (bestOpportunity) {
    writeJsonFile(path.join(summary.outputDir, "best_opportunity.json"), bestOpportunity);
  }

  return sessionSummaryFile;
}

function writeJsonFile(filePath: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  if (typeof json !== "string") {
    throw new Error(`JSON write failed for ${filePath}: value is not JSON serializable`);
  }

  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${json}\n`, "utf-8");
  renameSync(tempPath, filePath);
}
