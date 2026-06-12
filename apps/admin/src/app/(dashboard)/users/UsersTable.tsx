'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAdminUsers,
  useRestoreUser,
  useSoftDeleteUser,
  useUpdateUserRole,
  type AdminRole,
  type User,
} from '@/lib/admin-queries';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

// Tiny helper: prefer AZ, fall back to EN (annotated TODO for translators).
function t(az: string, _en?: string) {
  return az;
}

const PAGE_SIZE = 20;

export function UsersTable() {
  const toast = useToast();
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);

  // Debounce the search input by 300ms.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setQ(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchInput]);

  const params = useMemo(
    () => ({ q: q || undefined, limit: PAGE_SIZE, offset }),
    [q, offset],
  );

  const { data, isLoading, isError, refetch, isFetching } = useAdminUsers(params);

  const updateRole = useUpdateUserRole({
    onSuccess: () => toast.success(t('Uğurlu'), t('Rol yeniləndi.')),
    onError: () =>
      toast.error(t('Xəta'), t('Rol yenilənmədi. Yenidən cəhd edin.')),
  });
  const softDelete = useSoftDeleteUser({
    onSuccess: () => toast.success(t('Uğurlu'), t('İstifadəçi silindi.')),
    onError: () =>
      toast.error(t('Xəta'), t('İstifadəçi silinmədi. Yenidən cəhd edin.')),
  });
  const restore = useRestoreUser({
    onSuccess: () => toast.success(t('Uğurlu'), t('İstifadəçi bərpa edildi.')),
    onError: () =>
      toast.error(t('Xəta'), t('Bərpa alınmadı. Yenidən cəhd edin.')),
  });

  // Confirm dialog state for soft-delete.
  const [confirmDeleteFor, setConfirmDeleteFor] = useState<User | null>(null);

  const total = data?.count ?? 0;
  const results = data?.results ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="border-zinc-800 bg-[#141A22] p-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 max-w-md">
          <Input
            type="search"
            placeholder={t('Ad və ya e-poçt ilə axtar…', 'Search by name or email…')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t('İstifadəçi axtarışı')}
          />
        </div>
        <div className="text-xs text-zinc-500">
          {isFetching && !isLoading ? t('Yenilənir…') : null}
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <UsersSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : results.length === 0 ? (
        <EmptyState hasQuery={q.length > 0} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('İstifadəçi')}</TableHead>
                <TableHead>{t('E-poçt')}</TableHead>
                <TableHead>{t('Rol')}</TableHead>
                <TableHead className="text-right">{t('Oyunlar')}</TableHead>
                <TableHead>{t('Qoşulma')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead className="text-right">{t('Əməliyyatlar')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onChangeRole={(role) =>
                    updateRole.mutate({ id: u.id, role })
                  }
                  onSoftDelete={() => setConfirmDeleteFor(u)}
                  onRestore={() => restore.mutate({ id: u.id })}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && results.length > 0 && (
        <div className="flex items-center justify-between border-t border-zinc-800 p-3 text-sm text-zinc-400">
          <div>
            {t('Cəmi')}: <span className="text-zinc-200">{total}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t('Əvvəlki')}
            </Button>
            <span className="px-2 text-xs">
              {page} / {pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t('Növbəti')}
            </Button>
          </div>
        </div>
      )}

      {/* Soft-delete confirm */}
      <Dialog
        open={confirmDeleteFor !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('İstifadəçini sil?')}</DialogTitle>
            <DialogDescription>
              {confirmDeleteFor
                ? t(
                    `"${confirmDeleteFor.display_name}" hesabı yumşaq silinəcək. Sonradan bərpa edilə bilər.`,
                  )
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmDeleteFor(null)}
            >
              {t('Ləğv et')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmDeleteFor) {
                  softDelete.mutate({ id: confirmDeleteFor.id });
                  setConfirmDeleteFor(null);
                }
              }}
            >
              {t('Sil')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: User;
  onChangeRole: (role: AdminRole) => void;
  onSoftDelete: () => void;
  onRestore: () => void;
}

