"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, LifeBuoy, Loader2, RefreshCw, Save, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import {
  useAddTicketMessage,
  useSupportTicket,
  useSupportTickets,
  useUpdateSupportTicket,
  type SupportTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/admin-moderation";

const STATUS_OPTIONS: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const PRIORITY_OPTIONS: TicketPriority[] = ["low", "normal", "high", "urgent"];
const CATEGORY_OPTIONS: TicketCategory[] = [
  "general",
  "booking",
  "payment",
  "venue",
  "account",
  "bug",
  "owner",
];

// English source labels for category enum values; the i18n layer maps them to
// RU (and falls back to the English label for EN/AZ).
const CATEGORY_LABEL: Record<TicketCategory, string> = {
  general: "General",
  booking: "Booking",
  payment: "Payment",
  venue: "Venue",
  account: "Account",
  bug: "Bug",
  owner: "Owner",
};

const PAGE_SIZE = 25;

const selectCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none";

function statusVariant(status: TicketStatus): "success" | "warning" | "info" | "neutral" {
  if (status === "open") return "warning";
  if (status === "pending") return "info";
  if (status === "resolved") return "success";
  return "neutral";
}

function priorityVariant(priority: TicketPriority): "danger" | "warning" | "info" | "neutral" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  if (priority === "normal") return "info";
  return "neutral";
}

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category as TicketCategory] ?? category;
}

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function SupportPage(): React.JSX.Element {
  const { t } = useI18n();
  const [searchInput, setSearchInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<TicketStatus | undefined>(undefined);
  const [priority, setPriority] = React.useState<TicketPriority | undefined>(undefined);
  const [category, setCategory] = React.useState<TicketCategory | undefined>(undefined);
  const [offset, setOffset] = React.useState(0);
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Debounce the free-text search into the applied filter (250ms) so we don't
  // fire a request on every keystroke.
  React.useEffect(() => {
    const id = setTimeout(() => setQ(searchInput.trim()), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Any filter change resets to the first page.
  React.useEffect(() => {
    setOffset(0);
  }, [status, priority, category, q]);

  const { data, isLoading, isError, isFetching, refetch } = useSupportTickets({
    status,
    priority,
    category,
    q: q || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const tickets = data?.items ?? [];
  const summary = data?.summary;
  const total = data?.pagination.total ?? 0;

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">{t("İdarəetmə")}</p>
          <h1 className="mt-2 flex items-center gap-2 font-display text-[1.6rem] font-bold text-foreground">
            <LifeBuoy className="h-6 w-6 text-accent" />
            {t("Support")}
          </h1>
          <p className="mt-1 text-sm text-foregroundMuted">{t("User support tickets and conversations.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary && (
            <>
              <Badge variant="warning">{t("Open")}: {summary.open}</Badge>
              <Badge variant="info">{t("Pending")}: {summary.pending}</Badge>
              <Badge variant="danger">{t("Urgent")}: {summary.urgent}</Badge>
            </>
          )}
          <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("Refresh")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("Search")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-9 max-w-xs"
        />
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={status ?? ""}
          onChange={(e) => setStatus((e.target.value || undefined) as TicketStatus | undefined)}
        >
          <option value="">{t("All statuses")}</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={priority ?? ""}
          onChange={(e) => setPriority((e.target.value || undefined) as TicketPriority | undefined)}
        >
          <option value="">{t("All priorities")}</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{t(p)}</option>)}
        </select>
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={category ?? ""}
          onChange={(e) => setCategory((e.target.value || undefined) as TicketCategory | undefined)}
        >
          <option value="">{t("All categories")}</option>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Subject")}</TableHead>
              <TableHead>{t("User")}</TableHead>
              <TableHead>{t("Category")}</TableHead>
              <TableHead>{t("Priority")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead>{t("Updated")}</TableHead>
              <TableHead className="text-right">{t("Əməliyyat")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</TableCell></TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <p className="text-sm text-danger">{t("Yenidən yoxlayın")}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    {t("Retry")}
                  </Button>
                </TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-foregroundMuted">{t("No tickets")}</TableCell></TableRow>
            ) : (
              tickets.map((ticket) => (
                <TableRow key={ticket.id}>
                  <TableCell className="max-w-[260px]">
                    <p className="truncate font-semibold text-foreground">{ticket.subject}</p>
                    <p className="truncate text-xs text-foregroundMuted">{ticket.message}</p>
                  </TableCell>
                  <TableCell className="text-foregroundMuted">{ticket.user?.display_name ?? ticket.user?.email ?? "—"}</TableCell>
                  <TableCell className="text-foregroundMuted">{t(categoryLabel(ticket.category))}</TableCell>
                  <TableCell><Badge variant={priorityVariant(ticket.priority)}>{t(ticket.priority)}</Badge></TableCell>
                  <TableCell><Badge variant={statusVariant(ticket.status)}>{t(ticket.status)}</Badge></TableCell>
                  <TableCell className="text-foregroundMuted">{dt(ticket.updated_at ?? ticket.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="secondary" size="sm" onClick={() => setOpenId(ticket.id)}>{t("Open")}</Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {!isError && total > PAGE_SIZE ? (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3 sm:flex-row">
            <p className="text-sm text-foregroundMuted">
              {t("Səhifə")} <span className="font-semibold text-foreground">{page}</span> / {pageCount}
              <span className="ml-2 text-xs">({total})</span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canPrev || isFetching}
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              >
                <ChevronLeft className="h-4 w-4" />
                {t("Əvvəlki")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canNext || isFetching}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
              >
                {t("Növbəti")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {openId && <TicketDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: ticket, isLoading, isError, refetch } = useSupportTicket(id);
  const update = useUpdateSupportTicket();
  const addMessage = useAddTicketMessage();
  const [reply, setReply] = React.useState("");
  const [note, setNote] = React.useState("");

  // Keep the editable resolution note in sync with the loaded ticket. Re-syncs
  // on ticket id change and whenever the server-side note value changes (e.g.
  // after a successful save), but leaves the field untouched while typing.
  const serverNote = ticket?.resolution_note ?? "";
  React.useEffect(() => {
    setNote(serverNote);
  }, [id, serverNote]);

  function patch(data: Partial<Pick<SupportTicket, "status" | "priority">>) {
    update.mutate(
      { id, data },
      {
        onSuccess: () => toast.success(t("Ticket updated")),
        onError: (err) => toast.error(t("Alınmadı"), err.message),
      },
    );
  }

  function saveNote() {
    update.mutate(
      { id, data: { resolution_note: note.trim() === "" ? null : note.trim() } },
      {
        onSuccess: () => toast.success(t("Note saved")),
        onError: (err) => toast.error(t("Alınmadı"), err.message),
      },
    );
  }

  function send() {
    const body = reply.trim();
    if (body.length === 0) return;
    addMessage.mutate(
      { id, body },
      {
        onSuccess: () => {
          setReply("");
          toast.success(t("Reply sent"));
        },
        onError: (err) => toast.error(t("Alınmadı"), err.message),
      },
    );
  }

  const noteDirty = note.trim() !== serverNote.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ticket?.subject ?? t("Ticket")}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</div>
        ) : isError || !ticket ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-danger">{t("Yenidən yoxlayın")}</p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4" />
              {t("Retry")}
            </Button>
          </div>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="neutral">{t(categoryLabel(ticket.category))}</Badge>
              <span className="text-foregroundMuted">
                {t("Assigned to")}: {ticket.assigned_to?.display_name ?? ticket.assigned_to?.email ?? t("Unassigned")}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Status")}</span>
                <select
                  className={selectCls}
                  value={ticket.status}
                  onChange={(e) => patch({ status: e.target.value as TicketStatus })}
                  disabled={update.isPending}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(s)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-foreground">{t("Priority")}</span>
                <select
                  className={selectCls}
                  value={ticket.priority}
                  onChange={(e) => patch({ priority: e.target.value as TicketPriority })}
                  disabled={update.isPending}
                >
                  {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{t(p)}</option>)}
                </select>
              </label>
            </div>

            <div className="rounded-xl border border-border bg-surfaceElevated/40 p-3 text-sm">
              <p className="text-xs font-semibold text-foregroundMuted">
                {ticket.user?.display_name ?? ticket.user?.email ?? t("User")} · {dt(ticket.created_at)}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-foreground">{ticket.message}</p>
            </div>

            <div className="space-y-2.5">
              {ticket.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl border p-3 text-sm ${m.author_role === "staff" ? "border-accent/30 bg-accent/5" : "border-border bg-surface"}`}
                >
                  <p className="text-xs font-semibold text-foregroundMuted">
                    {m.author?.display_name ?? t(m.author_role)} · {dt(m.created_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-foreground">{m.body}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <label className="block text-sm font-semibold text-foreground">{t("Resolution note")}</label>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("Add a note about the resolution…")}
                disabled={update.isPending}
              />
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={saveNote}
                  disabled={update.isPending || !noteDirty}
                >
                  {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t("Save note")}
                </Button>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <Textarea
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t("Write a reply…")}
                disabled={addMessage.isPending}
              />
              <div className="flex justify-end">
                <Button onClick={send} disabled={addMessage.isPending || reply.trim().length === 0}>
                  {addMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("Send reply")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
