"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  changePasswordAction,
  deleteAccountAction,
  updateProfileAction,
} from "@/lib/actions/account";
import { Card, SectionHeading } from "@/components/ui";
import { Field, FormMessage, SubmitButton } from "@/components/auth-forms";

export function ProfileForms({
  name,
  email,
  timezone,
  latitude,
  longitude,
  hasPassword,
  dataSummary,
}: {
  name: string;
  email: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  hasPassword: boolean;
  dataSummary: { metrics: number; days: number; series: number };
}) {
  const [profileState, profileAction, profilePending] = useActionState(updateProfileAction, {});
  const [passwordState, passwordAction, passwordPending] = useActionState(changePasswordAction, {});

  return (
    <>
      <section>
        <SectionHeading title="Details" description="Your timezone decides which day each event belongs to." />
        <Card>
          <form action={profileAction} className="space-y-4">
            <FormMessage state={profileState} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" name="name" defaultValue={name} autoComplete="name" />
              <Field
                label="Timezone"
                name="timezone"
                defaultValue={timezone}
                placeholder="Europe/Madrid"
                hint="An IANA name, e.g. Europe/Amsterdam."
              />
              <Field
                label="Latitude"
                name="latitude"
                type="number"
                required={false}
                defaultValue={latitude}
                placeholder="40.4168"
                hint="Used to pre-fill the weather adapter."
              />
              <Field
                label="Longitude"
                name="longitude"
                type="number"
                required={false}
                defaultValue={longitude}
                placeholder="-3.7038"
              />
            </div>
            <SubmitButton pending={profilePending}>Save changes</SubmitButton>
          </form>
        </Card>
      </section>

      <section>
        <SectionHeading
          title={hasPassword ? "Change password" : "Set a password"}
          description={
            hasPassword
              ? undefined
              : "Your account was created through Google or GitHub, so it has no password yet. Setting one gives you a second way in."
          }
        />
        <Card>
          <form action={passwordAction} className="max-w-md space-y-4">
            <FormMessage state={passwordState} />
            {hasPassword ? (
              <Field
                label="Current password"
                name="current"
                type="password"
                autoComplete="current-password"
              />
            ) : null}
            <Field
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              hint="At least 10 characters."
            />
            <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
            <SubmitButton pending={passwordPending}>
              {hasPassword ? "Change password" : "Set password"}
            </SubmitButton>
          </form>
        </Card>
      </section>

      <DangerZone email={email} dataSummary={dataSummary} />
    </>
  );
}

function DangerZone({
  email,
  dataSummary,
}: {
  email: string;
  dataSummary: { metrics: number; days: number; series: number };
}) {
  const [state, action, pending] = useActionState(deleteAccountAction, {});
  const [open, setOpen] = useState(false);

  return (
    <section>
      <SectionHeading title="Delete account" />
      <Card className="border-danger/30">
        <p className="text-sm text-muted">
          This removes your account and everything attached to it — {dataSummary.metrics} metrics
          across {dataSummary.days} days, every imported file, every connected source, and any
          conversions written for your data. It cannot be undone, and there is no export yet.
        </p>

        {open ? (
          <form action={action} className="mt-5 max-w-md space-y-4">
            <FormMessage state={state} />
            <Field
              label={`Type ${email} to confirm`}
              name="confirm"
              placeholder={email}
              autoComplete="off"
            />
            <div className="flex gap-2">
              <SubmitButton pending={pending} variant="danger">
                <Trash2 className="size-4" aria-hidden />
                Delete my account permanently
              </SubmitButton>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-surface-2"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="mt-4 flex items-center gap-2 rounded-lg border border-danger/40 px-4 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
          >
            <Trash2 className="size-4" aria-hidden />
            Delete account
          </button>
        )}
      </Card>
    </section>
  );
}
