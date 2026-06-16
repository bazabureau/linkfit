'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Eye,
  MailCheck,
  MailQuestion,
  Medal,
  MoreHorizontal,
  RotateCcw,
  Shield,
  Trash2,
  UserRound,
  XCircle,
} from 'lucide-react';
import {
  useAdminUser,
  useAdminUsers,
  useRestoreUser,
  useSoftDeleteUser,
  useSuspendUser,
  useUnsuspendUser,
  useUpdateUserRole,
  useUpdateUserVerification,
  useUpdateUserVip,
  type AdminRole,
  type AdminUsersParams,
  type User,
  type UserDetail,
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
import { formatDate, formatDateTime } from '@/lib/date-format';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';

const PAGE_SIZE = 20;

type RoleFilter = NonNullable<AdminUsersParams['role']>;
type StatusFilter = NonNullable<AdminUsersParams['status']>;
type VerificationFilter = NonNullable<AdminUsersParams['verification']>;
type VipFilter = NonNullable<AdminUsersParams['vip']>;
type MutableAdminRole = Exclude<AdminRole, 'partner'>;

const ROLE_FILTERS: Array<{ value: RoleFilter; label: string }> = [
  { value: 'all', label: 'Hamısı' },
  { value: 'user', label: 'İstifadəçi' },
  { value: 'partner', label: 'Owner' },
  { value: 'staff', label: 'Admin staff' },
  { value: 'admin', label: 'Admin' },
  { value: 'moderator', label: 'Moderator' },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Bütün statuslar' },
  { value: 'active', label: 'Aktiv' },
  { value: 'suspended', label: 'Bloklanıb' },
  { value: 'deleted', label: 'Silinib' },
];

const VERIFICATION_FILTERS: Array<{ value: VerificationFilter; label: string }> =
  [
    { value: 'all', label: 'Email: hamısı' },
    { value: 'verified', label: 'Təsdiqli' },
    { value: 'unverified', label: 'Təsdiqsiz' },
  ];

const VIP_FILTERS: Array<{ value: VipFilter; label: string }> = [
  { value: 'all', label: 'VIP: hamısı' },
  { value: 'vip', label: 'VIP' },
  { value: 'standard', label: 'Standart' },
];

export function UsersTable() {
  const toast = useToast();
  const { t } = useI18n();
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [role, setRole] = useState<RoleFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [verification, setVerification] =
    useState<VerificationFilter>('all');
  const [vip, setVip] = useState<VipFilter>('all');
  const [confirmDeleteFor, setConfirmDeleteFor] = useState<User | null>(null);
  const [suspendFor, setSuspendFor] = useState<User | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [vipFor, setVipFor] = useState<User | null>(null);
  const [vipLabel, setVipLabel] = useState('VIP');
  const [vipExpiresAt, setVipExpiresAt] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setQ(searchInput.trim());
      setOffset(0);
    }, 250);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchInput]);

  const params = useMemo(
    () => ({
      q: q || undefined,
      role,
      status,
      verification,
      vip,
      limit: PAGE_SIZE,
      offset,
    }),
    [q, role, status, verification, vip, offset],
  );

  const { data, isLoading, isError, refetch, isFetching } =
    useAdminUsers(params);

  const updateRole = useUpdateUserRole({
    onSuccess: () => toast.success(t('Rol yeniləndi')),
    onError: () => toast.error(t('Rol yenilənmədi')),
  });
  const updateVerification = useUpdateUserVerification({
    onSuccess: () => toast.success(t('Email statusu yeniləndi')),
    onError: () => toast.error(t('Email statusu yenilənmədi')),
  });
  const updateVip = useUpdateUserVip({
    onSuccess: () => toast.success(t('VIP badge yeniləndi')),
    onError: () => toast.error(t('VIP badge yenilənmədi')),
  });
  const suspend = useSuspendUser({
    onSuccess: () => toast.success(t('İstifadəçi bloklandı')),
    onError: () => toast.error(t('Bloklama alınmadı')),
  });
  const unsuspend = useUnsuspendUser({
    onSuccess: () => toast.success(t('Blok aradan qaldırıldı')),
    onError: () => toast.error(t('Blok aradan qaldırılmadı')),
  });
  const softDelete = useSoftDeleteUser({
    onSuccess: () => toast.success(t('İstifadəçi silindi')),
    onError: () => toast.error(t('İstifadəçi silinmədi')),
  });
  const restore = useRestoreUser({
    onSuccess: () => toast.success(t('İstifadəçi bərpa edildi')),
    onError: () => toast.error(t('Bərpa alınmadı')),
  });

  const total = data?.count ?? 0;
  const results = data?.results ?? [];
  const summary = data?.summary;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    q !== '' ||
    role !== 'all' ||
    status !== 'all' ||
    verification !== 'all' ||
    vip !== 'all';

  function resetFilters() {
    setSearchInput('');
    setQ('');
    setRole('all');
    setStatus('all');
    setVerification('all');
    setVip('all');
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      <SummaryStrip summary={summary} />

      <Card className="overflow-hidden rounded-xl border-border bg-surface p-0">
        <div className="border-b border-border p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full max-w-xl">
              <Input
                type="search"
                placeholder={t('Ad və ya e-poçt ilə axtar')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label={t('İstifadəçi axtarışı')}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-foregroundMuted">
              {isFetching && !isLoading ? <span>{t('Yenilənir')}</span> : null}
              {hasFilters ? (
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('Sıfırla')}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-4">
            <FilterGroup
              label={t('Rol')}
              options={ROLE_FILTERS}
              value={role}
              onChange={(value) => {
                setRole(value);
                setOffset(0);
              }}
            />
            <FilterGroup
              label={t('Status')}
              options={STATUS_FILTERS}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setOffset(0);
              }}
            />
            <FilterGroup
              label={t('Email')}
              options={VERIFICATION_FILTERS}
              value={verification}
              onChange={(value) => {
                setVerification(value);
                setOffset(0);
              }}
            />
            <FilterGroup
              label={t('Badge')}
              options={VIP_FILTERS}
              value={vip}
              onChange={(value) => {
                setVip(value);
                setOffset(0);
              }}
            />
          </div>
        </div>

        {isLoading ? (
          <UsersSkeleton />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : results.length === 0 ? (
          <EmptyState hasQuery={hasFilters} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('İstifadəçi')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead>{t('Email')}</TableHead>
                  <TableHead>{t('Rol')}</TableHead>
                  <TableHead>{t('Aktivlik')}</TableHead>
                  <TableHead className="text-right">{t('Oyun')}</TableHead>
                  <TableHead className="text-right">{t('Əməliyyat')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onOpenDetail={() => setSelectedUserId(user.id)}
                    onChangeRole={(nextRole) =>
                      updateRole.mutate({ id: user.id, role: nextRole })
                    }
                    onToggleVerification={() =>
                      updateVerification.mutate({
                        id: user.id,
                        verified: !user.email_is_verified,
                      })
                    }
                    onOpenVip={() => {
                      setVipFor(user);
                      setVipLabel(user.vip_badge_label || 'VIP');
                      setVipExpiresAt(toDateInputValue(user.vip_expires_at));
                    }}
                    onDisableVip={() =>
                      updateVip.mutate({ id: user.id, is_vip: false })
                    }
                    onOpenSuspend={() => {
                      setSuspendFor(user);
                      setSuspendReason(user.suspension_reason || '');
                    }}
                    onUnsuspend={() => unsuspend.mutate({ id: user.id })}
                    onSoftDelete={() => setConfirmDeleteFor(user)}
                    onRestore={() => restore.mutate({ id: user.id })}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && !isError && results.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border p-3 text-sm text-foregroundMuted sm:flex-row sm:items-center sm:justify-between">
            <div>
              {t('Göstərilir')}{' '}
              <span className="text-foreground">{offset + 1}</span>-
              <span className="text-foreground">
                {Math.min(offset + PAGE_SIZE, total)}
              </span>{' '}
              / <span className="text-foreground">{total}</span>
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
              <span className="min-w-14 text-center text-xs">
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
        ) : null}
      </Card>

      <DeleteDialog
        user={confirmDeleteFor}
        onOpenChange={(open) => !open && setConfirmDeleteFor(null)}
        onConfirm={() => {
          if (!confirmDeleteFor) return;
          softDelete.mutate({ id: confirmDeleteFor.id });
          setConfirmDeleteFor(null);
        }}
      />

      <SuspendDialog
        user={suspendFor}
        reason={suspendReason}
        onReasonChange={setSuspendReason}
        onOpenChange={(open) => !open && setSuspendFor(null)}
        onConfirm={() => {
          if (!suspendFor) return;
          const reason = suspendReason.trim();
          if (reason.length < 2) {
            toast.error(t('Blok səbəbi yazılmalıdır'));
            return;
          }
          suspend.mutate({ id: suspendFor.id, reason });
          setSuspendFor(null);
          setSuspendReason('');
        }}
      />

      <VipDialog
        user={vipFor}
        label={vipLabel}
        expiresAt={vipExpiresAt}
        onLabelChange={setVipLabel}
        onExpiresAtChange={setVipExpiresAt}
        onOpenChange={(open) => !open && setVipFor(null)}
        onConfirm={() => {
          if (!vipFor) return;
          updateVip.mutate({
            id: vipFor.id,
            is_vip: true,
            vip_badge_label: vipLabel.trim() || 'VIP',
            vip_expires_at: vipExpiresAt ? new Date(vipExpiresAt).toISOString() : null,
          });
          setVipFor(null);
        }}
      />

      <UserDetailDialog
        userId={selectedUserId}
        onOpenChange={(open) => !open && setSelectedUserId(null)}
      />
    </div>
  );
}

function SummaryStrip({
  summary,
}: {
  summary: NonNullable<ReturnType<typeof useAdminUsers>['data']>['summary'];
}) {
  const { t } = useI18n();
  const items = [
    { label: 'Cəmi', value: summary?.total ?? 0, icon: UserRound },
    { label: 'Aktiv', value: summary?.active ?? 0, icon: CheckCircle2 },
    { label: 'Blok', value: summary?.suspended ?? 0, icon: Ban },
    { label: 'Email təsdiqli', value: summary?.verified ?? 0, icon: MailCheck },
    { label: 'VIP', value: summary?.vip ?? 0, icon: Medal },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-border bg-surface px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-foregroundMuted">
              {t(item.label)}
            </span>
            <item.icon className="h-4 w-4 text-accent" />
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-foregroundMuted">
        {t(label)}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              value === option.value
                ? 'border-accent bg-accent text-black'
                : 'border-border bg-surfaceElevated text-foregroundMuted hover:border-accent/60 hover:text-foreground',
            )}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

interface UserRowProps {
  user: User;
  onOpenDetail: () => void;
  onChangeRole: (role: MutableAdminRole) => void;
  onToggleVerification: () => void;
  onOpenVip: () => void;
  onDisableVip: () => void;
  onOpenSuspend: () => void;
  onUnsuspend: () => void;
  onSoftDelete: () => void;
  onRestore: () => void;
}

function UserRow({
  user,
  onOpenDetail,
  onChangeRole,
  onToggleVerification,
  onOpenVip,
  onDisableVip,
  onOpenSuspend,
  onUnsuspend,
  onSoftDelete,
  onRestore,
}: UserRowProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDeleted = Boolean(user.deleted_at);
  const isSuspended = Boolean(user.suspended_at);

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

  return (
    <TableRow className={isDeleted ? 'opacity-60' : undefined}>
      <TableCell className="min-w-72">
        <div className="flex items-center gap-3">
          <Avatar name={user.display_name} vip={user.is_vip} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onOpenDetail}
                className="truncate text-left font-medium text-foreground hover:text-accent"
              >
                {user.display_name || t('Adsız istifadəçi')}
              </button>
              {user.is_vip ? (
                <Badge variant="warning">{user.vip_badge_label || 'VIP'}</Badge>
              ) : null}
            </div>
            <div className="mt-1 truncate text-xs text-foregroundMuted">
              {user.email}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5">
          {isDeleted ? (
            <Badge variant="error">{t('Silinib')}</Badge>
          ) : isSuspended ? (
            <Badge variant="danger">{t('Bloklanıb')}</Badge>
          ) : (
            <Badge variant="success">{t('Aktiv')}</Badge>
          )}
          {user.last_seen_at ? (
            <span className="text-xs text-foregroundMuted">
              {formatDateTime(user.last_seen_at)}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {user.email_is_verified ? (
          <Badge variant="success">
            <MailCheck className="mr-1 h-3 w-3" />
            {t('Təsdiqli')}
          </Badge>
        ) : (
          <Badge variant="warning">
            <MailQuestion className="mr-1 h-3 w-3" />
            {t('Təsdiqsiz')}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <RoleBadge role={user.admin_role} />
      </TableCell>
      <TableCell className="min-w-32 text-sm text-foregroundMuted">
        <div>{formatDate(user.created_at)}</div>
        {user.vip_expires_at ? (
          <div className="mt-1 text-xs">VIP: {formatDate(user.vip_expires_at)}</div>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums text-foreground">
        {user.games_played_total}
      </TableCell>
      <TableCell className="text-right">
        <div className="relative inline-block" ref={menuRef}>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="İstifadəçi əməliyyatları"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surfaceElevated p-1 shadow-lg"
            >
              <MenuButton
                icon={Eye}
                onClick={() => {
                  onOpenDetail();
                  setMenuOpen(false);
                }}
              >
                {t('Detallara bax')}
              </MenuButton>
              <MenuButton
                icon={user.email_is_verified ? XCircle : MailCheck}
                disabled={isDeleted}
                onClick={() => {
                  onToggleVerification();
                  setMenuOpen(false);
                }}
              >
                {user.email_is_verified ? t('Email təsdiqini sil') : t('Email təsdiqlə')}
              </MenuButton>
              {user.is_vip ? (
                <MenuButton
                  icon={Medal}
                  disabled={isDeleted}
                  onClick={() => {
                    onDisableVip();
                    setMenuOpen(false);
                  }}
                >
                  {t('VIP badge sil')}
                </MenuButton>
              ) : (
                <MenuButton
                  icon={Medal}
                  disabled={isDeleted}
                  onClick={() => {
                    onOpenVip();
                    setMenuOpen(false);
                  }}
                >
                  {t('VIP badge ver')}
                </MenuButton>
              )}
              <div className="my-1 border-t border-border" />
              <MenuButton
                icon={Shield}
                disabled={user.admin_role === 'admin' || isDeleted}
                onClick={() => {
                  onChangeRole('admin');
                  setMenuOpen(false);
                }}
              >
                {t('Admin et')}
              </MenuButton>
              <MenuButton
                icon={Shield}
                disabled={user.admin_role === 'moderator' || isDeleted}
                onClick={() => {
                  onChangeRole('moderator');
                  setMenuOpen(false);
                }}
              >
                {t('Moderator et')}
              </MenuButton>
              <MenuButton
                icon={UserRound}
                disabled={user.admin_role === null || user.admin_role === 'partner' || isDeleted}
                onClick={() => {
                  onChangeRole(null);
                  setMenuOpen(false);
                }}
              >
                {t('Adi istifadəçi et')}
              </MenuButton>
              <div className="my-1 border-t border-border" />
              {isSuspended ? (
                <MenuButton
                  icon={RotateCcw}
                  disabled={isDeleted}
                  onClick={() => {
                    onUnsuspend();
                    setMenuOpen(false);
                  }}
                >
                  {t('Bloku aç')}
                </MenuButton>
              ) : (
                <MenuButton
                  icon={Ban}
                  disabled={isDeleted}
                  danger
                  onClick={() => {
                    onOpenSuspend();
                    setMenuOpen(false);
                  }}
                >
                  {t('Blokla')}
                </MenuButton>
              )}
              {isDeleted ? (
                <MenuButton
                  icon={RotateCcw}
                  onClick={() => {
                    onRestore();
                    setMenuOpen(false);
                  }}
                >
                  {t('Bərpa et')}
                </MenuButton>
              ) : (
                <MenuButton
                  icon={Trash2}
                  danger
                  onClick={() => {
                    onSoftDelete();
                    setMenuOpen(false);
                  }}
                >
                  {t('Sil')}
                </MenuButton>
              )}
            </div>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function MenuButton({
  children,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
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
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed text-foregroundMuted/40'
          : danger
            ? 'text-danger hover:bg-danger/10'
            : 'text-foreground hover:bg-surface',
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function Avatar({ name, vip }: { name: string; vip: boolean }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
        vip
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border bg-surfaceElevated text-foreground',
      )}
    >
      {initials || '?'}
    </div>
  );
}

function RoleBadge({ role }: { role: AdminRole }) {
  const { t } = useI18n();
  if (role === 'admin') return <Badge variant="warning">Admin</Badge>;
  if (role === 'moderator') return <Badge variant="info">Moderator</Badge>;
  if (role === 'partner') return <Badge variant="default">Owner</Badge>;
  return <Badge variant="neutral">{t('İstifadəçi')}</Badge>;
}

function DeleteDialog({
  user,
  onOpenChange,
  onConfirm,
}: {
  user: User | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('İstifadəçini sil?')}</DialogTitle>
          <DialogDescription>
            {user
              ? `${user.display_name} ${t('hesabı soft-delete olunacaq. Sonradan bərpa edilə bilər.')}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('Ləğv et')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('Sil')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuspendDialog({
  user,
  reason,
  onReasonChange,
  onOpenChange,
  onConfirm,
}: {
  user: User | null;
  reason: string;
  onReasonChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('İstifadəçini blokla')}</DialogTitle>
          <DialogDescription>
            {t('Blok səbəbi audit log-da saxlanacaq və admin komandası üçün görünəcək.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="suspend-reason">
            {t('Səbəb')}
          </label>
          <textarea
            id="suspend-reason"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-border bg-surfaceElevated px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foregroundMuted focus:border-accent"
            placeholder={t('Məsələn: qayda pozuntusu, spam, ödəniş problemi...')}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('Ləğv et')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('Blokla')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VipDialog({
  user,
  label,
  expiresAt,
  onLabelChange,
  onExpiresAtChange,
  onOpenChange,
  onConfirm,
}: {
  user: User | null;
  label: string;
  expiresAt: string;
  onLabelChange: (value: string) => void;
  onExpiresAtChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('VIP badge ver')}</DialogTitle>
          <DialogDescription>
            {t('Badge istifadəçi profilində və admin listində görünəcək.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="vip-label">
              {t('Badge adı')}
            </label>
            <Input
              id="vip-label"
              value={label}
              maxLength={40}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="VIP"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="vip-expires">
              {t('Bitmə tarixi')}
            </label>
            <Input
              id="vip-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => onExpiresAtChange(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('Ləğv et')}
          </Button>
          <Button onClick={onConfirm}>{t('Yadda saxla')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserDetailDialog({
  userId,
  onOpenChange,
}: {
  userId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data, isLoading, isError } = useAdminUser(userId);

  return (
    <Dialog open={userId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('İstifadəçi profili')}</DialogTitle>
          <DialogDescription>
            {t('Hesab statusu, activity və admin qərarları üçün qısa icmal.')}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-surfaceElevated" />
        ) : isError || !data ? (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            {t('Məlumat yüklənmədi.')}
          </div>
        ) : (
          <UserDetailPanel user={data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UserDetailPanel({ user }: { user: UserDetail }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surfaceElevated p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={user.display_name} vip={user.is_vip} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">
                {user.display_name}
              </h3>
              <RoleBadge role={user.admin_role} />
              {user.is_vip ? (
                <Badge variant="warning">{user.vip_badge_label || 'VIP'}</Badge>
              ) : null}
            </div>
            <div className="mt-1 text-sm text-foregroundMuted">{user.email}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.email_is_verified ? (
            <Badge variant="success">Email təsdiqli</Badge>
          ) : (
            <Badge variant="warning">Email təsdiqsiz</Badge>
          )}
          {user.suspended_at ? (
            <Badge variant="danger">Bloklanıb</Badge>
          ) : user.deleted_at ? (
            <Badge variant="error">Silinib</Badge>
          ) : (
            <Badge variant="success">Aktiv</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Oynadığı oyun" value={user.games_played_total} />
        <Metric label="Host olduğu oyun" value={user.games_hosted_total} />
        <Metric label="Booking" value={user.bookings_total} />
        <Metric label="Report" value={user.reports_received_count} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <InfoRow label="Qeydiyyat" value={formatDateTime(user.created_at)} />
        <InfoRow label="Son aktivlik" value={formatDateTime(user.last_seen_at)} />
        <InfoRow label="Email təsdiqi" value={formatDateTime(user.email_verified_at)} />
        <InfoRow label="VIP bitmə tarixi" value={formatDate(user.vip_expires_at)} />
      </div>

      {user.suspension_reason ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-danger">
            Blok səbəbi
          </div>
          <p className="mt-2 text-sm text-foreground">{user.suspension_reason}</p>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated p-4">
      <div className="text-xs text-foregroundMuted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surfaceElevated p-3">
      <div className="text-xs text-foregroundMuted">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function UsersSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-border bg-surfaceElevated p-3"
        >
          <div className="h-10 w-10 animate-pulse rounded-full bg-border" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-border" />
            <div className="h-3 w-64 animate-pulse rounded bg-border/70" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
      <div className="text-base font-medium text-foreground">
        {hasQuery ? 'Nəticə tapılmadı' : 'İstifadəçi yoxdur'}
      </div>
      <p className="max-w-sm text-sm text-foregroundMuted">
        {hasQuery
          ? 'Filterləri dəyişərək yenidən yoxlayın.'
          : 'Yeni qeydiyyatlar burada görünəcək.'}
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="text-base font-medium text-danger">Yükləmə xətası</div>
      <p className="max-w-sm text-sm text-foregroundMuted">
        Şəbəkəni və admin sessiyasını yoxlayın, sonra yenidən cəhd edin.
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Yenidən cəhd et
      </Button>
    </div>
  );
}

function toDateInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
