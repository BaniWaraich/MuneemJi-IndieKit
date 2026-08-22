import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientOrgs, documents } from "@/db/schema/muneem";
import {
  requireFirmOrOwnerForClient,
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/auth/tenant";
import {
  presignPut,
  StorageNotConfiguredError,
} from "@/lib/muneem-storage/presign";
import {
  documentS3Key,
  fileTypeFromContentType,
  isAllowedDocumentContentType,
} from "@/lib/muneem-storage/document-upload";
import {
  getFirmStorageBytes,
  MAX_FIRM_STORAGE_BYTES,
} from "@/lib/muneem-storage/firm-storage";
import { createDocumentSchema } from "@/lib/validations/documents.schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireFirmOrOwnerForClient(id);

    const body = await request.json();
    const result = createDocumentSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    if (!isAllowedDocumentContentType(result.data.contentType)) {
      return NextResponse.json(
        { error: "UNSUPPORTED_MEDIA_TYPE" },
        { status: 415 },
      );
    }

    const clientOrg = await db.query.clientOrgs.findFirst({
      where: eq(clientOrgs.id, id),
      columns: { firmId: true },
    });
    if (!clientOrg) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const firmStorageBytes = await getFirmStorageBytes(clientOrg.firmId);
    if (
      firmStorageBytes + BigInt(result.data.fileSizeBytes) >
      BigInt(MAX_FIRM_STORAGE_BYTES)
    ) {
      return NextResponse.json(
        {
          error: "STORAGE_LIMIT_EXCEEDED",
          detail: "Firm has reached the 500 MB storage limit.",
        },
        { status: 402 },
      );
    }

    const s3Key = documentS3Key(id, result.data.filename);
    const uploadUrl = await presignPut(s3Key, result.data.contentType, 900);

    const [row] = await db
      .insert(documents)
      .values({
        clientOrgId: id,
        submittedByUser: access.kind === "firm" ? access.session.userId : null,
        submittedByClient:
          access.kind === "owner" ? access.session.ownerId : null,
        submittedByGuest: null,
        s3Key,
        filename: result.data.filename,
        fileType: fileTypeFromContentType(result.data.contentType),
        fileSizeBytes: BigInt(result.data.fileSizeBytes),
        scanStatus: "pending",
        ocrStatus: "pending",
      })
      .returning({ id: documents.id });

    return NextResponse.json(
      { documentId: row.id, uploadUrl, s3Key },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json(
        { error: "STORAGE_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    throw e;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireFirmOrOwnerForClient(id);

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
      .where(eq(documents.clientOrgId, id))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({
      documents: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        fileType: r.fileType,
        fileSizeBytes:
          r.fileSizeBytes === null ? null : Number(r.fileSizeBytes),
        scanStatus: r.scanStatus,
        ocrStatus: r.ocrStatus,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json(
        { error: "STORAGE_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    throw e;
  }
}
