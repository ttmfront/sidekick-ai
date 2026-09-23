import { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, shell } from 'electron';
import { join, basename, extname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseTriageAction, type TranscriptTurn } from '@triager/shared';
import { AuthManager } from './auth';
import { AdoService } from './adoService';

// pdf-parse is loaded lazily at runtime (kept out of the bundle) via createRequire.
const nodeRequire = createRequire(__filename);

// Bundled project-overview PDF, attached as default meeting context until removed.
const DEFAULT_DOC_NAME = 'Agent-Triager-Project-Overview.pdf';

// Deployed agenttriager backend that mints realtime ephemeral credentials.
const BACKEND_URL = 'https://your-app.azurewebsites.net';

// Some Windows GPU drivers throw "GPU state invalid" compositing errors; the UI
// is lightweight DOM, so disable hardware acceleration for stability.
app.disableHardwareAcceleration();

const auth = new AuthManager();
let ado: AdoService;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Microsoft Surface · Sidekick',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.removeMenu();
  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.on('did-finish-load', () => console.log('[renderer] loaded OK'));
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) =>
    console.error(`[renderer] failed to load: ${code} ${desc}`)
  );
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'agent-triager-settings.json');
}
async function readSettings(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
async function writeSettings(patch: Record<string, unknown>): Promise<void> {
  const next = { ...(await readSettings()), ...patch };
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
}

interface PersistedAuditRecord {
  ts: number;
  workItemId: number;
  action: string;
  ok: boolean;
  summary?: string;
  error?: string;
  revisionBefore?: number;
  revisionAfter?: number;
}

async function appendAudit(record: PersistedAuditRecord): Promise<void> {
  const settings = await readSettings();
  const existing = Array.isArray(settings.audit) ? settings.audit as PersistedAuditRecord[] : [];
  await writeSettings({ audit: [...existing, record].slice(-200) });
}

const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.xml', '.yml',
  '.yaml', '.html', '.htm', '.ini', '.cfg', '.conf', '.rst', '.tex', '.srt', '.vtt', '.text'
]);

// pdf-parse (v2) exposes a PDFParse class; require the package root (CJS build) at
// runtime so pdfjs stays out of the bundle. Kept lazy so startup stays light.
type PdfParseModule = {
  PDFParse: new (opts: { data: Uint8Array }) => {
    getText(): Promise<{ text: string }>;
    destroy(): Promise<void>;
  };
};

async function extractPdfText(buf: Buffer): Promise<string> {
  let mod: PdfParseModule;
  try {
    mod = nodeRequire('pdf-parse') as PdfParseModule;
  } catch {
    throw new Error('PDF support is unavailable — paste the text into the notes box instead');
  }
  const parser = new mod.PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** Reads a reference document as plain text. PDFs are parsed; other binary/office
 *  formats are rejected with a hint to paste the text so we never feed junk to the model. */
async function readDocText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const buf = await readFile(filePath);
  if (ext === '.pdf') {
    const text = (await extractPdfText(buf))
      .replace(/\r\n/g, '\n')
      .replace(/^\s*-- \d+ of \d+ --\s*$/gm, '') // pdf-parse page separators
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) throw new Error('no selectable text in this PDF (looks scanned) — paste the text instead');
    return text;
  }
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) {
    throw new Error('binary Office format — open it and paste the text into the notes box');
  }
  const sample = buf.subarray(0, 8192);
  let control = 0;
  for (const b of sample) {
    if (b === 0) throw new Error('not a text file — paste the text into the notes box instead');
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  if (!TEXT_EXTS.has(ext) && control > sample.length * 0.15) {
    throw new Error('not a text file — paste the text into the notes box instead');
  }
  return buf.toString('utf8').replace(/\r\n/g, '\n').trim();
}

