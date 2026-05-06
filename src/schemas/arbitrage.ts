import { z } from "zod";
import { isoTimestampSchema } from "@/schemas/snapshots";

export const rejectionReasonSchema = z.enum([
  "insufficient_liquidity",
  "stale_feed",
  "low_edge",
  "incomplete_market",
]);

export const arbitrageLegSchema = z.object({
  exchange: z.string().min(1),
  side: z.enum(["back", "lay"]),
  odds: z.number().positive(),
  liquidity: z.number().nonnegative(),
  commissionRate: z.number().min(0).max(1),
});

export const arbitrageOpportunitySchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  eventName: z.string().min(1),
  marketType: z.string().min(1),
  selection: z.string().min(1),
  status: z.enum(["accepted", "rejected"]),
  legs: z.tuple([arbitrageLegSchema, arbitrageLegSchema]),
  grossEdgePct: z.number(),
  netEdgePct: z.number(),
  estimatedProfit: z.number(),
  rejectionReasons: z.array(rejectionReasonSchema),
  detectedAt: isoTimestampSchema,
  sourceSnapshotTimestamps: z.tuple([isoTimestampSchema, isoTimestampSchema]),
});
