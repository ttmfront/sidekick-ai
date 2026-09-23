import { readFile } from 'node:fs/promises';
import { AdoClient, reconcileSchema, type AccessTokenProvider, type AdoSchema } from '@triager/ado';
import { loadProgramConfig, resolveConfigPath, ProgramKnowledge, type ProgramConfig } from '@triager/knowledge';
import { MockReasoningProvider } from '@triager/triage-brain';
import {
  evaluatePolicy,
  type MeetingContext,
  type PolicyResult,
  type ToolResult,
  type TranscriptTurn,
  type TriageAction,
  type WorkItemSnapshot
} from '@triager/shared';
import { ActionExecutor, type ActionPreview, type ExecResult } from './executor';
import {
  AdoIntelligenceService,
  type RelatedSearchOptions,
  type RelatedWorkItem,
  type WorkItemIntelligence
} from './intelligence';
import {
  DraftOnlyPartnerProvider,
  type PartnerCaseDraft,
  type PartnerCaseSummary,
  type PartnerProvider
} from './partner';

export interface WorkItemRow {
  id: number;
  type: string;
  title: string;
  assignedTo: string;
  state: string;
  areaPath: string;
}

export interface CommentRow {
  author: string;
  date: string;
  text: string;
}

export interface SchemaSummary {
  total: number;
  discovered: number;
  undiscovered: number;
  fields: Record<string, { friendlyName: string; referenceName: string | null; discovered: boolean }>;
}

export interface ProposedAction {
  action: TriageAction;
  policy: PolicyResult;
  preview: ActionPreview;
}

export interface AnalyzeResult {
  workItemId: number;
  actions: ProposedAction[];
}

/** ADO connectivity plus the triage reasoning + write engine for one program. */
export class AdoService {
  private client?: AdoClient;
  private provider?: MockReasoningProvider;
  private executor?: ActionExecutor;
  private intelligence?: AdoIntelligenceService;
  private partner?: PartnerProvider;
  private schema: AdoSchema | null = null;

  constructor(
    private readonly config: ProgramConfig,
    private readonly schemaPath: string
  ) {}

  static async load(configPath: string, schemaPath: string): Promise<AdoService> {
    return new AdoService(await loadProgramConfig(configPath), schemaPath);
  }

  get program(): ProgramConfig {
    return this.config;
  }

  async connect(auth: AccessTokenProvider): Promise<void> {
    this.client = new AdoClient({
      organizationUrl: this.config.organizationUrl,
      project: this.config.project,
      auth
    });
    this.provider = new MockReasoningProvider(new ProgramKnowledge(this.config));
    this.schema = JSON.parse(await readFile(await resolveConfigPath(this.schemaPath), 'utf8')) as AdoSchema;
    this.executor = new ActionExecutor(this.client, () => this.schema);
    this.intelligence = new AdoIntelligenceService(
      this.client,
      this.config.organizationUrl,
      this.config.project
    );
    this.partner = new DraftOnlyPartnerProvider(
      this.schema.fields.partnerDiscussion?.referenceName ?? undefined
    );
  }

  private need(): AdoClient {
    if (!this.client) throw new Error('Not connected to Azure DevOps. Sign in first.');
    return this.client;
  }

  async loadQuery(): Promise<WorkItemRow[]> {
    const c = this.need();
    if (!this.config.queryPath) throw new Error('No queryPath configured for this program.');
    const query = await c.getQueryByPath(this.config.queryPath);
    const ids = await c.runQueryById(query.id);
    const items = await c.getWorkItemsBatch(ids, [
      'System.Id',
      'System.WorkItemType',
      'System.Title',
      'System.AssignedTo',
      'System.State',
      'System.AreaPath'
    ]);
    return items.map(toRow);
  }

  async getWorkItem(id: number): Promise<WorkItemSnapshot> {
    return this.need().getWorkItem(id, 'all');
  }

