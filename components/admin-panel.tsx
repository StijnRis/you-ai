"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ShieldCheck, Trash2, UserX } from "lucide-react";
import {
  deleteAccountAsAdminAction,
  setDisabledAction,
  setRoleAction,
  updateSettingsAction,
} from "@/lib/actions/admin";
import type { AdminAccount } from "@/lib/actions/admin";
import { SETTINGS, type SettingKey, type Settings } from "@/lib/settings-def";
import { Badge, Card } from "@/components/ui";
import { Field, FormMessage, SubmitButton } from "@/components/auth-forms";
import { cn } from "@/lib/utils";

export function AccountsTable({
  accounts,
  currentAdminId,
}: {
  accounts: AdminAccount[];
  currentAdminId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {accounts.map((account) => {
        const isSelf = account.id === currentAdminId;
        const open = expanded === account.id;

        return (
          <Card key={account.id} className="p-0">
            <button
              onClick={() => setExpanded(open ? null : account.id)}
              aria-expanded={open}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{account.name ?? "—"}</span>
                  {account.role === "admin" ? <Badge tone="accent">admin</Badge> : null}
                  {isSelf ? <Badge tone="neutral">you</Badge> : null}
                  {account.disabledAt ? <Badge tone="danger">disabled</Badge> : null}
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted">{account.email}</span>
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                {account.hasPassword ? <Badge tone="neutral">password</Badge> : null}
                {account.providers.map((provider) => (
                  <Badge key={provider} tone="neutral">
                    {provider}
                  </Badge>
                ))}
              </span>

              <span className="tnum text-xs text-muted">
                {account.eventCount.toLocaleString()} events
              </span>

              <ChevronDown
                className={cn("size-4 shrink-0 text-subtle transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>

            {open ? <AccountActions account={account} isSelf={isSelf} /> : null}
          </Card>
        );
      })}
    </div>
  );
}

function AccountActions({ account, isSelf }: { account: AdminAccount; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(setRoleAction, {});
  const [disableState, disableAction, disablePending] = useActionState(setDisabledAction, {});
  const [deleteState, deleteAction, deletePending] = useActionState(deleteAccountAsAdminAction, {});
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-4 border-t border-border px-5 py-5">
      <dl className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
        <Detail label="Timezone" value={account.timezone} />
        <Detail label="Joined" value={account.createdAt.toLocaleDateString()} />
        <Detail
          label="Last seen"
          value={account.lastSeenAt ? account.lastSeenAt.toLocaleString() : "never"}
        />
        <Detail
          label="Owns"
          value={`${account.sourceCount} sources · ${account.importCount} imports`}
        />
      </dl>

      <div className="flex flex-wrap gap-2">
        <form action={roleAction}>
          <input type="hidden" name="userId" value={account.id} />
          <input type="hidden" name="role" value={account.role === "admin" ? "user" : "admin"} />
          <SubmitButton pending={rolePending} variant="ghost">
            <ShieldCheck className="size-4" aria-hidden />
            {account.role === "admin" ? "Revoke admin" : "Make admin"}
          </SubmitButton>
        </form>

        {!isSelf ? (
          <form action={disableAction}>
            <input type="hidden" name="userId" value={account.id} />
            <input type="hidden" name="disabled" value={account.disabledAt ? "0" : "1"} />
            <SubmitButton pending={disablePending} variant="ghost">
              <UserX className="size-4" aria-hidden />
              {account.disabledAt ? "Re-enable sign-in" : "Disable sign-in"}
            </SubmitButton>
          </form>
        ) : null}

        {!isSelf && !confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 rounded-lg border border-danger/40 px-4 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
          >
            <Trash2 className="size-4" aria-hidden />
            Delete account
          </button>
        ) : null}
      </div>

      <FormMessage state={roleState} />
      <FormMessage state={disableState} />

      {confirming ? (
        <form action={deleteAction} className="max-w-md space-y-3 rounded-lg border border-danger/30 p-4">
          <p className="text-sm text-muted">
            This deletes {account.eventCount.toLocaleString()} events, {account.importCount} imports
            and {account.sourceCount} sources along with the account. It cannot be undone.
          </p>
          <FormMessage state={deleteState} />
          <input type="hidden" name="userId" value={account.id} />
          <Field
            label={`Type ${account.email} to confirm`}
            name="confirm"
            placeholder={account.email ?? ""}
            autoComplete="off"
          />
          <div className="flex gap-2">
            <SubmitButton pending={deletePending} variant="danger">
              Delete permanently
            </SubmitButton>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState(updateSettingsAction, {});
  const keys = Object.keys(SETTINGS) as SettingKey[];

  return (
    <Card>
      <form action={action} className="space-y-6">
        <FormMessage state={state} />

        <div className="space-y-5">
          {keys.map((key) => {
            const definition = SETTINGS[key];
            const value = settings[key];

            if (typeof definition.default === "boolean") {
              return (
                <label key={key} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name={key}
                    defaultChecked={value as boolean}
                    className="mt-0.5 size-4 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{definition.label}</span>
                    <span className="block text-xs text-muted">{definition.help}</span>
                  </span>
                </label>
              );
            }

            return (
              <label key={key} className="block max-w-md">
                <span className="text-sm font-medium">{definition.label}</span>
                <input
                  name={key}
                  type={typeof definition.default === "number" ? "number" : "text"}
                  step={key === "correlationAlpha" ? "0.001" : undefined}
                  defaultValue={String(value)}
                  className="mt-1.5 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-border-strong"
                />
                <span className="mt-1 block text-xs text-muted">{definition.help}</span>
              </label>
            );
          })}
        </div>

        <SubmitButton pending={pending}>Save settings</SubmitButton>
      </form>
    </Card>
  );
}
