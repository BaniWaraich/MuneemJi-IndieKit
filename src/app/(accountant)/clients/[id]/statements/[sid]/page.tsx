import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankStatements, bankTransactions, clientOrgs } from '@/db/schema/muneem';
import { auth } from '@/auth';
import { formatINR, formatDateIN } from '@/lib/format/inr';
import { StatementUnlockPrompt } from './statement-unlock-prompt';
import { RefreshButton } from './refresh-button';
import { ReasoningCell } from './reasoning-cell';

type Tx = typeof bankTransactions.$inferSelect;
type Category = NonNullable<Tx['category']>;
type Method = NonNullable<Tx['interpretationMethod']>;

// ---------------------------------------------------------------------------
// Badge / chip helpers (CA-facing — accounting terminology is allowed here)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<Category, string> = {
  vendor_payment: 'Vendor payment',
  customer_receipt: 'Customer receipt',
  salary: 'Salary',
  bank_charge: 'Bank charge',
  inter_account_transfer: 'Inter-account',
  loan_emi: 'Loan EMI',
  owner_drawing: 'Owner drawing',
  tax_payment: 'Tax payment',
  unknown: 'Unknown',
};

const CATEGORY_STYLES: Record<Category, string> = {
  vendor_payment: 'bg-blue-50 text-blue-700 border-blue-200',
  customer_receipt: 'bg-green-50 text-green-700 border-green-200',
  salary: 'bg-violet-50 text-violet-700 border-violet-200',
  bank_charge: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  inter_account_transfer: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  loan_emi: 'bg-amber-50 text-amber-700 border-amber-200',
  owner_drawing: 'bg-pink-50 text-pink-700 border-pink-200',
  tax_payment: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  unknown: 'bg-red-50 text-red-700 border-red-200',
};

function CategoryBadge({ category }: { category: Tx['category'] }) {
  if (!category) {
    return <span className="text-xs text-neutral-400">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[category]}`}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

function NeedsInvoiceBadge({ needsInvoice }: { needsInvoice: boolean }) {
  return needsInvoice ? (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
      No
    </span>
  );
}

function MethodChip({ method }: { method: Tx['interpretationMethod'] }) {
  if (!method) {
    return <span className="text-xs text-neutral-400">—</span>;
  }
  let style: string;
  if (method === 'llm_fallback') {
    style = 'bg-red-50 text-red-700 border-red-200';
  } else if (method === 'llm') {
    style = 'bg-violet-50 text-violet-700 border-violet-200';
  } else {
    // rule_* methods
    style = 'bg-blue-50 text-blue-700 border-blue-200';
  }
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${style}`}
    >
      {method}
    </span>
  );
}

function ConfidenceCell({ value }: { value: string | null }) {
  if (value === null) {
    return <span className="text-neutral-400">—</span>;
  }
  const fraction = Number(value);
  const pct = Math.round(fraction * 100);
  let color: string;
  if (fraction >= 0.8) color = 'text-green-700';
  else if (fraction >= 0.5) color = 'text-amber-700';
  else color = 'text-red-600';
  return <span className={`font-medium ${color}`}>{pct}%</span>;
}

