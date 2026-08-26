import { z } from "zod";
import { CLARIFICATION_ANSWERS } from "@/lib/payee-memory/types";

export const patchChecklistItemSchema = z.object({
  action: z.literal("not_needed"),
});

export const answerClarificationSchema = z.object({
  answer: z.enum(CLARIFICATION_ANSWERS),
});
