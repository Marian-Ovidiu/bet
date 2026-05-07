import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { normalizeBookmakerList } from "@/normalizer/normalizeBookmakerKey";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()),
  );

const bookmakerListFromEnv = z
  .string()
  .default("")
  .transform((value) => normalizeBookmakerList(value.split(",")));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  STALE_DATA_THRESHOLD_MS: z.coerce.number().int().positive().default(15000),
  MAX_QUOTE_SKEW_MS: z.coerce.number().int().nonnegative().default(15000),
  NEAR_MISS_ALERT_THRESHOLD: z.coerce.number().positive().default(1.005),
  NEAR_MISS_STRONG_THRESHOLD: z.coerce.number().positive().default(1.002),
  MIN_EDGE_PCT: z.coerce.number().min(0).default(0.5),
  MIN_LIQUIDITY: z.coerce.number().min(0).default(100),
  MIN_REQUIRED_LIQUIDITY: z.coerce.number().min(0).default(100),
  TARGET_STAKE_SIZE: z.coerce.number().positive().default(100),
  DEFAULT_EXCHANGE_COMMISSION_PCT: z.coerce.number().min(0).max(100).default(2),
  BETFAIR_EXCHANGE_COMMISSION_PCT: z.coerce.number().min(0).max(100).default(2),
  MATCHBOOK_EXCHANGE_COMMISSION_PCT: z.coerce.number().min(0).max(100).default(2),
  PAPER_STARTING_BALANCE: z.coerce.number().positive().default(10000),
  ENABLE_PAPER_TRADING: booleanFromEnv.default(true),
  PAPER_STAKE_SIZE: z.coerce.number().positive().default(50),
  PAPER_PARTIAL_FILL_PROBABILITY: z.coerce.number().min(0).max(1).default(0.1),
  PAPER_UNMATCHED_PROBABILITY: z.coerce.number().min(0).max(1).default(0.03),
  PAPER_MAX_OPEN_EXPOSURE: z.coerce.number().positive().default(500),
  MOCK_ARB_PROBABILITY: z.coerce.number().min(0).max(1).default(0.01),
  MOCK_MAX_NORMAL_EDGE_PCT: z.coerce.number().min(0).max(10).default(2.5),
  MOCK_EXTREME_EDGE_PROBABILITY: z.coerce.number().min(0).max(1).default(0.001),
  MOCK_STALE_PROBABILITY: z.coerce.number().min(0).max(1).default(0.03),
  MOCK_LOW_LIQUIDITY_PROBABILITY: z.coerce.number().min(0).max(1).default(0.15),
  MOCK_FOOTBALL_EVENT_COUNT: z.coerce.number().int().min(1).default(20),
  MOCK_TENNIS_EVENT_COUNT: z.coerce.number().int().min(1).default(20),
  MOCK_SELECTIONS_PER_FOOTBALL_MARKET: z.coerce.number().int().min(3).default(3),
  MOCK_SELECTIONS_PER_TENNIS_MARKET: z.coerce.number().int().min(2).default(2),
  REAL_FEED_ENABLED: booleanFromEnv.default(false),
  REAL_FEED_PROVIDER: z.literal("the_odds_api").default("the_odds_api"),
  THE_ODDS_API_KEY: z.string().default(""),
  THE_ODDS_API_SPORT: z.string().min(1).default("soccer_italy_serie_a"),
  THE_ODDS_API_REGIONS: z.string().min(1).default("eu"),
  THE_ODDS_API_MARKETS: z.string().min(1).default("h2h"),
  THE_ODDS_API_ODDS_FORMAT: z.literal("decimal").default("decimal"),
  THE_ODDS_API_DATE_FORMAT: z.literal("iso").default("iso"),
  REAL_FEED_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  REAL_FEED_INCLUDE_MOCK: booleanFromEnv.default(false),
  ENABLE_BOOKMAKER_FILTER: booleanFromEnv.default(false),
  ALLOWED_BOOKMAKERS: bookmakerListFromEnv,
  DENIED_BOOKMAKERS: bookmakerListFromEnv,
}).superRefine((value, context) => {
  if (value.REAL_FEED_ENABLED && value.THE_ODDS_API_KEY.trim().length === 0) {
    context.addIssue({
      code: "custom",
      path: ["THE_ODDS_API_KEY"],
      message: "THE_ODDS_API_KEY is required when REAL_FEED_ENABLED=true",
    });
  }
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  scanIntervalMs: number;
  staleDataThresholdMs: number;
  maxQuoteSkewMs: number;
  nearMissAlertThreshold: number;
  nearMissStrongThreshold: number;
  minEdgePct: number;
  minLiquidity: number;
  minRequiredLiquidity: number;
  targetStakeSize: number;
  defaultExchangeCommissionRate: number;
  exchangeCommissionByExchange: Record<string, number>;
  paperStartingBalance: number;
  enablePaperTrading: boolean;
  paperStakeSize: number;
  paperPartialFillProbability: number;
  paperUnmatchedProbability: number;
  paperMaxOpenExposure: number;
  mockArbProbability: number;
  mockMaxNormalEdgePct: number;
  mockExtremeEdgeProbability: number;
  mockStaleProbability: number;
  mockLowLiquidityProbability: number;
  mockFootballEventCount: number;
  mockTennisEventCount: number;
  mockSelectionsPerFootballMarket: number;
  mockSelectionsPerTennisMarket: number;
  realFeedEnabled: boolean;
  realFeedProvider: "the_odds_api";
  theOddsApiKey: string;
  theOddsApiSport: string;
  theOddsApiRegions: string;
  theOddsApiMarkets: string;
  theOddsApiOddsFormat: "decimal";
  theOddsApiDateFormat: "iso";
  realFeedPollIntervalMs: number;
  realFeedIncludeMock: boolean;
  enableBookmakerFilter: boolean;
  allowedBookmakers: string[];
  deniedBookmakers: string[];
  loadedAt: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotEnv({ quiet: true });
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    scanIntervalMs: parsed.SCAN_INTERVAL_MS,
    staleDataThresholdMs: parsed.STALE_DATA_THRESHOLD_MS,
    maxQuoteSkewMs: parsed.MAX_QUOTE_SKEW_MS,
    nearMissAlertThreshold: parsed.NEAR_MISS_ALERT_THRESHOLD,
    nearMissStrongThreshold: parsed.NEAR_MISS_STRONG_THRESHOLD,
    minEdgePct: parsed.MIN_EDGE_PCT,
    minLiquidity: parsed.MIN_LIQUIDITY,
    minRequiredLiquidity: parsed.MIN_REQUIRED_LIQUIDITY,
    targetStakeSize: parsed.TARGET_STAKE_SIZE,
    defaultExchangeCommissionRate: parsed.DEFAULT_EXCHANGE_COMMISSION_PCT / 100,
    exchangeCommissionByExchange: {
      betfair: parsed.BETFAIR_EXCHANGE_COMMISSION_PCT / 100,
      betfair_ex: parsed.BETFAIR_EXCHANGE_COMMISSION_PCT / 100,
      betfair_ex_eu: parsed.BETFAIR_EXCHANGE_COMMISSION_PCT / 100,
      betfair_ex_uk: parsed.BETFAIR_EXCHANGE_COMMISSION_PCT / 100,
      betfair_exchange: parsed.BETFAIR_EXCHANGE_COMMISSION_PCT / 100,
      matchbook: parsed.MATCHBOOK_EXCHANGE_COMMISSION_PCT / 100,
    },
    paperStartingBalance: parsed.PAPER_STARTING_BALANCE,
    enablePaperTrading: parsed.ENABLE_PAPER_TRADING,
    paperStakeSize: parsed.PAPER_STAKE_SIZE,
    paperPartialFillProbability: parsed.PAPER_PARTIAL_FILL_PROBABILITY,
    paperUnmatchedProbability: parsed.PAPER_UNMATCHED_PROBABILITY,
    paperMaxOpenExposure: parsed.PAPER_MAX_OPEN_EXPOSURE,
    mockArbProbability: parsed.MOCK_ARB_PROBABILITY,
    mockMaxNormalEdgePct: parsed.MOCK_MAX_NORMAL_EDGE_PCT,
    mockExtremeEdgeProbability: parsed.MOCK_EXTREME_EDGE_PROBABILITY,
    mockStaleProbability: parsed.MOCK_STALE_PROBABILITY,
    mockLowLiquidityProbability: parsed.MOCK_LOW_LIQUIDITY_PROBABILITY,
    mockFootballEventCount: parsed.MOCK_FOOTBALL_EVENT_COUNT,
    mockTennisEventCount: parsed.MOCK_TENNIS_EVENT_COUNT,
    mockSelectionsPerFootballMarket: parsed.MOCK_SELECTIONS_PER_FOOTBALL_MARKET,
    mockSelectionsPerTennisMarket: parsed.MOCK_SELECTIONS_PER_TENNIS_MARKET,
    realFeedEnabled: parsed.REAL_FEED_ENABLED,
    realFeedProvider: parsed.REAL_FEED_PROVIDER,
    theOddsApiKey: parsed.THE_ODDS_API_KEY,
    theOddsApiSport: parsed.THE_ODDS_API_SPORT,
    theOddsApiRegions: parsed.THE_ODDS_API_REGIONS,
    theOddsApiMarkets: parsed.THE_ODDS_API_MARKETS,
    theOddsApiOddsFormat: parsed.THE_ODDS_API_ODDS_FORMAT,
    theOddsApiDateFormat: parsed.THE_ODDS_API_DATE_FORMAT,
    realFeedPollIntervalMs: parsed.REAL_FEED_POLL_INTERVAL_MS,
    realFeedIncludeMock: parsed.REAL_FEED_INCLUDE_MOCK,
    enableBookmakerFilter: parsed.ENABLE_BOOKMAKER_FILTER,
    allowedBookmakers: parsed.ALLOWED_BOOKMAKERS,
    deniedBookmakers: parsed.DENIED_BOOKMAKERS,
    loadedAt: new Date().toISOString(),
  };
}

export function toSafeConfigSnapshot(config: AppConfig): Record<string, unknown> {
  return {
    ...config,
    theOddsApiKey: config.theOddsApiKey.length > 0 ? "[redacted]" : "",
  };
}
