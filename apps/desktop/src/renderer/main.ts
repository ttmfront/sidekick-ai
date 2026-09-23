import { startVoice, stopVoice, updateContext, respond } from './voice';
import { startScreen, captureFrame, stopScreen } from './screen';

interface TranscriptTurn { turnId: string; speaker?: string; text: string; ts: number; }
interface DiffLine { field: string; before: string; after: string; }
interface Preview { supported: boolean; summary: string; diff: DiffLine[]; warning?: string; }
interface Policy { outcome: 'auto' | 'confirm' | 'clarify' | 'reject'; risk: 'low' | 'medium' | 'high'; reason: string; }
interface Evidence { turnId: string; speaker?: string; quote: string; }
interface Action { action: string; confidence?: number; evidence?: Evidence[]; [k: string]: unknown; }
interface Proposed { action: Action; policy: Policy; preview: Preview; }
interface Snapshot { id: number; rev: number; title: string; state: string; fields: Record<string, unknown>; }
interface CommentRow { author: string; date: string; text: string; }
interface RefDoc { name: string; text: string; chars: number; error?: string; default?: boolean; }
interface AuditRecord { ts: number; workItemId: number; action: string; ok: boolean; summary?: string; error?: string; revisionAfter?: number; }
interface Source { kind: string; id: string; title?: string; url?: string; }
type ToolResult<T> = { status: 'found'; data: T; sources: Source[] } | { status: 'empty'; data: T; sources: Source[]; message: string } | { status: 'error'; error: string; retryable: boolean };
interface PullRequestSummary { id: number; title: string; status: string; isDraft: boolean; author: string; repository: string; sourceBranch: string; targetBranch: string; reviewers: { name: string; vote: number; required: boolean }[]; commitCount: number; commentCount: number; changedFileCount: number; url: string; }
interface BuildSummary { id: number; buildNumber: string; definition: string; status: string; result: string; branch: string; finishedAt?: string; url: string; }
interface Intelligence { item: Snapshot; comments: CommentRow[]; history: unknown[]; pullRequests: PullRequestSummary[]; builds: BuildSummary[]; attachments: { name: string; url: string }[]; warnings: string[]; }
interface RelatedItem { id: number; title: string; state: string; type: string; areaPath: string; iterationPath: string; assignedTo: string; score: number; reasons: string[]; url: string; }
interface MeetingContext { currentWorkItem?: { id: string; title?: string; url?: string }; currentComponent?: string; currentPlatform?: string; currentRelease?: string; currentInvestigation?: string; mentionedPeople: string[]; decisions: string[]; blockers: string[]; openQuestions: string[]; actionItems: { owner?: string; task: string }[]; }

