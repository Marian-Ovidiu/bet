import { findArbitrage } from "@/arb/findArbitrage";
import { loadConfig, toSafeConfigSnapshot, type AppConfig } from "@/config/loadConfig";
import {
  TheOddsApiFeed,
  type TheOddsApiExchangeSnapshot,
  type TheOddsApiSnapshotResult,
  type TheOddsApiUsage,
} from "@/exchanges/TheOddsApiFeed";
import { MockExchangeFeed } from "@/feeds/mockExchangeFeed";
import { groupByMarket } from "@/matching";
import { PaperExecutionEngine } from "@/paper/PaperExecutionEngine";
import {
  appendNearMissAlertLog,
  appendOpportunityLog,
  appendPaperTradeLog,
  createScannerOutput,
  writeNearMisses,
  writeRealMarketsSample,
  writeRejectedSummary,
  writeSessionSummary,
} from "@/reports/writeSessionSummary";
import type { ArbitrageOpportunity, AllowedNearMiss, NearMissAlert, QuoteSkewMetrics } from "@/types/arbitrage";
import type { MarketSnapshot } from "@/types/snapshots";
import { normalizeBookmakerKey } from "@/normalizer/normalizeBookmakerKey";

interface RuntimeSummary {
  sessionId: string;
  startedAt: string;
  ticks: number;
  marketsScanned: number;
  opportunitiesFound: number;
  rawOpportunitiesDetected: number;
  uniqueOpportunitiesFound: number;
  duplicateOpportunitiesSkipped: number;
  opportunityUpdatedCount: number;
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
  impliedSumTotal: number;
  impliedSumCount: number;
  minImpliedSum: number | null;
  allowedCandidateCount: number;
  nearMissAlerts: number;
  strongNearMissAlerts: number;
  allowedImpliedSumTotal: number;
  bestAllowedNearMiss: AllowedNearMiss | null;
  quoteSkewTotalMs: number;
  quoteSkewCount: number;
  maxQuoteSkewMs: number;
  executableStakeTotal: number;
  liquidityCoverageTotal: number;
  liquidityMetricCount: number;
  acceptedNetEdgeSum: number;
  acceptedCount: number;
  bestOpportunity: ArbitrageOpportunity | null;
  bestSurebet: ArbitrageOpportunity | null;
  bestBackLayOpportunity: ArbitrageOpportunity | null;
}

interface SeenOpportunity {
  fingerprints: Set<string>;
  netEdgePct: number;
  opportunity: ArbitrageOpportunity;
}

interface OpportunityDedupeResult {
  rawAcceptedCount: number;
  uniqueAcceptedOpportunities: ArbitrageOpportunity[];
  duplicateCount: number;
  updatedCount: number;
}

interface ScannerFeeds {
  feedMode: "mock" | "real" | "mixed";
  provider: string;
  mockFeeds: MockExchangeFeed[];
  realFeed: TheOddsApiFeed | null;
  lastRealPollAtMs: number;
  latestRealSnapshot: TheOddsApiSnapshotResult | null;
}

interface RealBackLayResult {
  opportunities: ArbitrageOpportunity[];
  backLayCandidates: number;
  backLayOpportunities: number;
  rejectedBackLayBySpread: number;
  rejectedBackLayByQuoteSkew: number;
  rejectedByLiquidityDepth: number;
  avgExecutableStake: number;
  avgLiquidityCoverageRatio: number;
  bestBackLayOpportunity: ArbitrageOpportunity | null;
}

