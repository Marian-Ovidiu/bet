import type { IsoTimestamp } from "@/types/common";

export interface SessionDiagnosticsCounters {
  marketsScanned: number;
  opportunitiesFound: number;
  rejectedByLiquidity: number;
  rejectedByStaleData: number;
  rejectedByLowEdge: number;
  paperTradesOpened: number;
}

export interface SessionDiagnostics {
  sessionId: string;
  startedAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  counters: SessionDiagnosticsCounters;
  cumulativeEdgePct: number;
  averageEdgePct: number;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp;
  totalMarketsScanned: number;
  totalOpportunitiesFound: number;
  rejectedByLiquidity: number;
  rejectedByStaleData: number;
  rejectedByLowEdge: number;
  averageEdgePct: number;
  paperTradesOpened: number;
}
