import type { ExchangeSnapshot, MarketSnapshot } from "@/types/snapshots";

export function groupByMarket(snapshots: ExchangeSnapshot[], timestamp: string): MarketSnapshot[] {
  const grouped = new Map<string, ExchangeSnapshot[]>();

  for (const snapshot of snapshots) {
    const key = `${snapshot.eventId}|${snapshot.marketType}|${snapshot.selection}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(snapshot);
    } else {
      grouped.set(key, [snapshot]);
    }
  }

  const markets: MarketSnapshot[] = [];

  for (const bucket of grouped.values()) {
    const first = bucket[0];
    if (!first) {
      continue;
    }

    markets.push({
      eventId: first.eventId,
      eventName: first.eventName,
      marketType: first.marketType,
      selection: first.selection,
      snapshots: bucket,
      timestamp,
    });
  }

  return markets;
}
