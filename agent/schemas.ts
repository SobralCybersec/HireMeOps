import { z } from "zod";

export const storedJobSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  location: z.string().trim().max(200).optional(),
  remoteMode: z.enum(["remote", "hybrid", "onsite"]).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const getJobInputSchema = z.object({
  jobId: z.string().trim().min(1).max(200),
});

export const researchIntentSchema = z.object({
  intent: z.string().trim().min(1).max(2_000),
  sourceHints: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  maxQueries: z.number().int().min(1).max(8).default(4),
});

export type StoredJobSearchInput = z.infer<typeof storedJobSearchInputSchema>;
export type GetJobInput = z.infer<typeof getJobInputSchema>;
export type ResearchIntent = z.infer<typeof researchIntentSchema>;