function runScanner(): void {
  const config = loadConfig();
  const runtime: RuntimeSummary = {
    sessionId: `scanner-${Date.now()}`,
    startedAt: new Date().toISOString(),
    ticks: 0,
    marketsScanned: 0,
    opportunitiesFound: 0,
    rawOpportunitiesDetected: 0,
    uniqueOpportunitiesFound: 0,
    duplicateOpportunitiesSkipped: 0,
    opportunityUpdatedCount: 0,
    rejectedByLiquidity: 0,
    rejectedByStaleData: 0,
    rejectedByLowEdge: 0,
    backLayCandidates: 0,
    backLayOpportunities: 0,
    rejectedBackLayBySpread: 0,
    rejectedBackLayByQuoteSkew: 0,
    backBackCandidates: 0,
    rejectedByNoCompleteOutcomeSet: 0,
    rejectedByImpliedSum: 0,
    rejectedByUnsupportedMarketType: 0,
    rejectedByQuoteSkew: 0,
    rejectedByLiquidityDepth: 0,
    skippedLayMarketsForBackBack: 0,
    rejectedByBookmakerFilter: 0,
    deniedBookmakerHits: 0,
    allowedBookmakerOpportunities: 0,
    apiRequests: 0,
    apiFailures: 0,
    eventsReceived: 0,
    bookmakersReceived: 0,
    marketsNormalized: 0,
    selectionsNormalized: 0,
    normalizedEvents: 0,
    normalizedSelections: 0,
    malformedPayloads: 0,
    rejectedNormalizedMarkets: 0,
    missingEventId: 0,
    missingSelection: 0,
    invalidOdds: 0,
    duplicateOutcome: 0,
    incompleteMarket: 0,
    staleMarket: 0,
    oddsApiUsage: null,
    impliedSumTotal: 0,
    impliedSumCount: 0,
    minImpliedSum: null,
    allowedCandidateCount: 0,
    nearMissAlerts: 0,
    strongNearMissAlerts: 0,
    allowedImpliedSumTotal: 0,
    bestAllowedNearMiss: null,
    quoteSkewTotalMs: 0,
    quoteSkewCount: 0,
    maxQuoteSkewMs: 0,
    executableStakeTotal: 0,
    liquidityCoverageTotal: 0,
    liquidityMetricCount: 0,
    acceptedNetEdgeSum: 0,
    acceptedCount: 0,
    bestOpportunity: null,
    bestSurebet: null,
    bestBackLayOpportunity: null,
  };
  const outputPaths = createScannerOutput(runtime.sessionId);
  const paperEngine = new PaperExecutionEngine({
    enabled: config.enablePaperTrading,
    startingBalance: config.paperStartingBalance,
    stakeSize: config.paperStakeSize,
    partialFillProbability: config.paperPartialFillProbability,
    unmatchedProbability: config.paperUnmatchedProbability,
    maxOpenExposure: config.paperMaxOpenExposure,
  });

  const feeds = createFeeds(config);
  const seenOpportunities = new Map<string, SeenOpportunity>();
  const allowedNearMisses = new Map<string, AllowedNearMiss>();
  const seenNearMissAlerts = new Set<string>();

  for (const feed of feeds.mockFeeds) {
    feed.start();
  }

  const runTick = async (): Promise<void> => {
    const nowIso = new Date().toISOString();
    const realSnapshot = feeds.realFeed ? await pollRealFeedIfDue(feeds, config, nowIso) : null;
    const mockMarkets = feeds.mockFeeds.length > 0
      ? groupByMarket(feeds.mockFeeds.flatMap((feed) => feed.getSnapshot(nowIso).snapshots), nowIso)
      : [];
    const realMarkets = realSnapshot ? realMarketsForArbitrage(realSnapshot) : [];
    const results = [
      mockMarkets.length > 0
        ? findArbitrage({
            markets: mockMarkets,
            nowIso,
            minEdgePct: config.minEdgePct,
            minLiquidity: config.minLiquidity,
            minRequiredLiquidity: config.minRequiredLiquidity,
            targetStakeSize: config.targetStakeSize,
            staleDataThresholdMs: config.staleDataThresholdMs,
            maxQuoteSkewMs: config.maxQuoteSkewMs,
            defaultCommissionRate: config.defaultExchangeCommissionRate,
            emitSummaryLogs: false,
            arbModes: ["BACK_LAY"],
          })
        : null,
      realMarkets.length > 0
        ? findArbitrage({
            markets: realMarkets,
            nowIso,
            minEdgePct: config.minEdgePct,
            minLiquidity: config.minLiquidity,
            minRequiredLiquidity: config.minRequiredLiquidity,
            targetStakeSize: config.targetStakeSize,
            staleDataThresholdMs: config.staleDataThresholdMs,
            maxQuoteSkewMs: config.maxQuoteSkewMs,
            defaultCommissionRate: config.defaultExchangeCommissionRate,
            emitSummaryLogs: false,
            arbModes: ["BACK_BACK_SUREBET"],
            bookmakerFilter: {
              enabled: config.enableBookmakerFilter,
              allowedBookmakers: config.allowedBookmakers,
              deniedBookmakers: config.deniedBookmakers,
            },
          })
        : null,
    ].filter((result): result is NonNullable<typeof result> => result !== null);

    const realBackLayResult = realSnapshot
      ? findRealBackLayOpportunities({
          snapshot: realSnapshot,
          nowIso,
          minEdgePct: config.minEdgePct,
          stake: config.targetStakeSize,
          minRequiredLiquidity: config.minRequiredLiquidity,
          targetStakeSize: config.targetStakeSize,
          maxQuoteSkewMs: config.maxQuoteSkewMs,
          defaultCommissionRate: config.defaultExchangeCommissionRate,
          commissionByExchange: config.exchangeCommissionByExchange,
        })
      : emptyRealBackLayResult();
    const opportunities = results.flatMap((result) => result.opportunities);
    opportunities.push(...realBackLayResult.opportunities);
    const nearMisses = results.flatMap((result) => result.allowedNearMisses);
    updateAllowedNearMisses(allowedNearMisses, nearMisses);
    const nearMissAlert = buildNearMissAlert(bestNearMiss(nearMisses), nowIso, config);
    if (nearMissAlert) {
      const alertKey = nearMissAlertFingerprint(nearMissAlert);
      if (!seenNearMissAlerts.has(alertKey)) {
        seenNearMissAlerts.add(alertKey);
        appendNearMissAlertLog(outputPaths.nearMissAlertsFile, nearMissAlert);
        runtime.nearMissAlerts += 1;
        if (nearMissAlert.alertLevel === "strong") {
          runtime.strongNearMissAlerts += 1;
        }
        console.log(
          `[near-miss] event=${nearMissAlert.eventName} impliedSum=${nearMissAlert.impliedSum.toFixed(6)} ` +
            `missingEdgePct=${nearMissAlert.missingEdgePct.toFixed(4)} ` +
            `bookmakers=${nearMissAlert.bookmakerSet.join(",")}`,
        );
      }
    }
    const diagnostics = mergeDiagnostics(results.map((result) => result.diagnostics));
    const acceptedOpportunities = opportunities.filter((opportunity) => opportunity.status === "accepted");
    const dedupeResult = dedupeAcceptedOpportunities(acceptedOpportunities, seenOpportunities);
    for (const opportunity of dedupeResult.uniqueAcceptedOpportunities) {
      appendOpportunityLog(outputPaths.opportunitiesLogFile, opportunity);
    }
    const executablePaperOpportunities = dedupeResult.uniqueAcceptedOpportunities.filter(
      (opportunity) => opportunity.arbMode === "BACK_LAY",
    );
    for (const opportunity of executablePaperOpportunities) {
      const trade = paperEngine.executeOpportunity(opportunity, nowIso);
      appendPaperTradeLog(outputPaths.tradeLogFile, trade);
      if (trade.status === "opened" || trade.status === "partial_fill") {
        const paperStats = paperEngine.getStats();
        console.log(
          `[paper] opened stake=${trade.stake.toFixed(2)} expectedProfit=${trade.expectedProfit.toFixed(2)} ` +
            `balance=${paperStats.endingBalance.toFixed(2)} exposure=${paperStats.currentOpenExposure.toFixed(2)}`,
        );
      }
    }

    runtime.ticks += 1;
    runtime.marketsScanned += diagnostics.marketsScanned;
    runtime.rawOpportunitiesDetected += dedupeResult.rawAcceptedCount;
    runtime.uniqueOpportunitiesFound += dedupeResult.uniqueAcceptedOpportunities.length;
    runtime.duplicateOpportunitiesSkipped += dedupeResult.duplicateCount;
    runtime.opportunityUpdatedCount += dedupeResult.updatedCount;
    runtime.opportunitiesFound = runtime.uniqueOpportunitiesFound;
    runtime.rejectedByLiquidity += diagnostics.rejectedByLiquidity;
    runtime.rejectedByStaleData += diagnostics.rejectedByStaleData;
    runtime.rejectedByLowEdge += diagnostics.rejectedByLowEdge;
    runtime.backLayCandidates += diagnostics.backLayCandidates;
    runtime.backLayCandidates += realBackLayResult.backLayCandidates;
    runtime.backLayOpportunities += realBackLayResult.backLayOpportunities;
    runtime.rejectedBackLayBySpread += realBackLayResult.rejectedBackLayBySpread;
    runtime.rejectedBackLayByQuoteSkew += realBackLayResult.rejectedBackLayByQuoteSkew;
    runtime.backBackCandidates += diagnostics.backBackCandidates;
    runtime.rejectedByNoCompleteOutcomeSet += diagnostics.rejectedByNoCompleteOutcomeSet;
    runtime.rejectedByImpliedSum += diagnostics.rejectedByImpliedSum;
    runtime.rejectedByUnsupportedMarketType += diagnostics.rejectedByUnsupportedMarketType;
    runtime.rejectedByQuoteSkew += diagnostics.rejectedByQuoteSkew;
    runtime.rejectedByLiquidityDepth += diagnostics.rejectedByLiquidityDepth;
    runtime.skippedLayMarketsForBackBack += diagnostics.skippedLayMarketsForBackBack;
    runtime.rejectedByBookmakerFilter += diagnostics.rejectedByBookmakerFilter;
    runtime.deniedBookmakerHits += diagnostics.deniedBookmakerHits;
    runtime.allowedBookmakerOpportunities += diagnostics.allowedBookmakerOpportunities;
    runtime.allowedCandidateCount += diagnostics.allowedCandidateCount;
    runtime.allowedImpliedSumTotal += diagnostics.averageAllowedImpliedSum * diagnostics.allowedCandidateCount;
    runtime.quoteSkewTotalMs += diagnostics.avgQuoteSkewMs * diagnostics.backBackCandidates;
    runtime.quoteSkewCount += diagnostics.backBackCandidates;
    runtime.maxQuoteSkewMs = Math.max(runtime.maxQuoteSkewMs, diagnostics.maxQuoteSkewMs);
    runtime.executableStakeTotal += diagnostics.avgExecutableStake * diagnostics.backBackCandidates;
    runtime.liquidityCoverageTotal += diagnostics.avgLiquidityCoverageRatio * diagnostics.backBackCandidates;
    runtime.liquidityMetricCount += diagnostics.backBackCandidates;
    runtime.executableStakeTotal += realBackLayResult.avgExecutableStake * realBackLayResult.backLayCandidates;
    runtime.liquidityCoverageTotal +=
      realBackLayResult.avgLiquidityCoverageRatio * realBackLayResult.backLayCandidates;
    runtime.liquidityMetricCount += realBackLayResult.backLayCandidates;
    runtime.rejectedByLiquidityDepth += realBackLayResult.rejectedByLiquidityDepth;
    runtime.bestAllowedNearMiss = bestNearMiss([runtime.bestAllowedNearMiss, ...nearMisses]);
    runtime.acceptedCount += dedupeResult.uniqueAcceptedOpportunities.length;
    runtime.acceptedNetEdgeSum += dedupeResult.uniqueAcceptedOpportunities.reduce(
      (sum, opportunity) => sum + opportunity.netEdgePct,
      0,
    );
    const surebetImpliedSums = dedupeResult.uniqueAcceptedOpportunities
      .filter((opportunity) => opportunity.arbMode === "BACK_BACK_SUREBET" && opportunity.impliedSum !== null)
      .map((opportunity) => opportunity.impliedSum as number);
    for (const impliedSum of surebetImpliedSums) {
      runtime.impliedSumTotal += impliedSum;
      runtime.impliedSumCount += 1;
      runtime.minImpliedSum = runtime.minImpliedSum === null ? impliedSum : Math.min(runtime.minImpliedSum, impliedSum);
    }
    if (realSnapshot) {
      runtime.apiRequests = realSnapshot.diagnostics.apiRequests;
      runtime.apiFailures = realSnapshot.diagnostics.apiFailures;
      runtime.eventsReceived = realSnapshot.diagnostics.eventsReceived;
      runtime.bookmakersReceived = realSnapshot.diagnostics.bookmakersReceived;
      runtime.marketsNormalized = realSnapshot.diagnostics.normalizedMarkets;
      runtime.selectionsNormalized = realSnapshot.diagnostics.normalizedSelections;
      runtime.normalizedEvents = realSnapshot.diagnostics.normalizedEvents;
      runtime.normalizedSelections = realSnapshot.diagnostics.normalizedSelections;
      runtime.malformedPayloads = realSnapshot.diagnostics.malformedPayloads;
      runtime.rejectedNormalizedMarkets = realSnapshot.diagnostics.rejectedNormalizedMarkets;
      runtime.missingEventId = realSnapshot.diagnostics.missingEventId;
      runtime.missingSelection = realSnapshot.diagnostics.missingSelection;
      runtime.invalidOdds = realSnapshot.diagnostics.invalidOdds;
      runtime.duplicateOutcome = realSnapshot.diagnostics.duplicateOutcome;
      runtime.incompleteMarket = realSnapshot.diagnostics.incompleteMarket;
      runtime.staleMarket = realSnapshot.diagnostics.staleMarket;
      runtime.oddsApiUsage = realSnapshot.oddsApiUsage;
    }

    const bestTickOpportunity = bestAccepted(dedupeResult.uniqueAcceptedOpportunities);
    if (
      bestTickOpportunity &&
      (!runtime.bestOpportunity || bestTickOpportunity.netEdgePct > runtime.bestOpportunity.netEdgePct)
    ) {
      runtime.bestOpportunity = bestTickOpportunity;
    }
    const bestTickSurebet = bestSurebet(dedupeResult.uniqueAcceptedOpportunities);
    if (
      bestTickSurebet &&
      (!runtime.bestSurebet || bestTickSurebet.netEdgePct > runtime.bestSurebet.netEdgePct)
    ) {
      runtime.bestSurebet = bestTickSurebet;
    }
    const bestTickBackLay = bestBackLay(dedupeResult.uniqueAcceptedOpportunities);
    if (
      bestTickBackLay &&
      (!runtime.bestBackLayOpportunity || bestTickBackLay.netEdgePct > runtime.bestBackLayOpportunity.netEdgePct)
    ) {
      runtime.bestBackLayOpportunity = bestTickBackLay;
    }

    for (const opportunity of dedupeResult.uniqueAcceptedOpportunities.filter((item) =>
      item.arbMode === "BACK_LAY" && item.id.startsWith("real-back-lay:"),
    )) {
      appendOpportunityLog(outputPaths.backLayOpportunitiesLogFile, opportunity);
    }

    printCompactTickSummary(feeds, runtime.ticks, diagnostics, realSnapshot, mockMarkets, dedupeResult);
  };

  let isTickRunning = true;
  void runTick().finally(() => {
    isTickRunning = false;
  });
  const tickIntervalId = setInterval(() => {
    if (isTickRunning) {
      return;
    }
    isTickRunning = true;
    void runTick().finally(() => {
      isTickRunning = false;
    });
  }, config.scanIntervalMs);

  let isShuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    clearInterval(tickIntervalId);
    feeds.realFeed?.stop();
    for (const feed of feeds.mockFeeds) {
      feed.stop();
    }
    paperEngine.assertInvariant();

    const endedAt = new Date().toISOString();
    const avgNetEdgePct = runtime.acceptedCount > 0 ? runtime.acceptedNetEdgeSum / runtime.acceptedCount : 0;
    const avgImpliedSum =
      runtime.impliedSumCount > 0 ? roundTo(runtime.impliedSumTotal / runtime.impliedSumCount, 8) : null;
    const avgAllowedImpliedSum =
      runtime.allowedCandidateCount > 0 ? roundTo(runtime.allowedImpliedSumTotal / runtime.allowedCandidateCount, 8) : null;
    const avgQuoteSkewMs =
      runtime.quoteSkewCount > 0 ? roundTo(runtime.quoteSkewTotalMs / runtime.quoteSkewCount, 2) : 0;
    const avgExecutableStake =
      runtime.liquidityMetricCount > 0 ? roundTo(runtime.executableStakeTotal / runtime.liquidityMetricCount, 4) : 0;
    const avgLiquidityCoverageRatio =
      runtime.liquidityMetricCount > 0
        ? roundTo(runtime.liquidityCoverageTotal / runtime.liquidityMetricCount, 4)
        : 0;
    const paperStats = paperEngine.getStats();
    console.assert(
      Math.abs(paperStats.endingBalance - (paperStats.startingBalance + paperStats.realizedPaperPnl)) < 0.0001,
      "Paper balance invariant failed",
    );
    const outputPath = await writeSessionSummary({
      sessionId: runtime.sessionId,
      startedAt: runtime.startedAt,
      endedAt,
      outputDir: outputPaths.outputDir,
      tradeLogFile: outputPaths.tradeLogFile,
      feedMode: feeds.feedMode,
      provider: feeds.provider,
      sportKey: config.realFeedEnabled ? config.theOddsApiSport : null,
      apiRequests: runtime.apiRequests,
      apiFailures: runtime.apiFailures,
      eventsReceived: runtime.eventsReceived,
      bookmakersReceived: runtime.bookmakersReceived,
      marketsNormalized: runtime.marketsNormalized,
      selectionsNormalized: runtime.selectionsNormalized,
      normalizedEvents: runtime.normalizedEvents,
      normalizedSelections: runtime.normalizedSelections,
      malformedPayloads: runtime.malformedPayloads,
      rejectedNormalizedMarkets: runtime.rejectedNormalizedMarkets,
      missingEventId: runtime.missingEventId,
      missingSelection: runtime.missingSelection,
      invalidOdds: runtime.invalidOdds,
      duplicateOutcome: runtime.duplicateOutcome,
      incompleteMarket: runtime.incompleteMarket,
      staleMarket: runtime.staleMarket,
      oddsApiUsage: runtime.oddsApiUsage,
      durationMs: Date.parse(endedAt) - Date.parse(runtime.startedAt),
      ticks: runtime.ticks,
      marketsScanned: runtime.marketsScanned,
      opportunitiesFound: runtime.opportunitiesFound,
      rawOpportunitiesDetected: runtime.rawOpportunitiesDetected,
      uniqueOpportunitiesFound: runtime.uniqueOpportunitiesFound,
      duplicateOpportunitiesSkipped: runtime.duplicateOpportunitiesSkipped,
      opportunityUpdatedCount: runtime.opportunityUpdatedCount,
      avgImpliedSum,
      minImpliedSum: runtime.minImpliedSum,
      bestAllowedNearMiss: runtime.bestAllowedNearMiss,
      avgAllowedImpliedSum,
      allowedCandidateCount: runtime.allowedCandidateCount,
      nearMissAlerts: runtime.nearMissAlerts,
      strongNearMissAlerts: runtime.strongNearMissAlerts,
      rejectedByLiquidity: runtime.rejectedByLiquidity,
      rejectedByStaleData: runtime.rejectedByStaleData,
      rejectedByLowEdge: runtime.rejectedByLowEdge,
      backLayCandidates: runtime.backLayCandidates,
      backLayOpportunities: runtime.backLayOpportunities,
      rejectedBackLayBySpread: runtime.rejectedBackLayBySpread,
      rejectedBackLayByQuoteSkew: runtime.rejectedBackLayByQuoteSkew,
      backBackCandidates: runtime.backBackCandidates,
      rejectedByNoCompleteOutcomeSet: runtime.rejectedByNoCompleteOutcomeSet,
      rejectedByImpliedSum: runtime.rejectedByImpliedSum,
      rejectedByUnsupportedMarketType: runtime.rejectedByUnsupportedMarketType,
      rejectedByQuoteSkew: runtime.rejectedByQuoteSkew,
      rejectedByLiquidityDepth: runtime.rejectedByLiquidityDepth,
      skippedLayMarketsForBackBack: runtime.skippedLayMarketsForBackBack,
      rejectedByBookmakerFilter: runtime.rejectedByBookmakerFilter,
      deniedBookmakerHits: runtime.deniedBookmakerHits,
      allowedBookmakerOpportunities: runtime.allowedBookmakerOpportunities,
      avgNetEdgePct,
      avgQuoteSkewMs,
      maxQuoteSkewMs: runtime.maxQuoteSkewMs,
      avgExecutableStake,
      avgLiquidityCoverageRatio,
      paperTradesOpened: paperStats.paperTradesOpened,
      paperTradesRejected: paperStats.paperTradesRejected,
      partialFills: paperStats.partialFills,
      unmatchedRiskEvents: paperStats.unmatchedRiskEvents,
      startingBalance: paperStats.startingBalance,
      endingBalance: paperStats.endingBalance,
      totalGrossProfit: paperStats.totalGrossProfit,
      totalCommissionPaid: paperStats.totalCommissionPaid,
      realizedPaperPnl: paperStats.realizedPaperPnl,
      maxOpenExposure: paperStats.maxOpenExposure,
      avgProfitPerTrade: paperStats.avgProfitPerTrade,
      bestTrade: paperStats.bestTrade,
      worstTrade: paperStats.worstTrade,
      partialFillRate: paperStats.partialFillRate,
      unmatchedRiskRate: paperStats.unmatchedRiskRate,
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
            quoteAgeSpreadMs: runtime.bestOpportunity.quoteAgeSpreadMs,
            executableStake: runtime.bestOpportunity.executableStake,
            liquidityCoverageRatio: runtime.bestOpportunity.liquidityCoverageRatio,
          }
        : null,
      bestSurebet: runtime.bestSurebet
        ? {
            id: runtime.bestSurebet.id,
            eventId: runtime.bestSurebet.eventId,
            eventName: runtime.bestSurebet.eventName,
            marketType: runtime.bestSurebet.marketType,
            impliedSum: runtime.bestSurebet.impliedSum,
            netEdgePct: runtime.bestSurebet.netEdgePct,
            estimatedProfit: runtime.bestSurebet.estimatedProfit,
            detectedAt: runtime.bestSurebet.detectedAt,
            quoteAgeSpreadMs: runtime.bestSurebet.quoteAgeSpreadMs,
            executableStake: runtime.bestSurebet.executableStake,
            liquidityCoverageRatio: runtime.bestSurebet.liquidityCoverageRatio,
          }
        : null,
      bestBackLayOpportunity: runtime.bestBackLayOpportunity
        ? {
            id: runtime.bestBackLayOpportunity.id,
            eventId: runtime.bestBackLayOpportunity.eventId,
            eventName: runtime.bestBackLayOpportunity.eventName,
            marketType: runtime.bestBackLayOpportunity.marketType,
            selection: runtime.bestBackLayOpportunity.selection,
            backExchange: runtime.bestBackLayOpportunity.legs[0].exchange,
            layExchange: runtime.bestBackLayOpportunity.legs[1].exchange,
            backOdds: runtime.bestBackLayOpportunity.legs[0].odds,
            layOdds: runtime.bestBackLayOpportunity.legs[1].odds,
            grossEdgePct: runtime.bestBackLayOpportunity.grossEdgePct,
            netEdgePct: runtime.bestBackLayOpportunity.netEdgePct,
            estimatedProfit: runtime.bestBackLayOpportunity.estimatedProfit,
            detectedAt: runtime.bestBackLayOpportunity.detectedAt,
            quoteAgeSpreadMs: runtime.bestBackLayOpportunity.quoteAgeSpreadMs,
            executableStake: runtime.bestBackLayOpportunity.executableStake,
            liquidityCoverageRatio: runtime.bestBackLayOpportunity.liquidityCoverageRatio,
          }
        : null,
      configSnapshot: toSafeConfigSnapshot(config),
    }, runtime.bestOpportunity);
    writeRealMarketsSample(outputPaths.realMarketsSampleFile, buildRealMarketsSample(feeds.latestRealSnapshot));
    writeNearMisses(outputPaths.nearMissesFile, topNearMisses(allowedNearMisses));
    writeRejectedSummary(outputPaths.rejectedSummaryFile, buildRejectedSummary(runtime));
    console.log(`[scanner] session summary written to ${outputPath}`);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function createFeeds(config: AppConfig): ScannerFeeds {
  const mockFeeds = !config.realFeedEnabled || config.realFeedIncludeMock ? createMockFeeds(config) : [];
  if (config.realFeedEnabled) {
    return {
      feedMode: config.realFeedIncludeMock ? "mixed" : "real",
      provider: config.realFeedProvider,
      mockFeeds,
      realFeed: new TheOddsApiFeed({
        apiKey: config.theOddsApiKey,
        sport: config.theOddsApiSport,
        regions: config.theOddsApiRegions,
        markets: config.theOddsApiMarkets,
        oddsFormat: config.theOddsApiOddsFormat,
        dateFormat: config.theOddsApiDateFormat,
        pollIntervalMs: config.realFeedPollIntervalMs,
        staleDataThresholdMs: config.staleDataThresholdMs,
      }),
      lastRealPollAtMs: 0,
      latestRealSnapshot: null,
    };
  }

  return {
    feedMode: "mock",
    provider: "mock",
    mockFeeds,
    realFeed: null,
    lastRealPollAtMs: 0,
    latestRealSnapshot: null,
  };
}

