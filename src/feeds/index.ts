import type { ExchangeSnapshot } from "@/types/snapshots";

export interface FeedPullResult {
  exchange: string;
  fetchedAt: string;
  snapshots: ExchangeSnapshot[];
}

export interface ExchangeFeedAdapter {
  readonly exchange: string;
  pullSnapshots(nowIso: string): Promise<FeedPullResult>;
}

export interface FeedDiagnostics {
  generatedEvents: number;
  staleSnapshots: number;
  updateCount: number;
  generatedArbBiasCount: number;
  generatedExtremeBiasCount: number;
  generatedLowLiquidityCount: number;
  generatedStaleSnapshotCount: number;
}

export interface FeedController {
  start(): void;
  stop(): void;
  getSnapshot(nowIso?: string): FeedPullResult;
  getDiagnostics(): FeedDiagnostics;
}

export * from "@/feeds/mockExchangeFeed";
