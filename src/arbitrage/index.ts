import type { ArbitrageOpportunity } from "@/types/arbitrage";
import type { MarketSnapshot } from "@/types/snapshots";

export interface ArbitrageEvaluationInput {
  market: MarketSnapshot;
  staleDataThresholdMs: number;
  minEdgePct: number;
  minLiquidity: number;
  nowIso: string;
}

export interface ArbitrageEngine {
  evaluate(input: ArbitrageEvaluationInput): ArbitrageOpportunity[];
}