function createMockFeeds(config: AppConfig): MockExchangeFeed[] {
  return [
    new MockExchangeFeed({
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
    }),
    new MockExchangeFeed({
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
    }),
  ];
}

async function pollRealFeedIfDue(
  feeds: ScannerFeeds,
  config: AppConfig,
  nowIso: string,
): Promise<TheOddsApiSnapshotResult | null> {
  if (!feeds.realFeed) {
    return null;
  }

  const nowMs = Date.parse(nowIso);
  const shouldPoll =
    !feeds.latestRealSnapshot || nowMs - feeds.lastRealPollAtMs >= config.realFeedPollIntervalMs;
  if (!shouldPoll) {
    return feeds.latestRealSnapshot;
  }

  try {
    feeds.latestRealSnapshot = await feeds.realFeed.pollOnce(nowIso);
    feeds.lastRealPollAtMs = nowMs;
  } catch {
    feeds.latestRealSnapshot = feeds.realFeed.getSnapshot();
  }
  return feeds.latestRealSnapshot;
}

function realMarketsForArbitrage(snapshot: TheOddsApiSnapshotResult): MarketSnapshot[] {
  return snapshot.markets.map((market) => ({
    eventId: market.eventId,
    eventName: market.eventName,
    marketType: market.marketType,
    selection: market.selection,
    timestamp: market.receivedAt,
    snapshots: market.snapshots.map((item) => ({
      exchange: item.exchange,
      eventId: item.eventId,
      eventName: item.eventName,
      marketType: item.marketType,
      selection: item.selection,
      backOdds: item.backOdds,
      layOdds: item.backOdds,
      liquidity: item.estimatedLiquidity,
      estimatedLiquidity: item.estimatedLiquidity,
      maxStakeEstimate: item.maxStakeEstimate,
      timestamp: item.sourceTimestamp,
    })),
  }));
}

