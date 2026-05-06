import type { ExchangeSnapshot } from "@/types/snapshots";

export function hasMinLiquidity(snapshot: ExchangeSnapshot, minLiquidity: number): boolean {
  return snapshot.liquidity >= minLiquidity;
}
