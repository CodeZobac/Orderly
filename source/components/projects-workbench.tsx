"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Snapshot } from "@/lib/types";
import { Field, Submit } from "./fields";

type Input = Record<string, unknown>;

function CreationAccordion({
  title,
  initialOpen = false,
  children,
}: {
  title: string;
  initialOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details
      className="creation-accordion"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <h3>{title}</h3>
        <span className="disclosure-mark" aria-hidden="true" />
      </summary>
      <div className="accordion-content">{children}</div>
    </details>
  );
}

export function ProjectsWorkbench({
  data,
  busy,
  blocked,
  save,
}: {
  data: Snapshot;
  busy: boolean;
  blocked: boolean;
  save: (input: Input) => Promise<boolean>;
}) {
  const running = data.entries.filter((entry) => entry.end === null);
  const limit = data.user.timer_limit === undefined ? 2 : data.user.timer_limit;
  const atCapacity = limit !== null && running.length >= limit;
  async function create(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const element = event.currentTarget;
    const values = Object.fromEntries(new FormData(element));
    if (await save({ ...values, action })) element.reset();
  }

  return (
    <div className="projects-workbench">
      <section
        className="project-catalogue"
        aria-labelledby="project-catalogue-title"
      >
        <div className="section-head">
          <h2 id="project-catalogue-title">Your projects</h2>
          <span className="muted">
            {data.projects.length}{" "}
            {data.projects.length === 1 ? "project" : "projects"}
          </span>
        </div>
        {!data.projects.length && (
          <div className="projects-empty">
            <h3>A home for your next task</h3>
            <p>
              Create a client and project, or import a board from{" "}
              <Link href="/settings/connections">Connections</Link>.
            </p>
          </div>
        )}
        <div className="project-ledger">
          {data.projects.map((project) => {
            const tasks = data.tasks.filter(
              (task) => task.project_id === project.id,
            );
            const client = data.clients.find(
              (item) => item.id === project.client_id,
            );
            return (
              <article
                className="project-record"
                key={project.id}
                id={`project-${project.id}`}
              >
                <header className="project-record-header">
                  <div>
                    <h3>{project.name}</h3>
                    <p>
                      {client?.name || "Client"} · {tasks.length}{" "}
                      {tasks.length === 1 ? "task" : "tasks"}
                    </p>
                  </div>
                  <span className="project-rate mono">
                    {project.currency} {(project.rate / 100).toFixed(2)}
                    <small>/ hour</small>
                  </span>
                </header>
                <details className="project-disclosure">
                  <summary>
                    <span>
                      Tasks <span className="muted">({tasks.length})</span>
                    </span>
                    <span className="disclosure-mark" aria-hidden="true" />
                  </summary>
                  <div className="project-task-list">
                    {!tasks.length && (
                      <p className="muted">
                        No tasks yet. Add one using Create a task. If you just
                        imported a board, synchronization may still be queued.
                      </p>
                    )}
                    {tasks.map((task) => {
                      const active = running.find(
                        (entry) => entry.task_id === task.id,
                      );
                      return (
                        <div className="project-task-row" key={task.id}>
                          <div className="project-task-context">
                            <Link href={`/tasks/${task.id}`}>{task.name}</Link>
                            {task.external?.map((external, index) => (
                              <div className="project-task-source" key={index}>
                                <span>
                                  {external.status}
                                  {external.assignee
                                    ? ` · ${external.assignee}`
                                    : ""}
                                  {!external.available ? " · unavailable" : ""}
                                </span>
                                {/^https:\/\//.test(external.url) && (
                                  <a
                                    href={external.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open in{" "}
                                    {external.provider === "notion"
                                      ? "Notion"
                                      : "Asana"}
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                          <button
                            disabled={
                              busy ||
                              blocked ||
                              (!active &&
                                (atCapacity ||
                                  task.external?.some(
                                    (external) =>
                                      external.ambiguous && !external.explicit,
                                  )))
                            }
                            onClick={() =>
                              void save(
                                active
                                  ? { action: "stop", entryId: active.id }
                                  : { action: "start", taskId: task.id },
                              )
                            }
                          >
                            {active ? "Stop timer" : "Start timer"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </details>
                <details className="project-disclosure">
                  <summary>
                    <span>Edit hourly rate</span>
                    <span className="disclosure-mark" aria-hidden="true" />
                  </summary>
                  <form
                    className="project-rate-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const values = Object.fromEntries(
                        new FormData(event.currentTarget),
                      );
                      void save({
                        ...values,
                        action: "rate",
                        projectId: project.id,
                      });
                    }}
                  >
                    <Field label={`Hourly rate (${project.currency})`}>
                      <input
                        name="rate"
                        inputMode="decimal"
                        pattern="[0-9]{1,7}(\.[0-9]{1,2})?"
                        required
                        defaultValue={(project.rate / 100).toFixed(2)}
                      />
                    </Field>
                    <Submit busy={busy} disabled={blocked}>
                      Update rate
                    </Submit>
                    <small>Recorded entries keep their saved rate.</small>
                  </form>
                </details>
              </article>
            );
          })}
        </div>
      </section>
      <aside
        className="project-creation"
        aria-labelledby="project-creation-title"
      >
        <h2 id="project-creation-title">Add to your workspace</h2>
        <p className="muted">Create what you need, when you need it.</p>
        <CreationAccordion
          title="Create a client"
          initialOpen={!data.projects.length}
        >
          <form onSubmit={(event) => void create(event, "client")}>
            <Field label="Client name">
              <input name="name" required maxLength={200} />
            </Field>
            <Submit busy={busy} disabled={blocked}>
              Add client
            </Submit>
          </form>
        </CreationAccordion>
        <CreationAccordion title="Create a project">
          <form onSubmit={(event) => void create(event, "project")}>
            <Field label="Client">
              <select name="clientId" required defaultValue="">
                <option value="" disabled>
                  Choose a client
                </option>
                {data.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project name">
              <input name="name" required maxLength={200} />
            </Field>
            <div className="project-money-fields">
              <Field label="Currency">
                <input
                  name="currency"
                  defaultValue="EUR"
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  required
                />
              </Field>
              <Field label="Hourly rate">
                <input
                  name="rate"
                  defaultValue="0.00"
                  inputMode="decimal"
                  pattern="[0-9]{1,7}(\.[0-9]{1,2})?"
                  required
                />
              </Field>
            </div>
            {!data.clients.length && (
              <p className="muted">
                Create a client first to give this project a home.
              </p>
            )}
            <Submit busy={busy} disabled={blocked || !data.clients.length}>
              Add project
            </Submit>
          </form>
        </CreationAccordion>
        <CreationAccordion title="Create a task">
          <form onSubmit={(event) => void create(event, "task")}>
            <Field label="Project">
              <select name="projectId" required defaultValue="">
                <option value="" disabled>
                  Choose a project
                </option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Task name">
              <input name="name" required maxLength={200} />
            </Field>
            {!data.projects.length && (
              <p className="muted">
                Create or import a project before adding tasks.
              </p>
            )}
            <Submit busy={busy} disabled={blocked || !data.projects.length}>
              Add task
            </Submit>
          </form>
        </CreationAccordion>
      </aside>
    </div>
  );
}
