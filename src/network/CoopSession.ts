import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { Entity } from '../world';
import type { WorldState } from '../game/WorldState';
import { validateWorld } from '../game/WorldState';
import { SFX, sound } from '../audio/SoundPlayer';
import type { SfxName } from '../audio/SoundPlayer';
import { notify } from '../game/Notices';

export type InputFrame = { input: NonNullable<Entity['playerInput']>; aim: { x: number; y: number }; sequence: number };
type Message =
  | { type: 'hello'; version: 1 }
  | { type: 'state'; compressed: ArrayBuffer | Uint8Array }
  | { type: 'input'; frame: InputFrame }
  | { type: 'end'; winner: number }
  | { type: 'sound'; name: SfxName; x?: number; y?: number }
  | { type: 'notice'; text: string }
  | { type: 'ping' };

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
  latest: { state: WorldState; paused: boolean } | null = null;
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
        this.setStatus('Invite ready. Waiting for your teammate.');
      } else if (destination) {
        this.attach(peer.connect(destination, { reliable: true, serialization: 'binary' }));
      } else this.fail('Enter a host invite link or peer ID.');
    });
  }

  private attach(connection: DataConnection): void {
    clearTimeout(this.timeout);
    this.connection = connection;
    this.sequence = -1;
    this.input = null;
    this.timeout = setTimeout(() => this.fail('Teammate handshake timed out.'), 15000);
    connection.on('open', () => connection.send({ type: 'hello', version: 1 } satisfies Message));
    connection.on('data', value => {
      this.receiving = this.receiving.then(async () => {
        if (this.connection !== connection) return;
        if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid co-op message');
        const message = value as Message;
        this.lastMessageAt = performance.now();
        if (message.type === 'hello') {
          if (message.version !== 1) throw new Error('Co-op version mismatch');
          clearTimeout(this.timeout);
          this.connected = true;
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            if (performance.now() - this.lastMessageAt > 10000) this.fail('Teammate connection timed out.');
            else this.send({ type: 'ping' });
          }, 1000);
          this.setStatus('Teammate connected.');
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
          if (!(message.compressed instanceof ArrayBuffer) && !(message.compressed instanceof Uint8Array)) {
            throw new Error('Invalid world packet encoding');
          }
          if (message.compressed.byteLength > 2000000) throw new Error('World packet exceeds compressed size limit');
          const bytes = message.compressed instanceof ArrayBuffer
            ? new Uint8Array(message.compressed) : Uint8Array.from(message.compressed);
          const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
          const chunks: ArrayBuffer[] = [];
          let size = 0;
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 16000000) {
              await reader.cancel();
              throw new Error('World packet exceeds size limit');
            }
            chunks.push(Uint8Array.from(chunk.value).buffer);
          }
          const decoded: unknown = JSON.parse(await new Blob(chunks).text());
          if (!decoded || typeof decoded !== 'object' || !('state' in decoded) || !('paused' in decoded)
            || typeof decoded.paused !== 'boolean') throw new Error('Invalid world update');
          validateWorld(decoded.state);
          if (!decoded.state.entities.some(e => e.data.playerSlot === 'guest')) throw new Error('Co-op world has no guest player');
          if (this.connection !== connection) return;
          this.latest = { state: decoded.state, paused: decoded.paused };
          this.onState?.();
        } else if (message.type === 'input' && this.role === 'host') {
          if (!validInput(message.frame)) throw new Error('Invalid teammate controls');
          if (message.frame.sequence <= this.sequence) return;
          this.sequence = message.frame.sequence;
          const previous = this.input?.input.intents;
          if (previous) {
            message.frame.input.intents.use ||= previous.use;
            message.frame.input.intents.build ||= previous.build;
            message.frame.input.intents.upgrade ||= previous.upgrade;
            if (message.frame.input.intents.weaponSlot === -1) message.frame.input.intents.weaponSlot = previous.weaponSlot;
            if (message.frame.input.intents.weaponStep === 0) message.frame.input.intents.weaponStep = previous.weaponStep;
          }
          this.input = message.frame;
          this.lastInputAt = performance.now();
        } else if (message.type === 'end' && this.role === 'guest') {
          if (![0, 1].includes(message.winner)) throw new Error('Invalid game result');
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
      this.input = null;
      this.connected = false;
      this.setStatus('Teammate disconnected. Return to the menu to reconnect.');
    });
    connection.on('error', error => this.fail(error.message));
  }

  sendState(state: WorldState, paused: boolean): void {
    if (!this.connected || !this.connection?.open || this.sending
      || this.connection.dataChannel.bufferedAmount > 262144) return;
    this.sending = true;
    const connection = this.connection;
    void new Response(new Blob([JSON.stringify({ state, paused })]).stream()
      .pipeThrough(new CompressionStream('gzip'))).arrayBuffer().then(buffer => {
        if (this.connection === connection && connection.open) {
          connection.send({ type: 'state', compressed: buffer } satisfies Message);
        }
      }).catch(error => this.fail(error instanceof Error ? error.message : String(error)))
      .finally(() => { this.sending = false; });
  }

  sendInput(frame: InputFrame): void {
    this.send({ type: 'input', frame });
  }
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
    connection?.removeAllListeners();
    connection?.close();
    this.setStatus(text);
  }
  close(): void {
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    this.onChange = null; this.onState = null; this.onEnd = null;
    this.connection?.removeAllListeners();
    this.connection?.close();
    this.peer?.removeAllListeners();
    this.peer?.destroy();
    this.peer = null; this.connection = null; this.role = null;
    this.connected = false; this.invite = ''; this.latest = null; this.input = null; this.sequence = -1;
    this.receiving = Promise.resolve();
  }
}

export const coop = new CoopSession();

export function invitePeer(text: string): string {
  const trimmed = text.trim();
  const id = trimmed.includes('://') ? new URL(trimmed).searchParams.get('join') : trimmed;
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid invite link or peer ID');
  return id;
}