interface FindRealBackLayInput {
  snapshot: TheOddsApiSnapshotResult;
  nowIso: string;
  minEdgePct: number;
  stake: number;
  minRequiredLiquidity: number;
  targetStakeSize: number;
  maxQuoteSkewMs: number;
  defaultCommissionRate: number;
  commissionByExchange: Record<string, number>;
}

function findRealBackLayOpportunities(input: FindRealBackLayInput): RealBackLayResult {
  const backByKey = new Map<string, TheOddsApiExchangeSnapshot>();
  const layByKey = new Map<string, TheOddsApiExchangeSnapshot>();

  for (const snapshot of input.snapshot.snapshots) {
    const key = realBackLayLegKey(snapshot);
    if (isRealBackMarketType(snapshot.marketType)) {
      const existing = backByKey.get(key);
      if (!existing || snapshot.backOdds > existing.backOdds) {
        backByKey.set(key, snapshot);
      }
    } else if (snapshot.marketType === "h2h_lay") {
      const existing = layByKey.get(key);
      if (!existing || snapshot.backOdds < existing.backOdds) {
        layByKey.set(key, snapshot);
      }
    }
  }

  const opportunities: ArbitrageOpportunity[] = [];
  let backLayCandidates = 0;
  let backLayOpportunities = 0;
  let rejectedBackLayBySpread = 0;
  let rejectedBackLayByQuoteSkew = 0;
  let rejectedByLiquidityDepth = 0;
  let executableStakeTotal = 0;
  let liquidityCoverageTotal = 0;
  let bestBackLayOpportunity: ArbitrageOpportunity | null = null;

  for (const [key, backLeg] of backByKey.entries()) {
    const layLeg = layByKey.get(key);
    if (!layLeg) {
      continue;
    }

    backLayCandidates += 1;
    const opportunity = buildRealBackLayOpportunity({
      backLeg,
      layLeg,
      nowIso: input.nowIso,
      minEdgePct: input.minEdgePct,
      stake: input.stake,
      minRequiredLiquidity: input.minRequiredLiquidity,
      targetStakeSize: input.targetStakeSize,
      maxQuoteSkewMs: input.maxQuoteSkewMs,
      defaultCommissionRate: input.defaultCommissionRate,
      commissionByExchange: input.commissionByExchange,
      candidateIndex: backLayCandidates,
    });
    opportunities.push(opportunity);

    if (backLeg.backOdds <= layLeg.backOdds) {
      rejectedBackLayBySpread += 1;
    }
    if (opportunity.rejectionReasons.includes("quote_skew_too_high")) {
      rejectedBackLayByQuoteSkew += 1;
    }
    if (opportunity.rejectionReasons.includes("liquidity_depth_too_low")) {
      rejectedByLiquidityDepth += 1;
    }
    executableStakeTotal += opportunity.executableStake;
    liquidityCoverageTotal += opportunity.liquidityCoverageRatio;
    if (opportunity.status === "accepted") {
      backLayOpportunities += 1;
      if (!bestBackLayOpportunity || opportunity.netEdgePct > bestBackLayOpportunity.netEdgePct) {
        bestBackLayOpportunity = opportunity;
      }
    }
  }

  return {
    opportunities,
    backLayCandidates,
    backLayOpportunities,
    rejectedBackLayBySpread,
    rejectedBackLayByQuoteSkew,
    rejectedByLiquidityDepth,
    avgExecutableStake: backLayCandidates > 0 ? executableStakeTotal / backLayCandidates : 0,
    avgLiquidityCoverageRatio: backLayCandidates > 0 ? liquidityCoverageTotal / backLayCandidates : 0,
    bestBackLayOpportunity,
  };
}

