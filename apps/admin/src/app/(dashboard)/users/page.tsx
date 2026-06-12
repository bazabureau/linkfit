import { UsersTable } from './UsersTable';

export const metadata = {
  title: 'İstifadəçilər · LinkFit Admin',
};

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            İstifadəçilər
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {/* TODO: i18n — Manage users, roles, and account status. */}
            İstifadəçiləri, rolları və hesab statusunu idarə edin.
          </p>
        </div>
      </header>

      <UsersTable />
    </div>
  );
}
