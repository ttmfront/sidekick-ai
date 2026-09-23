// Generates a complete, text-extractable project overview PDF for the Agent Triager
// app. The output is meant to be attached as meeting context so the in-app agent can
// answer questions about how the project works. Run: node scripts/generate-project-pdf.cjs
const PDFDocument = require('pdfkit');
const { createWriteStream, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const OUT_DIR = join(__dirname, '..', 'docs');
const OUT_FILE = join(OUT_DIR, 'Agent-Triager-Project-Overview.pdf');
mkdirSync(OUT_DIR, { recursive: true });

const BLUE = '#0078D4';
const DARK = '#201f1e';
const MUTED = '#605e5c';
const RULE = '#d2d0ce';
const CODE_BG = '#f3f2f1';

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 60, bottom: 64, left: 60, right: 60 },
  bufferPages: true,
  info: {
    Title: 'Agent Triager - Project Overview',
    Author: 'Microsoft Surface - Sidekick',
    Subject: 'Full technical and functional overview of the Agent Triager project',
    Keywords: 'Azure DevOps, triage, realtime agent, Electron, Surface, ADO, meeting copilot'
  }
});
doc.pipe(createWriteStream(OUT_FILE));

const PAGE_W = doc.page.width;
const CONTENT_W = PAGE_W - doc.page.margins.left - doc.page.margins.right;
const BOTTOM = doc.page.height - doc.page.margins.bottom;

function ensure(space) {
  if (doc.y + space > BOTTOM) doc.addPage();
}
function h1(text) {
  doc.addPage();
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(19).text(text, { paragraphGap: 6 });
  doc.moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(PAGE_W - doc.page.margins.right, doc.y + 2)
    .strokeColor(BLUE).lineWidth(1.5).stroke();
  doc.moveDown(0.8);
}
function h2(text) {
  ensure(70);
  doc.moveDown(0.5);
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(13.5).text(text, { paragraphGap: 4 });
  doc.moveDown(0.2);
}
function h3(text) {
  ensure(56);
  doc.moveDown(0.3);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11.5).text(text, { paragraphGap: 3 });
}
function p(text) {
  ensure(40);
  doc.fillColor(DARK).font('Helvetica').fontSize(10.5).text(text, { align: 'left', paragraphGap: 6, lineGap: 1.5 });
}
function li(text) {
  ensure(30);
  doc.fillColor(DARK).font('Helvetica').fontSize(10.5);
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.fillColor(BLUE).text('\u2022', x + 6, y, { continued: false, lineBreak: false });
  doc.fillColor(DARK).text(text, x + 20, y, { width: CONTENT_W - 20, paragraphGap: 4, lineGap: 1 });
}
function kv(key, val) {
  ensure(26);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK).text(`${key}:  `, { continued: true });
  doc.font('Helvetica').fillColor(MUTED).text(val, { paragraphGap: 3 });
}
function code(text) {
  ensure(28);
  const pad = 7;
  const h = doc.heightOfString(text, { width: CONTENT_W - pad * 2, lineGap: 1 }) + pad * 2;
  ensure(h + 4);
  const x = doc.page.margins.left;
  const y = doc.y;
  doc.roundedRect(x, y, CONTENT_W, h, 4).fill(CODE_BG);
  doc.fillColor('#1b3a57').font('Courier').fontSize(9.5).text(text, x + pad, y + pad, { width: CONTENT_W - pad * 2, lineGap: 1 });
  doc.y = y + h + 6;
  doc.x = doc.page.margins.left;
}
function spacer(n = 0.5) {
  doc.moveDown(n);
}

// ---------- Title page ----------
doc.rect(0, 0, PAGE_W, 200).fill(BLUE);
// Microsoft four-square mark
const lx = 60, ly = 60, s = 15, g = 3;
doc.rect(lx, ly, s, s).fill('#F25022');
doc.rect(lx + s + g, ly, s, s).fill('#7FBA00');
doc.rect(lx, ly + s + g, s, s).fill('#00A4EF');
doc.rect(lx + s + g, ly + s + g, s, s).fill('#FFB900');
doc.fillColor('#ffffff').font('Helvetica').fontSize(13).text('Microsoft Surface', lx + 2 * s + 3 * g + 8, ly + 3);
doc.fillColor('#dbeafe').fontSize(10).text('AI Triage Agent', lx + 2 * s + 3 * g + 8, ly + 20);

doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(30).text('Agent Triager', 60, 120);
doc.font('Helvetica').fontSize(13).fillColor('#eaf3fb').text('Project Overview & Working Reference', 60, 158);

doc.y = 230;
doc.x = 60;
doc.fillColor(DARK).font('Helvetica').fontSize(11).text(
  'An AI Program Manager that co-hosts live Azure DevOps bug-triage meetings: it listens to the call, watches the screen to know which work item is open, participates by voice, and updates the ADO bug directly - while using attached reference documents (specs, datasheets) as context.',
  { lineGap: 2 }
);
spacer(1);
doc.fillColor(MUTED).fontSize(9.5).font('Helvetica')
  .text(`Generated ${new Date().toISOString().slice(0, 10)} - This document is designed to be attached as meeting context so the agent can answer questions about itself.`);

spacer(1.2);
doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(12).text('Contents');
doc.moveDown(0.3);
[
  '1.  What it is', '2.  Key capabilities', '3.  Architecture at a glance', '4.  Repository layout',
  '5.  Desktop app internals', '6.  Shared packages', '7.  End-to-end flows', '8.  Agent tools reference',
  '9.  Meeting context & documents', '10. Audio: hearing the whole call', '11. Screen & vision',
  '12. Safety, governance & security', '13. Azure deployment & infrastructure', '14. Technology stack',
  '15. Program configuration (PROGRAM_A)', '16. How to run & use', '17. FAQ', '18. Glossary'
].forEach((t) => {
  doc.fillColor(DARK).font('Helvetica').fontSize(10.5).text(t, { indent: 6, paragraphGap: 2 });
});

// ---------- 1. What it is ----------
h1('1. What it is');
p('Sidekick - Your AI Engineering Teammate is a Windows desktop application that acts as an AI Program Manager during live Azure DevOps (ADO) bug-triage meetings. It joins the conversation like a senior PM: it listens to every participant, keeps track of which bug is on screen, speaks up to move the discussion along, records decisions, and applies real updates to the ADO work item as the team settles them.');
p('The goal is to remove the manual overhead of triage - editing fields, changing state, writing investigation notes, adding comments, marking duplicates - so the team can focus on the engineering decisions while the agent does the bookkeeping accurately and with a full audit trail.');
h3('The one-line pitch');
p('A voice-driven, screen-aware AI teammate that reads and writes your Azure DevOps bugs live during triage, grounded in your own reference documents.');

// ---------- 2. Key capabilities ----------
h1('2. Key capabilities');
li('Realtime voice participation - joins the meeting over WebRTC to Azure OpenAI\'s realtime model, speaking and understanding naturally.');
li('Hears the whole call - captures the local microphone AND Windows system/loopback audio, so it understands remote participants too, not just the person at the machine.');
li('Screen awareness - periodically captures the screen and uses a vision model to detect which ADO work item is currently open, then tracks it automatically.');
li('Direct ADO reads - loads the work item, its fields, repro steps, tags, and the full comment/discussion thread.');
li('Direct ADO writes - changes state (with reason), assigns owners, sets milestone and sub-status, appends investigation status, posts comments, marks duplicates, and links related bugs.');
li('Document-grounded answers - the user attaches reference material (specs, datasheets, docs - including PDFs); the agent uses it to answer questions and to compose comments based on the document contents.');
li('Multi-step workflows - a single request like "resolve as cannot-repro and add a comment" is completed end to end.');
li('Safety and audit - every write is schema-validated, uses optimistic concurrency, is tagged for attribution, and is shown in an on-screen activity log.');

