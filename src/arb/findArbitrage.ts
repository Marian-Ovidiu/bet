import type { ArbitrageOpportunity, RejectionReason } from "@/types/arbitrage";
import type { MarketSnapshot } from "@/types/snapshots";

export interface FindArbitrageInput {
  markets: MarketSnapshot[];
  nowIso: string;
  minEdgePct: number;
  minLiquidity: number;
  staleDataThresholdMs: number;
  defaultCommissionRate: number;
  commissionByExchange?: Record<string, number>;
  stake?: number;
  emitSummaryLogs?: boolean;
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
  averageNetEdgePct: number;
}

export interface FindArbitrageResult {
  opportunities: ArbitrageOpportunity[];
  diagnostics: ArbitrageDiagnosticsCounters;
}

export function findArbitrage(input: FindArbitrageInput): FindArbitrageResult {
  const opportunities: ArbitrageOpportunity[] = [];
  const stake = input.stake ?? 100;
  let comparedPairs = 0;
  let netEdgeAccumulator = 0;

  const counters: ArbitrageDiagnosticsCounters = {
    marketsScanned: input.markets.length,
    comparedPairs: 0,
    opportunitiesFound: 0,
    acceptedOpportunities: 0,
    rejectedByLiquidity: 0,
    rejectedByStaleData: 0,
    rejectedByLowEdge: 0,
    rejectedByIncompleteMarket: 0,
    averageNetEdgePct: 0,
  };

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

  counters.comparedPairs = comparedPairs;
  counters.averageNetEdgePct =
    counters.acceptedOpportunities > 0 ? netEdgeAccumulator / counters.acceptedOpportunities : 0;

  if (input.emitSummaryLogs ?? true) {
    logArbitrageSummary(counters, opportunities);
  }

  return {
    opportunities,
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
    grossEdgePct: roundTo(grossEdgePct, 4),
    netEdgePct: roundTo(netEdgePct, 4),
    estimatedProfit,
    rejectionReasons,
    detectedAt,
    sourceSnapshotTimestamps: [input.backCandidate.timestamp, input.layCandidate.timestamp] as const,
  };
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
  console.log(`Opportunities (total)  : ${counters.opportunitiesFound}`);
  console.log(`Accepted opportunities : ${counters.acceptedOpportunities}`);
  console.log(`Rejected by liquidity  : ${counters.rejectedByLiquidity}`);
  console.log(`Rejected by stale data : ${counters.rejectedByStaleData}`);
  console.log(`Rejected by low edge   : ${counters.rejectedByLowEdge}`);
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
