import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import {
  validateNormalizedMarket,
  type NormalizedMarketRejectionReason,
} from "@/normalizer/validateNormalizedMarket";
import { normalizeBookmakerKey } from "@/normalizer/normalizeBookmakerKey";
import type { EventId, ExchangeName, IsoTimestamp, MarketType, SelectionName } from "@/types/common";

export interface TheOddsApiFeedConfig {
  apiKey: string;
  sport: string;
  regions: string;
  markets: string;
  oddsFormat: "decimal";
  dateFormat: "iso";
  pollIntervalMs: number;
  staleDataThresholdMs?: number;
  timeoutMs?: number;
  httpClient?: AxiosInstance;
}

export interface TheOddsApiDiagnostics {
  apiRequests: number;
  apiFailures: number;
  malformedPayloads: number;
  eventsReceived: number;
  bookmakersReceived: number;
  normalizedEvents: number;
  normalizedMarkets: number;
  normalizedSelections: number;
  missingOddsCount: number;
  rejectedNormalizedMarkets: number;
  missingEventId: number;
  missingSelection: number;
  invalidOdds: number;
  duplicateOutcome: number;
  incompleteMarket: number;
  staleMarket: number;
}

export interface TheOddsApiUsage {
  requestsRemaining: number | null;
  requestsUsed: number | null;
  requestsLast: number | null;
}

export interface TheOddsApiExchangeSnapshot {
  exchange: ExchangeName;
  exchangeName: string;
  eventId: EventId;
  eventName: string;
  marketType: MarketType;
  selection: SelectionName;
  backOdds: number;
  layOdds: null;
  liquidity: null;
  estimatedLiquidity: number;
  maxStakeEstimate: number;
  timestamp: IsoTimestamp;
  receivedAt: IsoTimestamp;
  sourceTimestamp: IsoTimestamp;
}

export interface TheOddsApiMarketSnapshot {
  eventId: EventId;
  eventName: string;
  marketType: MarketType;
  selection: SelectionName;
  snapshots: TheOddsApiExchangeSnapshot[];
  timestamp: IsoTimestamp;
  receivedAt: IsoTimestamp;
  sourceTimestamp: IsoTimestamp;
}

export interface TheOddsApiSnapshotResult {
  provider: "the_odds_api";
  receivedAt: IsoTimestamp;
  snapshots: TheOddsApiExchangeSnapshot[];
  markets: TheOddsApiMarketSnapshot[];
  diagnostics: TheOddsApiDiagnostics;
  oddsApiUsage: TheOddsApiUsage | null;
}

const isoTimestampSchema = z.iso.datetime({ offset: true });

const oddsApiOutcomeSchema = z.object({
  name: z.string().default(""),
  price: z.number().optional(),
});

const oddsApiMarketSchema = z.object({
  key: z.string().default(""),
  last_update: isoTimestampSchema.optional(),
  outcomes: z.array(oddsApiOutcomeSchema).default([]),
});

const oddsApiBookmakerSchema = z.object({
  key: z.string().default(""),
  title: z.string().default(""),
  last_update: isoTimestampSchema.optional(),
  markets: z.array(oddsApiMarketSchema).default([]),
});

const oddsApiEventSchema = z.object({
  id: z.string().default(""),
  commence_time: isoTimestampSchema.optional(),
  home_team: z.string().default(""),
  away_team: z.string().default(""),
  bookmakers: z.array(oddsApiBookmakerSchema).default([]),
});

const oddsApiResponseSchema = z.array(oddsApiEventSchema);

type OddsApiEvent = z.infer<typeof oddsApiEventSchema>;
type OddsApiMarket = z.infer<typeof oddsApiMarketSchema>;

export class TheOddsApiFeed {
  private readonly config: TheOddsApiFeedConfig;
  private readonly httpClient: AxiosInstance;
  private diagnostics: TheOddsApiDiagnostics;
  private latest: TheOddsApiSnapshotResult;
  private oddsApiUsage: TheOddsApiUsage | null;
  private intervalId: NodeJS.Timeout | null;

