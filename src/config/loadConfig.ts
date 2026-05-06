import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  STALE_DATA_THRESHOLD_MS: z.coerce.number().int().positive().default(15000),
  MIN_EDGE_PCT: z.coerce.number().min(0).default(0.5),
  MIN_LIQUIDITY: z.coerce.number().min(0).default(100),
  DEFAULT_EXCHANGE_COMMISSION_PCT: z.coerce.number().min(0).max(100).default(2),
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
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  scanIntervalMs: number;
  staleDataThresholdMs: number;
  minEdgePct: number;
  minLiquidity: number;
  defaultExchangeCommissionRate: number;
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
  loadedAt: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotEnv();
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    scanIntervalMs: parsed.SCAN_INTERVAL_MS,
    staleDataThresholdMs: parsed.STALE_DATA_THRESHOLD_MS,
    minEdgePct: parsed.MIN_EDGE_PCT,
    minLiquidity: parsed.MIN_LIQUIDITY,
    defaultExchangeCommissionRate: parsed.DEFAULT_EXCHANGE_COMMISSION_PCT / 100,
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
    loadedAt: new Date().toISOString(),
  };
}
