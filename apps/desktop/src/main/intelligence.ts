import type {
  AdoClient,
  AdoPullRequest,
  AttachmentInfo
} from '@triager/ado';
import type {
  ContextReference,
  MeetingContext,
  TranscriptTurn,
  ToolResult,
  ToolSource,
  WorkItemSnapshot
} from '@triager/shared';

export interface RelatedWorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
  areaPath: string;
  iterationPath: string;
  assignedTo: string;
  score: number;
  reasons: string[];
  url: string;
}

export interface PullRequestSummary {
  id: number;
  title: string;
  status: string;
  isDraft: boolean;
  author: string;
  repository: string;
  sourceBranch: string;
  targetBranch: string;
  reviewers: { name: string; vote: number; required: boolean }[];
  commitCount: number;
  commentCount: number;
  changedFileCount: number;
  url: string;
}

export interface BuildSummary {
  id: number;
  buildNumber: string;
  definition: string;
  status: string;
  result: string;
  branch: string;
  finishedAt?: string;
  url: string;
}

export interface WorkItemIntelligence {
  item: WorkItemSnapshot;
  comments: { author: string; date: string; text: string }[];
  history: unknown[];
  pullRequests: PullRequestSummary[];
  builds: BuildSummary[];
  attachments: AttachmentInfo[];
  warnings: string[];
}

export interface RelatedSearchOptions {
  platform?: string;
  release?: string;
  limit?: number;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'being', 'from', 'have', 'into', 'issue',
  'that', 'their', 'there', 'these', 'this', 'with', 'when', 'where', 'which', 'while'
]);

