import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { Entity } from '../world';
import type { WorldState, NetWorldState } from '../game/WorldState';
import type { LevelState } from '../level/Level';
import { validateWorld } from '../game/WorldState';
import { SFX, sound } from '../audio/SoundPlayer';
import type { SfxName } from '../audio/SoundPlayer';
import { notify } from '../game/Notices';
import { gameState } from '../game/GameState';
import type { MultiplayerMode } from '../game/GameState';

export type InputFrame = { input: NonNullable<Entity['playerInput']>; aim: { x: number; y: number }; sequence: number };
type Message =
  | { type: 'hello'; version: 2; mode: MultiplayerMode }
  | { type: 'mode'; mode: MultiplayerMode }
  | { type: 'state'; seq: number; compressed: ArrayBuffer | Uint8Array }
  | { type: 'level'; compressed: ArrayBuffer | Uint8Array }
  | { type: 'input'; frame: InputFrame }
  | { type: 'end'; winner: number }
  | { type: 'sound'; name: SfxName; x?: number; y?: number }
  | { type: 'notice'; text: string }
  | { type: 'ping' };

type Intents = InputFrame['input']['intents'];
/** Folds a source's one-shot button presses into the target so none is lost. */
function mergeIntents(target: Intents, source: Intents): void {
  target.use ||= source.use;
  target.build ||= source.build;
  target.upgrade ||= source.upgrade;
  if (target.weaponSlot === -1) target.weaponSlot = source.weaponSlot;
  if (target.weaponStep === 0) target.weaponStep = source.weaponStep;
}
const hasIntent = (i: Intents) => i.use || i.build || i.upgrade || i.weaponSlot !== -1 || i.weaponStep !== 0;

async function gzip(text: string): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([text]).stream()
    .pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

async function gunzip(input: ArrayBuffer | Uint8Array, limit: number): Promise<unknown> {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : Uint8Array.from(input);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('World packet exceeds size limit');
    }
    chunks.push(Uint8Array.from(chunk.value).buffer);
  }
  return JSON.parse(await new Blob(chunks).text());
}

// Beyond this a lossy datagram is likely to lose a fragment, so bigger packets take the reliable channel.
const FAST_LIMIT = 32000;
const FAST_CHANNEL_ID = 100;

function validInput(value: unknown): value is InputFrame {
  if (!value || typeof value !== 'object') return false;
  const f = value as Partial<InputFrame>;
  const i = f.input;
  return !!i && !!i.intents && !!f.aim && Number.isSafeInteger(f.sequence) && f.sequence! >= 0
    && Number.isFinite(f.aim.x) && Number.isFinite(f.aim.y)
    && Math.abs(f.aim.x) < 100000 && Math.abs(f.aim.y) < 100000
    && ['up', 'down', 'left', 'right', 'shoot', 'use', 'sprint', 'mouseAiming'].every(k => typeof i[k as keyof typeof i] === 'boolean')
    && ['use', 'build', 'upgrade'].every(k => typeof i.intents[k as 'use' | 'build' | 'upgrade'] === 'boolean')
    && Number.isInteger(i.intents.weaponSlot) && i.intents.weaponSlot >= -1 && i.intents.weaponSlot <= 2
    && [-1, 0, 1].includes(i.intents.weaponStep)
    && (i.keyAim === null || (!!i.keyAim && Number.isFinite(i.keyAim.x) && Number.isFinite(i.keyAim.y)
      && Math.abs(i.keyAim.x) <= 1 && Math.abs(i.keyAim.y) <= 1));
}

export class CoopSession {
  role: 'host' | 'guest' | null = null;
  status = '';
  invite = '';
  connected = false;
  /** `levelChanged` is set when the terrain/fog snapshot was replaced since the previous update. */
  latest: { state: WorldState; paused: boolean; scores: [number, number] | null; levelChanged: boolean } | null = null;
  input: InputFrame | null = null;
  lastInputAt = 0;
  onChange: (() => void) | null = null;
  onState: (() => void) | null = null;
  onEnd: ((winner: number) => void) | null = null;
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private timeout?: ReturnType<typeof setTimeout>;
  private sequence = -1;
  private sending = false;
  private fast: RTCDataChannel | null = null;
  private stateSeqOut = 0;
  private stateSeqIn = -1;
  private level: LevelState | null = null;
  private levelChanged = false;
  private decoding = false;
  private pendingState: { seq: number; bytes: Uint8Array } | null = null;
  private receiving = Promise.resolve();
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastMessageAt = 0;