// ---------- 3. Architecture ----------
h1('3. Architecture at a glance');
p('The system is a TypeScript monorepo (npm workspaces) with three tiers: reusable domain packages, a deployed cloud backend, and the Electron desktop client.');
h3('Data & control flow (high level)');
code('Meeting room audio + screen\n        |\n        v\n[ Electron Desktop App ]\n   |            |            |\n   | mic +      | screen     | signed-in ADO token (Entra)\n   | loopback   | frames     |\n   v            v            v\nAzure OpenAI   Backend      Azure DevOps REST\n(realtime      /vision      (read + write work items)\n voice)        /session\n               (ephemeral\n                keys)');
p('The desktop app never holds long-lived cloud secrets: the realtime ephemeral key is minted by the backend and the SDP handshake is relayed through the Electron main process, while the ADO token is acquired by interactive Microsoft sign-in and stays in the main process.');

// ---------- 4. Repository layout ----------
h1('4. Repository layout');
kv('apps/desktop', 'The Electron app (main, preload, renderer). This is what the user runs.');
kv('apps/backend', 'Fastify service "agenttriager" deployed to Azure; mints realtime credentials and runs vision analysis.');
kv('packages/shared', 'Types, Zod action schemas, risk policy, and the tool catalogue shared everywhere.');
kv('packages/ado', 'The Azure DevOps REST adapter - the only component that talks to ADO - plus auth and schema discovery.');
kv('packages/knowledge', 'Program knowledge base: products, milestones, glossary, and partner mappings.');
kv('packages/triage-brain', 'Decision-settling reasoning and the action planner (with a mock provider for offline runs).');
kv('config/', 'Program configuration (PROGRAM_A), ADO field schema, and approval rules.');
kv('infra/', 'Azure Bicep templates for the backend, Azure OpenAI, Key Vault, and telemetry.');
kv('tests/', 'Simulated triage-meeting scenarios that exercise the decision logic.');

// ---------- 5. Desktop internals ----------
h1('5. Desktop app internals');
p('Electron splits the app into three isolated layers. Context isolation is on and Node integration is off in the renderer, so the UI can only reach the main process through a small, explicit bridge.');
h2('Main process (Node) - apps/desktop/src/main');
kv('index.ts', 'Creates the window, registers all IPC handlers, wires the ADO service, provides screen sources, relays vision and voice calls to the backend, supplies Windows system-audio loopback, and reads attached documents (including PDF text extraction).');
kv('auth.ts', 'Interactive Microsoft (Entra) sign-in using the Azure CLI public client id; the resulting ADO token stays in the main process and is exposed only as an access-token provider.');
kv('adoService.ts', 'Connects the ADO client, loads the configured query, fetches a work item and its comment thread, runs schema discovery, and executes validated actions.');
kv('executor.ts', 'The write engine. It converts a validated TriageAction into a real ADO write - fields, comments, investigation status, state, milestone, sub-status, duplicate, related links - re-reading the item first so every patch uses optimistic concurrency, and stamping an attribution tag.');
h2('Preload - apps/desktop/src/preload/index.ts');
p('A single contextBridge that exposes a typed "api" object (sign-in, status, get work item, get comments, discover schema, analyze, execute, voice connect, screen sources, vision analyze, set tag, pick documents). No Node APIs are handed to the page directly.');
h2('Renderer (browser) - apps/desktop/src/renderer');
kv('main.ts', 'The UI controller: sign-in, meeting start/stop, current-bug tracking, the meeting-context/documents panel, the activity log, and the mapping from spoken tool calls to ADO actions.');
kv('voice.ts', 'Realtime voice over WebRTC: microphone + system-audio capture and mixing, the peer connection, the data channel for events and tool calls, and audio playback.');
kv('screen.ts', 'The screen watcher: captures downscaled JPEG frames of the display for the vision model.');
kv('index.html', 'The single-page UI, styled in a light Microsoft Surface / Fluent theme.');

