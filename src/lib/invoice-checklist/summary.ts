import type {
  CHECKLIST_ITEM_STATUSES,
  GMAIL_SEARCH_STATUSES,
} from "@/db/schema/muneem";

type Item = {
  status: (typeof CHECKLIST_ITEM_STATUSES)[number];
  documentId: string | null;
  gmailSearchStatus: (typeof GMAIL_SEARCH_STATUSES)[number];
};

export type ChecklistSummary = {
  toCollect: number;
  collected: number;
  findYourself: number;
  quickQuestions: number;
};

const FIND_YOURSELF_SEARCH = new Set([
  "complete",
  "skipped_no_gmail",
  "failed",
]);

export function summarizeChecklist(
  items: Item[],
  pendingQuestions: number,
): ChecklistSummary {
  let toCollect = 0;
  let collected = 0;
  let findYourself = 0;
  for (const item of items) {
    if (item.status === "collected" || item.documentId) collected += 1;
    if (
      item.status === "to_collect" ||
      item.status === "awaiting_clarification"
    ) {
      toCollect += 1;
    }
    if (
      item.status === "to_collect" &&
      !item.documentId &&
      FIND_YOURSELF_SEARCH.has(item.gmailSearchStatus)
    ) {
      findYourself += 1;
    }
  }
  return {
    toCollect,
    collected,
    findYourself,
    quickQuestions: pendingQuestions,
  };
}
