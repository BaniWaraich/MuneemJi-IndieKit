import { z } from "zod";

export const onboardingProgressSchema = z.object({
  gmail_connected: z.boolean().optional(),
});