// ---------- 6. Shared packages ----------
h1('6. Shared packages');
h2('@triager/shared');
p('Defines the structured TriageAction types and their Zod schemas, so every action the agent proposes is validated by deterministic code before it can touch ADO. Also holds the risk policy (which actions are low/medium/high risk) and the catalogue of tools.');
h2('@triager/ado');
p('A typed Azure DevOps REST adapter. All writes go through JSON Patch; field updates support optimistic concurrency (a test on the revision number) so the app never blindly overwrites a work item that changed since it was read. Auth is pluggable: Personal Access Token for quick development, or Entra (Azure CLI identity / device-code app) for enterprise. It also discovers field reference names so custom-field writes are never guessed.');
h2('@triager/knowledge');
p('The program knowledge base: the products in scope, their milestones and aliases, a glossary of domain terms, and partner program mappings. This grounds the agent in the team\'s vocabulary.');
h2('@triager/triage-brain');
p('The reasoning layer that settles decisions from a transcript and plans concrete actions. A mock provider lets the pipeline run and be tested without a live model.');

// ---------- 7. Flows ----------
h1('7. End-to-end flows');
h3('A. Sign in & connect');
p('The user clicks "Sign in with Microsoft". An interactive Entra sign-in opens in the system browser; the returned token is used to connect the ADO client. The app then discovers the ADO field schema so it knows the reference names for custom fields.');
h3('B. Start the meeting');
p('Starting the meeting opens a realtime voice session. The desktop app asks the backend to mint an ephemeral realtime credential, relays the WebRTC SDP offer/answer through the main process, and begins streaming audio. The realtime key never reaches the renderer.');
h3('C. Track the current bug');
p('While the meeting runs, the screen watcher captures a frame every few seconds and sends it to the backend vision endpoint, which returns the work item id visible on screen. The app loads that bug (title, state, fields, repro, tags, and recent comments) and re-grounds the agent. A spoken bug number can also switch the tracked item.');
h3('D. Settle and apply');
p('As the team decides things, the agent calls its tools. Each tool call is mapped to a validated TriageAction and executed against ADO by the write engine. The result - success with the new revision, or a specific error - is shown in the Activity log and spoken back briefly.');
h3('E. Reference documents');
p('Attached documents are injected into the agent\'s context and can also be pulled on demand with the read_document tool. When asked to "refer to the datasheet and add a comment", the agent reads the document, extracts the relevant inputs, and posts a comment that cites the document by name.');

// ---------- 8. Tools ----------
h1('8. Agent tools reference');
p('These are the functions the realtime agent can call during a meeting. Reads are safe; writes apply immediately to the live ADO bug.');
kv('read_thread', 'Read the latest discussion/comment thread on the current bug.');
kv('read_document', 'Read the text of an attached reference document (optionally by name) to use specific details from it.');
kv('append_investigation_status', 'Append a concise, dated engineering status note (preserves history).');
kv('add_internal_comment', 'Post an internal discussion comment on the bug thread.');
kv('set_milestone', 'Set the release/milestone for a product (e.g. VR, CC, QCC).');
kv('set_sub_status', 'Set the triage sub-status (e.g. Investigating, Waiting on partner).');
kv('set_state', 'Change the workflow state (e.g. Active, Resolved) with the matching reason such as "Cannot Reproduce". High-impact.');
kv('mark_duplicate', 'Mark the bug as a duplicate of another work item and resolve it. High-impact.');
kv('record_action_item', 'Record an owner and task discussed in the meeting (a note only, no ADO change).');

// ---------- 9. Documents ----------
h1('9. Meeting context & documents');
p('The left panel of the app is for context. The user can paste free-form notes (specs, decisions, links) and/or attach files with "+ Add document". Text-based files (.txt, .md, .csv, .json, .xml, .yaml, .html, and more) are read directly, and PDF datasheets are parsed for their text. Office binaries (.docx, .xlsx) are not parsed - their text should be pasted instead - and scanned/image-only PDFs (no selectable text) are flagged.');
p('All of this material is folded into the agent\'s live instructions (capped for size) and refreshed whenever it changes, so the agent can answer questions about it and let it inform ADO updates. Attaching this very document is what lets the agent explain how the project works.');