  private needIntelligence(): AdoIntelligenceService {
    if (!this.intelligence) throw new Error('Not connected to Azure DevOps. Sign in first.');
    return this.intelligence;
  }

  async getIntelligence(id: number, updateContext = true): Promise<ToolResult<WorkItemIntelligence>> {
    return this.needIntelligence().focusWorkItem(id, updateContext);
  }

  async searchRelated(id: number, options?: RelatedSearchOptions): Promise<ToolResult<RelatedWorkItem[]>> {
    return this.needIntelligence().searchRelated(id, options);
  }

  getMeetingContext(): MeetingContext {
    return this.needIntelligence().getContext();
  }

  observeMeetingTurn(turn: TranscriptTurn): MeetingContext {
    return this.needIntelligence().observeTurn(turn);
  }

  async searchPartnerCases(id: number, partner?: string): Promise<ToolResult<PartnerCaseSummary[]>> {
    if (!this.partner) throw new Error('Partner provider is not initialized.');
    return this.partner.searchCases(await this.getWorkItem(id), partner);
  }

  async draftPartnerCase(id: number, partner: string): Promise<ToolResult<PartnerCaseDraft>> {
    if (!this.partner) throw new Error('Partner provider is not initialized.');
    return this.partner.createCaseDraft(await this.getWorkItem(id), partner);
  }

  /** The bug's discussion/comment thread, newest first, as plain text. */
  async getComments(id: number, top = 25): Promise<CommentRow[]> {
    const comments = await this.need().getComments(id);
    return comments
      .map((c) => ({ author: identityName(c.createdBy), date: String(c.createdDate ?? ''), text: stripHtml(c.text) }))
      .filter((c) => c.text)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, top);
  }

  async discoverSchema(): Promise<SchemaSummary> {
    const c = this.need();
    const fields = await c.getFields();
    const base = this.schema ?? (JSON.parse(await readFile(await resolveConfigPath(this.schemaPath), 'utf8')) as AdoSchema);
    this.schema = reconcileSchema(base, fields);
    const entries = Object.entries(this.schema.fields);
    const discovered = entries.filter(([, f]) => f.discovered && f.referenceName).length;
    const summary: SchemaSummary['fields'] = {};
    for (const [k, f] of entries) {
      summary[k] = {
        friendlyName: f.friendlyName,
        referenceName: f.referenceName,
        discovered: Boolean(f.discovered && f.referenceName)
      };
    }
    return { total: entries.length, discovered, undiscovered: entries.length - discovered, fields: summary };
  }

  async analyze(workItemId: number, transcript: TranscriptTurn[]): Promise<AnalyzeResult> {
    if (!this.provider || !this.executor) throw new Error('Not connected. Sign in first.');
    const wi = await this.getWorkItem(workItemId);
    const { actions } = await this.provider.plan({
      workItem: { id: workItemId, title: wi.title, state: wi.state, fields: wi.fields },
      transcript
    });
    const executor = this.executor;
    return {
      workItemId,
      actions: actions.map((action) => ({
        action,
        policy: evaluatePolicy(action),
        preview: executor.preview(action, wi)
      }))
    };
  }

  async execute(action: TriageAction, workItemId: number): Promise<ExecResult> {
    if (!this.executor) throw new Error('Not connected. Sign in first.');
    return this.executor.execute(action, workItemId);
  }

  setTag(tag: string): void {
    this.executor?.setTag(tag);
  }
}

function toRow(wi: WorkItemSnapshot): WorkItemRow {
  const f = wi.fields;
  return {
    id: wi.id,
    type: wi.workItemType,
    title: wi.title,
    state: wi.state,
    assignedTo: identityName(f['System.AssignedTo']),
    areaPath: String(f['System.AreaPath'] ?? '')
  };
}

function identityName(v: unknown): string {
  if (v && typeof v === 'object' && 'displayName' in v) {
    return String((v as { displayName: unknown }).displayName);
  }
  return v ? String(v) : '';
}

function stripHtml(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
