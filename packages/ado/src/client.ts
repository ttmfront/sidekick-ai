import type { WorkItemSnapshot, WorkItemRelation } from '@triager/shared';
import type { AccessTokenProvider } from './auth.js';
import type { AdoFieldMeta } from './schema-discovery.js';
import {
  buildFieldPatch,
  buildAddRelationPatch,
  workItemApiUrl,
  RELATION_TYPES,
  type FieldValue,
  type JsonPatchOp
} from './patch.js';

export interface AdoClientConfig {
  organizationUrl: string;
  project: string;
  apiVersion?: string;
  auth: AccessTokenProvider;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class AdoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'AdoError';
  }
}

interface AdoWorkItem {
  id: number;
  rev: number;
  fields?: Record<string, unknown>;
  relations?: { rel: string; url: string; attributes?: Record<string, unknown> }[];
  url?: string;
}

export interface AdoComment {
  id?: number;
  text: string;
  createdBy?: { displayName?: string };
  createdDate?: string;
}

export interface AttachmentInfo {
  name: string;
  url: string;
  resourceSize?: number;
  attributes?: Record<string, unknown>;
}

export interface AdoIdentity {
  displayName?: string;
  uniqueName?: string;
  url?: string;
}

export interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  status: string;
  isDraft?: boolean;
  creationDate?: string;
  closedDate?: string;
  sourceRefName?: string;
  targetRefName?: string;
  mergeStatus?: string;
  createdBy?: AdoIdentity;
  reviewers?: (AdoIdentity & { vote?: number; isRequired?: boolean })[];
  repository?: { id: string; name: string; webUrl?: string; project?: { id?: string; name?: string } };
  lastMergeCommit?: { commitId?: string; url?: string };
  url?: string;
}

export interface AdoGitCommit {
  commitId: string;
  comment?: string;
  url?: string;
  author?: { name?: string; email?: string; date?: string };
}

export interface AdoPullRequestThread {
  id: number;
  status?: string;
  isDeleted?: boolean;
  comments?: { id?: number; content?: string; commentType?: string; author?: AdoIdentity; publishedDate?: string }[];
}

export interface AdoPullRequestChange {
  changeId?: number;
  changeType?: string;
  item?: { path?: string; url?: string };
}

export interface AdoBuild {
  id: number;
  buildNumber?: string;
  status?: string;
  result?: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  sourceBranch?: string;
  sourceVersion?: string;
  webUrl?: string;
  definition?: { id?: number; name?: string };
  requestedFor?: AdoIdentity;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractWorkItemId(url: string): number | undefined {
  const m = /\/workItems\/(\d+)/i.exec(url);
  return m ? Number(m[1]) : undefined;
}

function toSnapshot(raw: AdoWorkItem): WorkItemSnapshot {
  const fields = raw.fields ?? {};
  const relations: WorkItemRelation[] = (raw.relations ?? []).map((r) => ({
    rel: r.rel,
    url: r.url,
    attributes: r.attributes,
    targetId: extractWorkItemId(r.url)
  }));
  return {
    id: raw.id,
    rev: raw.rev,
    workItemType: String(fields['System.WorkItemType'] ?? ''),
    title: String(fields['System.Title'] ?? ''),
    state: String(fields['System.State'] ?? ''),
    fields,
    relations
  };
}

/**
 * Typed Azure DevOps REST adapter. This is the ONLY component that talks to ADO.
 * All writes go through JSON Patch; field updates support optimistic concurrency.
 */
export class AdoClient {
  private readonly org: string;
  private readonly apiVersion: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: AdoClientConfig) {
    this.org = config.organizationUrl.replace(/\/+$/, '');
    this.apiVersion = config.apiVersion ?? '7.1';
    this.doFetch = config.fetchImpl ?? fetch;
  }

