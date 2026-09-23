// Realtime voice via WebRTC. Signaling (session mint + SDP exchange) is relayed
// through the main process so the ephemeral key never lives in the renderer.
// Only mic capture, the peer connection, and audio playback happen here.

const api = (
  window as unknown as {
    api: { voiceConnect(offerSdp: string): Promise<{ ok: boolean; answerSdp?: string; error?: string }> };
  }
).api;

export interface VoiceHandlers {
  onUserText: (text: string) => void;
  onAgentText: (text: string) => void;
  onStatus: (state: 'connecting' | 'live' | 'off', detail?: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<string>;
}

let pc: RTCPeerConnection | null = null;
let micStream: MediaStream | null = null;
let systemStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let capturedSystemAudio = false;
let dc: RTCDataChannel | null = null;
let audioEl: HTMLAudioElement | null = null;
let toolHandler: ((name: string, args: Record<string, unknown>) => Promise<string>) | null = null;

async function handleToolCall(name: string, callId: string, argsJson: string): Promise<void> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    /* keep empty args */
  }
  let output = 'done';
  try {
    output = toolHandler ? await toolHandler(name, args) : 'No handler available.';
  } catch (e) {
    output = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } }));
    dc.send(JSON.stringify({ type: 'response.create' }));
  }
}

function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      peer.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = (): void => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    peer.addEventListener('icegatheringstatechange', check);
    // Fallback so we never block forever on non-trickle ICE.
    window.setTimeout(finish, 2000);
  });
}

// Builds the audio the model listens to: the local mic mixed with the meeting/call
// audio (other participants) captured via Windows system loopback. Falls back to
// mic-only when loopback is unavailable (non-Windows or denied).
async function buildInputStream(): Promise<MediaStream> {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true }
  });

  try {
    systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    systemStream.getVideoTracks().forEach((t) => t.stop());
  } catch {
    systemStream = null;
  }

  if (!systemStream || systemStream.getAudioTracks().length === 0) {
    capturedSystemAudio = false;
    return micStream;
  }

  capturedSystemAudio = true;
  audioCtx = new AudioContext();
  await audioCtx.resume().catch(() => undefined);
  const dest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaStreamSource(micStream).connect(dest);
  audioCtx.createMediaStreamSource(systemStream).connect(dest);
  return dest.stream;
}

export async function startVoice(
  h: VoiceHandlers,
  instructions: string,
  tools: unknown[] = []
): Promise<void> {
  h.onStatus('connecting');
  toolHandler = h.onToolCall ?? null;
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

  audioEl = new Audio();
  audioEl.autoplay = true;
  pc.ontrack = (e) => {
    if (audioEl && e.streams[0]) audioEl.srcObject = e.streams[0];
  };

  const inputStream = await buildInputStream();
  for (const track of inputStream.getAudioTracks()) pc.addTrack(track, inputStream);

  dc = pc.createDataChannel('oai-events');
  dc.onopen = () => {
    dc?.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          instructions,
          input_audio_transcription: { model: 'whisper-1' },
          // Proactive: the agent participates like a PM and calls tools to update ADO.
          turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
          tools,
          tool_choice: 'auto'
        }
      })
    );
    h.onStatus('live', capturedSystemAudio ? 'Listening · you + call' : 'Listening · mic only');
  };
  dc.onmessage = (e) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof e.data === 'string' ? e.data : '') as Record<string, unknown>;
    } catch {
      return;
    }
    const type = msg.type as string | undefined;
    if (type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
      h.onUserText(String(msg.transcript).trim());
    } else if (type === 'response.audio_transcript.done' && msg.transcript) {
      h.onAgentText(String(msg.transcript).trim());
    } else if (type === 'response.function_call_arguments.done' && msg.name && msg.call_id) {
      void handleToolCall(String(msg.name), String(msg.call_id), String(msg.arguments ?? '{}'));
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);

  const res = await api.voiceConnect(pc.localDescription?.sdp ?? offer.sdp ?? '');
  if (!res.ok || !res.answerSdp) {
    h.onStatus('off', res.error ?? 'connect failed');
    stopVoice();
    throw new Error(res.error ?? 'voice connect failed');
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: res.answerSdp });
}

export function stopVoice(): void {
  try {
    dc?.close();
  } catch {
    /* noop */
  }
  dc = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  systemStream?.getTracks().forEach((t) => t.stop());
  systemStream = null;
  if (audioCtx) {
    void audioCtx.close().catch(() => undefined);
    audioCtx = null;
  }
  capturedSystemAudio = false;
  try {
    pc?.close();
  } catch {
    /* noop */
  }
  pc = null;
  if (audioEl) {
    audioEl.srcObject = null;
    audioEl = null;
  }
}

/** Make the agent briefly say something to the room. */
export function speak(text: string): void {
  if (dc && dc.readyState === 'open') {
    dc.send(
      JSON.stringify({
        type: 'response.create',
        response: { instructions: `Say this briefly and naturally to the room: ${text}`, modalities: ['audio', 'text'] }
      })
    );
  }
}

/** Re-ground the agent (e.g. when the current bug changes). */
export function updateContext(instructions: string): void {
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify({ type: 'session.update', session: { instructions } }));
  }
}

/** Let the agent answer the latest question, grounded by its session instructions. */
export function respond(): void {
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify({ type: 'response.create' }));
  }
}

export function isVoiceLive(): boolean {
  return dc?.readyState === 'open';
}
