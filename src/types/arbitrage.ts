import type { IsoTimestamp } from "@/types/common";

export type OpportunityStatus = "accepted" | "rejected";
export type ArbitrageMode = "BACK_LAY" | "BACK_BACK_SUREBET";

export type RejectionReason =
  | "insufficient_liquidity"
  | "stale_feed"
  | "low_edge"
  | "incomplete_market"
  | "no_complete_outcome_set"
  | "implied_sum_not_profitable"
  | "unsupported_market_type"
  | "quote_skew_too_high"
  | "liquidity_depth_too_low"
  | "bookmaker_filter"
  | `denied_bookmaker:${string}`
  | `bookmaker_not_allowed:${string}`;

export interface ArbitrageLeg {
  exchange: string;
  side: "back" | "lay";
  odds: number;
  liquidity: number;
  commissionRate: number;
}

export interface SurebetOutcomeLeg {
  bookmaker: string;
  exchange: string;
  outcome: string;
  odds: number;
  sourceTimestamp: IsoTimestamp;
  estimatedLiquidity: number;
  maxStakeEstimate: number;
}

export interface SurebetStakePlanItem {
  bookmaker: string;
  outcome: string;
  odds: number;
  stake: number;
  expectedPayout: number;
}

export interface QuoteSkewMetrics {
  oldestQuoteTimestamp: IsoTimestamp | null;
  newestQuoteTimestamp: IsoTimestamp | null;
  quoteAgeSpreadMs: number | null;
  oldestQuoteAgeMs: number | null;
  newestQuoteAgeMs: number | null;
}

export interface AllowedNearMiss {
  eventName: string;
  marketType: string;
  impliedSum: number;
  missingEdgePct: number;
  bestOutcomeLegs: SurebetOutcomeLeg[];
  bookmakerSet: string[];
  sourceTimestamps: IsoTimestamp[];
  oldestQuoteTimestamp: IsoTimestamp | null;
  newestQuoteTimestamp: IsoTimestamp | null;
  quoteAgeSpreadMs: number | null;
  oldestQuoteAgeMs: number | null;
  newestQuoteAgeMs: number | null;
  executableStake: number;
  liquidityCoverageRatio: number;
}

export interface NearMissAlert {
  eventName: string;
  impliedSum: number;
  missingEdgePct: number;
  quoteAgeSpreadMs: number | null;
  bookmakerSet: string[];
  bestOutcomeLegs: SurebetOutcomeLeg[];
  detectedAt: IsoTimestamp;
  alertLevel: "near" | "strong";
}

export interface ArbitrageOpportunity {
  id: string;
  arbMode: ArbitrageMode;
  eventId: string;
  eventName: string;
  marketType: string;
  selection: string;
  status: OpportunityStatus;
  legs: readonly [ArbitrageLeg, ArbitrageLeg];
  outcomeLegs: SurebetOutcomeLeg[];
  impliedSum: number | null;
  stakePlan: SurebetStakePlanItem[];
  guaranteedPayout: number | null;
  grossEdgePct: number;
  netEdgePct: number;
  estimatedProfit: number;
  rejectionReasons: RejectionReason[];
  detectedAt: IsoTimestamp;
  sourceSnapshotTimestamps: readonly [IsoTimestamp, IsoTimestamp];
  oldestQuoteTimestamp: IsoTimestamp | null;
  newestQuoteTimestamp: IsoTimestamp | null;
  quoteAgeSpreadMs: number | null;
  oldestQuoteAgeMs: number | null;
  newestQuoteAgeMs: number | null;
  executableStake: number;
  liquidityCoverageRatio: number;
}
