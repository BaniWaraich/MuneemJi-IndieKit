import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { clientOrgs } from '@/db/schema/muneem';
import { eq } from 'drizzle-orm';
import { SignOutButton } from '@/app/(accountant)/dashboard/sign-out-button';
import { OwnerNav } from './owner-nav';

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.role !== 'business_owner' || !session.user.firmId) {
    redirect('/owner/login');
  }

  const org = await db.query.clientOrgs.findFirst({
    where: eq(clientOrgs.id, session.user.firmId),
  });

  return (
    <div className="min-h-screen bg-neutral-100">
      <nav className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-neutral-900">Muneem Jee</h1>
              {org && <span className="text-sm text-neutral-500">· {org.name}</span>}
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-neutral-500">{session.user.email}</span>
              <SignOutButton callbackUrl="/owner/login" />
            </div>
          </div>
        </div>
      </nav>
      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-8">
        <aside className="w-64 shrink-0">
          <OwnerNav />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