  public constructor(config: TheOddsApiFeedConfig) {
    this.config = config;
    this.httpClient =
      config.httpClient ??
      axios.create({
        baseURL: "https://api.the-odds-api.com/v4",
        timeout: config.timeoutMs ?? 10000,
    });
    this.diagnostics = createInitialDiagnostics();
    this.oddsApiUsage = null;
    this.intervalId = null;

    const receivedAt = new Date().toISOString();
    this.latest = {
      provider: "the_odds_api",
      receivedAt,
      snapshots: [],
      markets: [],
      diagnostics: { ...this.diagnostics },
      oddsApiUsage: this.oddsApiUsage,
    };
  }

  public start(): void {
    if (this.intervalId) {
      return;
    }

    void this.pollOnce();
    this.intervalId = setInterval(() => {
      void this.pollOnce();
    }, this.config.pollIntervalMs);
  }

  public stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  public getSnapshot(): TheOddsApiSnapshotResult {
    return cloneSnapshotResult(this.latest);
  }

  public getDiagnostics(): TheOddsApiDiagnostics {
    return { ...this.diagnostics };
  }

  public async pollOnce(receivedAt: IsoTimestamp = new Date().toISOString()): Promise<TheOddsApiSnapshotResult> {
    this.diagnostics = {
      ...this.diagnostics,
      apiRequests: this.diagnostics.apiRequests + 1,
    };

    try {
      const response = await this.httpClient.get<unknown>(`/sports/${encodeURIComponent(this.config.sport)}/odds`, {
        params: {
          apiKey: this.config.apiKey,
          regions: this.config.regions,
          markets: this.config.markets,
          oddsFormat: this.config.oddsFormat,
          dateFormat: this.config.dateFormat,
        },
      });
      this.oddsApiUsage = readOddsApiUsage(response.headers);

      const parsed = oddsApiResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        this.diagnostics = {
          ...this.diagnostics,
          malformedPayloads: this.diagnostics.malformedPayloads + 1,
        };
        throw parsed.error;
      }

      const normalized = normalizeOddsApiEvents(
        parsed.data,
        receivedAt,
        this.config.staleDataThresholdMs ?? Number.POSITIVE_INFINITY,
      );
      this.diagnostics = {
        ...this.diagnostics,
        eventsReceived: this.diagnostics.eventsReceived + normalized.eventsReceived,
        bookmakersReceived: this.diagnostics.bookmakersReceived + normalized.bookmakersReceived,
        normalizedEvents: this.diagnostics.normalizedEvents + normalized.normalizedEvents,
        normalizedMarkets: this.diagnostics.normalizedMarkets + normalized.normalizedMarkets,
        normalizedSelections: this.diagnostics.normalizedSelections + normalized.normalizedSelections,
        missingOddsCount: this.diagnostics.missingOddsCount + normalized.missingOddsCount,
        rejectedNormalizedMarkets:
          this.diagnostics.rejectedNormalizedMarkets + normalized.rejectionDiagnostics.rejectedNormalizedMarkets,
        missingEventId: this.diagnostics.missingEventId + normalized.rejectionDiagnostics.missingEventId,
        missingSelection: this.diagnostics.missingSelection + normalized.rejectionDiagnostics.missingSelection,
        invalidOdds: this.diagnostics.invalidOdds + normalized.rejectionDiagnostics.invalidOdds,
        duplicateOutcome: this.diagnostics.duplicateOutcome + normalized.rejectionDiagnostics.duplicateOutcome,
        incompleteMarket: this.diagnostics.incompleteMarket + normalized.rejectionDiagnostics.incompleteMarket,
        staleMarket: this.diagnostics.staleMarket + normalized.rejectionDiagnostics.staleMarket,
      };
      this.latest = {
        provider: "the_odds_api",
        receivedAt,
        snapshots: normalized.snapshots,
        markets: groupByMarket(normalized.snapshots, receivedAt),
        diagnostics: { ...this.diagnostics },
        oddsApiUsage: this.oddsApiUsage,
      };

      return cloneSnapshotResult(this.latest);
    } catch (error) {
      this.diagnostics = {
        ...this.diagnostics,
        apiFailures: this.diagnostics.apiFailures + 1,
      };
      this.latest = {
        ...this.latest,
        diagnostics: { ...this.diagnostics },
        oddsApiUsage: this.oddsApiUsage,
      };
      throw error;
    }
  }
}

