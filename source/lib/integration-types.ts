export type Provider = "asana" | "notion";
export type Property = {
  id: string;
  name: string;
  type: string;
  options?: { id: string; name: string }[];
};
export type SourceOption = {
  id: string;
  name: string;
  properties: Property[];
  archived?: boolean;
};
export type Mapping = {
  title?: string;
  status?: string;
  assignee?: string;
  due?: string;
  sections?: Record<string, string>;
  automation?: boolean;
  doing?: string[];
};
export type ExternalMetadata = {
  id: string;
  name: string;
  url: string;
  status: string;
  assignee: string | null;
  due: string | null;
  archived: boolean;
  ambiguous: boolean;
  section?: string | null;
  status_id?: string;
  assignee_ids?: string[];
  updated_at?: string;
};
export type Connection = {
  id: string;
  provider: Provider;
  account_id: string;
  label: string;
  status: string;
  error: string | null;
  generation: number;
  identity?: {
    user_id?: string;
    user_name?: string;
    workspace_id?: string;
    workspace_name?: string;
  };
};
export type Source = {
  id: string;
  connection_id: string;
  external_id: string;
  name: string;
  project_id: string;
  mapping: Mapping;
  status: string;
  error: string | null;
  last_success: number | null;
  webhook_id: string | null;
};
export type ExternalTask = {
  id: string;
  connection_id: string;
  external_id: string;
  task_id: string | null;
  metadata: ExternalMetadata;
  explicit_link: boolean;
};
export type Integrations = {
  notionWebhookConfigured?: boolean;
  connections: Connection[];
  sources: Source[];
  tasks: ExternalTask[];
  memberships: {
    source_id: string;
    external_task_id: string;
    available: boolean;
  }[];
};
export type Credentials = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
};
