import type { Connection, Source } from "./integration-types";
export type GitHubConnection = Omit<Connection, "provider"> & {
  provider: "github";
};
export type Repository = { id: string; name: string; installation: string };
export type PullMetadata = {
  id: string;
  number: number;
  url: string;
  title: string;
  author: string;
  branch: string;
  base: string;
  state: "open" | "closed" | "merged";
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  mergedAt: number | null;
};
export type PullRequest = {
  id: string;
  source_id: string;
  metadata: PullMetadata;
  available: boolean;
};
export type EvidenceLink = {
  pr_id: string;
  task_id: string;
  status: "suggested" | "confirmed" | "rejected";
  reason: string;
};
export type EvidenceEvent = { pr_id: string; kind: string; at: number };
export type EvidenceAudit = {
  pr_id: string;
  task_id: string;
  before_status: string | null;
  after_status: string;
  at: number;
};
export type GitHubSnapshot = {
  connections: GitHubConnection[];
  sources: Source[];
  pulls: PullRequest[];
  links: EvidenceLink[];
  events: EvidenceEvent[];
  audit: EvidenceAudit[];
};
export type TaskReference = {
  task_id: string;
  external_id: string;
  url: string;
  provider: string;
};
