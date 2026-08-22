"use client";

import { useCallback, useRef, useState } from "react";

export type DocumentRow = {
  id: string;
  filename: string;
  fileType: "pdf" | "image";
  fileSizeBytes: number | null;
  scanStatus: string;
  ocrStatus: string;
  createdAt: string;
};

type FileProgress = {
  key: string;
  name: string;
  status: "uploading" | "confirming" | "done" | "error";
  error?: string;
};

const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif";

const API_ERRORS: Record<string, string> = {
  STORAGE_LIMIT_EXCEEDED:
    "Storage is full (500 MB for the firm). Free space or ask your accountant.",
  FILE_TOO_LARGE: "Each file must be 25 MB or smaller.",
  UPLOAD_NOT_FOUND: "Upload didn't finish. Try again.",
  STORAGE_NOT_CONFIGURED:
    "File storage isn't configured on this server. Check AWS S3 env vars.",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "pending" | "clean" | "other";
}) {
  const styles = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    clean: "bg-green-50 text-green-700 border-green-200",
    other: "bg-neutral-50 text-neutral-700 border-neutral-200",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}
    >
      {label}
    </span>
  );
}

async function errorFromResponse(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    const code = data.error;
    if (code && API_ERRORS[code]) return API_ERRORS[code];
    if (res.status === 415) {
      return "That file type isn't supported. Use a PDF or an image (PNG, JPEG, WebP, HEIC).";
    }
    if (res.status === 413) return API_ERRORS.FILE_TOO_LARGE;
    if (res.status === 402) return API_ERRORS.STORAGE_LIMIT_EXCEEDED;
    if (res.status === 503) return API_ERRORS.STORAGE_NOT_CONFIGURED;
  } catch {
    /* ignore */
  }
  return "Something went wrong. Please try again.";
}

async function runWithConcurrency(
  files: File[],
  limit: number,
  worker: (file: File) => Promise<void>,
) {
  const queue = [...files];
  const n = Math.min(limit, queue.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;
        await worker(file);
      }
    }),
  );
}

export function DocumentsPanel({
  clientOrgId,
  initial,
}: {
  clientOrgId: string;
  initial: DocumentRow[];
}) {
  const [docs, setDocs] = useState<DocumentRow[]>(initial);
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/v1/clients/${clientOrgId}/documents`, {
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { documents: DocumentRow[] };
      setDocs(data.documents);
    }
  }, [clientOrgId]);

  const patchProgress = (key: string, patch: Partial<FileProgress>) => {
    setProgress((prev) =>
      prev.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    );
  };

  async function uploadOne(file: File) {
    const key = `${file.name}-${file.size}-${file.lastModified}`;
    patchProgress(key, { status: "uploading" });

    const contentType = file.type || "application/octet-stream";
    const createRes = await fetch(`/api/v1/clients/${clientOrgId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType,
        fileSizeBytes: file.size,
      }),
    });
    if (!createRes.ok) {
      throw new Error(await errorFromResponse(createRes));
    }
    const { documentId, uploadUrl } = (await createRes.json()) as {
      documentId: string;
      uploadUrl: string;
    };

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!putRes.ok) throw new Error("Upload to storage failed. Try again.");

    patchProgress(key, { status: "confirming" });
    const confirmRes = await fetch(
      `/api/v1/clients/${clientOrgId}/documents/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      },
    );
    if (confirmRes.status === 409) return;
    if (!confirmRes.ok) {
      throw new Error(await errorFromResponse(confirmRes));
    }
    patchProgress(key, { status: "done" });
  }

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    setProgress(
      files.map((f) => ({
        key: `${f.name}-${f.size}-${f.lastModified}`,
        name: f.name,
        status: "uploading" as const,
      })),
    );
    try {
      await runWithConcurrency(files, 3, async (file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        try {
          await uploadOne(file);
          patchProgress(key, { status: "done" });
        } catch (err) {
          patchProgress(key, {
            status: "error",
            error: (err as Error).message,
          });
        }
      });
      await refresh();
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">
        Invoices & receipts
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Upload PDFs or photos. You don&apos;t need to pick which payment each
        invoice belongs to — matching happens later.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading) void handleFiles(e.dataTransfer.files);
        }}
        className={`mt-4 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary-light"
            : "border-neutral-300 bg-neutral-50"
        }`}
      >
        <p className="text-sm text-neutral-700">
          Drop files here, or choose from your device.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          PDF, PNG, JPEG, WebP, or HEIC. Up to 25 MB each.
        </p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={uploading}
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
          }}
          className="mx-auto mt-3 block w-full max-w-sm text-sm text-neutral-900"
        />
      </div>

      {progress.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-200 text-xs">
          {progress.map((p) => (
            <li
              key={p.key}
              className="flex items-center justify-between py-1.5"
            >
              <span className="truncate text-neutral-700">{p.name}</span>
              {p.status === "error" ? (
                <span className="text-red-600">{p.error}</span>
              ) : (
                <span className="text-neutral-500">
                  {p.status === "uploading"
                    ? "Uploading…"
                    : p.status === "confirming"
                      ? "Confirming…"
                      : "Done"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="bg-primary hover:bg-primary-hover focus:ring-primary mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "Upload invoices"}
      </button>

      <div className="mt-6 border-t border-neutral-200 pt-4">
        {docs.length === 0 ? (
          <p className="text-sm text-neutral-500">No invoices uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {d.filename}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {d.fileType.toUpperCase()}
                    {d.fileSizeBytes != null
                      ? ` · ${formatBytes(d.fileSizeBytes)}`
                      : ""}{" "}
                    · uploaded {formatDate(d.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StatusChip
                    label={d.scanStatus === "clean" ? "Stored" : "Pending"}
                    tone={d.scanStatus === "clean" ? "clean" : "pending"}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
