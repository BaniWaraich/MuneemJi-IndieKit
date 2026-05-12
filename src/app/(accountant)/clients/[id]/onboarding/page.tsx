"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BankAccount = {
  account_label: string;
  bank_name: string;
  account_number_last4: string;
  is_primary_operating: boolean;
  notes: string;
};

type KnownVendor = {
  name: string;
  category: string;
  needs_invoice: boolean;
  description_patterns: string; // comma-sep in UI
  notes: string;
};

type KnownCustomer = {
  name: string;
  description_patterns: string;
  notes: string;
};

type ActiveLoan = {
  lender: string;
  loan_type: "term_loan" | "vehicle" | "equipment" | "other";
  approximate_amount_inr: string; // INR display; converted to paise on submit
  debit_day_of_month: string;
  description_pattern: string;
  notes: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inrToPaise = (inr: string): string => {
  const n = parseFloat(inr.replace(/,/g, ""));
  if (isNaN(n) || n < 0) return "0";
  return Math.round(n * 100).toString();
};

const emptyAccount = (): BankAccount => ({
  account_label: "",
  bank_name: "",
  account_number_last4: "",
  is_primary_operating: false,
  notes: "",
});

const emptyVendor = (): KnownVendor => ({
  name: "",
  category: "",
  needs_invoice: true,
  description_patterns: "",
  notes: "",
});

const emptyCustomer = (): KnownCustomer => ({
  name: "",
  description_patterns: "",
  notes: "",
});

const emptyLoan = (): ActiveLoan => ({
  lender: "",
  loan_type: "term_loan",
  approximate_amount_inr: "",
  debit_day_of_month: "",
  description_pattern: "",
  notes: "",
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-600">{msg}</p>;
}

function Label({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-neutral-700"
    >
      {children}
    </label>
  );
}

const inputCls =
  "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-neutral-900";

const selectCls =
  "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-neutral-900";

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      {subtitle && (
        <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
      )}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function AddRowButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900"
    >
      + {label}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-neutral-400 hover:text-red-600"
    >
      Remove
    </button>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Business Profile
// ---------------------------------------------------------------------------

type Step1Errors = Partial<Record<string, string>>;

function Step1({
  clientId,
  clientName,
  onDone,
}: {
  clientId: string;
  clientName: string;
  onDone: () => void;
}) {
  const [legalStructure, setLegalStructure] = useState("sole_proprietorship");
  const [businessType, setBusinessType] = useState("trader");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [gstRegistrationType, setGstRegistrationType] = useState("regular");
  const [primaryTransactionMode, setPrimaryTransactionMode] = useState("mixed");
  const [invoiceSoftware, setInvoiceSoftware] = useState("tally");
  const [hasInterCompanyTransactions, setHasInterCompanyTransactions] =
    useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([
    emptyAccount(),
  ]);
  const [errors, setErrors] = useState<Step1Errors>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");

  const validate = (): Step1Errors => {
    const e: Step1Errors = {};
    if (!industry.trim()) e.industry = "Required";
    if (!description.trim()) e.description = "Required";
    if (bankAccounts.length === 0)
      e.bankAccounts = "Add at least one bank account";
    const hasPrimary = bankAccounts.some((a) => a.is_primary_operating);
    if (!hasPrimary) e.bankAccounts = "Mark one account as primary operating";
    bankAccounts.forEach((a, i) => {
      if (!a.account_label.trim()) e[`ba_label_${i}`] = "Required";
      if (!a.bank_name.trim()) e[`ba_bank_${i}`] = "Required";
      if (!/^\d{4}$/.test(a.account_number_last4))
        e[`ba_last4_${i}`] = "Must be exactly 4 digits";
    });
    return e;
  };

  const handleSave = async () => {
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setSaving(true);
    setServerError("");
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalStructure,
          businessType,
          industry: industry.trim(),
          description: description.trim(),
          gstRegistrationType,
          primaryTransactionMode,
          invoiceSoftware,
          hasInterCompanyTransactions,
          bankAccounts: bankAccounts.map((a) => ({
            ...a,
            notes: a.notes || undefined,
          })),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setServerError(d.error ?? "Failed to save profile");
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const updateAccount = (i: number, patch: Partial<BankAccount>) => {
    setBankAccounts((prev) =>
      prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    );
  };

  const setPrimary = (i: number) => {
    setBankAccounts((prev) =>
      prev.map((a, idx) => ({ ...a, is_primary_operating: idx === i })),
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">
          Business profile
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Required — used by the AI to classify transactions for{" "}
          <strong>{clientName}</strong>.
        </p>
      </div>

      <SectionCard title="Business details">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="legalStructure">Legal structure</Label>
            <select
              id="legalStructure"
              value={legalStructure}
              onChange={(e) => setLegalStructure(e.target.value)}
              className={selectCls}
            >
              <option value="sole_proprietorship">Sole proprietorship</option>
              <option value="partnership">Partnership</option>
              <option value="llp">LLP</option>
              <option value="private_limited">Private limited</option>
              <option value="public_limited">Public limited</option>
              <option value="trust">Trust</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <Label htmlFor="businessType">Business type</Label>
            <select
              id="businessType"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className={selectCls}
            >
              <option value="manufacturer">Manufacturer</option>
              <option value="trader">Trader</option>
              <option value="service_provider">Service provider</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="industry">Industry</Label>
          <input
            id="industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Retail textiles, IT services"
            className={inputCls}
          />
          <FieldError msg={errors.industry} />
        </div>

        <div>
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Brief description of what this business does"
            className={inputCls}
          />
          <FieldError msg={errors.description} />
        </div>
      </SectionCard>

      <SectionCard title="Tax & transactions">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="gstRegistrationType">GST registration</Label>
            <select
              id="gstRegistrationType"
              value={gstRegistrationType}
              onChange={(e) => setGstRegistrationType(e.target.value)}
              className={selectCls}
            >
              <option value="regular">Regular</option>
              <option value="composition">Composition</option>
              <option value="exempt">Exempt</option>
              <option value="unregistered">Unregistered</option>
            </select>
          </div>
          <div>
            <Label htmlFor="primaryTransactionMode">
              Primary transaction mode
            </Label>
            <select
              id="primaryTransactionMode"
              value={primaryTransactionMode}
              onChange={(e) => setPrimaryTransactionMode(e.target.value)}
              className={selectCls}
            >
              <option value="mostly_digital">Mostly digital</option>
              <option value="mixed">Mixed</option>
              <option value="cash_heavy">Cash heavy</option>
            </select>
          </div>
          <div>
            <Label htmlFor="invoiceSoftware">Invoice software</Label>
            <select
              id="invoiceSoftware"
              value={invoiceSoftware}
              onChange={(e) => setInvoiceSoftware(e.target.value)}
              className={selectCls}
            >
              <option value="tally">Tally</option>
              <option value="busy">Busy</option>
              <option value="zoho_books">Zoho Books</option>
              <option value="quickbooks">QuickBooks</option>
              <option value="manual">Manual / Excel</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            id="interCompany"
            type="checkbox"
            checked={hasInterCompanyTransactions}
            onChange={(e) => setHasInterCompanyTransactions(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
          />
          <Label htmlFor="interCompany">Has inter-company transactions</Label>
        </div>
      </SectionCard>

      <SectionCard
        title="Bank accounts"
        subtitle="Add all accounts that appear in uploaded statements. Mark the primary operating account."
      >
        {errors.bankAccounts && (
          <p className="text-xs text-red-600">{errors.bankAccounts}</p>
        )}
        {bankAccounts.map((a, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-neutral-200 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-600">
                Account {i + 1}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <input
                    type="radio"
                    name="primary_account"
                    checked={a.is_primary_operating}
                    onChange={() => setPrimary(i)}
                    className="h-3.5 w-3.5"
                  />
                  Primary operating
                </label>
                {bankAccounts.length > 1 && (
                  <RemoveButton
                    onClick={() =>
                      setBankAccounts((prev) =>
                        prev.filter((_, idx) => idx !== i),
                      )
                    }
                  />
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Label</Label>
                <input
                  value={a.account_label}
                  onChange={(e) =>
                    updateAccount(i, { account_label: e.target.value })
                  }
                  placeholder="e.g. HDFC Current"
                  className={inputCls}
                />
                <FieldError msg={errors[`ba_label_${i}`]} />
              </div>
              <div>
                <Label>Bank name</Label>
                <input
                  value={a.bank_name}
                  onChange={(e) =>
                    updateAccount(i, { bank_name: e.target.value })
                  }
                  placeholder="e.g. HDFC Bank"
                  className={inputCls}
                />
                <FieldError msg={errors[`ba_bank_${i}`]} />
              </div>
              <div>
                <Label>Last 4 digits</Label>
                <input
                  value={a.account_number_last4}
                  onChange={(e) =>
                    updateAccount(i, {
                      account_number_last4: e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 4),
                    })
                  }
                  placeholder="1234"
                  className={inputCls}
                  maxLength={4}
                />
                <FieldError msg={errors[`ba_last4_${i}`]} />
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <input
                  value={a.notes}
                  onChange={(e) => updateAccount(i, { notes: e.target.value })}
                  placeholder="e.g. Used for GST payments"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        ))}
        <AddRowButton
          onClick={() => setBankAccounts((prev) => [...prev, emptyAccount()])}
          label="Add bank account"
        />
      </SectionCard>

      {serverError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save & continue →"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Client Knowledge
// ---------------------------------------------------------------------------

function Step2({
  clientId,
  clientName,
  onDone,
}: {
  clientId: string;
  clientName: string;
  onDone: () => void;
}) {
  const [vendors, setVendors] = useState<KnownVendor[]>([]);
  const [customers, setCustomers] = useState<KnownCustomer[]>([]);
  const [loans, setLoans] = useState<ActiveLoan[]>([]);

  // Owner drawings
  const [drawingsMethod, setDrawingsMethod] = useState("upi_transfer");
  const [drawingsAmount, setDrawingsAmount] = useState("");
  const [drawingsPattern, setDrawingsPattern] = useState("");
  const [hasDrawings, setHasDrawings] = useState(false);

  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");

  const updateVendor = (i: number, patch: Partial<KnownVendor>) =>
    setVendors((prev) =>
      prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
    );
  const updateCustomer = (i: number, patch: Partial<KnownCustomer>) =>
    setCustomers((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  const updateLoan = (i: number, patch: Partial<ActiveLoan>) =>
    setLoans((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );

  const handleSave = async () => {
    setSaving(true);
    setServerError("");
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/knowledge`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knownVendors: vendors.map((v) => ({
            name: v.name,
            category: v.category,
            needs_invoice: v.needs_invoice,
            description_patterns: v.description_patterns
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            typical_amount_min_minor: "0",
            typical_amount_max_minor: "0",
            notes: v.notes || undefined,
          })),
          knownCustomers: customers.map((c) => ({
            name: c.name,
            description_patterns: c.description_patterns
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            typical_amount_min_minor: "0",
            typical_amount_max_minor: "0",
            notes: c.notes || undefined,
          })),
          activeLoans: loans.map((l) => ({
            lender: l.lender,
            loan_type: l.loan_type,
            approximate_amount_minor: inrToPaise(l.approximate_amount_inr),
            debit_day_of_month: l.debit_day_of_month
              ? parseInt(l.debit_day_of_month)
              : null,
            description_pattern: l.description_pattern,
            notes: l.notes || undefined,
          })),
          ownerDrawingsPattern: hasDrawings
            ? {
                method: drawingsMethod,
                approximate_monthly_minor: inrToPaise(drawingsAmount),
                typical_description_pattern: drawingsPattern || undefined,
              }
            : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setServerError(d.error ?? "Failed to save knowledge");
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            Client knowledge
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Optional enrichment — helps the AI classify more transactions
            correctly for <strong>{clientName}</strong>. You can add or update
            this anytime.
          </p>
        </div>
        <button
          onClick={onDone}
          className="text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-700"
        >
          Skip for now
        </button>
      </div>

      {/* Known vendors */}
      <SectionCard
        title="Known vendors"
        subtitle="Regular suppliers whose bank transfers you recognise. The AI pre-filters these and uses needs_invoice to decide if the CA needs a receipt."
      >
        {vendors.map((v, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-neutral-200 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-600">
                Vendor {i + 1}
              </span>
              <RemoveButton
                onClick={() =>
                  setVendors((prev) => prev.filter((_, idx) => idx !== i))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vendor name</Label>
                <input
                  value={v.name}
                  onChange={(e) => updateVendor(i, { name: e.target.value })}
                  placeholder="e.g. Reliance Industries"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Category</Label>
                <input
                  value={v.category}
                  onChange={(e) =>
                    updateVendor(i, { category: e.target.value })
                  }
                  placeholder="e.g. raw_material, utilities"
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                <Label>Description patterns (comma-separated)</Label>
                <input
                  value={v.description_patterns}
                  onChange={(e) =>
                    updateVendor(i, { description_patterns: e.target.value })
                  }
                  placeholder="e.g. RELIANCE IND, RIL PAYMENT"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  id={`needs_invoice_${i}`}
                  type="checkbox"
                  checked={v.needs_invoice}
                  onChange={(e) =>
                    updateVendor(i, { needs_invoice: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-neutral-300"
                />
                <Label htmlFor={`needs_invoice_${i}`}>Needs invoice</Label>
              </div>
            </div>
          </div>
        ))}
        <AddRowButton
          onClick={() => setVendors((prev) => [...prev, emptyVendor()])}
          label="Add vendor"
        />
      </SectionCard>

      {/* Known customers */}
      <SectionCard
        title="Known customers"
        subtitle="Regular clients who pay into this account. Inbound transfers from these will be classified as income."
      >
        {customers.map((c, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-neutral-200 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-600">
                Customer {i + 1}
              </span>
              <RemoveButton
                onClick={() =>
                  setCustomers((prev) => prev.filter((_, idx) => idx !== i))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Customer name</Label>
                <input
                  value={c.name}
                  onChange={(e) => updateCustomer(i, { name: e.target.value })}
                  placeholder="e.g. Tata Consultancy"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Description patterns (comma-separated)</Label>
                <input
                  value={c.description_patterns}
                  onChange={(e) =>
                    updateCustomer(i, { description_patterns: e.target.value })
                  }
                  placeholder="e.g. TCS PAYMENT, TATA CONS"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        ))}
        <AddRowButton
          onClick={() => setCustomers((prev) => [...prev, emptyCustomer()])}
          label="Add customer"
        />
      </SectionCard>

      {/* Active loans */}
      <SectionCard
        title="Active loans & EMIs"
        subtitle="Regular debit EMIs. The AI pre-filters these so they are not flagged as unknown expenses."
      >
        {loans.map((l, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-neutral-200 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-600">
                Loan {i + 1}
              </span>
              <RemoveButton
                onClick={() =>
                  setLoans((prev) => prev.filter((_, idx) => idx !== i))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Lender</Label>
                <input
                  value={l.lender}
                  onChange={(e) => updateLoan(i, { lender: e.target.value })}
                  placeholder="e.g. HDFC Bank"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Loan type</Label>
                <select
                  value={l.loan_type}
                  onChange={(e) =>
                    updateLoan(i, {
                      loan_type: e.target.value as ActiveLoan["loan_type"],
                    })
                  }
                  className={selectCls}
                >
                  <option value="term_loan">Term loan</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="equipment">Equipment</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <Label>Approx. EMI amount (₹)</Label>
                <input
                  value={l.approximate_amount_inr}
                  onChange={(e) =>
                    updateLoan(i, { approximate_amount_inr: e.target.value })
                  }
                  placeholder="e.g. 45000"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Debit day of month (optional)</Label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={l.debit_day_of_month}
                  onChange={(e) =>
                    updateLoan(i, { debit_day_of_month: e.target.value })
                  }
                  placeholder="e.g. 5"
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                <Label>Description pattern</Label>
                <input
                  value={l.description_pattern}
                  onChange={(e) =>
                    updateLoan(i, { description_pattern: e.target.value })
                  }
                  placeholder="e.g. HDFC EMI, LOAN EMI DEBIT"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        ))}
        <AddRowButton
          onClick={() => setLoans((prev) => [...prev, emptyLoan()])}
          label="Add loan / EMI"
        />
      </SectionCard>

      {/* Owner drawings */}
      <SectionCard
        title="Owner drawings"
        subtitle="How the owner typically withdraws money. Matched debits will not be flagged as unknown."
      >
        <div className="flex items-center gap-3">
          <input
            id="hasDrawings"
            type="checkbox"
            checked={hasDrawings}
            onChange={(e) => setHasDrawings(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          <Label htmlFor="hasDrawings">
            Owner regularly draws money from this account
          </Label>
        </div>
        {hasDrawings && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <select
                value={drawingsMethod}
                onChange={(e) => setDrawingsMethod(e.target.value)}
                className={selectCls}
              >
                <option value="upi_transfer">UPI transfer</option>
                <option value="cash_withdrawal">Cash withdrawal</option>
                <option value="salary">Salary</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div>
              <Label>Approx. monthly amount (₹)</Label>
              <input
                value={drawingsAmount}
                onChange={(e) => setDrawingsAmount(e.target.value)}
                placeholder="e.g. 80000"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <Label>Description pattern (optional)</Label>
              <input
                value={drawingsPattern}
                onChange={(e) => setDrawingsPattern(e.target.value)}
                placeholder="e.g. OWNER TRANSFER, SELF NEFT"
                className={inputCls}
              />
            </div>
          </div>
        )}
      </SectionCard>

      {serverError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={onDone}
          className="inline-flex items-center rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save & finish"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const clientId = params.id;

  const [step, setStep] = useState<1 | 2>(1);
  const [clientName, setClientName] = useState("");

  useEffect(() => {
    fetch(`/api/v1/clients/${clientId}/profile`)
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) setStep(2);
      })
      .catch(() => {});

    fetch(`/api/v1/clients`)
      .then((r) => r.json())
      .then((d) => {
        const c = (d.clients ?? []).find(
          (c: { id: string; name: string }) => c.id === clientId,
        );
        if (c) setClientName(c.name);
      })
      .catch(() => {});
  }, [clientId]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/clients/${clientId}`}
          className="text-primary hover:text-primary-hover text-sm"
        >
          ← Back to client
        </Link>
        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              step === 1
                ? "bg-neutral-900 text-white"
                : "bg-green-100 text-green-700"
            }`}
          >
            {step > 1 ? "✓" : "1"}
          </span>
          <span
            className={
              step === 1 ? "font-medium text-neutral-900" : "text-neutral-400"
            }
          >
            Business profile
          </span>
          <span className="text-neutral-300">→</span>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              step === 2
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-500"
            }`}
          >
            2
          </span>
          <span
            className={
              step === 2 ? "font-medium text-neutral-900" : "text-neutral-400"
            }
          >
            Client knowledge
          </span>
        </div>
      </div>

      {step === 1 ? (
        <Step1
          clientId={clientId}
          clientName={clientName}
          onDone={() => setStep(2)}
        />
      ) : (
        <Step2
          clientId={clientId}
          clientName={clientName}
          onDone={() => router.push(`/clients/${clientId}`)}
        />
      )}
    </div>
  );
}