function emptyRealBackLayResult(): RealBackLayResult {
  return {
    opportunities: [],
    backLayCandidates: 0,
    backLayOpportunities: 0,
    rejectedBackLayBySpread: 0,
    rejectedBackLayByQuoteSkew: 0,
    rejectedByLiquidityDepth: 0,
    avgExecutableStake: 0,
    avgLiquidityCoverageRatio: 0,
    bestBackLayOpportunity: null,
  };
}

interface BuildRealBackLayOpportunityInput {
  backLeg: TheOddsApiExchangeSnapshot;
  layLeg: TheOddsApiExchangeSnapshot;
  nowIso: string;
  minEdgePct: number;
  stake: number;
  minRequiredLiquidity: number;
  targetStakeSize: number;
  maxQuoteSkewMs: number;
  defaultCommissionRate: number;
  commissionByExchange: Record<string, number>;
  candidateIndex: number;
}

function buildRealBackLayOpportunity(input: BuildRealBackLayOpportunityInput): ArbitrageOpportunity {
  const rejectionReasons: ArbitrageOpportunity["rejectionReasons"] = [];
  const backCommission = commissionForRealExchange(
    input.backLeg.exchange,
    input.defaultCommissionRate,
    input.commissionByExchange,
  );
  const layCommission = commissionForRealExchange(
    input.layLeg.exchange,
    input.defaultCommissionRate,
    input.commissionByExchange,
  );
  const grossEdgePct = roundTo(((input.backLeg.backOdds - input.layLeg.backOdds) / input.layLeg.backOdds) * 100, 4);
  const netEdgePct = roundTo(grossEdgePct - (backCommission + layCommission) * 100, 4);
  const estimatedProfit = roundTo(input.stake * (netEdgePct / 100), 4);
  const quoteSkew = quoteSkewMetricsForTimestamps(
    [input.backLeg.sourceTimestamp, input.layLeg.sourceTimestamp],
    input.nowIso,
  );
  const executableStake = roundTo(
    Math.min(input.targetStakeSize, input.backLeg.maxStakeEstimate, input.layLeg.maxStakeEstimate),
    4,
  );
  const liquidityCoverageRatio = roundTo(executableStake / input.targetStakeSize, 4);

  if (input.backLeg.backOdds <= input.layLeg.backOdds) {
    rejectionReasons.push("low_edge");
  }
  if (
    input.backLeg.estimatedLiquidity < input.minRequiredLiquidity ||
    input.layLeg.estimatedLiquidity < input.minRequiredLiquidity ||
    executableStake < input.targetStakeSize
  ) {
    rejectionReasons.push("liquidity_depth_too_low");
  }
  if (netEdgePct < input.minEdgePct) {
    rejectionReasons.push("low_edge");
  }
  if (quoteSkew.quoteAgeSpreadMs !== null && quoteSkew.quoteAgeSpreadMs > input.maxQuoteSkewMs) {
    rejectionReasons.push("quote_skew_too_high");
  }

  return {
    id: [
      "real-back-lay",
      input.backLeg.eventId,
      input.backLeg.selection,
      input.backLeg.exchange,
      input.candidateIndex,
    ].join(":"),
    arbMode: "BACK_LAY",
    eventId: input.backLeg.eventId,
    eventName: input.backLeg.eventName,
    marketType: `${input.backLeg.marketType}/h2h_lay`,
    selection: input.backLeg.selection,
    status: rejectionReasons.length === 0 ? "accepted" : "rejected",
    legs: [
      {
        exchange: input.backLeg.exchange,
        side: "back",
        odds: input.backLeg.backOdds,
        liquidity: input.backLeg.estimatedLiquidity,
        commissionRate: backCommission,
      },
      {
        exchange: input.layLeg.exchange,
        side: "lay",
        odds: input.layLeg.backOdds,
        liquidity: input.layLeg.estimatedLiquidity,
        commissionRate: layCommission,
      },
    ] as const,
    outcomeLegs: [],
    impliedSum: null,
    stakePlan: [],
    guaranteedPayout: null,
    grossEdgePct,
    netEdgePct,
    estimatedProfit,
    rejectionReasons: Array.from(new Set(rejectionReasons)),
    detectedAt: input.nowIso,
    sourceSnapshotTimestamps: [input.backLeg.sourceTimestamp, input.layLeg.sourceTimestamp] as const,
    oldestQuoteTimestamp: quoteSkew.oldestQuoteTimestamp,
    newestQuoteTimestamp: quoteSkew.newestQuoteTimestamp,
    quoteAgeSpreadMs: quoteSkew.quoteAgeSpreadMs,
    oldestQuoteAgeMs: quoteSkew.oldestQuoteAgeMs,
    newestQuoteAgeMs: quoteSkew.newestQuoteAgeMs,
    executableStake,
    liquidityCoverageRatio,
  };
}

