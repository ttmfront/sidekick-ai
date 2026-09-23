import { contextBridge, ipcRenderer } from 'electron';

// The only bridge between renderer and main. No Node APIs are exposed directly.
contextBridge.exposeInMainWorld('api', {
  signIn: () => ipcRenderer.invoke('auth:signIn'),
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  status: () => ipcRenderer.invoke('auth:status'),
  loadQuery: () => ipcRenderer.invoke('ado:loadQuery'),
  getWorkItem: (id: number) => ipcRenderer.invoke('ado:getWorkItem', id),
  getComments: (id: number) => ipcRenderer.invoke('ado:getComments', id),
  getIntelligence: (id: number, updateContext = true) => ipcRenderer.invoke('ado:getIntelligence', id, updateContext),
  searchRelated: (id: number, options?: { platform?: string; release?: string; limit?: number }) =>
    ipcRenderer.invoke('ado:searchRelated', id, options),
  getMeetingContext: () => ipcRenderer.invoke('meeting:getContext'),
  observeMeetingTurn: (turn: unknown) => ipcRenderer.invoke('meeting:observeTurn', turn),
  searchPartnerCases: (id: number, partner?: string) => ipcRenderer.invoke('partner:searchCases', id, partner),
  draftPartnerCase: (id: number, partner: string) => ipcRenderer.invoke('partner:draftCase', id, partner),
  discoverSchema: () => ipcRenderer.invoke('ado:discoverSchema'),
  analyze: (workItemId: number, transcript: unknown) => ipcRenderer.invoke('meeting:analyze', workItemId, transcript),
  execute: (action: unknown, workItemId: number) => ipcRenderer.invoke('meeting:execute', action, workItemId),
  listAudit: () => ipcRenderer.invoke('audit:list'),
  voiceConnect: (offerSdp: string) => ipcRenderer.invoke('voice:connect', offerSdp),
  screenSources: () => ipcRenderer.invoke('screen:getSources'),
  visionAnalyze: (image: string, hint?: string) => ipcRenderer.invoke('vision:analyze', image, hint),
  setTag: (tag: string) => ipcRenderer.invoke('settings:setTag', tag),
  openAdoLink: (url: string) => ipcRenderer.invoke('navigation:openAdo', url),
  pickDocs: () => ipcRenderer.invoke('context:pickFiles'),
  getDefaultDocs: () => ipcRenderer.invoke('context:getDefaultDocs'),
  removeDefaultDoc: () => ipcRenderer.invoke('context:removeDefaultDoc')
});
