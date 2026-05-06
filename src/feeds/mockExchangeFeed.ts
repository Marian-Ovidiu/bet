import type { ExchangeFeedAdapter, FeedController, FeedDiagnostics, FeedPullResult } from "@/feeds";
import type { ExchangeSnapshot } from "@/types/snapshots";

type SupportedMarketType = "football_match_odds" | "tennis_winner";

interface MockEventDefinition {
  eventId: string;
  eventName: string;
  marketType: SupportedMarketType;
  selections: readonly string[];
}

export interface MockExchangeFeedConfig {
  exchange: string;
  seed: number;
  footballEventCount: number;
  tennisEventCount: number;
  minSpread: number;
  maxSpread: number;
  minLiquidity: number;
  maxLiquidity: number;
  updateIntervalMs: number;
  staleThresholdMs: number;
  arbProbability: number;
  maxNormalEdgePct: number;
  extremeEdgeProbability: number;
  staleProbability: number;
  lowLiquidityProbability: number;
  selectionsPerFootballMarket: number;
  selectionsPerTennisMarket: number;
}

const defaultConfig: MockExchangeFeedConfig = {
  exchange: "mock-exchange",
  seed: 42,
  footballEventCount: 20,
  tennisEventCount: 20,
  minSpread: 0.002,
  maxSpread: 0.012,
  minLiquidity: 100,
  maxLiquidity: 2000,
  updateIntervalMs: 2000,
  staleThresholdMs: 12000,
  arbProbability: 0.01,
  maxNormalEdgePct: 2.5,
  extremeEdgeProbability: 0.001,
  staleProbability: 0.03,
  lowLiquidityProbability: 0.15,
  selectionsPerFootballMarket: 3,
  selectionsPerTennisMarket: 2,
};

export class MockExchangeFeed implements FeedController, ExchangeFeedAdapter {
  public readonly exchange: string;

  private readonly config: MockExchangeFeedConfig;
  private readonly eventDefinitions: MockEventDefinition[];
  private diagnostics: FeedDiagnostics;
  private intervalId: NodeJS.Timeout | null;
  private latest: FeedPullResult;
  private lastUpdatedAtMs: number;
  private tickNumber: number;
  private readonly exchangeNoiseShift: number;

  public constructor(inputConfig: Partial<MockExchangeFeedConfig> = {}) {
    this.config = { ...defaultConfig, ...inputConfig };
    validateConfig(this.config);

    this.exchange = this.config.exchange;
    this.eventDefinitions = createEventDefinitions(
      this.config.footballEventCount,
      this.config.tennisEventCount,
      this.config.selectionsPerFootballMarket,
      this.config.selectionsPerTennisMarket,
    );
    this.diagnostics = {
      generatedEvents: this.eventDefinitions.length,
      staleSnapshots: 0,
      updateCount: 0,
      generatedArbBiasCount: 0,
      generatedExtremeBiasCount: 0,
      generatedLowLiquidityCount: 0,
      generatedStaleSnapshotCount: 0,
    };
    this.intervalId = null;
    this.tickNumber = 0;
    this.exchangeNoiseShift = deterministicUnitFloat(`${this.config.seed}|${this.exchange}|exchange-noise`) - 0.5;

    const timestamp = new Date().toISOString();
    this.latest = {
      exchange: this.exchange,
      fetchedAt: timestamp,
      snapshots: this.generateSnapshots(timestamp, this.tickNumber),
    };
    this.lastUpdatedAtMs = Date.parse(timestamp);
    this.diagnostics.updateCount = 1;
  }

  public start(): void {
    if (this.intervalId) {
      return;
    }
    this.intervalId = setInterval(() => {
      this.tickNumber += 1;
      this.refreshSnapshots(new Date().toISOString());
    }, this.config.updateIntervalMs);
  }