interface Api {
  signIn(): Promise<{ ok: boolean; account?: { username: string; name?: string }; org?: string; error?: string }>;
  signOut(): Promise<{ ok: boolean }>;
  status(): Promise<{ signedIn: boolean; account: { username: string; name?: string } | null; org: string; project: string; program: string }>;
  getWorkItem(id: number): Promise<{ ok: boolean; item?: Snapshot; error?: string }>;
  getComments(id: number): Promise<{ ok: boolean; comments?: CommentRow[]; error?: string }>;
  getIntelligence(id: number, updateContext?: boolean): Promise<{ ok: boolean; result?: ToolResult<Intelligence>; error?: string }>;
  searchRelated(id: number, options?: { platform?: string; release?: string; limit?: number }): Promise<{ ok: boolean; result?: ToolResult<RelatedItem[]>; error?: string }>;
  getMeetingContext(): Promise<{ ok: boolean; context?: MeetingContext; error?: string }>;
  observeMeetingTurn(turn: TranscriptTurn): Promise<{ ok: boolean; context?: MeetingContext; error?: string }>;
  searchPartnerCases(id: number, partner?: string): Promise<{ ok: boolean; result?: ToolResult<unknown[]>; error?: string }>;
  draftPartnerCase(id: number, partner: string): Promise<{ ok: boolean; result?: ToolResult<Record<string, unknown>>; error?: string }>;
  discoverSchema(): Promise<{ ok: boolean; discovered?: number; total?: number; error?: string }>;
  analyze(workItemId: number, transcript: TranscriptTurn[]): Promise<{ ok: boolean; actions?: Proposed[]; error?: string }>;
  execute(action: Action, workItemId: number): Promise<{ ok: boolean; result?: { ok: boolean; summary: string; revisionAfter?: number; error?: string }; error?: string }>;
  listAudit(): Promise<{ ok: boolean; audit?: AuditRecord[] }>;
  visionAnalyze(image: string, hint?: string): Promise<{ ok: boolean; workItemId?: number | null; title?: string | null; onScreen?: string; error?: string }>;
  setTag(tag: string): Promise<{ ok: boolean }>;
  pickDocs(): Promise<{ ok: boolean; docs?: RefDoc[]; error?: string }>;
  getDefaultDocs(): Promise<{ ok: boolean; docs?: RefDoc[]; error?: string }>;
  removeDefaultDoc(): Promise<{ ok: boolean }>;
  openAdoLink(url: string): Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window { api: Api; }
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const els = {
  adoDot: $('ado-dot'), adoText: $('ado-text'), account: $('account'),
  signin: $('btn-signin') as HTMLButtonElement, signout: $('btn-signout') as HTMLButtonElement,
  bugId: $('bug-id'), bugTitle: $('bug-title'), bugMeta: $('bug-meta'),
  screenDot: $('screen-dot'), screenText: $('screen-text'),
  focusForm: $('focus-form') as HTMLFormElement, focusInput: $('inp-focus') as HTMLInputElement,
  meeting: $('btn-meeting') as HTMLButtonElement, micDot: $('mic-dot'), micText: $('mic-text'),
  autonomy: $('sel-autonomy') as HTMLSelectElement, highrisk: $('chk-highrisk') as HTMLInputElement,
  watch: $('chk-screen') as HTMLInputElement, tag: $('inp-tag') as HTMLInputElement,
  adddoc: $('btn-adddoc') as HTMLButtonElement, ctxNotes: $('ctx-notes') as HTMLTextAreaElement, docList: $('doc-list'),
  feedEmpty: $('feed-empty'), feed: $('feed'), toast: $('toast')
};

let signedIn = false;
let meetingOn = false;
let currentBug: { id: number; title: string; state: string } | null = null;
let bugContext = '';
const transcript: TranscriptTurn[] = [];
const refDocs: RefDoc[] = [];
let refNotes = '';
let screenTimer: number | undefined;
const rejectedBugIds = new Set<number>(); // vision-misread/unreadable IDs we stop auto-retrying

function toast(message: string, isError = false): void {
  els.toast.textContent = message;
  els.toast.className = isError ? 'err' : '';
  els.toast.style.display = 'block';
  window.setTimeout(() => (els.toast.style.display = 'none'), isError ? 8000 : 3500);
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

type FeedKind = 'you' | 'agent' | 'speaker' | 'applied' | 'error' | 'system';

function addFeed(kind: FeedKind, text: string, who?: string): void {
  els.feedEmpty.style.display = 'none';
  const div = document.createElement('div');
  div.className = `entry ${kind}`;
  const time = new Date().toLocaleTimeString();
  const label = who ?? (kind === 'you' ? 'You' : kind === 'agent' ? 'Agent' : '');
  div.innerHTML = `<span class="ts">${time}</span><div class="body">${label ? `<span class="who">${esc(label)}:</span>` : ''}${esc(text)}</div>`;
  els.feed.appendChild(div);
  els.feed.scrollTop = els.feed.scrollHeight;
  (els.feed.parentElement as HTMLElement).scrollTop = (els.feed.parentElement as HTMLElement).scrollHeight;
}

function setMic(dot: 'on' | 'off' | 'busy', text: string): void {
  els.micDot.className = `dot ${dot}`;
  els.micText.textContent = text;
}
function setScreen(dot: 'on' | 'off' | 'busy', text: string): void {
  els.screenDot.className = `dot ${dot}`;
  els.screenText.textContent = text;
}

async function refreshStatus(): Promise<void> {
  const s = await window.api.status();
  signedIn = s.signedIn;
  if (s.signedIn && s.account) {
    els.account.innerHTML = `Signed in as <b>${esc(s.account.name || s.account.username)}</b>`;
    els.signin.style.display = 'none';
    els.signout.style.display = 'inline-block';
    els.adoDot.className = 'dot on';
    els.adoText.textContent = `Connected · ${esc(s.org.replace('https://dev.azure.com/', ''))} / ${esc(s.project)}`;
    els.meeting.disabled = false;
  } else {
    els.account.textContent = 'Not signed in';
    els.signin.style.display = 'inline-block';
    els.signout.style.display = 'none';
    els.adoDot.className = 'dot off';
    els.adoText.textContent = 'Not connected';
    els.meeting.disabled = true;
  }
}

async function onSignIn(): Promise<void> {
  els.signin.disabled = true;
  els.adoDot.className = 'dot busy';
  els.adoText.textContent = 'Opening Microsoft sign-in…';
  try {
    const r = await window.api.signIn();
    if (!r.ok) {
      toast(`Sign-in failed: ${r.error}`, true);
      els.adoDot.className = 'dot off';
      els.adoText.textContent = 'Not connected';
      return;
    }
    await refreshStatus();
    await window.api.setTag(els.tag.value);
    addFeed('system', 'Signed in. Discovering ADO field schema…');
    const d = await window.api.discoverSchema();
    if (d.ok) addFeed('system', `Schema ready: ${d.discovered}/${d.total} fields mapped.`);
  } finally {
    els.signin.disabled = false;
  }
}

async function onSignOut(): Promise<void> {
  if (meetingOn) stopMeeting();
  await window.api.signOut();
  await refreshStatus();
}

function renderBug(): void {
  if (!currentBug) {
    els.bugId.textContent = '—';
    els.bugTitle.textContent = 'No bug detected';
    els.bugMeta.textContent = meetingOn ? 'Watching the screen…' : 'Start the meeting and open a work item on screen.';
    return;
  }
  els.bugId.textContent = `#${currentBug.id}`;
  els.bugTitle.textContent = currentBug.title;
  els.bugMeta.textContent = currentBug.state ? `State: ${currentBug.state} · tracking live` : 'tracking live';
}

async function setCurrentBug(id: number, force = false, silent = false): Promise<boolean> {
  if (!force && currentBug?.id === id) return true;
  // Verify the work item actually loads before committing, so a misread/unreadable ID never sticks.
  const r = await window.api.getIntelligence(id, true);
  if (!r.ok || r.result?.status !== 'found') {
    const message = r.result?.status === 'error' ? r.result.error : r.error ?? 'Work item not found';
    if (!silent) addFeed('error', `Could not load bug #${id}: ${message}`);
    return false;
  }
  currentBug = { id, title: r.result.data.item.title, state: r.result.data.item.state };
  bugContext = buildBugContext(r.result.data.item, r.result.data.comments);
  renderBug();
  addFeed('system', `Now tracking bug #${id}`);
  updateContext(currentInstructions());
  respond(); // proactively introduce the new bug like a teammate
  return true;
}

function buildBugContext(item: Snapshot, comments: CommentRow[] = []): string {
  const repro = String(item.fields['Microsoft.VSTS.TCM.ReproSteps'] ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tags = String(item.fields['System.Tags'] ?? '');
  const parts: string[] = [];
  if (repro) parts.push(`Repro/summary: ${repro.slice(0, 400)}`);
  if (tags) parts.push(`Tags: ${tags}`);
  if (comments.length) {
    const thread = comments.slice(0, 6).map((x) => `- ${x.author || 'Unknown'}: ${x.text.slice(0, 220)}`).join('\n');
    parts.push(`Discussion thread (newest first, ${comments.length} total):\n${thread}`);
  }
  return parts.join('\n');
}

// ---- meeting ----

async function onToggleMeeting(): Promise<void> {
  if (meetingOn) {
    stopMeeting();
    return;
  }
  await startMeeting();
}

async function startMeeting(): Promise<void> {
  meetingOn = true;
  rejectedBugIds.clear();
  els.meeting.textContent = '⏹ Stop meeting';
  els.meeting.className = 'bigbtn danger';
  addFeed('system', 'Meeting started. Listening…');
  setMic('busy', 'Connecting…');
  try {
    await startVoice(
      {
        onUserText: (t) => onUserText(t),
        onAgentText: () => {},
        onStatus: (st, d) => {
          if (st === 'live') setMic('on', d || 'Listening');
          else if (st === 'off') setMic('off', d ? `Voice: ${d}` : 'Voice off');
          else setMic('busy', 'Connecting…');
        },
        onToolCall: (name, args) => onToolCall(name, args)
      },
      currentInstructions(),
      TOOLS
    );
  } catch (e) {
    addFeed('error', `Voice failed: ${e instanceof Error ? e.message : String(e)}`);
    setMic('off', 'Voice off');
  }

  if (els.watch.checked) {
    setScreen('busy', 'Screen: starting…');
    try {
      const ok = await startScreen();
      if (ok) {
        setScreen('on', 'Screen: watching');
        screenTimer = window.setInterval(() => void screenTick(), 8000);
        window.setTimeout(() => void screenTick(), 2500);
      } else {
        setScreen('off', 'Screen: no source');
      }
    } catch (e) {
      setScreen('off', 'Screen: denied');
      addFeed('error', `Screen capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  renderBug();
}

function stopMeeting(): void {
  meetingOn = false;
  els.meeting.textContent = '▶ Start meeting';
  els.meeting.className = 'bigbtn';
  stopVoice();
  stopScreen();
  if (screenTimer) window.clearInterval(screenTimer);
  setMic('off', 'Voice off');
  setScreen('off', 'Screen: off');
  addFeed('system', 'Meeting stopped.');
}

async function screenTick(): Promise<void> {
  if (!meetingOn) return;
  const frame = captureFrame();
  if (!frame) return;
  const hint =
    'Read the work item ID exactly from the browser URL (.../_workitems/edit/<id>) or the "BUG <id>" header. ' +
    'Report every digit precisely; if you cannot read the whole ID with full confidence, report null instead of guessing.' +
    (currentBug ? ` You were previously tracking #${currentBug.id}; switch only if a different item is clearly in focus.` : '');
  const r = await window.api.visionAnalyze(frame, hint);
  const detected = r.ok ? r.workItemId ?? null : null;
  if (detected && detected !== currentBug?.id && !rejectedBugIds.has(detected)) {
    const ok = await setCurrentBug(detected, false, true);
    if (!ok) rejectedBugIds.add(detected); // stop re-triggering on a misread/unreadable ID
  }
}

function onUserText(text: string): void {
  if (!text.trim()) return;
  const turn = { turnId: `t${transcript.length}`, speaker: 'You', text, ts: Date.now() };
  transcript.push(turn);
  // A spoken bug reference can also switch the tracked item.
  const m = /\b(?:bug|item|number|open|next(?:\s+is)?)\s*#?\s*(\d{5,7})\b/i.exec(text);
  if (m) void setCurrentBug(Number(m[1]));
}

// Realtime tools retrieve evidence on demand. Write tools produce a reviewable
// proposal by default; deterministic code executes only after approval.
const TOOLS = [
  { type: 'function', name: 'read_thread', description: 'Read the latest discussion/comment thread on the live ADO bug. Call this whenever asked what is on the thread, for the latest comments, or before commenting so you have context.', parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'get_work_item_intelligence', description: 'Retrieve a work item with comments, revision history, attachments, and linked pull requests. Omit id to inspect the current work item without changing meeting focus.', parameters: { type: 'object', properties: { id: { type: 'number', description: 'ADO work item ID; omit for the current item.' } } } },
  { type: 'function', name: 'search_related_bugs', description: 'Search and rank genuinely related ADO work items using title, symptoms, repro, tags, component, platform, and release signals.', parameters: { type: 'object', properties: { platform: { type: 'string' }, release: { type: 'string' }, limit: { type: 'number' } } } },
  { type: 'function', name: 'search_partner_cases', description: 'Search verified partner case context for the current work item. The tool will explicitly say when no connector is configured.', parameters: { type: 'object', properties: { partner: { type: 'string', description: 'For example PartnerCo.' } } } },
  { type: 'function', name: 'draft_partner_case', description: 'Generate a partner case payload from the current ADO item. This creates a draft only unless a real partner connector is configured.', parameters: { type: 'object', properties: { partner: { type: 'string' } }, required: ['partner'] } },
  { type: 'function', name: 'read_document', description: 'Read the text of an attached reference document (datasheet, spec, doc) so you can use specific details from it — e.g. before adding a comment based on the document. Pass a name to pick one, or omit to get all attached documents.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Name or part of the document name to read; optional.' } } } },
  { type: 'function', name: 'append_investigation_status', description: 'Propose appending a concise, dated engineering status note to the current ADO bug.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'The status note to append.' } }, required: ['text'] } },
  { type: 'function', name: 'add_internal_comment', description: 'Propose posting an internal discussion comment on the current ADO bug.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { type: 'function', name: 'set_milestone', description: 'Propose setting the release/milestone on the current ADO bug.', parameters: { type: 'object', properties: { product: { type: 'string', description: 'e.g. PROGRAM_A or PROGRAM_B' }, milestone: { type: 'string', description: 'e.g. VR, CC, QCC' } }, required: ['product', 'milestone'] } },
  { type: 'function', name: 'set_area_path', description: 'Propose changing the current ADO work item Area Path.', parameters: { type: 'object', properties: { area_path: { type: 'string' } }, required: ['area_path'] } },
  { type: 'function', name: 'assign_owner', description: 'Propose changing Assigned To on the current ADO work item.', parameters: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'] } },
  { type: 'function', name: 'set_sub_status', description: 'Propose changing the triage sub-status of the current ADO bug.', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { type: 'function', name: 'set_state', description: 'Propose changing workflow state. Always requires review unless the user explicitly enabled high-risk auto-apply.', parameters: { type: 'object', properties: { state: { type: 'string' }, reason: { type: 'string' } }, required: ['state'] } },
  { type: 'function', name: 'mark_duplicate', description: 'Propose marking the current bug as a duplicate and resolving it. High-impact.', parameters: { type: 'object', properties: { of_id: { type: 'number' } }, required: ['of_id'] } },
  { type: 'function', name: 'record_action_item', description: 'Record an owner and task discussed in the meeting (meeting note only, no ADO change).', parameters: { type: 'object', properties: { owner: { type: 'string' }, task: { type: 'string' } }, required: ['owner', 'task'] } }
];

async function onToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'read_document') {
    if (!refDocs.length) return 'No reference documents are attached yet — add one with "+ Add document" or paste the text into the context box.';
    const q = String(args.name ?? '').trim().toLowerCase();
    const readable = refDocs.filter((d) => d.text.trim());
    const matches = q ? readable.filter((d) => d.name.toLowerCase().includes(q)) : readable;
    if (!matches.length) {
      const names = refDocs.map((d) => d.name).join(', ') || 'none';
      return q ? `No attached document matches "${String(args.name)}". Attached: ${names}.` : `No readable document text is attached (${names}).`;
    }
    addFeed('system', `Referenced ${matches.length > 1 ? 'documents' : 'document'}: ${matches.map((d) => d.name).join(', ')}`);
    const CAP = 20000;
    return matches
      .map((d) => `# ${d.name}\n${d.text.slice(0, CAP)}${d.text.length > CAP ? '\n…[truncated]' : ''}`)
      .join('\n\n———\n\n');
  }

  if (!currentBug) return "I don't have a work item in focus yet — open the bug on screen or tell me its number and I'll update it right away.";
  const id = currentBug.id;

  if (name === 'record_action_item') {
    const item = `${String(args.owner ?? '')} — ${String(args.task ?? '')}`;
    addFeed('system', `Action item: ${item}`);
    return `Recorded an action item for ${String(args.owner ?? 'the owner')}.`;
  }

  if (name === 'get_work_item_intelligence') {
    const targetId = Number(args.id ?? id);
    const result = await window.api.getIntelligence(targetId, false);
    if (!result.ok || !result.result) return `I couldn't inspect bug ${targetId}: ${result.error ?? 'unknown error'}.`;
    if (result.result.status === 'error') return `I couldn't inspect bug ${targetId} because Azure DevOps returned: ${result.result.error}`;
    if (result.result.status === 'empty') return result.result.message;
    const data = result.result.data;
    const prs = data.pullRequests.length
      ? data.pullRequests.map((pr) => {
          const reviewers = pr.reviewers.map((reviewer) => `${reviewer.name} (vote ${reviewer.vote})`).join(', ') || 'none listed';
          return `PR #${pr.id} "${pr.title}" is ${pr.status}; ${pr.commitCount} commit(s), ${pr.changedFileCount} changed file(s), ${pr.commentCount} review comment(s); ${pr.sourceBranch} -> ${pr.targetBranch}; author ${pr.author || 'unknown'}; reviewers: ${reviewers}.`;
        }).join('\n')
      : 'No linked pull request was found.';
    const builds = data.builds.length
      ? data.builds.map((build) => `Build ${build.buildNumber} (${build.definition || 'pipeline'}) is ${build.status || 'unknown'} with result ${build.result || 'not available'}${build.finishedAt ? `, finished ${build.finishedAt}` : ''}.`).join('\n')
      : 'No linked validation build was found.';
    const warnings = data.warnings.length ? `\nRetrieval warnings:\n${data.warnings.join('\n')}` : '';
    const comments = data.comments.slice(0, 5).map((comment) => `${comment.author || 'Unknown'}: ${comment.text}`).join('\n') || 'No comments found.';
    addFeed('system', `Inspected #${targetId}: ${data.history.length} revisions, ${data.pullRequests.length} linked PRs, ${data.attachments.length} attachments.`);
    return `ADO evidence for #${targetId} "${data.item.title}" (${data.item.state}):\n${prs}\n${builds}\nRecent discussion:\n${comments}\nRevision/update count: ${data.history.length}.${warnings}`;
  }

  if (name === 'search_related_bugs') {
    const result = await window.api.searchRelated(id, {
      ...(args.platform ? { platform: String(args.platform) } : {}),
      ...(args.release ? { release: String(args.release) } : {}),
      ...(args.limit ? { limit: Number(args.limit) } : {})
    });
    if (!result.ok || !result.result) return `I couldn't search Azure DevOps: ${result.error ?? 'unknown error'}.`;
    if (result.result.status === 'error') return `The related-bug search failed because Azure DevOps returned: ${result.result.error}`;
    if (result.result.status === 'empty') return result.result.message;
    const items = result.result.data;
    addFeed('system', `Found ${items.length} related work item${items.length === 1 ? '' : 's'} from ADO evidence.`);
    return items.map((item, index) => `${index + 1}. #${item.id} "${item.title}" — ${item.state}. ${item.reasons.join('; ')}.`).join('\n');
  }

  if (name === 'search_partner_cases') {
    const partner = String(args.partner ?? 'partner');
    const result = await window.api.searchPartnerCases(id, partner);
    if (!result.ok || !result.result) return `I couldn't search partner context: ${result.error ?? 'unknown error'}.`;
    if (result.result.status === 'error') return `The partner search failed: ${result.result.error}`;
    if (result.result.status === 'empty') return result.result.message;
    return JSON.stringify(result.result.data);
  }

  if (name === 'draft_partner_case') {
    const partner = String(args.partner ?? 'partner');
    const result = await window.api.draftPartnerCase(id, partner);
    if (!result.ok || !result.result) return `I couldn't prepare the partner case draft: ${result.error ?? 'unknown error'}.`;
    if (result.result.status === 'error') return `The partner draft failed: ${result.result.error}`;
    if (result.result.status === 'empty') return result.result.message;
    addFeed('system', `${partner} case payload drafted. No external case was created because no partner connector is configured.`);
    return `${String(result.result.data.notice ?? 'Draft only.')}\nDraft payload: ${JSON.stringify(result.result.data)}`;
  }

  if (name === 'read_thread') {
    const c = await window.api.getComments(id);
    if (!c.ok) return `I couldn't load the thread: ${c.error ?? 'unknown error'}.`;
    const comments = c.comments ?? [];
    addFeed('system', `Read discussion thread (${comments.length} comment${comments.length === 1 ? '' : 's'}).`);
    if (!comments.length) return 'The discussion thread on this bug is empty.';
    const lines = comments.slice(0, 12).map((x) => `${x.author || 'Unknown'}: ${x.text}`);
    return `Discussion thread on bug ${id} (newest first):\n${lines.join('\n')}`;
  }

  let action: Action | null = null;
  switch (name) {
    case 'append_investigation_status': action = { action: 'append_investigation_status', workItemId: id, text: String(args.text ?? ''), evidence: [], confidence: 1 }; break;
    case 'add_internal_comment': action = { action: 'add_internal_comment', workItemId: id, text: String(args.text ?? ''), evidence: [], confidence: 1 }; break;
    case 'set_milestone': action = { action: 'update_milestone', workItemId: id, product: String(args.product ?? ''), to: String(args.milestone ?? ''), evidence: [], confidence: 1 }; break;
    case 'set_area_path': action = { action: 'update_fields', workItemId: id, changes: { 'System.AreaPath': String(args.area_path ?? '') }, evidence: [], confidence: 1 }; break;
    case 'assign_owner': action = { action: 'update_owner', workItemId: id, owner: String(args.owner ?? ''), evidence: [], confidence: 1 }; break;
    case 'set_sub_status': action = { action: 'update_sub_status', workItemId: id, subStatus: String(args.value ?? ''), evidence: [], confidence: 1 }; break;
    case 'set_state': action = { action: 'update_state', workItemId: id, state: String(args.state ?? ''), ...(args.reason ? { reason: String(args.reason) } : {}), evidence: [], confidence: 1 }; break;
    case 'mark_duplicate': action = { action: 'mark_duplicate', workItemId: id, duplicateOfId: Number(args.of_id), resolve: true, evidence: [], confidence: 1 }; break;
    default: return `Unknown tool: ${name}.`;
  }
  return queueAction(action, id, name);
}

function actionSummary(action: Action): string {
  switch (action.action) {
    case 'add_internal_comment': return `Add comment: ${String(action.text ?? '')}`;
    case 'append_investigation_status': return `Append investigation: ${String(action.text ?? '')}`;
    case 'update_milestone': return `Set milestone to ${String(action.to ?? '')}`;
    case 'update_owner': return `Assign to ${String(action.owner ?? '')}`;
    case 'update_sub_status': return `Set sub-status to ${String(action.subStatus ?? '')}`;
    case 'update_state': return `Set state to ${String(action.state ?? '')}${action.reason ? ` (${String(action.reason)})` : ''}`;
    case 'mark_duplicate': return `Mark duplicate of #${String(action.duplicateOfId ?? '')} and resolve`;
    case 'update_fields': return `Update ${Object.entries(action.changes as Record<string, unknown>).map(([key, value]) => `${key} -> ${String(value)}`).join(', ')}`;
    default: return action.action;
  }
}

async function executeAction(action: Action, workItemId: number, card?: HTMLElement): Promise<string> {
  const r = await window.api.execute(action, workItemId);
  if (r.ok && r.result?.ok) {
    const summary = `${r.result.summary}${r.result.revisionAfter ? ` (rev ${r.result.revisionAfter})` : ''}`;
    addFeed('applied', `✓ ${summary} — tagged "${els.tag.value}"`);
    card?.remove();
    void setCurrentBugRefresh(workItemId);
    return `Applied: ${summary} on bug ${workItemId}.`;
  }
  const error = r.result?.error || r.error || 'failed';
  addFeed('error', `Failed: ${action.action} — ${error}`);
  return `That update failed: ${error}.`;
}

async function queueAction(action: Action, workItemId: number, toolName: string): Promise<string> {
  const highRisk = toolName === 'set_state' || toolName === 'mark_duplicate';
  const autoApply = els.autonomy.value === 'auto' && (!highRisk || els.highrisk.checked);
  if (autoApply) return executeAction(action, workItemId);

  els.feedEmpty.style.display = 'none';
  const card = document.createElement('div');
  card.className = 'entry suggest';
  card.innerHTML = `<div class="body"><b>Proposed ADO change</b><span class="risk ${highRisk ? 'high' : 'medium'}">${highRisk ? 'high' : 'medium'} risk</span><div>${esc(actionSummary(action))}</div><textarea>${esc(JSON.stringify(action, null, 2))}</textarea><div class="pbtns"><button class="apply">Confirm</button><button class="secondary edit">Edit</button><button class="secondary cancel">Cancel</button></div></div>`;
  els.feed.appendChild(card);
  const textarea = card.querySelector('textarea') as HTMLTextAreaElement;
  const buttons = card.querySelectorAll<HTMLButtonElement>('button');
  buttons[0].addEventListener('click', () => {
    let edited: Action;
    try {
      edited = JSON.parse(textarea.value) as Action;
    } catch {
      toast('The edited action is not valid JSON.', true);
      return;
    }
    buttons.forEach((button) => (button.disabled = true));
    void executeAction(edited, workItemId, card);
  });
  buttons[1].addEventListener('click', () => {
    textarea.style.display = textarea.style.display === 'block' ? 'none' : 'block';
    if (textarea.style.display === 'block') textarea.focus();
  });
  buttons[2].addEventListener('click', () => {
    card.remove();
  });
  els.feed.scrollTop = els.feed.scrollHeight;
  return `Prepared a ${highRisk ? 'high-risk ' : ''}change for bug ${workItemId}. It is waiting for confirmation in Sidekick.`;
}

async function setCurrentBugRefresh(id: number): Promise<void> {
  const r = await window.api.getIntelligence(id, true);
  if (r.ok && r.result?.status === 'found' && currentBug?.id === id) {
    currentBug = { id, title: r.result.data.item.title, state: r.result.data.item.state };
    bugContext = buildBugContext(r.result.data.item, r.result.data.comments);
    renderBug();
    syncContext();
  }
}

// ---- meeting context / reference documents ----

function syncContext(): void {
  updateContext(currentInstructions()); // no-op unless voice is live
}

function meetingContext(): string {
  const parts: string[] = [];
  const notes = refNotes.trim();
  if (notes) parts.push(`User notes:\n${notes}`);
  for (const d of refDocs) {
    if (d.text.trim()) parts.push(`Document "${d.name}":\n${d.text.trim()}`);
  }
  const joined = parts.join('\n\n———\n\n');
  const CAP = 16000;
  return joined.length > CAP ? `${joined.slice(0, CAP)}\n…[reference material truncated]` : joined;
}

function renderDocs(): void {
  els.docList.innerHTML = refDocs
    .map((d, i) => {
      const meta = d.error ? esc(d.error) : `${d.chars.toLocaleString()} chars${d.default ? ' · default' : ''}`;
      return `<div class="doc${d.error ? ' err' : ''}"><span class="dname">${esc(d.name)}</span><span class="dmeta">${meta}</span><button class="drm" data-i="${i}">Remove</button></div>`;
    })
    .join('');
  els.docList.querySelectorAll<HTMLButtonElement>('button.drm').forEach((b) =>
    b.addEventListener('click', () => {
      const [removed] = refDocs.splice(Number(b.dataset.i), 1);
      if (removed?.default) void window.api.removeDefaultDoc(); // stays removed across restarts
      renderDocs();
      syncContext();
    })
  );
}

// Attaches the bundled project-overview document by default (unless the user removed it).
async function loadDefaultDocs(): Promise<void> {
  const r = await window.api.getDefaultDocs();
  if (!r.ok || !r.docs?.length) return;
  let added = false;
  for (const d of r.docs) {
    if (refDocs.some((x) => x.name === d.name)) continue;
    refDocs.push(d);
    if (!d.error) addFeed('system', `Attached by default: ${d.name} (${d.chars.toLocaleString()} chars)`);
    added = true;
  }
  if (added) {
    renderDocs();
    syncContext();
  }
}

async function onAddDoc(): Promise<void> {
  els.adddoc.disabled = true;
  try {
    const r = await window.api.pickDocs();
    if (!r.ok) {
      toast(r.error || 'Could not open files', true);
      return;
    }
    for (const d of r.docs ?? []) {
      refDocs.push(d);
      if (d.error) addFeed('error', `Couldn't read ${d.name}: ${d.error}`);
      else addFeed('system', `Added document: ${d.name} (${d.chars.toLocaleString()} chars)`);
    }
    renderDocs();
    syncContext();
  } finally {
    els.adddoc.disabled = false;
  }
}

function onNotesChange(): void {
  refNotes = els.ctxNotes.value;
  syncContext();
}

function currentInstructions(): string {
  const base =
    'You are Project Sidekick, an engineering teammate in a live triage meeting. Azure DevOps tools run with ' +
    "the signed-in user's permissions. Treat tool output as the only source of truth for project data: never " +
    'invent work items, pull requests, builds, people, partner cases, status, or history. Dynamically call ' +
    'get_work_item_intelligence, search_related_bugs, read_thread, and partner tools when the question requires ' +
    'evidence; do not imply that cached prompt context is exhaustive. Clearly distinguish no matching result ' +
    'from a failed Azure DevOps request. Resolve follow-up phrases such as "that one" and "our current bug" ' +
    'from the current work item and recent tool results. Compare evidence, explain why a related issue is relevant, ' +
    'identify contradictions or missing validation, and suggest a useful next check without interrupting for minor ' +
    'details. For any requested ADO change, call every matching write tool; the UI will present a preview and ' +
    'confirmation unless the user enabled auto-apply. Never claim a queued action succeeded. Only report success ' +
    'after the tool returns an Applied result. Partner case tools are draft-only unless their result explicitly ' +
    'confirms creation. Keep spoken responses concise and conversational.';
  const ctx = meetingContext();
  const refBlock = ctx
    ? `\n\nReference material the user attached for this meeting — treat it as authoritative and use it to answer questions and inform ADO updates; cite the document name when you rely on it:\n${ctx}`
    : '';
  if (currentBug) {
    return (
      `${base}\n\nCurrent work item: bug #${currentBug.id} "${currentBug.title}"` +
      `${currentBug.state ? ` (state: ${currentBug.state})` : ''}.` +
      `${bugContext ? `\nContext: ${bugContext}` : ''}` +
      refBlock
    );
  }
  return `${base}\n\nNo work item is in focus yet. Ask for an ID before making work-item-specific claims or changes.${refBlock}`;
}

async function onFocusBug(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const id = Number(els.focusInput.value.replace(/[^0-9]/g, ''));
  if (!id) {
    toast('Enter a work item ID to focus.', true);
    return;
  }
  els.focusInput.value = '';
  await setCurrentBug(id, true);
}

els.signin.addEventListener('click', () => void onSignIn());
els.signout.addEventListener('click', () => void onSignOut());
els.meeting.addEventListener('click', () => void onToggleMeeting());
els.tag.addEventListener('change', () => void window.api.setTag(els.tag.value));
els.adddoc.addEventListener('click', () => void onAddDoc());
els.ctxNotes.addEventListener('change', () => onNotesChange());
els.focusForm.addEventListener('submit', (event) => void onFocusBug(event));

void refreshStatus();
renderBug();
renderDocs();
void loadDefaultDocs();

export {};
