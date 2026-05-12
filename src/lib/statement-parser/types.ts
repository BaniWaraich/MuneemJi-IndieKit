import { z } from 'zod';

/** Raw row as extracted by pdfplumber script or CSV parser — before normalisation */
export const rawTransactionSchema = z.object({
  date: z.string(),
  description: z.string(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  balance: z.number(),
});

export const extractionResultSchema = z.object({
  transactions: z.array(rawTransactionSchema),
  opening_balance: z.number(),
  closing_balance: z.number(),
  currency: z.string().length(3),
});

export type RawTransaction = z.infer<typeof rawTransactionSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export type BankIdentification = {
  bankIdentifier: string;
  bankName: string;
  country: string;
  rawHeaderText: string;
};
