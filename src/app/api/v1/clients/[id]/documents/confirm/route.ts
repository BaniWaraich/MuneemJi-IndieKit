import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/db";
import { documents } from "@/db/schema/muneem";
import {
  requireFirmOrOwnerForClient,
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/auth/tenant";
import { inngest } from "@/lib/inngest/client";
import { s3Client, s3Bucket } from "@/lib/muneem-storage/s3";
import { MAX_DOCUMENT_BYTES } from "@/lib/muneem-storage/document-upload";
import { confirmDocumentSchema } from "@/lib/validations/documents.schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireFirmOrOwnerForClient(id);

    const body = await request.json();
    const result = confirmDocumentSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { documentId } = result.data;

    const document = await db.query.documents.findFirst({
      where: and(eq(documents.id, documentId), eq(documents.clientOrgId, id)),
      columns: { id: true, scanStatus: true, s3Key: true },
    });

    if (!document) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    if (document.scanStatus !== "pending") {
      return NextResponse.json({ error: "ALREADY_CONFIRMED" }, { status: 409 });
    }

    let contentLength: number | undefined;
    try {
      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket: s3Bucket, Key: document.s3Key }),
      );
      contentLength = head.ContentLength;
    } catch {
      return NextResponse.json({ error: "UPLOAD_NOT_FOUND" }, { status: 404 });
    }

    if (typeof contentLength !== "number") {
      return NextResponse.json({ error: "UPLOAD_NOT_FOUND" }, { status: 404 });
    }

    if (contentLength > MAX_DOCUMENT_BYTES) {
      return NextResponse.json(
        {
          error: "FILE_TOO_LARGE",
          maxBytes: MAX_DOCUMENT_BYTES,
          actualBytes: contentLength,
        },
        { status: 413 },
      );
    }

    // Virus scanning is deferred (see docs/modules/F03-file-upload-virus-scan.md).
    await db
      .update(documents)
      .set({ scanStatus: "clean" })
      .where(eq(documents.id, documentId));

    await inngest.send({
      name: "muneem/document.uploaded",
      data: { documentId },
    });

    return NextResponse.json({ confirmed: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    throw e;
  }
}
