import { z } from "zod";

export const ownerSignupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  businessName: z.string().trim().min(1, "Business name is required").max(120),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