function realBackLayLegKey(snapshot: TheOddsApiExchangeSnapshot): string {
  return [
    snapshot.eventId,
    snapshot.selection,
    normalizeBookmakerKey(snapshot.exchange),
  ].join("|");
}

function isRealBackMarketType(marketType: string): boolean {
  return marketType === "football_match_odds" || marketType === "tennis_winner";
}

function commissionForRealExchange(
  exchange: string,
  defaultCommissionRate: number,
  commissionByExchange: Record<string, number>,
): number {
  const normalized = normalizeBookmakerKey(exchange);
  const specific = commissionByExchange[normalized] ?? commissionByExchange[exchange];
  return typeof specific === "number" ? clamp(specific, 0, 1) : clamp(defaultCommissionRate, 0, 1);
}

function mergeDiagnostics(
  results: Array<ReturnType<typeof findArbitrage>["diagnostics"]>,
): ReturnType<typeof findArbitrage>["diagnostics"] {
  const merged = {
    marketsScanned: 0,
    comparedPairs: 0,
    opportunitiesFound: 0,
    acceptedOpportunities: 0,
    rejectedByLiquidity: 0,
    rejectedByStaleData: 0,
    rejectedByLowEdge: 0,
    rejectedByIncompleteMarket: 0,
    backLayCandidates: 0,
    backBackCandidates: 0,
    rejectedByNoCompleteOutcomeSet: 0,
    rejectedByImpliedSum: 0,
    rejectedByUnsupportedMarketType: 0,
    rejectedByQuoteSkew: 0,
    rejectedByLiquidityDepth: 0,
    skippedLayMarketsForBackBack: 0,
    rejectedByBookmakerFilter: 0,
    deniedBookmakerHits: 0,
    allowedBookmakerOpportunities: 0,
    allowedCandidateCount: 0,
    averageAllowedImpliedSum: 0,
    avgQuoteSkewMs: 0,
    maxQuoteSkewMs: 0,
    avgExecutableStake: 0,
    avgLiquidityCoverageRatio: 0,
    averageNetEdgePct: 0,
  };
  let weightedNetEdge = 0;
  let weightedAllowedImpliedSum = 0;
  let weightedQuoteSkew = 0;
  let weightedExecutableStake = 0;
  let weightedLiquidityCoverage = 0;

  for (const diagnostics of results) {
    merged.marketsScanned += diagnostics.marketsScanned;
    merged.comparedPairs += diagnostics.comparedPairs;
    merged.opportunitiesFound += diagnostics.opportunitiesFound;
    merged.acceptedOpportunities += diagnostics.acceptedOpportunities;
    merged.rejectedByLiquidity += diagnostics.rejectedByLiquidity;
    merged.rejectedByStaleData += diagnostics.rejectedByStaleData;
    merged.rejectedByLowEdge += diagnostics.rejectedByLowEdge;
    merged.rejectedByIncompleteMarket += diagnostics.rejectedByIncompleteMarket;
    merged.backLayCandidates += diagnostics.backLayCandidates;
    merged.backBackCandidates += diagnostics.backBackCandidates;
    merged.rejectedByNoCompleteOutcomeSet += diagnostics.rejectedByNoCompleteOutcomeSet;
    merged.rejectedByImpliedSum += diagnostics.rejectedByImpliedSum;
    merged.rejectedByUnsupportedMarketType += diagnostics.rejectedByUnsupportedMarketType;
    merged.rejectedByQuoteSkew += diagnostics.rejectedByQuoteSkew;
    merged.rejectedByLiquidityDepth += diagnostics.rejectedByLiquidityDepth;
    merged.skippedLayMarketsForBackBack += diagnostics.skippedLayMarketsForBackBack;
    merged.rejectedByBookmakerFilter += diagnostics.rejectedByBookmakerFilter;
    merged.deniedBookmakerHits += diagnostics.deniedBookmakerHits;
    merged.allowedBookmakerOpportunities += diagnostics.allowedBookmakerOpportunities;
    merged.allowedCandidateCount += diagnostics.allowedCandidateCount;
    weightedAllowedImpliedSum += diagnostics.averageAllowedImpliedSum * diagnostics.allowedCandidateCount;
    weightedQuoteSkew += diagnostics.avgQuoteSkewMs * diagnostics.backBackCandidates;
    weightedExecutableStake += diagnostics.avgExecutableStake * diagnostics.backBackCandidates;
    weightedLiquidityCoverage += diagnostics.avgLiquidityCoverageRatio * diagnostics.backBackCandidates;
    merged.maxQuoteSkewMs = Math.max(merged.maxQuoteSkewMs, diagnostics.maxQuoteSkewMs);
    weightedNetEdge += diagnostics.averageNetEdgePct * diagnostics.acceptedOpportunities;
  }

  merged.averageNetEdgePct =
    merged.acceptedOpportunities > 0 ? weightedNetEdge / merged.acceptedOpportunities : 0;
  merged.averageAllowedImpliedSum =
    merged.allowedCandidateCount > 0 ? weightedAllowedImpliedSum / merged.allowedCandidateCount : 0;
  merged.avgQuoteSkewMs =
    merged.backBackCandidates > 0 ? weightedQuoteSkew / merged.backBackCandidates : 0;
  merged.avgExecutableStake =
    merged.backBackCandidates > 0 ? weightedExecutableStake / merged.backBackCandidates : 0;
  merged.avgLiquidityCoverageRatio =
    merged.backBackCandidates > 0 ? weightedLiquidityCoverage / merged.backBackCandidates : 0;
  return merged;
}

