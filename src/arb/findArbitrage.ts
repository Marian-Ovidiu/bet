import type {
  ArbitrageMode,
  ArbitrageOpportunity,
  AllowedNearMiss,
  QuoteSkewMetrics,
  RejectionReason,
  SurebetOutcomeLeg,
  SurebetStakePlanItem,
} from "@/types/arbitrage";
import type { MarketSnapshot } from "@/types/snapshots";
import { normalizeBookmakerKey, normalizeBookmakerList } from "@/normalizer/normalizeBookmakerKey";

const allArbitrageModes = ["BACK_LAY", "BACK_BACK_SUREBET"] as const satisfies readonly ArbitrageMode[];

export interface FindArbitrageInput {
  markets: MarketSnapshot[];
  nowIso: string;
  minEdgePct: number;
  minLiquidity: number;
  minRequiredLiquidity?: number;
  targetStakeSize?: number;
  staleDataThresholdMs: number;
  maxQuoteSkewMs?: number;
  defaultCommissionRate: number;
  commissionByExchange?: Record<string, number>;
  stake?: number;
  emitSummaryLogs?: boolean;
  arbModes?: readonly ArbitrageMode[];
  bookmakerFilter?: BookmakerFilterConfig | undefined;
}

export interface BookmakerFilterConfig {
  enabled: boolean;
  allowedBookmakers: readonly string[];
  deniedBookmakers: readonly string[];
}

export interface ArbitrageDiagnosticsCounters {
  marketsScanned: number;
  comparedPairs: number;
  opportunitiesFound: number;
  acceptedOpportunities: number;
  rejectedByLiquidity: number;
  rejectedByStaleData: number;
  rejectedByLowEdge: number;
  rejectedByIncompleteMarket: number;
  backLayCandidates: number;
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
  allowedCandidateCount: number;
  averageAllowedImpliedSum: number;
  avgQuoteSkewMs: number;
  maxQuoteSkewMs: number;
  avgExecutableStake: number;
  avgLiquidityCoverageRatio: number;
  averageNetEdgePct: number;
}

export interface FindArbitrageResult {
  opportunities: ArbitrageOpportunity[];
  allowedNearMisses: AllowedNearMiss[];
  diagnostics: ArbitrageDiagnosticsCounters;
}