function UserRow({ user, onChangeRole, onSoftDelete, onRestore }: UserRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const isDeleted = !!user.deleted_at;

  return (
    <TableRow className={isDeleted ? 'opacity-60' : undefined}>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar name={user.display_name} />
          <div className="font-medium text-zinc-100">{user.display_name}</div>
        </div>
      </TableCell>
      <TableCell className="text-zinc-300">{user.email}</TableCell>
      <TableCell>
        <RoleBadge role={user.admin_role} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-zinc-300">
        {user.games_played_total}
      </TableCell>
      <TableCell className="text-zinc-400">
        {formatDate(user.created_at)}
      </TableCell>
      <TableCell>
        {isDeleted ? (
          <Badge variant="error">{t('Silinib')}</Badge>
        ) : (
          <Badge variant="success">{t('Aktiv')}</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="relative inline-block" ref={menuRef}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {t('Əməliyyat')}
            <span className="ml-1 text-zinc-500">▾</span>
          </Button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-zinc-800 bg-[#1A2029] shadow-lg"
            >
              <MenuButton
                disabled={user.admin_role === 'admin' || isDeleted}
                onClick={() => {
                  onChangeRole('admin');
                  setMenuOpen(false);
                }}
              >
                {t('Admin et')}
              </MenuButton>
              <MenuButton
                disabled={user.admin_role === 'moderator' || isDeleted}
                onClick={() => {
                  onChangeRole('moderator');
                  setMenuOpen(false);
                }}
              >
                {t('Moderator et')}
              </MenuButton>
              <MenuButton
                disabled={user.admin_role === null || isDeleted}
                onClick={() => {
                  onChangeRole(null);
                  setMenuOpen(false);
                }}
              >
                {t('Adi istifadəçi et')}
              </MenuButton>
              <div className="my-1 border-t border-zinc-800" />
              {isDeleted ? (
                <MenuButton
                  onClick={() => {
                    onRestore();
                    setMenuOpen(false);
                  }}
                >
                  {t('Bərpa et')}
                </MenuButton>
              ) : (
                <MenuButton
                  danger
                  onClick={() => {
                    onSoftDelete();
                    setMenuOpen(false);
                  }}
                >
                  {t('Sil (soft)')}
                </MenuButton>
              )}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function MenuButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={[
        'block w-full px-3 py-2 text-left text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed text-zinc-600'
          : danger
            ? 'text-red-400 hover:bg-red-500/10'
            : 'text-zinc-200 hover:bg-zinc-800',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500/15 text-sm font-semibold text-green-400">
      {initials || '?'}
    </div>
  );
}

function RoleBadge({ role }: { role: AdminRole }) {
  if (role === 'admin') return <Badge variant="warning">{t('Admin')}</Badge>;
  if (role === 'moderator')
    return <Badge variant="info">{t('Moderator')}</Badge>;
  return <Badge variant="neutral">{t('İstifadəçi')}</Badge>;
}

function UsersSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
        >
          <div className="h-9 w-9 animate-pulse rounded-full bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-48 animate-pulse rounded bg-zinc-800/70" />
          </div>
          <div className="h-6 w-16 animate-pulse rounded bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
      <div className="text-base font-medium text-zinc-300">
        {hasQuery
          ? t('Nəticə tapılmadı', 'No results')
          : t('İstifadəçi yoxdur', 'No users yet')}
      </div>
      <p className="max-w-sm text-sm text-zinc-500">
        {hasQuery
          ? t('Başqa açar sözlə cəhd edin.')
          : t('İstifadəçilər qeydiyyatdan keçəndə burada görünəcək.')}
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-base font-medium text-red-400">
        {t('Yükləmə xətası', 'Failed to load')}
      </div>
      <p className="max-w-sm text-sm text-zinc-500">
        {t('Şəbəkəyə qoşulu olduğunuzdan əmin olun və yenidən cəhd edin.')}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('Yenidən cəhd et')}
      </Button>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('az-AZ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
