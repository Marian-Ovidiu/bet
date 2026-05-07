import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TheOddsApiUsage } from "@/exchanges/TheOddsApiFeed";
import type { ArbitrageOpportunity, AllowedNearMiss, NearMissAlert } from "@/types/arbitrage";
import type { PaperTrade } from "@/types/paper";

export interface ScannerOutputPaths {
  outputDir: string;
  sessionSummaryFile: string;
  tradeLogFile: string;
  opportunitiesLogFile: string;
  backLayOpportunitiesLogFile: string;
  nearMissAlertsFile: string;
  realMarketsSampleFile: string;
  nearMissesFile: string;
  rejectedSummaryFile: string;
  bestOpportunityFile: string;
}

export interface ScannerSessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  outputDir: string;
  tradeLogFile: string;
  feedMode: "mock" | "real" | "mixed";
  provider: string;
  sportKey: string | null;
  apiRequests: number;
  apiFailures: number;
  eventsReceived: number;
  bookmakersReceived: number;
  marketsNormalized: number;
  selectionsNormalized: number;
  normalizedEvents: number;
  normalizedSelections: number;
  malformedPayloads: number;
  rejectedNormalizedMarkets: number;
  missingEventId: number;
  missingSelection: number;
  invalidOdds: number;
  duplicateOutcome: number;
  incompleteMarket: number;
  staleMarket: number;
  oddsApiUsage: TheOddsApiUsage | null;
  durationMs: number;
  ticks: number;
  marketsScanned: number;
  opportunitiesFound: number;
  rawOpportunitiesDetected: number;
  uniqueOpportunitiesFound: number;
  duplicateOpportunitiesSkipped: number;
  opportunityUpdatedCount: number;
  avgImpliedSum: number | null;
  minImpliedSum: number | null;
  bestAllowedNearMiss: AllowedNearMiss | null;
  avgAllowedImpliedSum: number | null;
  allowedCandidateCount: number;
  nearMissAlerts: number;
  strongNearMissAlerts: number;
  rejectedByLiquidity: number;
  rejectedByStaleData: number;
  rejectedByLowEdge: number;
  backLayCandidates: number;
  backLayOpportunities: number;
  rejectedBackLayBySpread: number;
  rejectedBackLayByQuoteSkew: number;
  backBackCandidates: number;
  rejectedByNoCompleteOutcomeSet: number;
  rejectedByImpliedSum: number;
  rejectedByUnsupportedMarketType: number;
  rejectedByQuoteSkew: number;
  rejectedByLiquidityDepth: number;
  skippedLayMarketsForBackBack: number;
  rejectedByBookmakerFilter: number;
  deniedBookmakerHits: number;
  allowedBookmakerOpportunities: number;
  avgNetEdgePct: number;
  avgQuoteSkewMs: number;
  maxQuoteSkewMs: number;
  avgExecutableStake: number;
  avgLiquidityCoverageRatio: number;
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
    quoteAgeSpreadMs: number | null;
    executableStake: number;
    liquidityCoverageRatio: number;
  } | null;
  bestSurebet: {
    id: string;
    eventId: string;
    eventName: string;
    marketType: string;
    impliedSum: number | null;
    netEdgePct: number;
    estimatedProfit: number;
    detectedAt: string;
    quoteAgeSpreadMs: number | null;
    executableStake: number;
    liquidityCoverageRatio: number;
  } | null;
  bestBackLayOpportunity: {
    id: string;
    eventId: string;
    eventName: string;
    marketType: string;
    selection: string;
    backExchange: string;
    layExchange: string;
    backOdds: number;
    layOdds: number;
    grossEdgePct: number;
    netEdgePct: number;
    estimatedProfit: number;
    detectedAt: string;
    quoteAgeSpreadMs: number | null;
    executableStake: number;
    liquidityCoverageRatio: number;
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
    opportunitiesLogFile: path.join(outputDir, "opportunities.jsonl"),
    backLayOpportunitiesLogFile: path.join(outputDir, "back_lay_opportunities.jsonl"),
    nearMissAlertsFile: path.join(outputDir, "near_miss_alerts.jsonl"),
    realMarketsSampleFile: path.join(outputDir, "real_markets_sample.json"),
    nearMissesFile: path.join(outputDir, "near_misses.json"),
    rejectedSummaryFile: path.join(outputDir, "rejected_summary.json"),
    bestOpportunityFile: path.join(outputDir, "best_opportunity.json"),
  };

  writeFileSync(paths.tradeLogFile, "", { encoding: "utf-8", flag: "w" });
  writeFileSync(paths.opportunitiesLogFile, "", { encoding: "utf-8", flag: "w" });
  writeFileSync(paths.backLayOpportunitiesLogFile, "", { encoding: "utf-8", flag: "w" });
  writeFileSync(paths.nearMissAlertsFile, "", { encoding: "utf-8", flag: "w" });
  return paths;
}

export function appendPaperTradeLog(tradeLogFile: string, trade: PaperTrade): void {
  const json = JSON.stringify(trade);
  if (typeof json !== "string") {
    throw new Error("Paper trade log append failed: trade is not JSON serializable");
  }

  appendFileSync(tradeLogFile, `${json}\n`, { encoding: "utf-8", flag: "a" });
}

export function appendOpportunityLog(opportunitiesLogFile: string, opportunity: ArbitrageOpportunity): void {
  const json = JSON.stringify(opportunity);
  if (typeof json !== "string") {
    throw new Error("Opportunity log append failed: opportunity is not JSON serializable");
  }

  appendFileSync(opportunitiesLogFile, `${json}\n`, { encoding: "utf-8", flag: "a" });
}

export function appendNearMissAlertLog(nearMissAlertsFile: string, alert: NearMissAlert): void {
  const json = JSON.stringify(alert);
  if (typeof json !== "string") {
    throw new Error("Near miss alert log append failed: alert is not JSON serializable");
  }

  appendFileSync(nearMissAlertsFile, `${json}\n`, { encoding: "utf-8", flag: "a" });
}

export function writeRealMarketsSample(filePath: string, sample: unknown): void {
  writeJsonFile(filePath, sample);
}

export function writeRejectedSummary(filePath: string, summary: unknown): void {
  writeJsonFile(filePath, summary);
}

export function writeNearMisses(filePath: string, nearMisses: AllowedNearMiss[]): void {
  writeJsonFile(filePath, nearMisses);
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