function dedupeAcceptedOpportunities(
  acceptedOpportunities: ArbitrageOpportunity[],
  seenOpportunities: Map<string, SeenOpportunity>,
): OpportunityDedupeResult {
  const uniqueAcceptedOpportunities: ArbitrageOpportunity[] = [];
  let duplicateCount = 0;
  let updatedCount = 0;

  for (const opportunity of acceptedOpportunities) {
    const fingerprint = opportunityFingerprint(opportunity);
    const identityKey = opportunityIdentityKey(opportunity);
    const existing = seenOpportunities.get(identityKey);
    if (!existing) {
      seenOpportunities.set(identityKey, {
        fingerprints: new Set([fingerprint]),
        netEdgePct: opportunity.netEdgePct,
        opportunity,
      });
      uniqueAcceptedOpportunities.push(opportunity);
      continue;
    }

    if (existing.fingerprints.has(fingerprint)) {
      duplicateCount += 1;
      continue;
    }

    if (opportunity.netEdgePct > existing.netEdgePct + 0.0001) {
      existing.fingerprints.add(fingerprint);
      seenOpportunities.set(identityKey, {
        fingerprints: existing.fingerprints,
        netEdgePct: opportunity.netEdgePct,
        opportunity,
      });
      uniqueAcceptedOpportunities.push(opportunity);
      updatedCount += 1;
    } else {
      duplicateCount += 1;
    }
  }

  return {
    rawAcceptedCount: acceptedOpportunities.length,
    uniqueAcceptedOpportunities,
    duplicateCount,
    updatedCount,
  };
}

function updateAllowedNearMisses(
  nearMissesByKey: Map<string, AllowedNearMiss>,
  nearMisses: AllowedNearMiss[],
): void {
  for (const nearMiss of nearMisses) {
    const key = nearMissKey(nearMiss);
    const existing = nearMissesByKey.get(key);
    if (!existing || nearMiss.impliedSum < existing.impliedSum) {
      nearMissesByKey.set(key, nearMiss);
    }
  }
}

function topNearMisses(nearMissesByKey: Map<string, AllowedNearMiss>): AllowedNearMiss[] {
  return Array.from(nearMissesByKey.values())
    .sort((left, right) => left.impliedSum - right.impliedSum)
    .slice(0, 20);
}

function bestNearMiss(nearMisses: Array<AllowedNearMiss | null>): AllowedNearMiss | null {
  let best: AllowedNearMiss | null = null;
  for (const nearMiss of nearMisses) {
    if (!nearMiss) {
      continue;
    }
    if (!best || nearMiss.impliedSum < best.impliedSum) {
      best = nearMiss;
    }
  }
  return best;
}

function buildNearMissAlert(
  nearMiss: AllowedNearMiss | null,
  detectedAt: string,
  config: AppConfig,
): NearMissAlert | null {
  if (!nearMiss || nearMiss.impliedSum > config.nearMissAlertThreshold) {
    return null;
  }

  return {
    eventName: nearMiss.eventName,
    impliedSum: nearMiss.impliedSum,
    missingEdgePct: nearMiss.missingEdgePct,
    quoteAgeSpreadMs: nearMiss.quoteAgeSpreadMs,
    bookmakerSet: nearMiss.bookmakerSet,
    bestOutcomeLegs: nearMiss.bestOutcomeLegs,
    detectedAt,
    alertLevel: nearMiss.impliedSum <= config.nearMissStrongThreshold ? "strong" : "near",
  };
}

function nearMissAlertFingerprint(alert: NearMissAlert): string {
  const bookmakersKey = alert.bookmakerSet.slice().sort().join(",");
  const oddsKey = alert.bestOutcomeLegs
    .map((leg) => `${leg.bookmaker}|${leg.outcome}|${roundTo(leg.odds, 6)}`)
    .sort()
    .join(";");
  return [alert.eventName, bookmakersKey, oddsKey].join("|");
}

function nearMissKey(nearMiss: AllowedNearMiss): string {
  const legsKey = nearMiss.bestOutcomeLegs
    .map((leg) => `${leg.bookmaker}|${leg.outcome}`)
    .sort()
    .join(";");
  return [nearMiss.eventName, nearMiss.marketType, legsKey].join("|");
}

function opportunityFingerprint(opportunity: ArbitrageOpportunity): string {
  return opportunityKey(opportunity, true);
}

function opportunityIdentityKey(opportunity: ArbitrageOpportunity): string {
  return opportunityKey(opportunity, false);
}

function opportunityKey(opportunity: ArbitrageOpportunity, includeOdds: boolean): string {
  const outcomeLegs = opportunity.outcomeLegs.length > 0
    ? opportunity.outcomeLegs
    : opportunity.legs.map((leg) => ({
        bookmaker: leg.exchange,
        outcome: leg.side,
        odds: leg.odds,
      }));
  const legsKey = outcomeLegs
    .map((leg) => {
      const baseKey = `${leg.bookmaker}|${leg.outcome}`;
      return includeOdds ? `${baseKey}|${roundTo(leg.odds, 6)}` : baseKey;
    })
    .sort()
    .join(";");

  return [
    opportunity.eventId,
    opportunity.marketType,
    opportunity.arbMode,
    legsKey,
  ].join("|");
}

function printCompactTickSummary(
  feeds: ScannerFeeds,
  tick: number,
  diagnostics: ReturnType<typeof findArbitrage>["diagnostics"],
  realSnapshot: TheOddsApiSnapshotResult | null,
  mockMarkets: MarketSnapshot[],
  dedupeResult: OpportunityDedupeResult,
): void {
  const events = realSnapshot
    ? new Set(realSnapshot.snapshots.map((snapshot) => snapshot.eventId)).size
    : new Set(mockMarkets.map((market) => market.eventId)).size;
  const selections = realSnapshot
    ? realSnapshot.snapshots.length
    : mockMarkets.reduce((sum, market) => sum + market.snapshots.length, 0);
  const malformed = realSnapshot?.diagnostics.malformedPayloads ?? 0;
  const stale = diagnostics.rejectedByStaleData + (realSnapshot?.diagnostics.staleMarket ?? 0);

  console.log(
    `[scanner] tick=${tick} mode=${feeds.feedMode} events=${events} selections=${selections} ` +
      `opps=${diagnostics.acceptedOpportunities} ` +
      `rejected(implied=${diagnostics.rejectedByImpliedSum} stale=${stale} ` +
      `skew=${diagnostics.rejectedByQuoteSkew} malformed=${malformed}) rawOpps=${dedupeResult.rawAcceptedCount} ` +
      `uniqueOpps=${dedupeResult.uniqueAcceptedOpportunities.length} ` +
      `duplicatesSkipped=${dedupeResult.duplicateCount}`,
  );
}