  public stop(): void {
    if (!this.intervalId) {
      return;
    }
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  public getSnapshot(nowIso?: string): FeedPullResult {
    const now = nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    if (nowMs - this.lastUpdatedAtMs > this.config.staleThresholdMs) {
      this.diagnostics = { ...this.diagnostics, staleSnapshots: this.diagnostics.staleSnapshots + 1 };
    }
    return clonePullResult(this.latest);
  }

  public getDiagnostics(): FeedDiagnostics {
    return { ...this.diagnostics };
  }

  public async pullSnapshots(nowIso: string): Promise<FeedPullResult> {
    this.tickNumber += 1;
    this.refreshSnapshots(nowIso);
    return clonePullResult(this.latest);
  }

  private refreshSnapshots(nowIso: string): void {
    this.latest = {
      exchange: this.exchange,
      fetchedAt: nowIso,
      snapshots: this.generateSnapshots(nowIso, this.tickNumber),
    };
    this.lastUpdatedAtMs = Date.parse(nowIso);
    this.diagnostics = { ...this.diagnostics, updateCount: this.diagnostics.updateCount + 1 };
  }

  private generateSnapshots(timestamp: string, tick: number): ExchangeSnapshot[] {
    const snapshots: ExchangeSnapshot[] = [];

    for (const event of this.eventDefinitions) {
      for (const selection of event.selections) {
        const marketKey = `${event.eventId}|${event.marketType}|${selection}|${tick}`;
        const fairProbability = fairProbabilityForSelection(
          event.marketType,
          selection,
          deterministicUnitFloat(`fair|${marketKey}`),
        );
        const fairOdds = 1 / fairProbability;

        const overround = 0.018 + deterministicUnitFloat(`${this.exchange}|overround|${marketKey}`) * 0.03;
        const exchangeNoisePct =
          this.exchangeNoiseShift * 0.012 + (deterministicUnitFloat(`${this.exchange}|noise|${marketKey}`) - 0.5) * 0.008;
        const spreadPct = clamp(
          randomBetweenFromUnit(
            deterministicUnitFloat(`${this.exchange}|spread|${marketKey}`),
            this.config.minSpread,
            this.config.maxSpread,
          ),
          this.config.minSpread,
          this.config.maxSpread,
        );

        let backOdds = fairOdds * (1 - overround) * (1 + exchangeNoisePct);
        let layOdds = backOdds * (1 + spreadPct);

        const arbRoll = deterministicUnitFloat(`${this.exchange}|arb|${marketKey}`);
        if (arbRoll < this.config.arbProbability) {
          const extremeRoll = deterministicUnitFloat(`${this.exchange}|arb-extreme|${marketKey}`);
          const isExtreme = extremeRoll < this.config.extremeEdgeProbability;
          const targetEdgePct = isExtreme
            ? randomBetweenFromUnit(deterministicUnitFloat(`${this.exchange}|edge-ext|${marketKey}`), 5.1, 8.0)
            : randomBetweenFromUnit(
                deterministicUnitFloat(`${this.exchange}|edge-normal|${marketKey}`),
                0.1,
                this.config.maxNormalEdgePct,
              );

          backOdds = backOdds * (1 + targetEdgePct / 100);
          this.diagnostics.generatedArbBiasCount += 1;
          if (isExtreme) {
            this.diagnostics.generatedExtremeBiasCount += 1;
          }
        }

        backOdds = roundTo(Math.max(backOdds, 1.01), 3);
        layOdds = roundTo(Math.max(layOdds, backOdds + 0.001), 3);

        const lowLiquidityRoll = deterministicUnitFloat(`${this.exchange}|liq-flag|${marketKey}`);
        const liquidity =
          lowLiquidityRoll < this.config.lowLiquidityProbability
            ? randomBetweenFromUnit(
                deterministicUnitFloat(`${this.exchange}|liq-low|${marketKey}`),
                2,
                Math.max(3, this.config.minLiquidity * 0.8),
              )
            : randomBetweenFromUnit(
                deterministicUnitFloat(`${this.exchange}|liq-normal|${marketKey}`),
                this.config.minLiquidity,
                this.config.maxLiquidity,
              );
        if (lowLiquidityRoll < this.config.lowLiquidityProbability) {
          this.diagnostics.generatedLowLiquidityCount += 1;
        }

        const staleRoll = deterministicUnitFloat(`${this.exchange}|stale-flag|${marketKey}`);
        const snapshotTimestamp =
          staleRoll < this.config.staleProbability
            ? new Date(
                Date.parse(timestamp) -
                  (this.config.staleThresholdMs +
                    randomBetweenFromUnit(deterministicUnitFloat(`${this.exchange}|stale-age|${marketKey}`), 500, 6000)),
              ).toISOString()
            : timestamp;
        if (staleRoll < this.config.staleProbability) {
          this.diagnostics.generatedStaleSnapshotCount += 1;
        }

        snapshots.push({
          exchange: this.exchange,
          eventId: event.eventId,
          eventName: event.eventName,
          marketType: event.marketType,
          selection,
          backOdds,
          layOdds,
          liquidity: roundTo(liquidity, 2),
          timestamp: snapshotTimestamp,
        });
      }
    }

    return snapshots;
  }
}

function createEventDefinitions(
  footballCount: number,
  tennisCount: number,
  selectionsPerFootballMarket: number,
  selectionsPerTennisMarket: number,
): MockEventDefinition[] {
  const footballTeams: ReadonlyArray<readonly [string, string]> = [
    ["Arsenal", "Chelsea"],
    ["Inter", "Milan"],
    ["Real Madrid", "Barcelona"],
    ["Bayern", "Dortmund"],
    ["PSG", "Lyon"],
    ["Ajax", "Feyenoord"],
    ["Roma", "Napoli"],
    ["Liverpool", "Manchester City"],
  ];
  const tennisPlayers: ReadonlyArray<readonly [string, string]> = [
    ["Djokovic", "Alcaraz"],
    ["Sinner", "Medvedev"],
    ["Swiatek", "Sabalenka"],
    ["Gauff", "Rybakina"],
    ["Zverev", "Tsitsipas"],
    ["Rune", "Rublev"],
  ];

  const events: MockEventDefinition[] = [];

  for (let index = 0; index < footballCount; index += 1) {
    const pair = pickPair(footballTeams, index);
    const home = pair[0];
    const away = pair[1];
    events.push({
      eventId: `football-${index + 1}`,
      eventName: `${home} vs ${away}`,
      marketType: "football_match_odds",
      selections: [home, "Draw", away].slice(0, selectionsPerFootballMarket),
    });
  }

  for (let index = 0; index < tennisCount; index += 1) {
    const pair = pickPair(tennisPlayers, index);
    const playerA = pair[0];
    const playerB = pair[1];
    events.push({
      eventId: `tennis-${index + 1}`,
      eventName: `${playerA} vs ${playerB}`,
      marketType: "tennis_winner",
      selections: [playerA, playerB].slice(0, selectionsPerTennisMarket),
    });
  }

  return events;
}

function fairProbabilityForSelection(marketType: SupportedMarketType, selection: string, unit: number): number {
  if (marketType === "football_match_odds") {
    if (selection === "Draw") {
      return randomBetweenFromUnit(unit, 0.22, 0.34);
    }
    return randomBetweenFromUnit(unit, 0.28, 0.52);
  }
  return randomBetweenFromUnit(unit, 0.38, 0.62);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clonePullResult(result: FeedPullResult): FeedPullResult {
  return {
    exchange: result.exchange,
    fetchedAt: result.fetchedAt,
    snapshots: result.snapshots.map((snapshot) => ({ ...snapshot })),
  };
}

function pickPair(list: ReadonlyArray<readonly [string, string]>, index: number): readonly [string, string] {
  const pair = list[index % list.length];
  if (!pair) {
    throw new Error("Pair list must not be empty");
  }
  return pair;
}

function deterministicUnitFloat(key: string): number {
  return hash32(key) / 0xffffffff;
}

function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomBetweenFromUnit(unit: number, min: number, max: number): number {
  return min + (max - min) * unit;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateConfig(config: MockExchangeFeedConfig): void {
  if (config.minSpread > config.maxSpread) {
    throw new Error("minSpread must be <= maxSpread");
  }
  if (config.minLiquidity > config.maxLiquidity) {
    throw new Error("minLiquidity must be <= maxLiquidity");
  }
  if (config.footballEventCount < 0 || config.tennisEventCount < 0) {
    throw new Error("event counts must be >= 0");
  }
  if (config.arbProbability < 0 || config.arbProbability > 1) {
    throw new Error("arbProbability must be in [0, 1]");
  }
  if (config.selectionsPerFootballMarket !== 3) {
    throw new Error("selectionsPerFootballMarket must be 3 for football_match_odds");
  }
  if (config.selectionsPerTennisMarket !== 2) {
    throw new Error("selectionsPerTennisMarket must be 2 for tennis_winner");
  }
}