// ---------- 10. Audio ----------
h1('10. Audio: hearing the whole call');
p('A microphone alone only captures the person at the machine. To understand everyone on a call, the app also captures Windows system (loopback) audio - everything playing through the speakers, i.e. the remote participants. The main process supplies a loopback source, and the renderer mixes the microphone and system audio into a single stream with the Web Audio API before sending it to the realtime model.');
p('If loopback is unavailable (non-Windows, or blocked), it falls back to microphone-only. The microphone status shows "Listening - you + call" when call audio is captured, or "Listening - mic only" otherwise.');

// ---------- 11. Screen & vision ----------
h1('11. Screen & vision');
p('The screen watcher captures a downscaled JPEG of the primary display using Electron\'s desktop capturer. Every few seconds a frame is sent to the backend vision endpoint, which returns the ADO work-item id on screen (and a short description). The app uses that to keep the "current bug" in sync with what the team is actually looking at, so the agent always acts on the right item.');

// ---------- 12. Safety ----------
h1('12. Safety, governance & security');
li('Schema validation - every action is parsed by a Zod schema before execution; invalid actions are rejected.');
li('Optimistic concurrency - the item is re-read and the write includes a revision test, so concurrent edits are never clobbered.');
li('Attribution tag - every write adds a configurable tag (default "added by electron") so agent changes are identifiable.');
li('High-risk gating - state changes and duplicate-resolution are treated as high-impact and controlled by the "Auto high-risk" toggle.');
li('Audit trail - all applied actions, reads, and errors appear in the on-screen Activity log with timestamps and revision numbers.');
li('Secret handling - the ADO token stays in the main process; the realtime ephemeral key is minted server-side and never reaches the renderer; SDP is relayed through main.');
li('Least exposure in the UI - context isolation on, Node integration off; the renderer only sees a small typed bridge.');

// ---------- 13. Azure ----------
h1('13. Azure deployment & infrastructure');
p('The backend and models run in Azure, authored as Bicep under infra/.');
kv('App Service (Node 20)', '"agenttriager" (East US) - hosts the Fastify backend: /health, /session (mints realtime ephemeral credentials), /vision/analyze, and /triage/plan.');
kv('Azure OpenAI (East US 2)', 'realtime model gpt-realtime for voice, and a reasoning model (gpt-4o) for planning/vision. East US 2 is used because realtime models are offered there.');
kv('Key Vault', 'Holds secrets; the web app\'s managed identity is granted access.');
kv('App Insights + Log Analytics', 'Telemetry and diagnostics.');
p('The desktop client points at the deployed backend for realtime session minting and vision, and talks directly to Azure DevOps for reads and writes using the signed-in user\'s token.');

// ---------- 14. Tech stack ----------
h1('14. Technology stack');
kv('Language', 'TypeScript across the monorepo (npm workspaces).');
kv('Desktop', 'Electron (main/preload/renderer), bundled with tsup.');
kv('Voice', 'WebRTC to Azure OpenAI realtime (gpt-realtime), with whisper transcription.');
kv('Backend', 'Fastify service on Azure App Service.');
kv('ADO', 'Azure DevOps REST API v7.1 via a typed adapter, JSON Patch writes, optimistic concurrency.');
kv('Auth', '@azure/identity (InteractiveBrowserCredential using the Azure CLI public client); PAT/device-code also supported.');
kv('Validation', 'Zod schemas for every action.');
kv('Documents', 'pdf-parse for PDF text extraction; plain-text/markdown/CSV/JSON read directly.');
kv('Testing', 'Vitest, including simulated meeting scenarios.');
kv('Infra', 'Bicep for Azure resources.');

// ---------- 15. Program config ----------
h1('15. Program configuration (PROGRAM_A)');
p('The bundled program config targets a real ADO organisation and project, and encodes the team\'s vocabulary so the agent speaks the right language.');
kv('Organization', 'dev.azure.com/your-org');
kv('Project', 'YourProject');
kv('Products', 'PROGRAM_A (aliases 701, SAE) and PROGRAM_B (aliases 702, ROT).');
kv('Milestones', 'VR (Validation Ready), CC (Code Complete), QCC (Quality Control Check).');
kv('Partner', 'PartnerCases - external engineering partner; per-product partner programs are configured.');
kv('Glossary', 'Domain terms such as BSP, ETL, HLOS, GPIO, UEFI, SAM, and PC case are defined so the agent understands them.');