function registerIpc(): void {
  ipcMain.handle('auth:signIn', async () => {
    try {
      const account = await auth.signIn();
      await ado.connect(auth.tokenProvider!);
      return {
        ok: true,
        account,
        org: ado.program.organizationUrl,
        project: ado.program.project,
        query: ado.program.queryName
      };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('auth:status', async () => ({
    signedIn: auth.isSignedIn,
    account: auth.currentAccount ?? null,
    org: ado.program.organizationUrl,
    project: ado.program.project,
    program: ado.program.program,
    query: ado.program.queryName
  }));

  ipcMain.handle('auth:signOut', async () => {
    auth.signOut();
    return { ok: true };
  });

  ipcMain.handle('ado:loadQuery', async () => {
    try {
      return { ok: true, items: await ado.loadQuery() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('ado:getWorkItem', async (_e, id: number) => {
    try {
      return { ok: true, item: await ado.getWorkItem(id) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('ado:getComments', async (_e, id: number) => {
    try {
      return { ok: true, comments: await ado.getComments(id) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('ado:getIntelligence', async (_e, id: number, updateContext = true) => {
    try {
      return { ok: true, result: await ado.getIntelligence(id, updateContext) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('ado:searchRelated', async (
    _e,
    id: number,
    options?: { platform?: string; release?: string; limit?: number }
  ) => {
    try {
      return { ok: true, result: await ado.searchRelated(id, options) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('meeting:getContext', async () => {
    try {
      return { ok: true, context: ado.getMeetingContext() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('meeting:observeTurn', async (_e, turn: unknown) => {
    if (!turn || typeof turn !== 'object' || !('text' in turn) || typeof turn.text !== 'string') {
      return { ok: false, error: 'Invalid meeting turn.' };
    }
    try {
      return { ok: true, context: ado.observeMeetingTurn(turn as TranscriptTurn) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('partner:searchCases', async (_e, id: number, partner?: string) => {
    try {
      return { ok: true, result: await ado.searchPartnerCases(id, partner) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('partner:draftCase', async (_e, id: number, partner: string) => {
    try {
      return { ok: true, result: await ado.draftPartnerCase(id, partner) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('ado:discoverSchema', async () => {
    try {
      return { ok: true, ...(await ado.discoverSchema()) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('meeting:analyze', async (_e, workItemId: number, transcript: unknown) => {
    try {
      const turns = Array.isArray(transcript) ? transcript : [];
      return { ok: true, ...(await ado.analyze(workItemId, turns)) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('meeting:execute', async (_e, action: unknown, workItemId: number) => {
    const parsed = parseTriageAction(action);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid action rejected by validation.' };
    }
    try {
      const result = await ado.execute(parsed.data, workItemId);
      await appendAudit({
        ts: Date.now(), workItemId, action: parsed.data.action, ok: result.ok,
        summary: result.summary || undefined, error: result.error,
        revisionBefore: result.revisionBefore, revisionAfter: result.revisionAfter
      });
      return { ok: true, result };
    } catch (e) {
      const error = errMsg(e);
      await appendAudit({ ts: Date.now(), workItemId, action: parsed.data.action, ok: false, error });
      return { ok: false, error };
    }
  });

  ipcMain.handle('audit:list', async () => {
    const settings = await readSettings();
    const audit = Array.isArray(settings.audit) ? settings.audit as PersistedAuditRecord[] : [];
    return { ok: true, audit: audit.slice(-50).reverse() };
  });

  // Relays WebRTC signaling so the realtime ephemeral key never reaches the renderer.
  ipcMain.handle('voice:connect', async (_e, offerSdp: string) => {
    try {
      const sres = await fetch(`${BACKEND_URL}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!sres.ok) return { ok: false, error: `session mint failed (${sres.status})` };
      const s = (await sres.json()) as { client_secret?: { value?: string }; webrtcUrl?: string; deployment?: string };
      const ephemeral = s.client_secret?.value;
      const webrtcUrl = s.webrtcUrl;
      const deployment = s.deployment ?? 'realtime';
      if (!ephemeral || !webrtcUrl) return { ok: false, error: 'session missing ephemeral key or webrtc url' };
      const sdpRes = await fetch(`${webrtcUrl}?model=${encodeURIComponent(deployment)}`, {
        method: 'POST',
        body: offerSdp,
        headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' }
      });
      if (!sdpRes.ok) return { ok: false, error: `webrtc negotiation failed (${sdpRes.status})` };
      return { ok: true, answerSdp: await sdpRes.text() };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  // Screen sources for the screen-watcher (renderer captures frames from these).
  ipcMain.handle('screen:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 }
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  });

  // Sends a screenshot to the backend vision model to detect the current bug.
  ipcMain.handle('vision:analyze', async (_e, image: string, hint?: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/vision/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, hint })
      });
      if (!res.ok) return { ok: false, error: `vision failed (${res.status})` };
      const data = (await res.json()) as { workItemId?: number | null; title?: string | null; onScreen?: string };
      return { ok: true, workItemId: data.workItemId ?? null, title: data.title ?? null, onScreen: data.onScreen ?? '' };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('settings:setTag', async (_e, tag: string) => {
    ado.setTag(tag);
    return { ok: true };
  });

  ipcMain.handle('navigation:openAdo', async (_e, url: string) => {
    try {
      const target = new URL(url);
      const allowedBase = new URL(ado.program.organizationUrl);
      const organizationPath = `${allowedBase.pathname.replace(/\/+$/, '')}/`;
      if (
        target.protocol !== 'https:' ||
        target.origin !== allowedBase.origin ||
        !`${target.pathname.replace(/\/+$/, '')}/`.startsWith(organizationPath)
      ) {
        return { ok: false, error: 'Blocked non-ADO link.' };
      }
      await shell.openExternal(target.toString());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });

  // Lets the user attach reference documents; their text becomes agent context.
  ipcMain.handle('context:pickFiles', async () => {
    if (!mainWindow) return { ok: false, error: 'window not ready' };
    const sel = await dialog.showOpenDialog(mainWindow, {
      title: 'Add reference documents',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'html', 'htm', 'ini', 'cfg', 'rst', 'tex', 'srt', 'vtt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (sel.canceled) return { ok: true, docs: [] };
    const docs = await Promise.all(
      sel.filePaths.map(async (p) => {
        try {
          const text = await readDocText(p);
          return { name: basename(p), text, chars: text.length };
        } catch (e) {
          return { name: basename(p), text: '', chars: 0, error: errMsg(e) };
        }
      })
    );
    return { ok: true, docs };
  });

  // The bundled project-overview doc is attached by default until the user removes it.
  ipcMain.handle('context:getDefaultDocs', async () => {
    try {
      const settings = await readSettings();
      if (settings.defaultDocRemoved) return { ok: true, docs: [] };
      const text = await readDocText(join(__dirname, '../docs', DEFAULT_DOC_NAME));
      return { ok: true, docs: [{ name: DEFAULT_DOC_NAME, text, chars: text.length, default: true }] };
    } catch {
      return { ok: true, docs: [] };
    }
  });

  ipcMain.handle('context:removeDefaultDoc', async () => {
    try {
      await writeSettings({ defaultDocRemoved: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });
}

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });
  // Supply Windows system-audio loopback so getDisplayMedia captures the whole
  // call (every participant), not just the local mic.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then(([screen]) => callback(screen ? { video: screen, audio: 'loopback' } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );
  ado = await AdoService.load(
    join(__dirname, '../config/program.json'),
    join(__dirname, '../config/ado-schema.json')
  );
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
