'use client';

import { useState } from 'react';

type Contact = {
  id: string;
  name: string;
  email: string;
  hasAccount: boolean;
  hasPendingInvite: boolean;
  inviteExpiresAt: string | null;
};

type FieldErrors = Partial<Record<'name' | 'email', string>>;

export function ContactsPanel({
  clientOrgId,
  initialContacts,
}: {
  clientOrgId: string;
  initialContacts: Contact[];
}) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteLoadingId, setInviteLoadingId] = useState<string | null>(null);

  const input = (key?: keyof FieldErrors) =>
    `px-3 py-2 text-sm text-neutral-900 bg-white border rounded-lg placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:border-transparent transition-colors w-full ${
      key && errors[key]
        ? 'border-red-500 focus:ring-red-500'
        : 'border-neutral-300 focus:ring-primary'
    }`;

  const addContact = async () => {
    setFormError('');
    const e: FieldErrors = {};
    if (!name.trim()) e.name = 'Name is required.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = 'Enter a valid email address.';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    const res = await fetch(`/api/v1/clients/${clientOrgId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
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
      }
      setFormError(
        data.error === 'CONTACT_EMAIL_DUPLICATE' ? '' : data.error || 'Failed to add contact.',
      );
      return;
    }

    setContacts((c) => [...c, { ...data.contact, hasPendingInvite: false, inviteExpiresAt: null }]);
    setName('');
    setEmail('');
  };

  const sendInvite = async (contactId: string) => {
    setInviteLoadingId(contactId);
    const res = await fetch(`/api/v1/clients/${clientOrgId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId }),
    });
    const data = await res.json();
    setInviteLoadingId(null);

    if (!res.ok) {
      alert(data.error || 'Failed to send invite');
      return;
    }

    setContacts((cs) =>
      cs.map((c) =>
        c.id === contactId ? { ...c, hasPendingInvite: true, inviteExpiresAt: data.expiresAt } : c,
      ),
    );
  };

  const badge = (c: Contact) => {
    if (c.hasAccount) {
      return (
        <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
          Accepted
        </span>
      );
    }
    if (c.hasPendingInvite) {
      return (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
          Invite pending
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
        Not invited
      </span>
    );
  };

  return (
    <section className="space-y-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">Contacts</h2>

      {contacts.length === 0 ? (
        <p className="text-sm text-neutral-500">No contacts yet. Add one below.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-700">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="py-3 text-neutral-900">{c.name}</td>
                <td className="py-3 text-neutral-700">{c.email}</td>
                <td className="py-3">{badge(c)}</td>
                <td className="py-3 text-right">
                  {!c.hasAccount && (
                    <button
                      onClick={() => sendInvite(c.id)}
                      disabled={inviteLoadingId === c.id}
                      className="inline-flex items-center rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50"
                    >
                      {inviteLoadingId === c.id
                        ? 'Sending…'
                        : c.hasPendingInvite
                          ? 'Resend invite'
                          : 'Send invite'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="border-t border-neutral-200 pt-4">
        <h3 className="text-base font-medium text-neutral-900">Add contact</h3>
        {formError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {formError}
          </p>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors({ ...errors, name: '' });
              }}
              placeholder="Name"
              className={input('name')}
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
          </div>
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors({ ...errors, email: '' });
              }}
              placeholder="owner@company.com"
              className={input('email')}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
          </div>
          <button
            onClick={addContact}
            disabled={loading}
            className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
          >
            {loading ? 'Adding…' : 'Add contact'}
          </button>
        </div>
      </div>
    </section>
  );
}