// ---------- 16. How to run ----------
h1('16. How to run & use');
h3('Run the desktop app');
code('npm run dev --workspace @triager/desktop\n# builds the bundles then launches Electron');
h3('Typical session');
li('Sign in with Microsoft (schema discovery runs automatically).');
li('Add context: paste notes or attach documents/datasheets (including PDFs) in the left panel.');
li('Press "Start meeting" - confirm the mic status shows "you + call" so call audio is captured.');
li('Open the ADO bug on screen; the agent detects and tracks it.');
li('Talk naturally. Ask it to reference a document, change state, set a milestone, add a comment, or mark a duplicate - it applies the change and confirms.');
h3('Controls');
kv('Autonomy', 'Auto-apply vs suggest.');
kv('Auto high-risk', 'Allow state/duplicate changes to apply directly (on by default).');
kv('Watch screen', 'Enable the screen watcher / vision tracking.');
kv('Tag', 'The attribution tag stamped on every write.');

// ---------- 17. FAQ ----------
h1('17. FAQ');
h3('Does it really change Azure DevOps, or only suggest?');
p('It changes ADO directly, using the signed-in user\'s own permissions. The write engine performs real REST writes with optimistic concurrency and tags each change for attribution.');
h3('Can it hear people who are remote on the call?');
p('Yes. It captures the microphone plus Windows system/loopback audio, so remote participants heard through the speakers are included. It falls back to mic-only if loopback is unavailable.');
h3('How does it know which bug we are discussing?');
p('A vision model reads the screen every few seconds and returns the work-item id on screen; saying a bug number also switches the tracked item.');
h3('How does it use my documents?');
p('Attached notes and files (including PDFs) are injected into its context and can be pulled on demand with read_document. It can answer questions from them and compose ADO comments based on their contents, citing the document by name.');
h3('What stops it from making a bad change?');
p('Actions are schema-validated, high-impact actions are gated, writes use optimistic concurrency and an attribution tag, and everything is logged in the Activity panel.');
h3('Where do the AI models run?');
p('In Azure OpenAI (realtime voice and a reasoning/vision model). The backend mints short-lived credentials so no long-lived key sits in the client.');
h3('Can it create partner (PartnerCo) cases or send external messages?');
p('Partner workflows (case creation, external partner messages) are modelled in the knowledge base and action set; sending anything that can leave the company boundary is treated as sensitive and handled conservatively.');

// ---------- 18. Glossary ----------
h1('18. Glossary');
kv('ADO', 'Azure DevOps - the work-item tracking system the agent reads and writes.');
kv('Work item / bug', 'A tracked issue in ADO with fields, a state, tags, and a comment thread.');
kv('Triage', 'The meeting where bugs are reviewed and their state, owner, and next steps decided.');
kv('Realtime model', 'The Azure OpenAI voice model the agent uses to listen and speak (gpt-realtime).');
kv('Loopback audio', 'Windows system audio capture - what is playing through the speakers - used to hear remote participants.');
kv('Optimistic concurrency', 'Writing only if the item\'s revision has not changed since it was read.');
kv('Investigation status', 'A custom ADO field where dated engineering notes are appended.');
kv('Sub-status', 'A triage sub-state such as Investigating or Waiting on partner.');
kv('Milestone', 'A release checkpoint - VR (Validation Ready), CC (Code Complete), QCC (Quality Control Check).');
kv('Ephemeral key', 'A short-lived credential minted by the backend for the realtime session.');

// ---------- Footers (page numbers) ----------
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  const y = doc.page.height - 40;
  doc.moveTo(60, y - 6).lineTo(PAGE_W - 60, y - 6).strokeColor(RULE).lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text('Agent Triager - Project Overview', 60, y, { lineBreak: false });
  doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE_W - 160, y, { width: 100, align: 'right', lineBreak: false });
}

doc.end();
console.log('Wrote', OUT_FILE);
