export type Client = { id: string; name: string };
export type Project = {
  id: string;
  client_id: string;
  name: string;
  currency: string;
  rate: number;
};
export type Task = { id: string; project_id: string; name: string };
export type Entry = {
  id: string;
  task_id: string;
  start: number;
  end: number | null;
  rate: number;
  currency: string;
  billable: number;
  notes: string;
  version: number;
};
export type Audit = {
  id: string;
  entry_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  at: number;
};
export type Snapshot = {
  user: { email: string; timezone: string };
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  entries: Entry[];
  audit: Audit[];
  now: number;
};
