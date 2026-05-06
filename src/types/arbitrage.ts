import type { IsoTimestamp } from "@/types/common";

export type OpportunityStatus = "accepted" | "rejected";

export type RejectionReason =
  | "insufficient_liquidity"
  | "stale_feed"
  | "low_edge"
  | "incomplete_market";

export interface ArbitrageLeg {
  exchange: string;
  side: "back" | "lay";
  odds: number;
  liquidity: number;
  commissionRate: number;
}

export interface ArbitrageOpportunity {
  id: string;
  eventId: string;
  eventName: string;
  marketType: string;
  selection: string;
  status: OpportunityStatus;
  legs: readonly [ArbitrageLeg, ArbitrageLeg];
  grossEdgePct: number;
  netEdgePct: number;
  estimatedProfit: number;
  rejectionReasons: RejectionReason[];
  detectedAt: IsoTimestamp;
  sourceSnapshotTimestamps: readonly [IsoTimestamp, IsoTimestamp];
}
