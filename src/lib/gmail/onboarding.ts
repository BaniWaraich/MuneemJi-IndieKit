import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientUsers } from "@/db/schema/muneem";

export async function setGmailConnectedFlag(
  userId: string,
  connected: boolean,
): Promise<void> {
  const row = await db.query.clientUsers.findFirst({
    where: eq(clientUsers.id, userId),
    columns: { onboardingProgress: true },
  });
  if (!row) return;
  await db
    .update(clientUsers)
    .set({
      onboardingProgress: {
        ...row.onboardingProgress,
        gmail_connected: connected,
      },
    })
    .where(eq(clientUsers.id, userId));
}
