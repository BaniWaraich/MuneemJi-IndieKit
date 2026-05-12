'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const COUNTRY_DEFAULTS: Record<
  string,
  { currency: string; taxRegime: 'GST_INDIA' | 'VAT_EU' | 'GST_HST_CANADA'; taxLabel: string }
> = {
  IN: { currency: 'INR', taxRegime: 'GST_INDIA', taxLabel: 'GST (India)' },
  IE: { currency: 'EUR', taxRegime: 'VAT_EU', taxLabel: 'VAT (EU)' },
  CA: { currency: 'CAD', taxRegime: 'GST_HST_CANADA', taxLabel: 'GST/HST (Canada)' },
};

type FieldErrors = Partial<Record<'name' | 'taxNumber', string>>;

export default function NewClientPage() {
  const [name, setName] = useState('');
  const [country, setCountry] = useState<keyof typeof COUNTRY_DEFAULTS>('IN');
  const [taxNumber, setTaxNumber] = useState('');
  const { currency, taxRegime, taxLabel } = COUNTRY_DEFAULTS[country];
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const input = (key?: keyof FieldErrors) =>
    `mt-1 block w-full px-3 py-2 text-sm text-neutral-900 bg-white border rounded-lg placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
      key && errors[key]
        ? 'border-red-500 focus:ring-red-500'
        : 'border-neutral-300 focus:ring-primary'
    }`;

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = 'Client name is required.';
    if (country === 'IN' && taxNumber && !GSTIN_REGEX.test(taxNumber.trim())) {
      e.taxNumber = 'GSTIN must be 15 characters (e.g. 22AAAAA0000A1Z5)';
    }
    return e;
  };

  const handleSubmit = async () => {
    setFormError('');
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    setLoading(true);
    const res = await fetch('/api/v1/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        country,
        currency,
        taxRegime,
        taxNumber: taxNumber.trim() || null,
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      const zf = data?.details?.fieldErrors as Record<string, string[]> | undefined;
      if (zf) {
        const se: FieldErrors = {};
        for (const [k, msgs] of Object.entries(zf)) {
          if (msgs?.length) se[k as keyof FieldErrors] = msgs[0];
        }
        setErrors(se);
        setFormError('Please fix the highlighted fields.');
      } else {
        setFormError(data.error || 'Failed to add client.');
      }
      return;
    }

    router.push(`/clients/${data.client.id}`);
  };

  return (
    <div className="min-h-screen bg-neutral-100">
      <main className="mx-auto max-w-2xl px-6 py-8">
        <Link href="/dashboard" className="text-primary hover:text-primary-hover text-sm">
          ← Back to clients
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-neutral-900">Add a client</h1>

        <div className="mt-6 space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          {formError && (
            <div
              role="alert"
              className="bg-error-light rounded-lg border border-red-200 px-4 py-3 text-sm text-red-700"
            >
              {formError}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-neutral-700">
              Client organisation name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors({ ...errors, name: '' });
              }}
              className={input('name')}
              placeholder="Acme Pvt Ltd"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="country" className="block text-sm font-medium text-neutral-700">
              Country
            </label>
            <select
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value as keyof typeof COUNTRY_DEFAULTS)}
              className={input()}
            >
              <option value="IN">India</option>
              <option value="IE">Ireland</option>
              <option value="CA">Canada</option>
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              Currency ({currency}) and tax regime ({taxLabel}) are set automatically.
            </p>
          </div>

          <div>
            <label htmlFor="taxNumber" className="block text-sm font-medium text-neutral-700">
              {country === 'IN' ? 'GSTIN (optional)' : 'Tax number (optional)'}
            </label>
            <input
              id="taxNumber"
              type="text"
              value={taxNumber}
              onChange={(e) => {
                setTaxNumber(e.target.value.toUpperCase());
                if (errors.taxNumber) setErrors({ ...errors, taxNumber: '' });
              }}
              className={input('taxNumber')}
              placeholder={country === 'IN' ? '22AAAAA0000A1Z5' : ''}
            />
            {errors.taxNumber && <p className="mt-1 text-xs text-red-600">{errors.taxNumber}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              Cancel
            </Link>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
            >
              {loading ? 'Adding client…' : 'Add client'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
