import { findArbitrage } from "@/arb/findArbitrage";
import { loadConfig } from "@/config/loadConfig";
import { MockExchangeFeed } from "@/feeds/mockExchangeFeed";
import { groupByMarket } from "@/matching";
import { PaperExecutionEngine } from "@/paper/PaperExecutionEngine";
import { writeSessionSummary } from "@/reports/writeSessionSummary";
import type { ArbitrageOpportunity } from "@/types/arbitrage";

interface RuntimeSummary {
  sessionId: string;
  startedAt: string;
  ticks: number;
  marketsScanned: number;
  opportunitiesFound: number;
  rejectedByLiquidity: number;
  rejectedByStaleData: number;
  rejectedByLowEdge: number;
  acceptedNetEdgeSum: number;
  acceptedCount: number;
  bestOpportunity: ArbitrageOpportunity | null;
}

function runScanner(): void {
  const config = loadConfig();
  const runtime: RuntimeSummary = {
    sessionId: `scanner-${Date.now()}`,
    startedAt: new Date().toISOString(),
    ticks: 0,
    marketsScanned: 0,
    opportunitiesFound: 0,
    rejectedByLiquidity: 0,
    rejectedByStaleData: 0,
    rejectedByLowEdge: 0,
    acceptedNetEdgeSum: 0,
    acceptedCount: 0,
    bestOpportunity: null,
  };
  const paperEngine = new PaperExecutionEngine({
    enabled: config.enablePaperTrading,
    startingBalance: config.paperStartingBalance,
    stakeSize: config.paperStakeSize,
    partialFillProbability: config.paperPartialFillProbability,
    unmatchedProbability: config.paperUnmatchedProbability,
    maxOpenExposure: config.paperMaxOpenExposure,
  });

  const feedAlpha = new MockExchangeFeed({
    exchange: "mock-alpha",
    seed: 101,
    footballEventCount: config.mockFootballEventCount,
    tennisEventCount: config.mockTennisEventCount,
    selectionsPerFootballMarket: config.mockSelectionsPerFootballMarket,
    selectionsPerTennisMarket: config.mockSelectionsPerTennisMarket,
    staleThresholdMs: config.staleDataThresholdMs,
    updateIntervalMs: config.scanIntervalMs,
    arbProbability: config.mockArbProbability,
    maxNormalEdgePct: config.mockMaxNormalEdgePct,
    extremeEdgeProbability: config.mockExtremeEdgeProbability,
    staleProbability: config.mockStaleProbability,
    lowLiquidityProbability: config.mockLowLiquidityProbability,
  });
  const feedBeta = new MockExchangeFeed({
    exchange: "mock-beta",
    seed: 202,
    footballEventCount: config.mockFootballEventCount,
    tennisEventCount: config.mockTennisEventCount,
    selectionsPerFootballMarket: config.mockSelectionsPerFootballMarket,
    selectionsPerTennisMarket: config.mockSelectionsPerTennisMarket,
    staleThresholdMs: config.staleDataThresholdMs,
    updateIntervalMs: config.scanIntervalMs,
    arbProbability: config.mockArbProbability,
    maxNormalEdgePct: config.mockMaxNormalEdgePct,
    extremeEdgeProbability: config.mockExtremeEdgeProbability,
    staleProbability: config.mockStaleProbability,
    lowLiquidityProbability: config.mockLowLiquidityProbability,
  });

  feedAlpha.start();
  feedBeta.start();

  const runTick = (): void => {
    const nowIso = new Date().toISOString();
    const snapshots = [...feedAlpha.getSnapshot(nowIso).snapshots, ...feedBeta.getSnapshot(nowIso).snapshots];
    const markets = groupByMarket(snapshots, nowIso);
    const result = findArbitrage({
      markets,
      nowIso,
      minEdgePct: config.minEdgePct,
      minLiquidity: config.minLiquidity,
      staleDataThresholdMs: config.staleDataThresholdMs,
      defaultCommissionRate: config.defaultExchangeCommissionRate,
      emitSummaryLogs: false,
    });
    const acceptedOpportunities = result.opportunities.filter((opportunity) => opportunity.status === "accepted");
    for (const opportunity of acceptedOpportunities) {
      const trade = paperEngine.executeOpportunity(opportunity, nowIso);
      if (trade.status === "opened" || trade.status === "partial_fill") {
        const paperStats = paperEngine.getStats();
        console.log(
          `[paper] opened stake=${trade.stake.toFixed(2)} expectedProfit=${trade.expectedProfit.toFixed(2)} ` +
            `balance=${paperStats.endingBalance.toFixed(2)} exposure=${paperStats.currentOpenExposure.toFixed(2)}`,
        );
      }
    }

    runtime.ticks += 1;
    runtime.marketsScanned += result.diagnostics.marketsScanned;
    runtime.opportunitiesFound += result.diagnostics.acceptedOpportunities;
    runtime.rejectedByLiquidity += result.diagnostics.rejectedByLiquidity;
    runtime.rejectedByStaleData += result.diagnostics.rejectedByStaleData;
    runtime.rejectedByLowEdge += result.diagnostics.rejectedByLowEdge;
    runtime.acceptedCount += result.diagnostics.acceptedOpportunities;
    runtime.acceptedNetEdgeSum += result.diagnostics.averageNetEdgePct * result.diagnostics.acceptedOpportunities;

    const bestTickOpportunity = bestAccepted(result.opportunities);
    if (
      bestTickOpportunity &&
      (!runtime.bestOpportunity || bestTickOpportunity.netEdgePct > runtime.bestOpportunity.netEdgePct)
    ) {
      runtime.bestOpportunity = bestTickOpportunity;
    }

    console.log(
      `[scanner] tick=${runtime.ticks} comparedSelections=${result.diagnostics.marketsScanned} ` +
        `opps=${result.diagnostics.acceptedOpportunities} ` +
        `rejected(liq=${result.diagnostics.rejectedByLiquidity} stale=${result.diagnostics.rejectedByStaleData} edge=${result.diagnostics.rejectedByLowEdge})`,
    );
  };

  runTick();
  const tickIntervalId = setInterval(runTick, config.scanIntervalMs);

  let isShuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    clearInterval(tickIntervalId);
    feedAlpha.stop();
    feedBeta.stop();
    paperEngine.assertInvariant();

    const endedAt = new Date().toISOString();
    const avgNetEdgePct = runtime.acceptedCount > 0 ? runtime.acceptedNetEdgeSum / runtime.acceptedCount : 0;
    const paperStats = paperEngine.getStats();
    console.assert(
      Math.abs(paperStats.endingBalance - (paperStats.startingBalance + paperStats.realizedPaperPnl)) < 0.0001,
      "Paper balance invariant failed",
    );
    const outputPath = await writeSessionSummary({
      sessionId: runtime.sessionId,
      startedAt: runtime.startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(runtime.startedAt),
      ticks: runtime.ticks,
      marketsScanned: runtime.marketsScanned,
      opportunitiesFound: runtime.opportunitiesFound,
      rejectedByLiquidity: runtime.rejectedByLiquidity,
      rejectedByStaleData: runtime.rejectedByStaleData,
      rejectedByLowEdge: runtime.rejectedByLowEdge,
      avgNetEdgePct,
      paperTradesOpened: paperStats.paperTradesOpened,
      paperTradesRejected: paperStats.paperTradesRejected,
      partialFills: paperStats.partialFills,
      unmatchedRiskEvents: paperStats.unmatchedRiskEvents,
      startingBalance: paperStats.startingBalance,
      endingBalance: paperStats.endingBalance,
      realizedPaperPnl: paperStats.realizedPaperPnl,
      maxOpenExposure: paperStats.maxOpenExposure,
      bestOpportunity: runtime.bestOpportunity
        ? {
            id: runtime.bestOpportunity.id,
            eventId: runtime.bestOpportunity.eventId,
            eventName: runtime.bestOpportunity.eventName,
            marketType: runtime.bestOpportunity.marketType,
            selection: runtime.bestOpportunity.selection,
            netEdgePct: runtime.bestOpportunity.netEdgePct,
            estimatedProfit: runtime.bestOpportunity.estimatedProfit,
            detectedAt: runtime.bestOpportunity.detectedAt,
          }
        : null,
      configSnapshot: config,
    });
    console.log(`[scanner] session summary written to ${outputPath}`);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function bestAccepted(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity | null {
  let best: ArbitrageOpportunity | null = null;
  for (const opportunity of opportunities) {
    if (opportunity.status !== "accepted") {
      continue;
    }
    if (!best || opportunity.netEdgePct > best.netEdgePct) {
      best = opportunity;
    }
  }
  return best;
}

runScanner();