  constructor() {
    window.addEventListener('beforeunload', () => this.close());
  }

  async open(role: 'host' | 'guest', destination?: string): Promise<void> {
    this.close();
    this.role = role;
    this.setStatus('Connecting to PeerJS...');
    const peer = new Peer();
    this.peer = peer;
    peer.on('error', error => this.fail(error.message));
    peer.on('disconnected', () => this.fail('Signaling disconnected. Return to the menu and reconnect.'));
    peer.on('connection', connection => {
      if (role !== 'host' || this.connection) {
        connection.on('open', () => connection.close());
        return;
      }
      this.attach(connection);
    });
    this.timeout = setTimeout(() => this.fail('Connection timed out. Check the invite and network.'), 30000);
    peer.on('open', id => {
      if (this.peer !== peer) return;
      if (role === 'host') {
        clearTimeout(this.timeout);
        const url = new URL(location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set('join', id);
        this.invite = url.href;
        this.setStatus('Invite ready. Waiting for the other player.');
      } else if (destination) {
        this.attach(peer.connect(destination, { reliable: true, serialization: 'binary' }));
      } else this.fail('Enter a host invite link or peer ID.');
    });
  }

  private attach(connection: DataConnection): void {
    clearTimeout(this.timeout);
    this.connection = connection;
    this.resetStream();
    this.input = null;
    this.timeout = setTimeout(() => this.fail('Teammate handshake timed out.'), 15000);
    connection.on('open', () => {
      this.openFastChannel(connection);
      connection.send({ type: 'hello', version: 2, mode: gameState.multiplayerMode } satisfies Message);
    });
    connection.on('data', value => {
      this.receiving = this.receiving.then(async () => {
        if (this.connection !== connection) return;
        if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid co-op message');
        const message = value as Message;
        this.lastMessageAt = performance.now();
        if (message.type === 'hello') {
          if (message.version !== 2) throw new Error('Multiplayer version mismatch. Reload both browsers.');
          if (!['companion', 'enemy'].includes(message.mode)) throw new Error('Invalid multiplayer mode');
          if (this.role === 'guest') gameState.multiplayerMode = message.mode;
          clearTimeout(this.timeout);
          this.connected = true;
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            if (performance.now() - this.lastMessageAt > 10000) this.fail('Other player connection timed out.');
            else this.send({ type: 'ping' });
          }, 1000);
          this.setStatus(gameState.multiplayerMode === 'enemy' ? 'Opponent connected.' : 'Companion connected.');
        } else if (message.type === 'mode' && this.role === 'guest') {
          if (!['companion', 'enemy'].includes(message.mode)) throw new Error('Invalid multiplayer mode');
          gameState.multiplayerMode = message.mode;
          this.setStatus(message.mode === 'enemy' ? 'Opponent connected.' : 'Companion connected.');
        } else if (message.type === 'ping' && this.connected) {
          return;
        } else if (message.type === 'sound' && this.role === 'guest') {
          if (!Object.prototype.hasOwnProperty.call(SFX, message.name) || message.x !== undefined && !Number.isFinite(message.x)
            || message.y !== undefined && !Number.isFinite(message.y)) throw new Error('Invalid sound event');
          sound.playSound(message.name, message.x, message.y);
        } else if (message.type === 'notice' && this.role === 'guest') {
          if (typeof message.text !== 'string' || message.text.length > 200) throw new Error('Invalid game notice');
          notify(message.text);
        } else if (message.type === 'state' && this.role === 'guest') {
          if (!Number.isSafeInteger(message.seq) || !this.validPacket(message.compressed)) throw new Error('Invalid world packet encoding');
          this.queueState(connection, message.seq, message.compressed instanceof ArrayBuffer
            ? new Uint8Array(message.compressed) : Uint8Array.from(message.compressed));
        } else if (message.type === 'level' && this.role === 'guest') {
          if (!this.validPacket(message.compressed)) throw new Error('Invalid level packet encoding');
          const level = await gunzip(message.compressed, 16000000);
          if (this.connection !== connection) return;
          if (!level || typeof level !== 'object') throw new Error('Invalid level update');
          this.level = level as LevelState;
          this.levelChanged = true;
        } else if (message.type === 'input' && this.role === 'host') {
          this.acceptInput(message.frame);
        } else if (message.type === 'end' && this.role === 'guest') {
          if (![0, 1, 2].includes(message.winner)) throw new Error('Invalid game result');
          this.onEnd?.(message.winner);
        } else throw new Error('Unexpected co-op message');
      }).catch(error => {
        this.fail(error instanceof Error ? error.message : String(error));
      });
    });
    connection.on('close', () => {
      if (this.connection !== connection) return;
      clearTimeout(this.timeout);
      clearInterval(this.heartbeat);
      this.connection = null;
      this.closeFast();
      this.input = null;
      this.connected = false;
      this.setStatus('Other player disconnected. Return to the menu to reconnect.');
    });
    connection.on('error', error => this.fail(error.message));
  }

  /** A second, unordered, no-retransmit channel so a lost packet never stalls newer game data. */
  private openFastChannel(connection: DataConnection): void {
    try {
      const fast = connection.peerConnection.createDataChannel('fast', {
        negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0,
      });
      fast.binaryType = 'arraybuffer';
      fast.onmessage = event => this.receiveFast(connection, event.data);
      this.fast = fast;
    } catch (error) {
      console.warn('Co-op: unreliable channel unavailable, using the reliable one', error);
      this.fast = null;
    }
  }

  private closeFast(): void {
    if (this.fast) this.fast.onmessage = null;
    try { this.fast?.close(); } catch { /* already closed */ }
    this.fast = null;
  }

  private fastReady(limit = 262144): RTCDataChannel | null {
    const fast = this.fast;
    return fast && fast.readyState === 'open' && fast.bufferedAmount < limit ? fast : null;
  }

  private receiveFast(connection: DataConnection, data: unknown): void {
    if (this.connection !== connection || !this.connected) return;
    this.lastMessageAt = performance.now();
    try {
      if (typeof data === 'string' && this.role === 'host') {
        const message = JSON.parse(data) as Partial<Message>;
        if (message.type === 'input') this.acceptInput(message.frame);
      } else if (data instanceof ArrayBuffer && this.role === 'guest' && data.byteLength > 4) {
        this.queueState(connection, new DataView(data).getUint32(0), new Uint8Array(data, 4));
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private validPacket(value: unknown): value is ArrayBuffer | Uint8Array {
    if (!(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) return false;
    if (value.byteLength > 2000000) throw new Error('World packet exceeds compressed size limit');
    return true;
  }

  private acceptInput(frame: unknown): void {
    if (!validInput(frame)) throw new Error('Invalid remote controls');
    if (frame.sequence <= this.sequence) {
      // A late or reordered frame must not roll the controls back, but its button presses still count.
      if (this.input) mergeIntents(this.input.input.intents, frame.input.intents);
      return;
    }
    this.sequence = frame.sequence;
    if (this.input) mergeIntents(frame.input.intents, this.input.input.intents);
    this.input = frame;
    this.lastInputAt = performance.now();
  }

  /** Only the newest undecoded world update matters; older ones are dropped. */
  private queueState(connection: DataConnection, seq: number, bytes: Uint8Array): void {
    if (seq <= this.stateSeqIn) return;
    if (this.pendingState && this.pendingState.seq > seq) return;
    this.pendingState = { seq, bytes };
    if (!this.decoding) void this.drainStates(connection);
  }

  private async drainStates(connection: DataConnection): Promise<void> {
    this.decoding = true;
    try {
      while (this.pendingState && this.connection === connection) {
        const { seq, bytes } = this.pendingState;
        this.pendingState = null;
        if (seq <= this.stateSeqIn) continue;
        const decoded = await gunzip(bytes, 16000000);
        if (this.connection !== connection || seq <= this.stateSeqIn) continue;
        if (!decoded || typeof decoded !== 'object' || !('state' in decoded) || !('paused' in decoded)
          || typeof decoded.paused !== 'boolean') throw new Error('Invalid world update');
        // The terrain and fog arrive separately and less often.
        if (!this.level) continue;
        const state = { ...(decoded.state as NetWorldState), level: this.level };
        validateWorld(state);
        if (!state.entities.some(e => e.data.playerSlot === 'guest')) throw new Error('Co-op world has no guest player');
        const scores = 'scores' in decoded && Array.isArray(decoded.scores) && decoded.scores.length === 2
          && decoded.scores.every(Number.isFinite) ? decoded.scores as [number, number] : null;
        this.stateSeqIn = seq;
        this.latest = { state, paused: decoded.paused, scores, levelChanged: this.levelChanged };
        this.levelChanged = false;
        this.onState?.();
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.decoding = false;
    }
  }

  canSendState(): boolean {
    return this.connected && !!this.connection?.open && !this.sending
      && this.connection.dataChannel.bufferedAmount <= 262144;
  }

  /** Terrain, fog and base layout; large, so it goes on the reliable channel and is sent sparingly. */
  sendLevel(level: LevelState): void {
    if (!this.canSendState()) return;
    const connection = this.connection;
    void gzip(JSON.stringify(level)).then(compressed => {
      if (this.connection === connection && connection?.open) {
        connection.send({ type: 'level', compressed } satisfies Message);
      }
    }).catch(error => this.fail(error instanceof Error ? error.message : String(error)));
  }

  sendState(state: NetWorldState, paused: boolean, scores: [number, number]): void {
    if (!this.canSendState()) return;
    this.sending = true;
    const connection = this.connection;
    const seq = this.stateSeqOut++;
    void gzip(JSON.stringify({ state, paused, scores })).then(compressed => {
      if (this.connection !== connection || !connection?.open) return;
      const fast = compressed.byteLength + 4 <= Math.min(FAST_LIMIT, connection.peerConnection.sctp?.maxMessageSize ?? FAST_LIMIT)
        ? this.fastReady() : null;
      if (fast) {
        const packet = new Uint8Array(compressed.byteLength + 4);
        new DataView(packet.buffer).setUint32(0, seq);
        packet.set(compressed, 4);
        fast.send(packet);
      } else connection.send({ type: 'state', seq, compressed } satisfies Message);
    }).catch(error => this.fail(error instanceof Error ? error.message : String(error)))
      .finally(() => { this.sending = false; });
  }

  sendInput(frame: InputFrame): void {
    // One-shot presses must not be lost, so they take the reliable channel; held keys ride the fast one.
    const fast = hasIntent(frame.input.intents) ? null : this.fastReady(65536);
    if (this.connected && fast) {
      try { fast.send(JSON.stringify({ type: 'input', frame } satisfies Message)); }
      catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
    } else this.send({ type: 'input', frame });
  }

  sendMode(): void { this.send({ type: 'mode', mode: gameState.multiplayerMode }); }
  sendSound(name: SfxName, x?: number, y?: number): void {
    this.send({ type: 'sound', name, ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) });
  }
  sendNotice(text: string): void { this.send({ type: 'notice', text }); }
  end(winner: number): void { this.send({ type: 'end', winner }); }
  private send(message: Message): void {
    if (!this.connected || !this.connection?.open) return;
    try { this.connection.send(message); }
    catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
  }
  private setStatus(text: string): void { this.status = text; this.onChange?.(); }
  private fail(text: string): void {
    console.error('Co-op:', text);
    this.connected = false;
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    const connection = this.connection;
    this.connection = null;
    this.closeFast();
    connection?.removeAllListeners();
    connection?.close();
    this.setStatus(text);
  }
  close(): void {
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    this.onChange = null; this.onState = null; this.onEnd = null;
    this.closeFast();
    this.connection?.removeAllListeners();
    this.connection?.close();
    this.peer?.removeAllListeners();
    this.peer?.destroy();
    this.peer = null; this.connection = null; this.role = null;
    this.connected = false; this.invite = ''; this.latest = null; this.input = null;
    this.resetStream();
    this.receiving = Promise.resolve();
  }
  private resetStream(): void {
    this.sequence = -1;
    this.stateSeqOut = 0; this.stateSeqIn = -1;
    this.level = null; this.levelChanged = false;
    this.pendingState = null;
  }
}

export const coop = new CoopSession();

export function invitePeer(text: string): string {
  const trimmed = text.trim();
  const id = trimmed.includes('://') ? new URL(trimmed).searchParams.get('join') : trimmed;
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid invite link or peer ID');
  return id;
}