export function findArbitrage(input: FindArbitrageInput): FindArbitrageResult {
  const opportunities: ArbitrageOpportunity[] = [];
  const allowedNearMisses: AllowedNearMiss[] = [];
  const stake = input.stake ?? 100;
  const arbModes = new Set(input.arbModes ?? allArbitrageModes);
  let comparedPairs = 0;
  let netEdgeAccumulator = 0;
  let allowedImpliedSumAccumulator = 0;
  let quoteSkewAccumulator = 0;
  let executableStakeAccumulator = 0;
  let liquidityCoverageAccumulator = 0;

  const counters: ArbitrageDiagnosticsCounters = {
    marketsScanned: input.markets.length,
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

  if (arbModes.has("BACK_LAY")) {
    for (const market of input.markets) {
      if (market.snapshots.length < 2) {
        counters.rejectedByIncompleteMarket += 1;
        continue;
      }

      for (let indexA = 0; indexA < market.snapshots.length - 1; indexA += 1) {
        const backCandidate = market.snapshots[indexA];
        if (!backCandidate) {
          continue;
        }

        for (let indexB = indexA + 1; indexB < market.snapshots.length; indexB += 1) {
          const layCandidate = market.snapshots[indexB];
          if (!layCandidate) {
            continue;
          }
          if (backCandidate.exchange === layCandidate.exchange) {
            continue;
          }

          comparedPairs += 1;
          counters.backLayCandidates += 1;
          const evaluated = evaluatePair({
            backCandidate,
            layCandidate,
            eventId: market.eventId,
            eventName: market.eventName,
            marketType: market.marketType,
            selection: market.selection,
            nowIso: input.nowIso,
            staleDataThresholdMs: input.staleDataThresholdMs,
            minLiquidity: input.minLiquidity,
            minEdgePct: input.minEdgePct,
            stake,
            defaultCommissionRate: input.defaultCommissionRate,
            commissionByExchange: input.commissionByExchange ?? {},
            pairIndex: comparedPairs,
          });

          opportunities.push(evaluated);
          counters.opportunitiesFound += 1;

          if (evaluated.status === "accepted") {
            counters.acceptedOpportunities += 1;
            netEdgeAccumulator += evaluated.netEdgePct;
          } else {
            updateRejectionCounters(counters, evaluated.rejectionReasons);
          }
        }
      }
    }
  }

  if (arbModes.has("BACK_BACK_SUREBET")) {
    const surebetOpportunities = findBackBackSurebets({
      markets: input.markets,
      nowIso: input.nowIso,
      staleDataThresholdMs: input.staleDataThresholdMs,
      maxQuoteSkewMs: input.maxQuoteSkewMs ?? input.staleDataThresholdMs,
      minRequiredLiquidity: input.minRequiredLiquidity ?? input.minLiquidity,
      targetStakeSize: input.targetStakeSize ?? stake,
      minEdgePct: input.minEdgePct,
      stake,
      defaultCommissionRate: input.defaultCommissionRate,
      commissionByExchange: input.commissionByExchange ?? {},
      bookmakerFilter: input.bookmakerFilter,
    });
    counters.rejectedByUnsupportedMarketType += surebetOpportunities.rejectedByUnsupportedMarketType;
    counters.skippedLayMarketsForBackBack += surebetOpportunities.skippedLayMarketsForBackBack;
    counters.deniedBookmakerHits += surebetOpportunities.deniedBookmakerHits;
    counters.allowedBookmakerOpportunities += surebetOpportunities.allowedBookmakerOpportunities;
    counters.allowedCandidateCount += surebetOpportunities.allowedCandidateCount;
    allowedImpliedSumAccumulator += surebetOpportunities.allowedImpliedSumTotal;
    quoteSkewAccumulator += surebetOpportunities.quoteSkewTotalMs;
    executableStakeAccumulator += surebetOpportunities.executableStakeTotal;
    liquidityCoverageAccumulator += surebetOpportunities.liquidityCoverageTotal;
    counters.maxQuoteSkewMs = Math.max(counters.maxQuoteSkewMs, surebetOpportunities.maxQuoteSkewMs);
    counters.backBackCandidates += surebetOpportunities.opportunities.length;
    allowedNearMisses.push(...surebetOpportunities.allowedNearMisses);

    for (const opportunity of surebetOpportunities.opportunities) {
      opportunities.push(opportunity);
      counters.opportunitiesFound += 1;

      if (opportunity.status === "accepted") {
        counters.acceptedOpportunities += 1;
        netEdgeAccumulator += opportunity.netEdgePct;
      } else {
        updateRejectionCounters(counters, opportunity.rejectionReasons);
      }
    }
  }

  counters.comparedPairs = comparedPairs;
  counters.averageNetEdgePct =
    counters.acceptedOpportunities > 0 ? netEdgeAccumulator / counters.acceptedOpportunities : 0;
  counters.averageAllowedImpliedSum =
    counters.allowedCandidateCount > 0 ? allowedImpliedSumAccumulator / counters.allowedCandidateCount : 0;
  counters.avgQuoteSkewMs =
    counters.backBackCandidates > 0 ? quoteSkewAccumulator / counters.backBackCandidates : 0;
  counters.avgExecutableStake =
    counters.backBackCandidates > 0 ? executableStakeAccumulator / counters.backBackCandidates : 0;
  counters.avgLiquidityCoverageRatio =
    counters.backBackCandidates > 0 ? liquidityCoverageAccumulator / counters.backBackCandidates : 0;

  if (input.emitSummaryLogs ?? true) {
    logArbitrageSummary(counters, opportunities);
  }

  return {
    opportunities,
    allowedNearMisses,
    diagnostics: counters,
  };
}

interface EvaluatePairInput {
  backCandidate: MarketSnapshot["snapshots"][number];
  layCandidate: MarketSnapshot["snapshots"][number];
  eventId: string;
  eventName: string;
  marketType: string;
  selection: string;
  nowIso: string;
  staleDataThresholdMs: number;
  minLiquidity: number;
  minEdgePct: number;
  stake: number;
  defaultCommissionRate: number;
  commissionByExchange: Record<string, number>;
  pairIndex: number;
}

function evaluatePair(input: EvaluatePairInput): ArbitrageOpportunity {
  const detectedAt = input.nowIso;
  const rejectionReasons: RejectionReason[] = [];

  const backCommission = commissionForExchange(
    input.backCandidate.exchange,
    input.defaultCommissionRate,
    input.commissionByExchange,
  );
  const layCommission = commissionForExchange(
    input.layCandidate.exchange,
    input.defaultCommissionRate,
    input.commissionByExchange,
  );

  const grossEdgePct = toPct((input.backCandidate.backOdds - input.layCandidate.layOdds) / input.layCandidate.layOdds);
  const commissionCostPct = toPct(backCommission + layCommission);
  const netEdgePct = grossEdgePct - commissionCostPct;
  const estimatedProfit = roundTo((netEdgePct / 100) * input.stake, 4);

  if (input.backCandidate.liquidity < input.minLiquidity || input.layCandidate.liquidity < input.minLiquidity) {
    rejectionReasons.push("insufficient_liquidity");
  }

  const nowMs = Date.parse(input.nowIso);
  const backTsMs = Date.parse(input.backCandidate.timestamp);
  const layTsMs = Date.parse(input.layCandidate.timestamp);
  if (nowMs - backTsMs > input.staleDataThresholdMs || nowMs - layTsMs > input.staleDataThresholdMs) {
    rejectionReasons.push("stale_feed");
  }

  if (netEdgePct < input.minEdgePct) {
    rejectionReasons.push("low_edge");
  }

  const status = rejectionReasons.length === 0 ? "accepted" : "rejected";

  return {
    id: `${input.eventId}:${input.selection}:${input.backCandidate.exchange}->${input.layCandidate.exchange}:${input.pairIndex}`,
    arbMode: "BACK_LAY",
    eventId: input.eventId,
    eventName: input.eventName,
    marketType: input.marketType,
    selection: input.selection,
    status,
    legs: [
      {
        exchange: input.backCandidate.exchange,
        side: "back",
        odds: input.backCandidate.backOdds,
        liquidity: input.backCandidate.liquidity,
        commissionRate: backCommission,
      },
      {
        exchange: input.layCandidate.exchange,
        side: "lay",
        odds: input.layCandidate.layOdds,
        liquidity: input.layCandidate.liquidity,
        commissionRate: layCommission,
      },
    ] as const,
    outcomeLegs: [],
    impliedSum: null,
    stakePlan: [],
    guaranteedPayout: null,
    grossEdgePct: roundTo(grossEdgePct, 4),
    netEdgePct: roundTo(netEdgePct, 4),
    estimatedProfit,
    rejectionReasons,
    detectedAt,
    sourceSnapshotTimestamps: [input.backCandidate.timestamp, input.layCandidate.timestamp] as const,
    oldestQuoteTimestamp: null,
    newestQuoteTimestamp: null,
    quoteAgeSpreadMs: null,
    oldestQuoteAgeMs: null,
    newestQuoteAgeMs: null,
    executableStake: input.stake,
    liquidityCoverageRatio: 1,
  };
}

interface FindBackBackSurebetsInput {
  markets: MarketSnapshot[];
  nowIso: string;
  staleDataThresholdMs: number;
  maxQuoteSkewMs: number;
  minRequiredLiquidity: number;
  targetStakeSize: number;
  minEdgePct: number;
  stake: number;
  defaultCommissionRate: number;
  commissionByExchange: Record<string, number>;
  bookmakerFilter?: BookmakerFilterConfig | undefined;
}

interface SurebetEventMarketGroup {
  eventId: string;
  eventName: string;
  marketType: string;
  markets: MarketSnapshot[];
}

interface FindBackBackSurebetsResult {
  opportunities: ArbitrageOpportunity[];
  allowedNearMisses: AllowedNearMiss[];
  rejectedByUnsupportedMarketType: number;
  skippedLayMarketsForBackBack: number;
  deniedBookmakerHits: number;
  allowedBookmakerOpportunities: number;
  allowedCandidateCount: number;
  allowedImpliedSumTotal: number;
  quoteSkewTotalMs: number;
  maxQuoteSkewMs: number;
  executableStakeTotal: number;
  liquidityCoverageTotal: number;
}

interface EvaluatedBackBackSurebet {
  opportunity: ArbitrageOpportunity;
  nearMiss: AllowedNearMiss | null;
  deniedBookmakerHits: number;
  passedBookmakerFilter: boolean;
  allowedCandidateImpliedSum: number | null;
}

function findBackBackSurebets(input: FindBackBackSurebetsInput): FindBackBackSurebetsResult {
  const opportunities: ArbitrageOpportunity[] = [];
  const allowedNearMisses: AllowedNearMiss[] = [];
  const groups = groupMarketsByEventAndType(input.markets);
  let groupIndex = 0;
  let rejectedByUnsupportedMarketType = 0;
  let skippedLayMarketsForBackBack = 0;
  let deniedBookmakerHits = 0;
  let allowedBookmakerOpportunities = 0;
  let allowedCandidateCount = 0;
  let allowedImpliedSumTotal = 0;
  let quoteSkewTotalMs = 0;
  let maxQuoteSkewMs = 0;
  let executableStakeTotal = 0;
  let liquidityCoverageTotal = 0;

  for (const group of groups) {
    if (isLayMarketType(group.marketType)) {
      skippedLayMarketsForBackBack += 1;
      continue;
    }
    if (!isSupportedBackBackMarketType(group.marketType)) {
      rejectedByUnsupportedMarketType += 1;
      continue;
    }
    groupIndex += 1;
    const evaluated = evaluateBackBackSurebetGroup(input, group, groupIndex);
    deniedBookmakerHits += evaluated.deniedBookmakerHits;
    if (evaluated.allowedCandidateImpliedSum !== null) {
      allowedCandidateCount += 1;
      allowedImpliedSumTotal += evaluated.allowedCandidateImpliedSum;
    }
    if (evaluated.opportunity.quoteAgeSpreadMs !== null) {
      quoteSkewTotalMs += evaluated.opportunity.quoteAgeSpreadMs;
      maxQuoteSkewMs = Math.max(maxQuoteSkewMs, evaluated.opportunity.quoteAgeSpreadMs);
    }
    executableStakeTotal += evaluated.opportunity.executableStake;
    liquidityCoverageTotal += evaluated.opportunity.liquidityCoverageRatio;
    if (evaluated.passedBookmakerFilter && evaluated.opportunity.status === "accepted") {
      allowedBookmakerOpportunities += 1;
    }
    if (evaluated.nearMiss) {
      allowedNearMisses.push(evaluated.nearMiss);
    }
    assertBackBackMarketIsNotLay(evaluated.opportunity);
    opportunities.push(evaluated.opportunity);
  }

  return {
    opportunities,
    allowedNearMisses,
    rejectedByUnsupportedMarketType,
    skippedLayMarketsForBackBack,
    deniedBookmakerHits,
    allowedBookmakerOpportunities,
    allowedCandidateCount,
    allowedImpliedSumTotal,
    quoteSkewTotalMs,
    maxQuoteSkewMs,
    executableStakeTotal,
    liquidityCoverageTotal,
  };
}

function evaluateBackBackSurebetGroup(
  input: FindBackBackSurebetsInput,
  group: SurebetEventMarketGroup,
  groupIndex: number,
): EvaluatedBackBackSurebet {
  const rejectionReasons: RejectionReason[] = [];
  const requiredOutcomeCount = group.markets.length;
  const completeOutcomeSet = requiredOutcomeCount === 2 || requiredOutcomeCount === 3;
  const selected = completeOutcomeSet
    ? selectBestOutcomeLegs(group, input.bookmakerFilter)
    : emptyOutcomeLegSelection();
  const outcomeLegs = selected.outcomeLegs;
  const quoteSkew = computeQuoteSkewMetrics(outcomeLegs, input.nowIso);
  const liquidity = computeSurebetLiquidity(outcomeLegs, input.targetStakeSize);

  if (!completeOutcomeSet || outcomeLegs.length !== requiredOutcomeCount) {
    rejectionReasons.push("no_complete_outcome_set");
  }
  if (outcomeLegs.some((leg) => leg.estimatedLiquidity < input.minRequiredLiquidity)) {
    rejectionReasons.push("liquidity_depth_too_low");
  }
  if (liquidity.executableStake < input.targetStakeSize) {
    rejectionReasons.push("liquidity_depth_too_low");
  }

  const stale = outcomeLegs.some(
    (leg) => Date.parse(input.nowIso) - Date.parse(leg.sourceTimestamp) > input.staleDataThresholdMs,
  );
  if (stale) {
    rejectionReasons.push("stale_feed");
  }
  if (quoteSkew.quoteAgeSpreadMs !== null && quoteSkew.quoteAgeSpreadMs > input.maxQuoteSkewMs) {
    rejectionReasons.push("quote_skew_too_high");
  }

  const bookmakerFilterResult = evaluateBookmakerFilter(
    outcomeLegs,
    input.bookmakerFilter,
    selected,
    completeOutcomeSet && outcomeLegs.length === requiredOutcomeCount,
  );
  rejectionReasons.push(...bookmakerFilterResult.rejectionReasons);

  const impliedSum = outcomeLegs.length === requiredOutcomeCount && completeOutcomeSet
    ? roundTo(outcomeLegs.reduce((sum, leg) => sum + 1 / leg.odds, 0), 8)
    : null;

  if (impliedSum !== null && impliedSum >= 1) {
    rejectionReasons.push("implied_sum_not_profitable");
  }

  const grossEdgePct = impliedSum !== null ? roundTo((1 / impliedSum - 1) * 100, 4) : 0;
  const effectiveCommissionRate = effectiveSurebetCommissionRate(outcomeLegs, input.defaultCommissionRate, input.commissionByExchange);
  const netEdgePct = roundTo(grossEdgePct - toPct(effectiveCommissionRate), 4);
  if (impliedSum !== null && netEdgePct < input.minEdgePct) {
    rejectionReasons.push("low_edge");
  }

  const guaranteedPayout = impliedSum !== null ? roundTo(input.stake / impliedSum, 4) : null;
  const estimatedProfit = guaranteedPayout !== null ? roundTo(input.stake * (netEdgePct / 100), 4) : 0;
  const stakePlan = guaranteedPayout !== null ? buildStakePlan(outcomeLegs, guaranteedPayout) : [];
  const status = rejectionReasons.length === 0 ? "accepted" : "rejected";
  const allowedCandidateImpliedSum = impliedSum !== null && bookmakerFilterResult.passed && !stale ? impliedSum : null;
  const normalizedMarketType = normalizeSurebetMarketType(group.marketType, requiredOutcomeCount);
  const nearMiss =
    impliedSum !== null && bookmakerFilterResult.passed && impliedSum >= 1
      ? buildAllowedNearMiss({
          eventName: group.eventName,
          marketType: normalizedMarketType,
          impliedSum,
          outcomeLegs,
          quoteSkew,
          executableStake: liquidity.executableStake,
          liquidityCoverageRatio: liquidity.liquidityCoverageRatio,
        })
      : null;

  return {
    opportunity: {
      id: `${group.eventId}:${group.marketType}:BACK_BACK_SUREBET:${groupIndex}`,
      arbMode: "BACK_BACK_SUREBET",
      eventId: group.eventId,
      eventName: group.eventName,
      marketType: normalizedMarketType,
      selection: "ALL_OUTCOMES",
      status,
      legs: placeholderBackLayLegs(outcomeLegs, input.defaultCommissionRate),
      outcomeLegs,
      impliedSum,
      stakePlan,
      guaranteedPayout,
      grossEdgePct,
      netEdgePct,
      estimatedProfit,
      rejectionReasons,
      detectedAt: input.nowIso,
      sourceSnapshotTimestamps: sourceTimestampsForSurebet(outcomeLegs, input.nowIso),
      oldestQuoteTimestamp: quoteSkew.oldestQuoteTimestamp,
      newestQuoteTimestamp: quoteSkew.newestQuoteTimestamp,
      quoteAgeSpreadMs: quoteSkew.quoteAgeSpreadMs,
      oldestQuoteAgeMs: quoteSkew.oldestQuoteAgeMs,
      newestQuoteAgeMs: quoteSkew.newestQuoteAgeMs,
      executableStake: liquidity.executableStake,
      liquidityCoverageRatio: liquidity.liquidityCoverageRatio,
    },
    nearMiss,
    deniedBookmakerHits: bookmakerFilterResult.deniedBookmakerHits,
    passedBookmakerFilter: bookmakerFilterResult.passed,
    allowedCandidateImpliedSum,
  };
}

function groupMarketsByEventAndType(markets: MarketSnapshot[]): SurebetEventMarketGroup[] {
  const grouped = new Map<string, SurebetEventMarketGroup>();

  for (const market of markets) {
    const key = `${market.eventId}|${market.marketType}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.markets.push(market);
    } else {
      grouped.set(key, {
        eventId: market.eventId,
        eventName: market.eventName,
        marketType: market.marketType,
        markets: [market],
      });
    }
  }

  return Array.from(grouped.values());
}

interface OutcomeLegSelection {
  outcomeLegs: SurebetOutcomeLeg[];
  filterRejectionReasons: RejectionReason[];
  deniedBookmakerHits: number;
}

function emptyOutcomeLegSelection(): OutcomeLegSelection {
  return {
    outcomeLegs: [],
    filterRejectionReasons: [],
    deniedBookmakerHits: 0,
  };
}

function selectBestOutcomeLegs(
  group: SurebetEventMarketGroup,
  filter: BookmakerFilterConfig | undefined,
): OutcomeLegSelection {
  const legs: SurebetOutcomeLeg[] = [];
  const seenOutcomes = new Set<string>();
  const filterRejectionReasons = new Set<RejectionReason>();
  const filterEnabled = filter?.enabled ?? false;
  const allowed = filterEnabled ? new Set(normalizeBookmakerList(filter?.allowedBookmakers ?? [])) : null;
  const denied = filterEnabled ? new Set(normalizeBookmakerList(filter?.deniedBookmakers ?? [])) : null;
  let deniedBookmakerHits = 0;

  for (const market of group.markets) {
    if (seenOutcomes.has(market.selection)) {
      continue;
    }
    seenOutcomes.add(market.selection);

    const eligibleSnapshots = market.snapshots.filter((snapshot) => {
      if (!filterEnabled || !allowed || !denied) {
        return true;
      }

      const bookmakerKey = normalizeBookmakerKey(snapshot.exchange);
      if (bookmakerKey.length === 0) {
        filterRejectionReasons.add("bookmaker_not_allowed:unknown");
        return false;
      }
      if (denied.has(bookmakerKey)) {
        deniedBookmakerHits += 1;
        filterRejectionReasons.add(`denied_bookmaker:${bookmakerKey}`);
        return false;
      }
      if (!allowed.has(bookmakerKey)) {
        filterRejectionReasons.add(`bookmaker_not_allowed:${bookmakerKey}`);
        return false;
      }
      return true;
    });

    const best = eligibleSnapshots.reduce<MarketSnapshot["snapshots"][number] | null>((currentBest, snapshot) => {
      if (!currentBest || snapshot.backOdds > currentBest.backOdds) {
        return snapshot;
      }
      return currentBest;
    }, null);

    if (!best) {
      continue;
    }

    legs.push({
      bookmaker: best.exchange,
      exchange: best.exchange,
      outcome: market.selection,
      odds: best.backOdds,
      sourceTimestamp: best.timestamp,
      estimatedLiquidity: best.estimatedLiquidity ?? best.liquidity,
      maxStakeEstimate: best.maxStakeEstimate ?? best.liquidity,
    });
  }

  return {
    outcomeLegs: legs,
    filterRejectionReasons: Array.from(filterRejectionReasons).sort(),
    deniedBookmakerHits,
  };
}

interface BookmakerFilterResult {
  rejectionReasons: RejectionReason[];
  deniedBookmakerHits: number;
  passed: boolean;
}

function evaluateBookmakerFilter(
  outcomeLegs: readonly SurebetOutcomeLeg[],
  filter: BookmakerFilterConfig | undefined,
  selection: OutcomeLegSelection,
  selectionComplete: boolean,
): BookmakerFilterResult {
  if (!filter?.enabled) {
    return {
      rejectionReasons: [],
      deniedBookmakerHits: 0,
      passed: true,
    };
  }

  const allowed = new Set(normalizeBookmakerList(filter.allowedBookmakers));
  const denied = new Set(normalizeBookmakerList(filter.deniedBookmakers));
  const detailReasons = new Set<RejectionReason>();
  let deniedBookmakerHits = 0;

  for (const leg of outcomeLegs) {
    const bookmakerKey = normalizeBookmakerKey(leg.bookmaker);
    if (bookmakerKey.length === 0) {
      detailReasons.add("bookmaker_not_allowed:unknown");
      continue;
    }

    if (denied.has(bookmakerKey)) {
      deniedBookmakerHits += 1;
      detailReasons.add(`denied_bookmaker:${bookmakerKey}`);
    }

    if (!allowed.has(bookmakerKey)) {
      detailReasons.add(`bookmaker_not_allowed:${bookmakerKey}`);
    }
  }

  if (!selectionComplete) {
    for (const reason of selection.filterRejectionReasons) {
      detailReasons.add(reason);
    }
  }

  const rejectionReasons: RejectionReason[] = detailReasons.size > 0
    ? ["bookmaker_filter", ...Array.from(detailReasons).sort()]
    : [];

  return {
    rejectionReasons,
    deniedBookmakerHits: deniedBookmakerHits + selection.deniedBookmakerHits,
    passed: rejectionReasons.length === 0,
  };
}

interface BuildAllowedNearMissInput {
  eventName: string;
  marketType: string;
  impliedSum: number;
  outcomeLegs: SurebetOutcomeLeg[];
  quoteSkew: QuoteSkewMetrics;
  executableStake: number;
  liquidityCoverageRatio: number;
}

function buildAllowedNearMiss(input: BuildAllowedNearMissInput): AllowedNearMiss {
  const bookmakerSet = Array.from(
    new Set(input.outcomeLegs.map((leg) => normalizeBookmakerKey(leg.bookmaker)).filter((key) => key.length > 0)),
  ).sort();
  const sourceTimestamps = Array.from(new Set(input.outcomeLegs.map((leg) => leg.sourceTimestamp))).sort();

  return {
    eventName: input.eventName,
    marketType: input.marketType,
    impliedSum: input.impliedSum,
    missingEdgePct: roundTo((1 - input.impliedSum) * 100, 4),
    bestOutcomeLegs: input.outcomeLegs,
    bookmakerSet,
    sourceTimestamps,
    oldestQuoteTimestamp: input.quoteSkew.oldestQuoteTimestamp,
    newestQuoteTimestamp: input.quoteSkew.newestQuoteTimestamp,
    quoteAgeSpreadMs: input.quoteSkew.quoteAgeSpreadMs,
    oldestQuoteAgeMs: input.quoteSkew.oldestQuoteAgeMs,
    newestQuoteAgeMs: input.quoteSkew.newestQuoteAgeMs,
    executableStake: input.executableStake,
    liquidityCoverageRatio: input.liquidityCoverageRatio,
  };
}

interface LiquidityExecutionMetrics {
  executableStake: number;
  liquidityCoverageRatio: number;
}

function computeSurebetLiquidity(
  outcomeLegs: readonly SurebetOutcomeLeg[],
  targetStakeSize: number,
): LiquidityExecutionMetrics {
  if (outcomeLegs.length === 0 || targetStakeSize <= 0) {
    return {
      executableStake: 0,
      liquidityCoverageRatio: 0,
    };
  }

  const impliedSum = outcomeLegs.reduce((sum, leg) => sum + 1 / leg.odds, 0);
  if (impliedSum <= 0) {
    return {
      executableStake: 0,
      liquidityCoverageRatio: 0,
    };
  }

  const executableStake = outcomeLegs.reduce((currentMaxStake, leg) => {
    const allocationRatio = (1 / leg.odds) / impliedSum;
    if (allocationRatio <= 0) {
      return currentMaxStake;
    }
    return Math.min(currentMaxStake, leg.maxStakeEstimate / allocationRatio);
  }, targetStakeSize);
  const cappedStake = roundTo(Math.max(0, Math.min(targetStakeSize, executableStake)), 4);

  return {
    executableStake: cappedStake,
    liquidityCoverageRatio: roundTo(cappedStake / targetStakeSize, 4),
  };
}

function computeQuoteSkewMetrics(
  outcomeLegs: readonly SurebetOutcomeLeg[],
  nowIso: string,
): QuoteSkewMetrics {
  const parsedTimestamps = outcomeLegs
    .map((leg) => ({
      timestamp: leg.sourceTimestamp,
      ms: Date.parse(leg.sourceTimestamp),
    }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((left, right) => left.ms - right.ms);

  if (parsedTimestamps.length === 0) {
    return {
      oldestQuoteTimestamp: null,
      newestQuoteTimestamp: null,
      quoteAgeSpreadMs: null,
      oldestQuoteAgeMs: null,
      newestQuoteAgeMs: null,
    };
  }

  const oldest = parsedTimestamps[0] as { timestamp: string; ms: number };
  const newest = parsedTimestamps[parsedTimestamps.length - 1] as { timestamp: string; ms: number };
  const nowMs = Date.parse(nowIso);

  return {
    oldestQuoteTimestamp: oldest.timestamp,
    newestQuoteTimestamp: newest.timestamp,
    quoteAgeSpreadMs: Math.max(0, newest.ms - oldest.ms),
    oldestQuoteAgeMs: Number.isFinite(nowMs) ? Math.max(0, nowMs - oldest.ms) : null,
    newestQuoteAgeMs: Number.isFinite(nowMs) ? Math.max(0, nowMs - newest.ms) : null,
  };
}

function buildStakePlan(outcomeLegs: SurebetOutcomeLeg[], guaranteedPayout: number): SurebetStakePlanItem[] {
  return outcomeLegs.map((leg) => ({
    bookmaker: leg.bookmaker,
    outcome: leg.outcome,
    odds: leg.odds,
    stake: roundTo(guaranteedPayout / leg.odds, 4),
    expectedPayout: guaranteedPayout,
  }));
}

function effectiveSurebetCommissionRate(
  outcomeLegs: SurebetOutcomeLeg[],
  defaultCommissionRate: number,
  commissionByExchange: Record<string, number>,
): number {
  if (outcomeLegs.length === 0) {
    return clamp(defaultCommissionRate, 0, 1);
  }

  const total = outcomeLegs.reduce(
    (sum, leg) => sum + commissionForExchange(leg.exchange, defaultCommissionRate, commissionByExchange),
    0,
  );
  return clamp(total / outcomeLegs.length, 0, 1);
}

function placeholderBackLayLegs(
  outcomeLegs: SurebetOutcomeLeg[],
  defaultCommissionRate: number,
): readonly [ArbitrageOpportunity["legs"][number], ArbitrageOpportunity["legs"][number]] {
  const first = outcomeLegs[0];
  const second = outcomeLegs[1] ?? first;
  return [
    {
      exchange: first?.exchange ?? "none",
      side: "back",
      odds: first?.odds ?? 1,
      liquidity: 0,
      commissionRate: defaultCommissionRate,
    },
    {
      exchange: second?.exchange ?? "none",
      side: "back",
      odds: second?.odds ?? 1,
      liquidity: 0,
      commissionRate: defaultCommissionRate,
    },
  ] as const;
}

function sourceTimestampsForSurebet(outcomeLegs: SurebetOutcomeLeg[], fallback: string): readonly [string, string] {
  const first = outcomeLegs[0]?.sourceTimestamp ?? fallback;
  const second = outcomeLegs[1]?.sourceTimestamp ?? first;
  return [first, second] as const;
}

function normalizeSurebetMarketType(marketType: string, outcomeCount: number): string {
  if (marketType === "h2h" && outcomeCount === 3) {
    return "football_match_odds";
  }
  if (marketType === "h2h" && outcomeCount === 2) {
    return "tennis_winner";
  }
  return marketType;
}

function isLayMarketType(marketType: string): boolean {
  return marketType.toLowerCase().includes("lay");
}

function isSupportedBackBackMarketType(marketType: string): boolean {
  return marketType === "h2h" || marketType === "football_match_odds" || marketType === "tennis_winner";
}

function assertBackBackMarketIsNotLay(opportunity: ArbitrageOpportunity): void {
  if (opportunity.arbMode === "BACK_BACK_SUREBET" && isLayMarketType(opportunity.marketType)) {
    throw new Error("BACK_BACK_SUREBET invariant failed: marketType must not include lay");
  }
}

function updateRejectionCounters(
  counters: ArbitrageDiagnosticsCounters,
  rejectionReasons: RejectionReason[],
): void {
  for (const reason of rejectionReasons) {
    if (reason === "insufficient_liquidity") {
      counters.rejectedByLiquidity += 1;
    } else if (reason === "stale_feed") {
      counters.rejectedByStaleData += 1;
    } else if (reason === "low_edge") {
      counters.rejectedByLowEdge += 1;
    } else if (reason === "incomplete_market") {
      counters.rejectedByIncompleteMarket += 1;
    } else if (reason === "no_complete_outcome_set") {
      counters.rejectedByNoCompleteOutcomeSet += 1;
    } else if (reason === "implied_sum_not_profitable") {
      counters.rejectedByImpliedSum += 1;
    } else if (reason === "unsupported_market_type") {
      counters.rejectedByUnsupportedMarketType += 1;
    } else if (reason === "quote_skew_too_high") {
      counters.rejectedByQuoteSkew += 1;
    } else if (reason === "liquidity_depth_too_low") {
      counters.rejectedByLiquidityDepth += 1;
    } else if (reason === "bookmaker_filter") {
      counters.rejectedByBookmakerFilter += 1;
    }
  }
}

function commissionForExchange(
  exchange: string,
  defaultCommissionRate: number,
  commissionByExchange: Record<string, number>,
): number {
  const specific = commissionByExchange[exchange];
  if (typeof specific === "number") {
    return clamp(specific, 0, 1);
  }
  return clamp(defaultCommissionRate, 0, 1);
}

function logArbitrageSummary(
  counters: ArbitrageDiagnosticsCounters,
  opportunities: ArbitrageOpportunity[],
): void {
  const accepted = opportunities.filter((opportunity) => opportunity.status === "accepted");
  const best = accepted.reduce<ArbitrageOpportunity | null>(
    (currentBest, opportunity) =>
      currentBest && currentBest.netEdgePct > opportunity.netEdgePct ? currentBest : opportunity,
    null,
  );

  console.log("===========================================================");
  console.log("ARB SCANNER SUMMARY");
  console.log("===========================================================");
  console.log(`Markets scanned        : ${counters.marketsScanned}`);
  console.log(`Pairs compared         : ${counters.comparedPairs}`);
  console.log(`Back/lay candidates    : ${counters.backLayCandidates}`);
  console.log(`Back/back candidates   : ${counters.backBackCandidates}`);
  console.log(`Opportunities (total)  : ${counters.opportunitiesFound}`);
  console.log(`Accepted opportunities : ${counters.acceptedOpportunities}`);
  console.log(`Rejected by liquidity  : ${counters.rejectedByLiquidity}`);
  console.log(`Rejected by stale data : ${counters.rejectedByStaleData}`);
  console.log(`Rejected by low edge   : ${counters.rejectedByLowEdge}`);
  console.log(`Rejected by outcomes   : ${counters.rejectedByNoCompleteOutcomeSet}`);
  console.log(`Rejected by implied sum: ${counters.rejectedByImpliedSum}`);
  console.log(`Rejected unsupported   : ${counters.rejectedByUnsupportedMarketType}`);
  console.log(`Rejected quote skew    : ${counters.rejectedByQuoteSkew}`);
  console.log(`Rejected liquidity     : ${counters.rejectedByLiquidityDepth}`);
  console.log(`Skipped lay surebets   : ${counters.skippedLayMarketsForBackBack}`);
  console.log(`Rejected bookmakers    : ${counters.rejectedByBookmakerFilter}`);
  console.log(`Denied bookmaker hits  : ${counters.deniedBookmakerHits}`);
  console.log(`Allowed bookmaker opps : ${counters.allowedBookmakerOpportunities}`);
  console.log(`Avg quote skew (ms)    : ${roundTo(counters.avgQuoteSkewMs, 2)}`);
  console.log(`Max quote skew (ms)    : ${counters.maxQuoteSkewMs}`);
  console.log(`Avg executable stake   : ${roundTo(counters.avgExecutableStake, 2)}`);
  console.log(`Avg liquidity coverage : ${roundTo(counters.avgLiquidityCoverageRatio, 4)}`);
  console.log(`Avg net edge (%)       : ${roundTo(counters.averageNetEdgePct, 4)}`);
  if (best) {
    console.log(
      `Best opportunity       : ${best.eventName} | ${best.selection} | net edge ${roundTo(best.netEdgePct, 4)}%`,
    );
  } else {
    console.log("Best opportunity       : none");
  }
  console.log("===========================================================");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPct(value: number): number {
  return value * 100;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
