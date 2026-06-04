import { inngest } from "@/lib/inngest/client";
import { serve } from "inngest/next";
import { functions } from "@/lib/inngest/functions";

// Vercel Hobby hard-caps serverless functions at ~60s regardless of a higher
// value here, so each Inngest step must finish within ~60s. D02/D03 are
// decomposed into small steps (each its own invocation) to live under this.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
