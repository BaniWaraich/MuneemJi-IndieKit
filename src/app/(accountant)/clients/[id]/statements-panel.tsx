'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Statement = {
  id: string;
  filename: string;
  status: 'processing' | 'phase1_complete' | 'parsed' | 'empty' | 'failed';
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  createdAt: string;
};

function StatusBadge({ status }: { status: Statement['status'] }) {
  const styles: Record<Statement['status'], string> = {
    processing: 'bg-amber-50 text-amber-700 border-amber-200',
    phase1_complete: 'bg-blue-50 text-blue-700 border-blue-200',
    parsed: 'bg-green-50 text-green-700 border-green-200',
    empty: 'bg-neutral-50 text-neutral-700 border-neutral-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
  };
  const label = {
    processing: 'Processing',
    phase1_complete: 'Phase 1 complete',
    parsed: 'Parsed',
    empty: 'No transactions',
    failed: 'Failed',
  }[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

export function StatementsPanel({
  clientOrgId,
  initial,
  detailHrefPrefix = `/clients/${clientOrgId}/statements`,
}: {
  clientOrgId: string;
  initial: Statement[];
  detailHrefPrefix?: string;
}) {
  const [statements, setStatements] = useState<Statement[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/v1/clients/${clientOrgId}/statements`, { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { statements: Statement[] };
      setStatements(data.statements);
    }
  }, [clientOrgId]);

  useEffect(() => {
    const anyProcessing = statements.some((s) => s.status === 'processing');
    if (!anyProcessing) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [statements, refresh]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError('Choose a file first.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const createRes = await fetch(`/api/v1/clients/${clientOrgId}/statements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        }),
      });
      if (!createRes.ok) throw new Error('Failed to start upload');
      const { statementId, uploadUrl } = (await createRes.json()) as {
        statementId: string;
        uploadUrl: string;
      };

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');

      const confirmRes = await fetch(`/api/v1/clients/${clientOrgId}/statements/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementId }),
      });
      if (!confirmRes.ok) throw new Error('Failed to confirm upload');

      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">Bank statements</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Upload a CSV or PDF. We parse it into transactions automatically.
      </p>

      <form onSubmit={handleUpload} className="mt-4 space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
        />
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        <button
          type="submit"
          disabled={uploading}
          className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload statement'}
        </button>
      </form>

      <div className="mt-6 border-t border-neutral-200 pt-4">
        {statements.length === 0 ? (
          <p className="text-sm text-neutral-500">No statements uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {statements.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <Link
                    href={`${detailHrefPrefix}/${s.id}`}
                    className="text-primary hover:text-primary-hover truncate text-sm font-medium"
                  >
                    {s.filename}
                  </Link>
                  <p className="text-xs text-neutral-500">
                    {s.periodStart && s.periodEnd
                      ? `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)} · `
                      : ''}
                    {s.currency} · uploaded {formatDate(s.createdAt)}
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
