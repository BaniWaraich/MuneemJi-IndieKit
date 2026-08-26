export type ChecklistItemDto = {
  id: string;
  displayName: string;
  amountMinor: string;
  currency: string;
  periodLabel: string;
  occurrenceCount: number;
  status: "to_collect" | "collected" | "not_needed" | "awaiting_clarification";
  viewUrl?: string;
  fromGmail?: boolean;
};

export type ClarificationDto = {
  id: string;
  payeeKey: string;
  promptText: string;
  occurrenceCount: number;
  sampleAmountsMinor: string[];
};

export type ChecklistPayload = {
  statement: {
    id: string;
    filename: string;
    status: string;
    periodStart: string | null;
    periodEnd: string | null;
    currency: string;
  };
  summary: {
    toCollect: number;
    collected: number;
    findYourself: number;
    quickQuestions: number;
  };
  clarifications: ClarificationDto[];
  items: {
    toCollect: ChecklistItemDto[];
    collected: ChecklistItemDto[];
    notNeeded: ChecklistItemDto[];
  };
  gmailHint?: "needs_reauth" | "not_connected";
};
