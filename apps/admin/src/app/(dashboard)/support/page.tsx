"use client";

import * as React from "react";
import { LifeBuoy, Loader2, Send } from "lucide-react";

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
  type TicketPriority,
  type TicketStatus,
} from "@/lib/admin-moderation";

const STATUS_OPTIONS: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const PRIORITY_OPTIONS: TicketPriority[] = ["low", "normal", "high", "urgent"];

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

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("az-AZ", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function SupportPage(): React.JSX.Element {
  const { t } = useI18n();
  const [filters, setFilters] = React.useState<{ status?: TicketStatus; priority?: TicketPriority; q: string }>({ q: "" });
  const [openId, setOpenId] = React.useState<string | null>(null);

  const { data, isLoading } = useSupportTickets({
    status: filters.status,
    priority: filters.priority,
    q: filters.q || undefined,
  });
  const tickets = data?.items ?? [];
  const summary = data?.summary;

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
        {summary && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="warning">{t("Open")}: {summary.open}</Badge>
            <Badge variant="info">{t("Pending")}: {summary.pending}</Badge>
            <Badge variant="danger">{t("Urgent")}: {summary.urgent}</Badge>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("Search")}
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          className="h-9 max-w-xs"
        />
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={filters.status ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || undefined) as TicketStatus | undefined }))}
        >
          <option value="">{t("All statuses")}</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <select
          className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground"
          value={filters.priority ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, priority: (e.target.value || undefined) as TicketPriority | undefined }))}
        >
          <option value="">{t("All priorities")}</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{t(p)}</option>)}
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
                  <TableCell className="capitalize text-foregroundMuted">{ticket.category}</TableCell>
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
      </div>

      {openId && <TicketDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const toast = useToast();
  const { data: ticket, isLoading } = useSupportTicket(id);
  const update = useUpdateSupportTicket();
  const addMessage = useAddTicketMessage();
  const [reply, setReply] = React.useState("");

  function patch(data: Partial<Pick<SupportTicket, "status" | "priority">>) {
    update.mutate(
      { id, data },
      {
        onSuccess: () => toast.success(t("Ticket updated")),
        onError: () => toast.error(t("Alınmadı")),
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
        onError: () => toast.error(t("Alınmadı")),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ticket?.subject ?? t("Ticket")}</DialogTitle>
        </DialogHeader>
        {isLoading || !ticket ? (
          <div className="py-10 text-center text-foregroundMuted">{t("Yüklənir")}…</div>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
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
              <Textarea
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t("Write a reply…")}
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
