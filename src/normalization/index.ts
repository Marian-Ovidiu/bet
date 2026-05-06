import type { ExchangeSnapshot } from "@/types/snapshots";

export type UnknownPayload = unknown;

export interface FeedNormalizer {
  exchange: string;
  normalize(rawPayload: UnknownPayload, nowIso: string): ExchangeSnapshot[];
}
