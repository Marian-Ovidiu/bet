import { z } from "zod";
import { isoTimestampSchema } from "@/schemas/snapshots";

export const rejectionReasonSchema = z.string().min(1);

export const arbitrageLegSchema = z.object({
  exchange: z.string().min(1),
  side: z.enum(["back", "lay"]),
  odds: z.number().positive(),
  liquidity: z.number().nonnegative(),
  commissionRate: z.number().min(0).max(1),
});

export const surebetOutcomeLegSchema = z.object({
  bookmaker: z.string().min(1),
  exchange: z.string().min(1),
  outcome: z.string().min(1),
  odds: z.number().positive(),
  sourceTimestamp: isoTimestampSchema,
  estimatedLiquidity: z.number().nonnegative(),
  maxStakeEstimate: z.number().nonnegative(),
});

export const surebetStakePlanItemSchema = z.object({
  bookmaker: z.string().min(1),
  outcome: z.string().min(1),
  odds: z.number().positive(),
  stake: z.number().nonnegative(),
  expectedPayout: z.number().nonnegative(),
});

export const allowedNearMissSchema = z.object({
  eventName: z.string().min(1),
  marketType: z.string().min(1),
  impliedSum: z.number().positive(),
  missingEdgePct: z.number(),
  bestOutcomeLegs: z.array(surebetOutcomeLegSchema),
  bookmakerSet: z.array(z.string().min(1)),
  sourceTimestamps: z.array(isoTimestampSchema),
  oldestQuoteTimestamp: isoTimestampSchema.nullable(),
  newestQuoteTimestamp: isoTimestampSchema.nullable(),
  quoteAgeSpreadMs: z.number().nonnegative().nullable(),
  oldestQuoteAgeMs: z.number().nonnegative().nullable(),
  newestQuoteAgeMs: z.number().nonnegative().nullable(),
  executableStake: z.number().nonnegative(),
  liquidityCoverageRatio: z.number().nonnegative(),
});

export const nearMissAlertSchema = z.object({
  eventName: z.string().min(1),
  impliedSum: z.number().positive(),
  missingEdgePct: z.number(),
  quoteAgeSpreadMs: z.number().nonnegative().nullable(),
  bookmakerSet: z.array(z.string().min(1)),
  bestOutcomeLegs: z.array(surebetOutcomeLegSchema),
  detectedAt: isoTimestampSchema,
  alertLevel: z.enum(["near", "strong"]),
});

export const arbitrageOpportunitySchema = z.object({
  id: z.string().min(1),
  arbMode: z.enum(["BACK_LAY", "BACK_BACK_SUREBET"]),
  eventId: z.string().min(1),
  eventName: z.string().min(1),
  marketType: z.string().min(1),
  selection: z.string().min(1),
  status: z.enum(["accepted", "rejected"]),
  legs: z.tuple([arbitrageLegSchema, arbitrageLegSchema]),
  outcomeLegs: z.array(surebetOutcomeLegSchema),
  impliedSum: z.number().positive().nullable(),
  stakePlan: z.array(surebetStakePlanItemSchema),
  guaranteedPayout: z.number().positive().nullable(),
  grossEdgePct: z.number(),
  netEdgePct: z.number(),
  estimatedProfit: z.number(),
  rejectionReasons: z.array(rejectionReasonSchema),
  detectedAt: isoTimestampSchema,
  sourceSnapshotTimestamps: z.tuple([isoTimestampSchema, isoTimestampSchema]),
  oldestQuoteTimestamp: isoTimestampSchema.nullable(),
  newestQuoteTimestamp: isoTimestampSchema.nullable(),
  quoteAgeSpreadMs: z.number().nonnegative().nullable(),
  oldestQuoteAgeMs: z.number().nonnegative().nullable(),
  newestQuoteAgeMs: z.number().nonnegative().nullable(),
  executableStake: z.number().nonnegative(),
  liquidityCoverageRatio: z.number().nonnegative(),
});