  private apiUrl(
    path: string,
    params: Record<string, string> = {},
    opts: { project?: boolean; apiVersion?: string } = {}
  ): string {
    const useProject = opts.project ?? true;
    const base = useProject ? `${this.org}/${encodeURIComponent(this.config.project)}` : this.org;
    const usp = new URLSearchParams({ 'api-version': opts.apiVersion ?? this.apiVersion, ...params });
    return `${base}/_apis/${path}?${usp.toString()}`;
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    contentType = 'application/json'
  ): Promise<T> {
    const authHeader = await this.config.auth.getAuthHeader();
    const headers: Record<string, string> = {
      Authorization: authHeader,
      Accept: 'application/json'
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = contentType;
      payload = JSON.stringify(body);
    }
    const res = await this.doFetch(url, { method, headers, body: payload });
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const message =
        data && typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : `ADO ${method} failed with ${res.status}`;
      throw new AdoError(message, res.status, data);
    }
    return data as T;
  }

  // ---- Reads ----

  async getWorkItem(
    id: number,
    expand: 'none' | 'relations' | 'fields' | 'all' = 'all'
  ): Promise<WorkItemSnapshot> {
    const raw = await this.request<AdoWorkItem>(
      'GET',
      this.apiUrl(`wit/workitems/${id}`, { $expand: expand })
    );
    return toSnapshot(raw);
  }

  async getWorkItemUpdates(id: number): Promise<unknown[]> {
    const res = await this.request<{ value: unknown[] }>(
      'GET',
      this.apiUrl(`wit/workItems/${id}/updates`)
    );
    return res.value ?? [];
  }

  async getComments(id: number): Promise<AdoComment[]> {
    const res = await this.request<{ comments: AdoComment[] }>(
      'GET',
      this.apiUrl(`wit/workItems/${id}/comments`, {}, { apiVersion: '7.1-preview.4' })
    );
    return res.comments ?? [];
  }

  async runWiql(query: string, projectScoped = true): Promise<number[]> {
    const res = await this.request<{ workItems?: { id: number }[] }>(
      'POST',
      this.apiUrl('wit/wiql', {}, { project: projectScoped }),
      { query }
    );
    return (res.workItems ?? []).map((w) => w.id);
  }

  async getPullRequest(repositoryId: string, pullRequestId: number): Promise<AdoPullRequest> {
    return this.request<AdoPullRequest>(
      'GET',
      this.apiUrl(`git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}`)
    );
  }

  async getPullRequestCommits(repositoryId: string, pullRequestId: number): Promise<AdoGitCommit[]> {
    const res = await this.request<{ value?: AdoGitCommit[] }>(
      'GET',
      this.apiUrl(`git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/commits`)
    );
    return res.value ?? [];
  }

  async getPullRequestThreads(repositoryId: string, pullRequestId: number): Promise<AdoPullRequestThread[]> {
    const res = await this.request<{ value?: AdoPullRequestThread[] }>(
      'GET',
      this.apiUrl(`git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/threads`)
    );
    return res.value ?? [];
  }

  async getPullRequestChanges(repositoryId: string, pullRequestId: number): Promise<AdoPullRequestChange[]> {
    const iterations = await this.request<{ value?: { id: number }[] }>(
      'GET',
      this.apiUrl(`git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/iterations`)
    );
    const iterationId = iterations.value?.at(-1)?.id;
    if (!iterationId) return [];
    const res = await this.request<{ changeEntries?: AdoPullRequestChange[] }>(
      'GET',
      this.apiUrl(`git/repositories/${encodeURIComponent(repositoryId)}/pullrequests/${pullRequestId}/iterations/${iterationId}/changes`, { $top: '2000' })
    );
    return res.changeEntries ?? [];
  }

  async getBuild(buildId: number): Promise<AdoBuild> {
    return this.request<AdoBuild>('GET', this.apiUrl(`build/builds/${buildId}`));
  }

  async getFields(): Promise<AdoFieldMeta[]> {
    const res = await this.request<{ value: AdoFieldMeta[] }>(
      'GET',
      this.apiUrl('wit/fields', {}, { project: false })
    );
    return (res.value ?? []).map((f) => ({
      referenceName: f.referenceName,
      name: f.name,
      type: f.type
    }));
  }

  async getWorkItemTypeFields(workItemType: string): Promise<AdoFieldMeta[]> {
    const res = await this.request<{ value: AdoFieldMeta[] }>(
      'GET',
      this.apiUrl(`wit/workitemtypes/${encodeURIComponent(workItemType)}/fields`, { $expand: 'all' })
    );
    return (res.value ?? []).map((f) => ({ referenceName: f.referenceName, name: f.name, type: f.type }));
  }

  async listAttachments(id: number): Promise<AttachmentInfo[]> {
    const wi = await this.getWorkItem(id, 'relations');
    return (wi.relations ?? [])
      .filter((r) => r.rel === 'AttachedFile')
      .map((r) => ({
        name: String(r.attributes?.['name'] ?? ''),
        url: r.url,
        resourceSize:
          typeof r.attributes?.['resourceSize'] === 'number'
            ? (r.attributes['resourceSize'] as number)
            : undefined,
        attributes: r.attributes
      }));
  }

  // ---- Writes ----

  async addComment(id: number, text: string): Promise<AdoComment> {
    return this.request<AdoComment>(
      'POST',
      this.apiUrl(`wit/workItems/${id}/comments`, {}, { apiVersion: '7.1-preview.4' }),
      { text }
    );
  }

  async patchWorkItem(id: number, ops: JsonPatchOp[]): Promise<WorkItemSnapshot> {
    const raw = await this.request<AdoWorkItem>(
      'PATCH',
      this.apiUrl(`wit/workitems/${id}`),
      ops,
      'application/json-patch+json'
    );
    return toSnapshot(raw);
  }

  async updateFields(
    id: number,
    changes: Record<string, FieldValue>,
    expectedRev?: number
  ): Promise<WorkItemSnapshot> {
    return this.patchWorkItem(id, buildFieldPatch(changes, expectedRev));
  }

  async addRelation(
    id: number,
    rel: string,
    targetId: number,
    attributes?: Record<string, unknown>
  ): Promise<WorkItemSnapshot> {
    const url = workItemApiUrl(this.org, targetId);
    return this.patchWorkItem(id, buildAddRelationPatch(rel, url, attributes));
  }

  async linkRelated(id: number, targetId: number): Promise<WorkItemSnapshot> {
    return this.addRelation(id, RELATION_TYPES.related, targetId);
  }

  async markDuplicateOf(id: number, duplicateOfId: number): Promise<WorkItemSnapshot> {
    return this.addRelation(id, RELATION_TYPES.duplicateOf, duplicateOfId);
  }

  // ---- Queries ----

  async getQueryByPath(path: string): Promise<{ id: string; name: string; path: string; wiql?: string }> {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return this.request<{ id: string; name: string; path: string; wiql?: string }>(
      'GET',
      this.apiUrl(`wit/queries/${encoded}`, { $expand: 'wiql' })
    );
  }

  async runQueryById(id: string): Promise<number[]> {
    const res = await this.request<{ workItems?: { id: number }[] }>(
      'GET',
      this.apiUrl(`wit/wiql/${encodeURIComponent(id)}`)
    );
    return (res.workItems ?? []).map((w) => w.id);
  }

  async getWorkItemsBatch(ids: number[], fields?: string[], projectScoped = true): Promise<WorkItemSnapshot[]> {
    if (ids.length === 0) return [];
    const body: Record<string, unknown> = { ids: ids.slice(0, 200) };
    if (fields && fields.length) body['fields'] = fields;
    else body['$expand'] = 'fields';
    const res = await this.request<{ value: AdoWorkItem[] }>(
      'POST',
      this.apiUrl('wit/workitemsbatch', {}, { project: projectScoped }),
      body
    );
    return (res.value ?? []).map(toSnapshot);
  }
}
