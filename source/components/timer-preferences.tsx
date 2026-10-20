"use client";
import { useState } from "react";
import { Field, Submit } from "./fields";

export function TimerPreferences({
  limit,
  busy,
  save,
}: {
  limit: number | null;
  busy: boolean;
  save: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <PreferencesForm
      key={String(limit)}
      limit={limit}
      busy={busy}
      save={save}
    />
  );
}

function PreferencesForm({
  limit,
  busy,
  save,
}: Parameters<typeof TimerPreferences>[0]) {
  const [unlimited, setUnlimited] = useState(limit === null);
  return (
    <section className="settings">
      <h2>Parallel timers</h2>
      <p>
        Each timer counts its full duration. Lowering the limit keeps existing
        timers running.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void save({
            action: "timer_preferences",
            timerLimit: unlimited ? null : Number(values.get("limit")),
          });
        }}
      >
        <Field label="Maximum simultaneous timers">
          <input
            name="limit"
            type="number"
            min={1}
            max={2147483647}
            step={1}
            required={!unlimited}
            disabled={unlimited}
            defaultValue={limit ?? 2}
          />
        </Field>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(event) => setUnlimited(event.target.checked)}
          />{" "}
          No limit
        </label>
        <Submit busy={busy}>Save timer preferences</Submit>
      </form>
    </section>
  );
}
