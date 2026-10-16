import { z } from "zod";
export const researchOptionsSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.^=&-]{1,20}$/),
  includeNews: z.boolean().default(true),
  includeFinancials: z.boolean().default(true),
  includeNotes: z.boolean().default(false),
  includePortfolio: z.boolean().default(false),
  portfolioId: z.number().int().positive().optional(),
});
export type ResearchOptions = z.infer<typeof researchOptionsSchema>;
export const chatSchema = researchOptionsSchema
  .extend({
    messages: z
      .array(
        z.discriminatedUnion("role", [
          z
            .object({
              role: z.literal("user"),
              content: z.string().trim().min(1).max(4000),
            })
            .strict(),
          z
            .object({
              role: z.literal("assistant"),
              content: z.string().trim().min(1).max(20000),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(20),
  })
  .refine(
    (v) =>
      v.messages.at(-1)?.role === "user" &&
      v.messages.reduce((n, m) => n + m.content.length, 0) <= 24000,
    "End with a user question and keep the conversation under 24,000 characters.",
  )
  .refine(
    (v) => !v.includePortfolio || Boolean(v.portfolioId),
    "Select a portfolio to include holdings.",
  );
