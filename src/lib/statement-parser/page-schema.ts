import { z } from "zod";

export const pageRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  description: z.string(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  balance: z.number().nullable(),
});

export type PageRow = z.infer<typeof pageRowSchema>;

export const pageResultSchema = z.object({
  currency: z.string().length(3).nullable(),
  transactions: z.array(pageRowSchema),
});

export type PageResult = z.infer<typeof pageResultSchema>;

export type PageKind = "text" | "scanned" | "blank";

export const pageSignalsSchema = z.object({
  char_count: z.number(),
  alnum_count: z.number(),
  word_count: z.number(),
  image_area_ratio: z.number(),
});

export type PageSignals = z.infer<typeof pageSignalsSchema>;

export type ExtractedPage = {
  page: number;
  text: string;
  kind: PageKind;
  signals: PageSignals;
};

export type NumberedPageResult = PageResult & { page: number };
