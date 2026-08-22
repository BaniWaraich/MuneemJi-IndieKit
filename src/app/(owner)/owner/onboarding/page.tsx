import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankStatements } from "@/db/schema/muneem";
import { getOwnerSession } from "@/lib/auth/tenant";
import { getGmailStatus } from "@/lib/gmail/status";
import { GmailConnectCard } from "../_components/gmail-connect-card";
import { OnboardingChecklist } from "../_components/onboarding-checklist";

export default async function OwnerOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const session = await getOwnerSession();
  if (!session) return null;
  const { gmail } = await searchParams;

  const [gmailStatus, [{ count }]] = await Promise.all([
    getGmailStatus(session.ownerId),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bankStatements)
      .where(eq(bankStatements.clientOrgId, session.clientOrgId)),
  ]);

  const flash =
    gmail === "connected"
      ? "connected"
      : gmail === "error"
        ? "error"
        : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900">Onboarding</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Connect Gmail and upload a statement so we can start collecting
          invoices.
        </p>
      </div>

      <OnboardingChecklist
        gmailConnected={gmailStatus.status === "active"}
        statementUploaded={count > 0}
      />

      <div id="gmail">
        <GmailConnectCard initial={gmailStatus} flash={flash} />
      </div>
    </div>
  );
}