function buildRealMarketsSample(snapshot: TheOddsApiSnapshotResult | null): unknown {
  if (!snapshot) {
    return {
      provider: "the_odds_api",
      receivedAt: null,
      events: [],
    };
  }

  const events = new Map<
    string,
    {
      eventId: string;
      eventName: string;
      bookmakers: Map<
        string,
        {
          bookmaker: string;
          outcomes: Array<{
            marketType: string;
            selection: string;
            odds: number;
            estimatedLiquidity: number;
            maxStakeEstimate: number;
            receivedAt: string;
            sourceTimestamp: string;
          }>;
        }
      >;
    }
  >();

  for (const snapshotItem of snapshot.snapshots) {
    let event = events.get(snapshotItem.eventId);
    if (!event) {
      if (events.size >= 5) {
        continue;
      }
      event = {
        eventId: snapshotItem.eventId,
        eventName: snapshotItem.eventName,
        bookmakers: new Map(),
      };
      events.set(snapshotItem.eventId, event);
    }

    let bookmaker = event.bookmakers.get(snapshotItem.exchange);
    if (!bookmaker) {
      bookmaker = {
        bookmaker: snapshotItem.exchangeName || snapshotItem.exchange,
        outcomes: [],
      };
      event.bookmakers.set(snapshotItem.exchange, bookmaker);
    }

    bookmaker.outcomes.push({
      marketType: snapshotItem.marketType,
      selection: snapshotItem.selection,
      odds: snapshotItem.backOdds,
      estimatedLiquidity: snapshotItem.estimatedLiquidity,
      maxStakeEstimate: snapshotItem.maxStakeEstimate,
      receivedAt: snapshotItem.receivedAt,
      sourceTimestamp: snapshotItem.sourceTimestamp,
    });
  }

  return {
    provider: snapshot.provider,
    receivedAt: snapshot.receivedAt,
    events: Array.from(events.values()).map((event) => ({
      eventId: event.eventId,
      eventName: event.eventName,
      bookmakers: Array.from(event.bookmakers.values()),
    })),
  };
}

function buildRejectedSummary(runtime: RuntimeSummary): unknown {
  return {
    arbitrage: {
      rawOpportunitiesDetected: runtime.rawOpportunitiesDetected,
      uniqueOpportunitiesFound: runtime.uniqueOpportunitiesFound,
      duplicateOpportunitiesSkipped: runtime.duplicateOpportunitiesSkipped,
      opportunityUpdatedCount: runtime.opportunityUpdatedCount,
      rejectedByLiquidity: runtime.rejectedByLiquidity,
      rejectedByStaleData: runtime.rejectedByStaleData,
      rejectedByLowEdge: runtime.rejectedByLowEdge,
      rejectedByNoCompleteOutcomeSet: runtime.rejectedByNoCompleteOutcomeSet,
      rejectedByImpliedSum: runtime.rejectedByImpliedSum,
      rejectedByUnsupportedMarketType: runtime.rejectedByUnsupportedMarketType,
      rejectedByQuoteSkew: runtime.rejectedByQuoteSkew,
      backLayCandidates: runtime.backLayCandidates,
      backLayOpportunities: runtime.backLayOpportunities,
      rejectedBackLayBySpread: runtime.rejectedBackLayBySpread,
      rejectedBackLayByQuoteSkew: runtime.rejectedBackLayByQuoteSkew,
      rejectedByLiquidityDepth: runtime.rejectedByLiquidityDepth,
      skippedLayMarketsForBackBack: runtime.skippedLayMarketsForBackBack,
      rejectedByBookmakerFilter: runtime.rejectedByBookmakerFilter,
      deniedBookmakerHits: runtime.deniedBookmakerHits,
      allowedBookmakerOpportunities: runtime.allowedBookmakerOpportunities,
      avgQuoteSkewMs: runtime.quoteSkewCount > 0 ? roundTo(runtime.quoteSkewTotalMs / runtime.quoteSkewCount, 2) : 0,
      maxQuoteSkewMs: runtime.maxQuoteSkewMs,
      avgExecutableStake:
        runtime.liquidityMetricCount > 0 ? roundTo(runtime.executableStakeTotal / runtime.liquidityMetricCount, 4) : 0,
      avgLiquidityCoverageRatio:
        runtime.liquidityMetricCount > 0
          ? roundTo(runtime.liquidityCoverageTotal / runtime.liquidityMetricCount, 4)
          : 0,
    },
    realFeedSanity: {
      malformedPayloads: runtime.malformedPayloads,
      rejectedNormalizedMarkets: runtime.rejectedNormalizedMarkets,
      missingEventId: runtime.missingEventId,
      missingSelection: runtime.missingSelection,
      invalidOdds: runtime.invalidOdds,
      duplicateOutcome: runtime.duplicateOutcome,
      incompleteMarket: runtime.incompleteMarket,
      staleMarket: runtime.staleMarket,
    },
    apiFailures: runtime.apiFailures,
  };
}

function bestAccepted(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity | null {
  let best: ArbitrageOpportunity | null = null;
  for (const opportunity of opportunities) {
    if (opportunity.status !== "accepted") {
      continue;
    }
    if (opportunity.arbMode === "BACK_BACK_SUREBET" && marketTypeIncludesLay(opportunity.marketType)) {
      throw new Error("BACK_BACK_SUREBET invariant failed: bestOpportunity marketType must not include lay");
    }
    if (!best || opportunity.netEdgePct > best.netEdgePct) {
      best = opportunity;
    }
  }
  return best;
}

function bestSurebet(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity | null {
  let best: ArbitrageOpportunity | null = null;
  for (const opportunity of opportunities) {
    if (opportunity.status !== "accepted" || opportunity.arbMode !== "BACK_BACK_SUREBET") {
      continue;
    }
    if (marketTypeIncludesLay(opportunity.marketType)) {
      throw new Error("BACK_BACK_SUREBET invariant failed: bestSurebet marketType must not include lay");
    }
    if (!best || opportunity.netEdgePct > best.netEdgePct) {
      best = opportunity;
    }
  }
  return best;
}

function bestBackLay(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity | null {
  let best: ArbitrageOpportunity | null = null;
  for (const opportunity of opportunities) {
    if (
      opportunity.status !== "accepted" ||
      opportunity.arbMode !== "BACK_LAY" ||
      !opportunity.id.startsWith("real-back-lay:")
    ) {
      continue;
    }
    if (!best || opportunity.netEdgePct > best.netEdgePct) {
      best = opportunity;
    }
  }
  return best;
}

function marketTypeIncludesLay(marketType: string): boolean {
  return marketType.toLowerCase().includes("lay");
}

function quoteSkewMetricsForTimestamps(timestamps: string[], nowIso: string): QuoteSkewMetrics {
  const parsed = timestamps
    .map((timestamp) => ({
      timestamp,
      ms: Date.parse(timestamp),
    }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((left, right) => left.ms - right.ms);

  if (parsed.length === 0) {
    return {
      oldestQuoteTimestamp: null,
      newestQuoteTimestamp: null,
      quoteAgeSpreadMs: null,
      oldestQuoteAgeMs: null,
      newestQuoteAgeMs: null,
    };
  }

  const oldest = parsed[0] as { timestamp: string; ms: number };
  const newest = parsed[parsed.length - 1] as { timestamp: string; ms: number };
  const nowMs = Date.parse(nowIso);

  return {
    oldestQuoteTimestamp: oldest.timestamp,
    newestQuoteTimestamp: newest.timestamp,
    quoteAgeSpreadMs: Math.max(0, newest.ms - oldest.ms),
    oldestQuoteAgeMs: Number.isFinite(nowMs) ? Math.max(0, nowMs - oldest.ms) : null,
    newestQuoteAgeMs: Number.isFinite(nowMs) ? Math.max(0, nowMs - newest.ms) : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

runScanner();