function stripHtml(value: unknown): string {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function identityName(value: unknown): string {
  if (value && typeof value === 'object' && 'displayName' in value) {
    return String((value as { displayName?: unknown }).displayName ?? '');
  }
  return String(value ?? '');
}

function tokens(value: unknown): Set<string> {
  const words = stripHtml(value).toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

function overlap(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((word) => right.has(word));
}

function escapeWiql(value: string): string {
  return value.replace(/'/g, "''");
}

function branchName(value: string | undefined): string {
  return String(value ?? '').replace(/^refs\/heads\//, '');
}

export function parsePullRequestArtifact(url: string): { repositoryId: string; pullRequestId: number } | null {
  const marker = 'vstfs:///Git/PullRequestId/';
  if (!url.startsWith(marker)) return null;
  const parts = decodeURIComponent(url.slice(marker.length)).split('/');
  const pullRequestId = Number(parts.at(-1));
  const repositoryId = parts.at(-2) ?? '';
  return repositoryId && Number.isInteger(pullRequestId) ? { repositoryId, pullRequestId } : null;
}

export function parseBuildArtifact(url: string): number | null {
  const match = /^vstfs:\/\/\/Build\/Build\/(\d+)$/i.exec(url);
  return match ? Number(match[1]) : null;
}

export class AdoIntelligenceService {
  private context: MeetingContext = {
    mentionedPeople: [], mentionedBugs: [], mentionedPRs: [], decisions: [], openQuestions: [],
    blockers: [], actionItems: [], updatedAt: Date.now()
  };

  constructor(
    private readonly client: AdoClient,
    private readonly organizationUrl: string,
    private readonly project: string
  ) {}

  getContext(): MeetingContext {
    return structuredClone(this.context);
  }

  observeTurn(turn: TranscriptTurn): MeetingContext {
    const text = turn.text.trim();
    if (!text) return this.getContext();
    const mentionedBugs = [...text.matchAll(/\b(?:bug|item)\s*#?\s*(\d{3,9})\b/gi)]
      .map((match) => ({ id: match[1], url: this.workItemUrl(Number(match[1])) }));
    const mentionedPRs = [...text.matchAll(/\b(?:pr|pull request)\s*#?\s*(\d+)\b/gi)]
      .map((match) => ({ id: match[1] }));
    const actionMatch = /\b([A-Z][\w.-]+)\s+will\s+(.+?)(?:[.!]|$)/.exec(text);
    const platformMatch = /\b(?:on|platform)\s+(AMD|Intel|ARM|PartnerCo|Windows|Linux|Android)\b/i.exec(text);
    const releaseMatch = /\b(?:target(?:ing)?|milestone|release)\s+(?:remains?\s+)?([A-Z]?M\d+|[A-Za-z]+\s+\d{2,4})\b/i.exec(text);
    this.context = {
      ...this.context,
      currentPlatform: platformMatch?.[1] ?? this.context.currentPlatform,
      currentRelease: releaseMatch?.[1] ?? this.context.currentRelease,
      currentInvestigation: /\b(?:investigat|hypothesi|root cause|finding)\w*/i.test(text)
        ? text
        : this.context.currentInvestigation,
      mentionedBugs: mergeRefs(this.context.mentionedBugs, mentionedBugs),
      mentionedPRs: mergeRefs(this.context.mentionedPRs, mentionedPRs),
      mentionedPeople: actionMatch
        ? appendUnique(this.context.mentionedPeople, actionMatch[1])
        : this.context.mentionedPeople,
      decisions: /\b(?:agreed|decided|decision|target remains|will ship|we'll)\b/i.test(text)
        ? appendUnique(this.context.decisions, text)
        : this.context.decisions,
      blockers: /\b(?:blocked|blocker|waiting on|awaiting)\b/i.test(text)
        ? appendUnique(this.context.blockers, text)
        : this.context.blockers,
      openQuestions: /\?\s*$/.test(text)
        ? appendUnique(this.context.openQuestions, text)
        : this.context.openQuestions,
      actionItems: actionMatch
        ? appendAction(this.context.actionItems, { owner: actionMatch[1], task: actionMatch[2].trim() })
        : this.context.actionItems,
      updatedAt: Date.now()
    };
    return this.getContext();
  }

  async focusWorkItem(id: number, updateContext = true): Promise<ToolResult<WorkItemIntelligence>> {
    try {
      const item = await this.client.getWorkItem(id, 'all');
      const [comments, history, attachments, pullRequestResult, buildResult] = await Promise.all([
        this.client.getComments(id),
        this.client.getWorkItemUpdates(id),
        this.client.listAttachments(id),
        this.getLinkedPullRequests(item),
        this.getLinkedBuilds(item)
      ]);
      const url = this.workItemUrl(id);
      const ref: ContextReference = { id: String(id), title: item.title, url };
      this.context = updateContext
        ? {
            ...this.context,
            currentWorkItem: ref,
            currentComponent: String(item.fields['System.AreaPath'] ?? ''),
            currentRelease: String(item.fields['System.IterationPath'] ?? ''),
            mentionedBugs: mergeRefs(this.context.mentionedBugs, [ref]),
            updatedAt: Date.now()
          }
        : {
            ...this.context,
            mentionedBugs: mergeRefs(this.context.mentionedBugs, [ref]),
            updatedAt: Date.now()
          };
      const data: WorkItemIntelligence = {
        item,
        comments: comments.map((comment) => ({
          author: identityName(comment.createdBy),
          date: String(comment.createdDate ?? ''),
          text: stripHtml(comment.text)
        })),
        history,
        pullRequests: pullRequestResult.items,
        builds: buildResult.items,
        attachments,
        warnings: [...pullRequestResult.warnings, ...buildResult.warnings]
      };
      const sources: ToolSource[] = [
        { kind: 'work_item', id: String(id), title: item.title, url },
        ...pullRequestResult.items.map((pr) => ({ kind: 'pull_request' as const, id: String(pr.id), title: pr.title, url: pr.url })),
        ...buildResult.items.map((build) => ({ kind: 'build' as const, id: String(build.id), title: build.buildNumber, url: build.url }))
      ];
      return { status: 'found', data, sources };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error), retryable: true };
    }
  }

  async searchRelated(sourceId: number, options: RelatedSearchOptions = {}): Promise<ToolResult<RelatedWorkItem[]>> {
    try {
      const source = await this.client.getWorkItem(sourceId, 'fields');
      const sourceText = [
        source.title,
        source.fields['System.Description'],
        source.fields['Microsoft.VSTS.TCM.ReproSteps'],
        source.fields['System.Tags']
      ].join(' ');
      const sourceTokens = tokens(sourceText);
      const searchTerms = [...sourceTokens].filter((term) => term.length >= 4).slice(0, 6);
      if (!searchTerms.length) {
        return { status: 'empty', data: [], sources: [], message: 'The current work item has too little searchable text.' };
      }
      const clauses = searchTerms.map((term) => {
        const value = escapeWiql(term);
        return `([System.Title] CONTAINS WORDS '${value}' OR [System.Description] CONTAINS WORDS '${value}' OR [Microsoft.VSTS.TCM.ReproSteps] CONTAINS WORDS '${value}')`;
      });
      if (options.platform) clauses.push(`[System.Tags] CONTAINS '${escapeWiql(options.platform)}'`);
      if (options.release) clauses.push(`[System.IterationPath] UNDER '${escapeWiql(options.release)}'`);
      const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.Id] <> ${sourceId} AND [System.WorkItemType] IN ('Bug', 'User Story', 'Task') AND (${clauses.slice(0, searchTerms.length).join(' OR ')})${clauses.slice(searchTerms.length).map((clause) => ` AND ${clause}`).join('')} ORDER BY [System.ChangedDate] DESC`;
      const ids = (await this.client.runWiql(wiql, false)).slice(0, 100);
      const candidates = await this.client.getWorkItemsBatch(ids, [
        'System.Id', 'System.WorkItemType', 'System.Title', 'System.State', 'System.AreaPath',
        'System.IterationPath', 'System.AssignedTo', 'System.Description',
        'Microsoft.VSTS.TCM.ReproSteps', 'System.Tags'
      ], false);
      const sourceArea = String(source.fields['System.AreaPath'] ?? '').toLowerCase();
      const ranked = candidates.map((item) => {
        const candidateTokens = tokens([
          item.title, item.fields['System.Description'], item.fields['Microsoft.VSTS.TCM.ReproSteps'], item.fields['System.Tags']
        ].join(' '));
        const shared = overlap(sourceTokens, candidateTokens);
        const sameArea = sourceArea && String(item.fields['System.AreaPath'] ?? '').toLowerCase() === sourceArea;
        const reasons = [
          shared.length ? `Shared signals: ${shared.slice(0, 5).join(', ')}` : '',
          sameArea ? 'Same area/component' : '',
          options.platform && candidateTokens.has(options.platform.toLowerCase()) ? `Platform: ${options.platform}` : ''
        ].filter(Boolean);
        return {
          id: item.id,
          title: item.title,
          state: item.state,
          type: item.workItemType,
          areaPath: String(item.fields['System.AreaPath'] ?? ''),
          iterationPath: String(item.fields['System.IterationPath'] ?? ''),
          assignedTo: identityName(item.fields['System.AssignedTo']),
          score: shared.length + (sameArea ? 3 : 0),
          reasons,
          url: this.workItemUrl(item.id)
        };
      }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.id - a.id).slice(0, options.limit ?? 8);
      const sources = ranked.map((item) => ({ kind: 'work_item' as const, id: String(item.id), title: item.title, url: item.url }));
      if (!ranked.length) return { status: 'empty', data: [], sources: [], message: 'No sufficiently similar work items were found.' };
      this.context.mentionedBugs = mergeRefs(this.context.mentionedBugs, sources);
      this.context.updatedAt = Date.now();
      return { status: 'found', data: ranked, sources };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error), retryable: true };
    }
  }

  private async getLinkedPullRequests(item: WorkItemSnapshot): Promise<{ items: PullRequestSummary[]; warnings: string[] }> {
    const links = (item.relations ?? []).map((relation) => parsePullRequestArtifact(relation.url)).filter((value): value is NonNullable<typeof value> => Boolean(value));
    const settled = await Promise.allSettled(links.map(async (link) => {
        const [pr, commits, threads, changes] = await Promise.all([
          this.client.getPullRequest(link.repositoryId, link.pullRequestId),
          this.client.getPullRequestCommits(link.repositoryId, link.pullRequestId),
          this.client.getPullRequestThreads(link.repositoryId, link.pullRequestId),
          this.client.getPullRequestChanges(link.repositoryId, link.pullRequestId)
        ]);
        const commentCount = threads.reduce(
          (total, thread) => total + (thread.comments?.filter((comment) => comment.commentType !== 'system').length ?? 0),
          0
        );
        return this.toPullRequestSummary(pr, commits.length, commentCount, changes.length);
      }));
    const results = settled.filter((result): result is PromiseFulfilledResult<PullRequestSummary> => result.status === 'fulfilled').map((result) => result.value);
    const warnings = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => `A linked pull request could not be retrieved: ${errorMessage(result.reason)}`);
    this.context.mentionedPRs = mergeRefs(this.context.mentionedPRs, results.map((pr) => ({ id: String(pr.id), title: pr.title, url: pr.url })));
    return { items: results, warnings };
  }

  private async getLinkedBuilds(item: WorkItemSnapshot): Promise<{ items: BuildSummary[]; warnings: string[] }> {
    const ids = (item.relations ?? [])
      .map((relation) => parseBuildArtifact(relation.url))
      .filter((id): id is number => id !== null);
    const settled = await Promise.allSettled(ids.map((id) => this.client.getBuild(id)));
    const builds = settled.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<AdoClient['getBuild']>>> => result.status === 'fulfilled').map((result) => result.value);
    const warnings = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => `A linked build could not be retrieved: ${errorMessage(result.reason)}`);
    const items = builds.map((build) => ({
      id: build.id,
      buildNumber: build.buildNumber ?? String(build.id),
      definition: build.definition?.name ?? '',
      status: build.status ?? '',
      result: build.result ?? '',
      branch: branchName(build.sourceBranch),
      finishedAt: build.finishTime,
      url: build.webUrl ?? `${this.organizationUrl}/${encodeURIComponent(this.project)}/_build/results?buildId=${build.id}`
    }));
    return { items, warnings };
  }

  private toPullRequestSummary(
    pr: AdoPullRequest,
    commitCount: number,
    commentCount: number,
    changedFileCount: number
  ): PullRequestSummary {
    const repository = pr.repository?.name ?? '';
    const url = pr.repository?.webUrl
      ? `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`
      : `${this.organizationUrl}/${encodeURIComponent(this.project)}/_git/${encodeURIComponent(repository)}/pullrequest/${pr.pullRequestId}`;
    return {
      id: pr.pullRequestId,
      title: pr.title,
      status: pr.status,
      isDraft: Boolean(pr.isDraft),
      author: pr.createdBy?.displayName ?? pr.createdBy?.uniqueName ?? '',
      repository,
      sourceBranch: branchName(pr.sourceRefName),
      targetBranch: branchName(pr.targetRefName),
      reviewers: (pr.reviewers ?? []).map((reviewer) => ({
        name: reviewer.displayName ?? reviewer.uniqueName ?? '', vote: reviewer.vote ?? 0, required: Boolean(reviewer.isRequired)
      })),
      commitCount,
      commentCount,
      changedFileCount,
      url
    };
  }

  private workItemUrl(id: number): string {
    return `${this.organizationUrl}/${encodeURIComponent(this.project)}/_workitems/edit/${id}`;
  }
}

function mergeRefs(existing: ContextReference[], incoming: ContextReference[]): ContextReference[] {
  const byId = new Map(existing.map((ref) => [ref.id, ref]));
  for (const ref of incoming) byId.set(ref.id, ref);
  return [...byId.values()];
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function appendAction(
  values: { owner?: string; task: string }[],
  value: { owner?: string; task: string }
): { owner?: string; task: string }[] {
  return values.some((item) => item.owner === value.owner && item.task === value.task) ? values : [...values, value];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}