import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema/muneem";
import { getOwnerSession } from "@/lib/auth/tenant";
import { DocumentsPanel } from "@/app/(accountant)/clients/[id]/documents-panel";

export default async function OwnerInvoicesPage() {
  const session = await getOwnerSession();
  if (!session) return null;

  const rows = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      fileType: documents.fileType,
      fileSizeBytes: documents.fileSizeBytes,
      scanStatus: documents.scanStatus,
      ocrStatus: documents.ocrStatus,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.clientOrgId, session.clientOrgId))
    .orderBy(desc(documents.createdAt));

  const initial = rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    fileType: r.fileType,
    fileSizeBytes: r.fileSizeBytes === null ? null : Number(r.fileSizeBytes),
    scanStatus: r.scanStatus,
    ocrStatus: r.ocrStatus,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900">
          Invoices & receipts
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Upload invoices and receipts. You don&apos;t need to match them to a
          payment — we&apos;ll do that later.
        </p>
      </div>
      <DocumentsPanel clientOrgId={session.clientOrgId} initial={initial} />
    </div>
  );
}
