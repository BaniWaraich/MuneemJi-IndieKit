/**
 * O04: build BO invoice checklist after D03.
 * Event: muneem/interpretation.complete
 */
import { eventType, staticSchema } from "inngest";
import { inngest } from "../client";
import { buildInvoiceChecklist } from "@/lib/invoice-checklist/build";

export const interpretationComplete = eventType(
  "muneem/interpretation.complete",
  {
    schema: staticSchema<{
      clientOrgId: string;
      statementId: string;
      trigger: string;
    }>(),
  },
);

export const gmailInvoiceSearch = eventType("muneem/gmail.invoice-search", {
  schema: staticSchema<{
    clientOrgId: string;
    statementId: string;
    itemId: string;
  }>(),
});

export const buildInvoiceChecklistFn = inngest.createFunction(
  {
    id: "build-invoice-checklist",
    name: "Muneem: O04 Invoice Checklist",
    concurrency: { limit: 4 },
    retries: 3,
    triggers: [interpretationComplete],
  },
  async ({ event, step }) => {
    const { statementId, clientOrgId } = event.data;

    const result = await step.run("build-checklist", () =>
      buildInvoiceChecklist(statementId),
    );

    if (result.gmailItemIds.length > 0) {
      const orgId = result.clientOrgId ?? clientOrgId;
      for (const itemId of result.gmailItemIds) {
        await step.sendEvent(
          `gmail-search-${itemId}`,
          gmailInvoiceSearch.create(
            {
              clientOrgId: orgId,
              statementId,
              itemId,
            },
            { id: `gmail-pull-${itemId}` },
          ),
        );
      }
    }

    return {
      skipped: result.skipped,
      gmailQueued: result.gmailItemIds.length,
    };
  },
);