const MATCH_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  unmatched: {
    label: 'Awaiting invoice',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  flagged: {
    label: 'Needs review',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
};

function MatchStatusBadge({ status }: { status: string }) {
  const cfg = MATCH_STATUS_BADGES[status] ?? {
    label: status,
    className: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page (server component)
// ---------------------------------------------------------------------------

export default async function StatementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sid: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id, sid } = await params;
  const { tab } = await searchParams;
  const activeTab = tab === 'invoices' ? 'invoices' : 'parsed';

  const session = await auth();
  if (
    !session ||
    (session.user.role !== 'ca_admin' && session.user.role !== 'ca_staff') ||
    !session.user.firmId
  ) {
    redirect('/login');
  }

  const client = await db.query.clientOrgs.findFirst({
    where: and(eq(clientOrgs.id, id), eq(clientOrgs.firmId, session.user.firmId)),
  });
  if (!client) notFound();

  const statement = await db.query.bankStatements.findFirst({
    where: and(eq(bankStatements.id, sid), eq(bankStatements.clientOrgId, id)),
  });
  if (!statement) notFound();

  const txs = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.statementId, sid))
    .orderBy(asc(bankTransactions.transactionDate));

  // Status is typed against the current enum; cast to string so we can also
  // handle Task-1 statuses ('password_required' / 'unlocking') defensively
  // until that migration lands.
  const status = statement.status as string;

  // --- Summary metrics (Parsed Output) ---
  const total = txs.length;
  const ruleCount = txs.filter((t) => t.interpretationMethod?.startsWith('rule_')).length;
  const llmCount = txs.filter((t) => t.interpretationMethod === 'llm').length;
  const fallbackCount = txs.filter((t) => t.interpretationMethod === 'llm_fallback').length;
  const needsInvoiceCount = txs.filter((t) => t.needsInvoice).length;

  const confValues = txs
    .map((t) => (t.interpretationConfidence === null ? null : Number(t.interpretationConfidence)))
    .filter((v): v is number => v !== null);
  const avgConfidence =
    confValues.length > 0
      ? Math.round((confValues.reduce((a, b) => a + b, 0) / confValues.length) * 100)
      : null;

  // --- Invoices Needed filter ---
  const invoiceTxs = txs.filter(
    (t) => t.needsInvoice && t.matchStatus !== 'out_of_scope',
  );

  return (
    <div className="min-h-screen bg-neutral-100">
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <Link href={`/clients/${id}`} className="text-primary hover:text-primary-hover text-sm">
          ← Back to {client.name}
        </Link>

        {/* Statement header */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-neutral-900">{statement.filename}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {statement.periodStart && statement.periodEnd
              ? `${formatDateIN(statement.periodStart)} – ${formatDateIN(statement.periodEnd)} · `
              : ''}
            {statement.currency} · status:{' '}
            <span className="font-medium text-neutral-700">{status}</span>
          </p>

          {/* Status-conditional notices */}
          {status === 'password_required' && (
            <StatementUnlockPrompt
              clientOrgId={id}
              statementId={sid}
              errorMessage={statement.errorMessage}
            />
          )}

          {(status === 'processing' ||
            status === 'phase1_complete' ||
            status === 'unlocking') && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs text-blue-700">Parsing in progress — refresh to update.</p>
              <RefreshButton />
            </div>
          )}

          {status === 'failed' && statement.errorMessage && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {statement.errorMessage}
            </p>
          )}

          {status === 'empty' && (
            <p className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
              No transactions were extracted from this statement.
            </p>
          )}
        </div>

        {/* Tabs */}
        <div>
          <nav className="flex gap-6 border-b border-neutral-200">
            <Link
              href={`/clients/${id}/statements/${sid}?tab=parsed`}
              className={`-mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'parsed'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Parsed Output
            </Link>
            <Link
              href={`/clients/${id}/statements/${sid}?tab=invoices`}
              className={`-mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === 'invoices'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Invoices Needed
              {invoiceTxs.length > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  {invoiceTxs.length}
                </span>
              )}
            </Link>
          </nav>

          {activeTab === 'parsed' ? (
            <ParsedOutputTab
              txs={txs}
              total={total}
              ruleCount={ruleCount}
              llmCount={llmCount}
              fallbackCount={fallbackCount}
              needsInvoiceCount={needsInvoiceCount}
              avgConfidence={avgConfidence}
            />
          ) : (
            <InvoicesNeededTab txs={invoiceTxs} />
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Parsed Output
// ---------------------------------------------------------------------------

function ParsedOutputTab({
  txs,
  total,
  ruleCount,
  llmCount,
  fallbackCount,
  needsInvoiceCount,
  avgConfidence,
}: {
  txs: Tx[];
  total: number;
  ruleCount: number;
  llmCount: number;
  fallbackCount: number;
  needsInvoiceCount: number;
  avgConfidence: number | null;
}) {
  return (
    <div className="mt-4 space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryStat label="Transactions" value={String(total)} />
        <SummaryStat
          label="Rule / LLM / Fallback"
          value={`${ruleCount} / ${llmCount} / ${fallbackCount}`}
        />
        <SummaryStat label="Invoices needed" value={String(needsInvoiceCount)} />
        <SummaryStat
          label="Avg. confidence"
          value={avgConfidence === null ? '—' : `${avgConfidence}%`}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        {total === 0 ? (
          <p className="px-6 py-6 text-sm text-neutral-500">
            No transactions parsed from this statement.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 text-xs text-neutral-700">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-4 py-2 text-left font-medium">Invoice needed</th>
                  <th className="px-4 py-2 text-left font-medium">Method</th>
                  <th className="px-4 py-2 text-right font-medium">Confidence</th>
                  <th className="px-4 py-2 text-left font-medium">Reasoning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {txs.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="px-4 py-2 whitespace-nowrap text-neutral-700">
                      {formatDateIN(t.transactionDate)}
                    </td>
                    <td className="max-w-xs px-4 py-2 text-neutral-900">{t.description}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium whitespace-nowrap ${
                        t.amountMinor < 0n ? 'text-red-600' : 'text-green-700'
                      }`}
                    >
                      {formatINR(t.amountMinor)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <CategoryBadge category={t.category} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <NeedsInvoiceBadge needsInvoice={t.needsInvoice} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <MethodChip method={t.interpretationMethod} />
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <ConfidenceCell value={t.interpretationConfidence} />
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <ReasoningCell text={t.reasoning} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Invoices Needed
// ---------------------------------------------------------------------------

function InvoicesNeededTab({ txs }: { txs: Tx[] }) {
  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        {txs.length === 0 ? (
          <p className="px-6 py-6 text-sm text-neutral-500">
            No invoices required for this statement.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 text-xs text-neutral-700">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Category</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Reasoning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {txs.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="px-4 py-2 whitespace-nowrap text-neutral-700">
                      {formatDateIN(t.transactionDate)}
                    </td>
                    <td className="max-w-xs px-4 py-2 text-neutral-900">{t.description}</td>
                    <td className="px-4 py-2 text-right font-medium whitespace-nowrap text-red-600">
                      {formatINR(t.amountMinor)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <CategoryBadge category={t.category} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <MatchStatusBadge status={t.matchStatus} />
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <ReasoningCell text={t.reasoning} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