function readOddsApiUsage(headers: Record<string, unknown>): TheOddsApiUsage | null {
  const requestsRemaining = readNumericHeader(headers, "x-requests-remaining");
  const requestsUsed = readNumericHeader(headers, "x-requests-used");
  const requestsLast = readNumericHeader(headers, "x-requests-last");

  if (requestsRemaining === null && requestsUsed === null && requestsLast === null) {
    return null;
  }

  return {
    requestsRemaining,
    requestsUsed,
    requestsLast,
  };
}

function readNumericHeader(headers: Record<string, unknown>, key: string): number | null {
  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? parseNumericHeader(first) : null;
  }
  if (typeof value === "string") {
    return parseNumericHeader(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function parseNumericHeader(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface NormalizedOddsApiEvents {
  snapshots: TheOddsApiExchangeSnapshot[];
  eventsReceived: number;
  bookmakersReceived: number;
  normalizedEvents: number;
  normalizedMarkets: number;
  normalizedSelections: number;
  missingOddsCount: number;
  rejectionDiagnostics: NormalizedMarketValidationDiagnostics;
}

interface NormalizedMarketValidationDiagnostics {
  rejectedNormalizedMarkets: number;
  missingEventId: number;
  missingSelection: number;
  invalidOdds: number;
  duplicateOutcome: number;
  incompleteMarket: number;
  staleMarket: number;
}

function normalizeOddsApiEvents(
  events: OddsApiEvent[],
  receivedAt: IsoTimestamp,
  staleDataThresholdMs: number,
): NormalizedOddsApiEvents {
  const snapshots: TheOddsApiExchangeSnapshot[] = [];
  let normalizedMarkets = 0;
  let normalizedSelections = 0;
  let missingOddsCount = 0;
  let bookmakersReceived = 0;
  const rejectionDiagnostics = createValidationDiagnostics();

  for (const event of events) {
    const eventName = `${event.home_team} vs ${event.away_team}`;
    bookmakersReceived += event.bookmakers.length;
    for (const bookmaker of event.bookmakers) {
      for (const market of bookmaker.markets) {
        const marketType = normalizeMarketType(market);
        const sourceTimestamp = market.last_update ?? bookmaker.last_update ?? event.commence_time;
        const validation = validateNormalizedMarket({
          market: {
            eventId: event.id,
            eventName,
            marketType,
            outcomes: market.outcomes.map((outcome) => ({
              bookmaker: bookmaker.key,
              outcome: outcome.name,
              odds: outcome.price ?? null,
              sourceTimestamp: sourceTimestamp ?? null,
            })),
          },
          nowIso: receivedAt,
          staleDataThresholdMs,
        });

        if (!validation.valid) {
          recordValidationRejections(rejectionDiagnostics, validation.rejectionReasons);
          if (validation.rejectionReasons.includes("invalid_odds")) {
            missingOddsCount += market.outcomes.filter((outcome) => typeof outcome.price !== "number").length;
          }
          continue;
        }

        normalizedMarkets += 1;
        for (const outcome of market.outcomes) {
          if (typeof outcome.price !== "number") {
            missingOddsCount += 1;
            continue;
          }
          const liquidity = estimateBookmakerLiquidity(bookmaker.key);

          snapshots.push({
            exchange: bookmaker.key,
            exchangeName: bookmaker.title,
            eventId: event.id,
            eventName,
            marketType,
            selection: outcome.name,
            backOdds: outcome.price,
            layOdds: null,
            liquidity: null,
            estimatedLiquidity: liquidity.estimatedLiquidity,
            maxStakeEstimate: liquidity.maxStakeEstimate,
            timestamp: receivedAt,
            receivedAt,
            sourceTimestamp: sourceTimestamp ?? receivedAt,
          });
          normalizedSelections += 1;
        }
      }
    }
  }

  return {
    snapshots,
    eventsReceived: events.length,
    bookmakersReceived,
    normalizedEvents: events.length,
    normalizedMarkets,
    normalizedSelections,
    missingOddsCount,
    rejectionDiagnostics,
  };
}

function normalizeMarketType(market: OddsApiMarket): MarketType {
  if (market.key === "h2h" && market.outcomes.length === 3) {
    return "football_match_odds";
  }
  if (market.key === "h2h" && market.outcomes.length === 2) {
    return "tennis_winner";
  }
  return market.key;
}

interface EstimatedLiquidity {
  estimatedLiquidity: number;
  maxStakeEstimate: number;
}

function estimateBookmakerLiquidity(bookmakerKey: string): EstimatedLiquidity {
  const normalized = normalizeBookmakerKey(bookmakerKey);
  if (["betfair", "betfair_ex", "betfair_ex_eu", "betfair_ex_uk", "betfair_exchange", "matchbook"].includes(normalized)) {
    return {
      estimatedLiquidity: 10000,
      maxStakeEstimate: 5000,
    };
  }
  if (normalized === "pinnacle") {
    return {
      estimatedLiquidity: 5000,
      maxStakeEstimate: 1000,
    };
  }
  if (["onexbet", "betonlineag", "betanything", "everygame", "gtbets"].includes(normalized)) {
    return {
      estimatedLiquidity: 50,
      maxStakeEstimate: 25,
    };
  }
  return {
    estimatedLiquidity: 1000,
    maxStakeEstimate: 250,
  };
}

function groupByMarket(
  snapshots: TheOddsApiExchangeSnapshot[],
  receivedAt: IsoTimestamp,
): TheOddsApiMarketSnapshot[] {
  const grouped = new Map<string, TheOddsApiExchangeSnapshot[]>();

  for (const snapshot of snapshots) {
    const key = `${snapshot.eventId}|${snapshot.marketType}|${snapshot.selection}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(snapshot);
    } else {
      grouped.set(key, [snapshot]);
    }
  }

  return Array.from(grouped.values()).map((bucket) => {
    const first = bucket[0];
    if (!first) {
      throw new Error("Market snapshot bucket must not be empty");
    }

    return {
      eventId: first.eventId,
      eventName: first.eventName,
      marketType: first.marketType,
      selection: first.selection,
      snapshots: bucket.map((snapshot) => ({ ...snapshot })),
      timestamp: receivedAt,
      receivedAt,
      sourceTimestamp: first.sourceTimestamp,
    };
  });
}

function createInitialDiagnostics(): TheOddsApiDiagnostics {
  return {
    apiRequests: 0,
    apiFailures: 0,
    malformedPayloads: 0,
    eventsReceived: 0,
    bookmakersReceived: 0,
    normalizedEvents: 0,
    normalizedMarkets: 0,
    normalizedSelections: 0,
    missingOddsCount: 0,
    rejectedNormalizedMarkets: 0,
    missingEventId: 0,
    missingSelection: 0,
    invalidOdds: 0,
    duplicateOutcome: 0,
    incompleteMarket: 0,
    staleMarket: 0,
  };
}

function createValidationDiagnostics(): NormalizedMarketValidationDiagnostics {
  return {
    rejectedNormalizedMarkets: 0,
    missingEventId: 0,
    missingSelection: 0,
    invalidOdds: 0,
    duplicateOutcome: 0,
    incompleteMarket: 0,
    staleMarket: 0,
  };
}

function recordValidationRejections(
  diagnostics: NormalizedMarketValidationDiagnostics,
  reasons: NormalizedMarketRejectionReason[],
): void {
  diagnostics.rejectedNormalizedMarkets += 1;
  for (const reason of reasons) {
    if (reason === "missing_event_id") {
      diagnostics.missingEventId += 1;
    } else if (reason === "missing_selection") {
      diagnostics.missingSelection += 1;
    } else if (reason === "invalid_odds") {
      diagnostics.invalidOdds += 1;
    } else if (reason === "duplicate_outcome") {
      diagnostics.duplicateOutcome += 1;
    } else if (reason === "incomplete_market") {
      diagnostics.incompleteMarket += 1;
    } else if (reason === "stale_market") {
      diagnostics.staleMarket += 1;
    }
  }
}

function cloneSnapshotResult(result: TheOddsApiSnapshotResult): TheOddsApiSnapshotResult {
  return {
    provider: result.provider,
    receivedAt: result.receivedAt,
    snapshots: result.snapshots.map((snapshot) => ({ ...snapshot })),
    markets: result.markets.map((market) => ({
      ...market,
      snapshots: market.snapshots.map((snapshot) => ({ ...snapshot })),
    })),
    diagnostics: { ...result.diagnostics },
    oddsApiUsage: result.oddsApiUsage ? { ...result.oddsApiUsage } : null,
  };
}
