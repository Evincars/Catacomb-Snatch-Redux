import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { PLAYER_SLOTS } from '../world';
import type { Entity, PlayerSlot } from '../world';
import type { WorldState, NetWorldState } from '../game/WorldState';
import type { LevelState } from '../level/Level';
import { validateWorld } from '../game/WorldState';
import { SFX, sound } from '../audio/SoundPlayer';
import type { SfxName } from '../audio/SoundPlayer';
import { notify } from '../game/Notices';
import { gameState } from '../game/GameState';
import type { MultiplayerMode } from '../game/GameState';
import { cleanName, settings } from '../game/Settings';
import { NetworkError, ValidationError, attempt, errorMessage } from '../core/errors';
import { isPair, isRecord } from '../core/guards';
import { createLog } from '../core/log';

const log = createLog('network');

export type InputFrame = { input: NonNullable<Entity['playerInput']>; aim: { x: number; y: number }; sequence: number };
export type RosterEntry = { slot: PlayerSlot; name: string };
type Message =
  | { type: 'hello'; version: 4; name: string }
  | { type: 'welcome'; slot: PlayerSlot; mode: MultiplayerMode }
  | { type: 'refused'; reason: string }
  | { type: 'roster'; players: RosterEntry[]; mode: MultiplayerMode }
  | { type: 'name'; name: string }
  | { type: 'state'; seq: number; compressed: ArrayBuffer | Uint8Array }
  | { type: 'level'; compressed: ArrayBuffer | Uint8Array }
  | { type: 'input'; frame: InputFrame }
  | { type: 'end'; winner: number }
  /** The match is over and the host is setting up the next one in the same room. */
  | { type: 'lobby' }
  | { type: 'sound'; name: SfxName; x?: number; y?: number }
  | { type: 'notice'; text: string }
  | { type: 'ping' };

/** The most guests a room takes: the host plus three others make four players. */
export const MAX_GUESTS = PLAYER_SLOTS.length - 1;
const VERSION = 4;

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
      throw new ValidationError('World packet exceeds size limit', { limit });
    }
    chunks.push(Uint8Array.from(chunk.value).buffer);
  }
  return JSON.parse(await new Blob(chunks).text());
}

// Beyond this a lossy datagram is likely to lose a fragment, so bigger packets take the reliable channel.
const FAST_LIMIT = 32000;
const FAST_CHANNEL_ID = 100;

type Controls = InputFrame['input'];
const BUTTONS = ['up', 'down', 'left', 'right', 'shoot', 'use', 'sprint', 'mouseAiming'] as const satisfies readonly (keyof Controls)[];
const INTENT_FLAGS = ['use', 'build', 'upgrade'] as const satisfies readonly (keyof Intents)[];
/** Aim points farther than this from the origin are not a real cursor. */
const MAX_AIM = 100000;

function validAim(aim: unknown): boolean {
  return isRecord(aim) && Number.isFinite(aim.x) && Number.isFinite(aim.y)
    && Math.abs(Number(aim.x)) < MAX_AIM && Math.abs(Number(aim.y)) < MAX_AIM;
}

function validKeyAim(keyAim: unknown): boolean {
  if (keyAim === null) return true;
  return isRecord(keyAim) && Number.isFinite(keyAim.x) && Number.isFinite(keyAim.y)
    && Math.abs(Number(keyAim.x)) <= 1 && Math.abs(Number(keyAim.y)) <= 1;
}

function validIntents(intents: unknown): boolean {
  if (!isRecord(intents) || !INTENT_FLAGS.every(k => typeof intents[k] === 'boolean')) return false;
  const slot = intents.weaponSlot;
  return Number.isInteger(slot) && Number(slot) >= -1 && Number(slot) <= 2
    && (intents.weaponStep === -1 || intents.weaponStep === 0 || intents.weaponStep === 1);
}

function validInput(value: unknown): value is InputFrame {
  if (!isRecord(value) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0 || !validAim(value.aim)) return false;
  const i = value.input;
  return isRecord(i) && BUTTONS.every(k => typeof i[k] === 'boolean') && validIntents(i.intents) && validKeyAim(i.keyAim);
}

/** Just the envelope; `handle` checks each message type's own fields. */
function isMessage(value: unknown): value is Message {
  return isRecord(value) && typeof value.type === 'string';
}

function validRoster(value: unknown): value is RosterEntry[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= PLAYER_SLOTS.length
    && value.every(p => !!p && PLAYER_SLOTS.includes(p.slot) && typeof p.name === 'string' && cleanName(p.name) === p.name)
    && new Set(value.map(p => p.slot)).size === value.length;
}

/** One peer on the other end of the line: the host for a guest, each guest for the host. */
class Link {
  name = '';
  ready = false;
  fast: RTCDataChannel | null = null;
  sequence = -1;
  input: InputFrame | null = null;
  lastInputAt = 0;
  lastMessageAt = performance.now();
  timeout?: ReturnType<typeof setTimeout>;
  receiving: Promise<void> = Promise.resolve();
  constructor(readonly connection: DataConnection, public slot: PlayerSlot | null) {}
}

export class CoopSession {
  role: 'host' | 'guest' | null = null;
  status = '';
  invite = '';
  /** Host: at least one guest has joined. Guest: the host accepted this player. */
  connected = false;
  /** Which player this browser controls; the host is always 'host'. */
  slot: PlayerSlot | null = null;
  /** Everyone in the room, host first; kept current on every browser. */
  roster: RosterEntry[] = [];
  /** Set once the match begins, so nobody else can join half-way. */
  locked = false;
  /** Guests a loaded save has room for; null for a fresh game. */
  guestLimit: number | null = null;
  /** `levelChanged` is set when the terrain/fog snapshot was replaced since the previous update. */
  latest: { state: WorldState; paused: boolean; scores: [number, number] | null; levelChanged: boolean } | null = null;
  onChange: (() => void) | null = null;
  onState: (() => void) | null = null;
  onEnd: ((winner: number) => void) | null = null;
  /** Guest only: the host took the room back to the lobby for another match. */
  onLobby: (() => void) | null = null;
  /** Host only: a guest's connection ended. */
  onLeave: ((slot: PlayerSlot, name: string) => void) | null = null;
  private peer: Peer | null = null;
  private links = new Map<PlayerSlot, Link>();
  private uplink: Link | null = null;
  private timeout?: ReturnType<typeof setTimeout>;
  private sending = false;
  private stateSeqOut = 0;
  private stateSeqIn = -1;
  /** The host's last terrain and fog, checked in full by validateWorld with the world update it goes with. */
  private level: Record<string, unknown> | null = null;
  private levelChanged = false;
  private decoding = false;
  private pendingState: { seq: number; bytes: Uint8Array } | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor() {
    window.addEventListener('beforeunload', () => this.close());
  }

  get hostName(): string { return cleanName(settings.playerName) || 'Host'; }

  /** Guests that have finished joining, in slot order. */
  guestSlots(): PlayerSlot[] {
    return PLAYER_SLOTS.filter(slot => this.links.get(slot)?.ready);
  }

  nameOf(slot: PlayerSlot): string | undefined {
    return this.roster.find(p => p.slot === slot)?.name;
  }

  /** The latest controls of a guest, as the host knows them. */
  inputOf(slot: PlayerSlot): { frame: InputFrame | null; at: number } {
    const link = this.links.get(slot);
    return { frame: link?.input ?? null, at: link?.lastInputAt ?? 0 };
  }

  clearInputs(): void {
    for (const link of this.links.values()) link.input = null;
  }

  async open(role: 'host' | 'guest', destination?: string): Promise<void> {
    this.close();
    this.role = role;
    this.slot = role === 'host' ? 'host' : null;
    this.setStatus('Connecting to PeerJS...');
    const peer = new Peer();
    this.peer = peer;
    peer.on('error', error => this.fail(error.message));
    peer.on('disconnected', () => this.fail('Signaling disconnected. Return to the menu and reconnect.'));
    peer.on('connection', connection => {
      if (role !== 'host') return connection.close();
      const refusal = this.refusal();
      const slot = PLAYER_SLOTS.find(s => s !== 'host' && !this.links.has(s));
      if (refusal || !slot) {
        connection.on('open', () => {
          connection.send({ type: 'refused', reason: refusal ?? 'The room is full.' } satisfies Message);
          setTimeout(() => connection.close(), 500);
        });
        return;
      }
      this.attach(new Link(connection, slot));
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
        this.refreshRoster();
        this.setStatus(this.waitingText());
      } else if (destination) {
        this.attach(new Link(peer.connect(destination, { reliable: true, serialization: 'binary' }), null));
      } else this.fail('Enter a host invite link or peer ID.');
    });
  }

  /** Why the host cannot take another guest right now, if it cannot. */
  private refusal(): string | null {
    if (this.locked) return 'The match has already started.';
    if (this.links.size >= this.maxGuests()) return 'The room is full.';
    return null;
  }

  /** An enemy guest plays one against one; a loaded save only has room for the guests it had. */
  maxGuests(): number {
    const modeLimit = gameState.multiplayerMode === 'enemy' ? 1 : MAX_GUESTS;
    return Math.min(modeLimit, this.guestLimit ?? MAX_GUESTS);
  }

  private waitingText(): string {
    const guests = this.guestSlots().length;
    return guests === 0 ? 'Invite ready. Waiting for the other players.'
      : `${guests + 1} of ${this.maxGuests() + 1} players here. ${gameState.multiplayerMode === 'enemy' ? 'Opponent' : 'Companions'} connected.`;
  }

  private attach(link: Link): void {
    const connection = link.connection;
    // The signalling timeout is over once there is a line to the other side.
    clearTimeout(this.timeout);
    if (this.role === 'guest') this.uplink = link;
    else this.links.set(link.slot!, link);
    this.resetStream();
    link.timeout = setTimeout(() => this.dropLink(link, 'Teammate handshake timed out.'), 15000);
    connection.on('open', () => {
      this.openFastChannel(link);
      // The host waits to be greeted; a guest introduces itself.
      if (this.role === 'guest') this.send(link, { type: 'hello', version: VERSION, name: cleanName(settings.playerName) });
    });
    connection.on('data', value => {
      link.receiving = link.receiving.then(async () => {
        if (!this.owns(link)) return;
        if (!isMessage(value)) throw new NetworkError('Invalid co-op message');
        link.lastMessageAt = performance.now();
        await this.handle(link, value);
      }).catch(error => {
        this.dropLink(link, errorMessage(error));
      });
    });
    connection.on('close', () => {
      if (!this.owns(link)) return;
      this.dropLink(link, this.role === 'guest'
        ? 'The host disconnected. Return to the menu to reconnect.' : `${link.name || 'A player'} disconnected.`);
    });
    connection.on('error', error => this.dropLink(link, error.message));
  }

  private owns(link: Link): boolean {
    return this.role === 'guest' ? this.uplink === link : this.links.get(link.slot!) === link;
  }

  private async handle(link: Link, message: Message): Promise<void> {
    if (message.type === 'hello' && this.role === 'host') {
      if (link.ready) throw new NetworkError('Unexpected co-op message');
      if (message.version !== VERSION) throw new NetworkError('Multiplayer version mismatch. Reload both browsers.');
      link.name = this.uniqueName(cleanName(message.name), link.slot!);
      link.ready = true;
      clearTimeout(link.timeout);
      this.connected = true;
      this.startHeartbeat();
      this.send(link, { type: 'welcome', slot: link.slot!, mode: gameState.multiplayerMode });
      this.refreshRoster();
      this.broadcastRoster();
      this.setStatus(this.waitingText());
    } else if (message.type === 'welcome' && this.role === 'guest') {
      if (!PLAYER_SLOTS.includes(message.slot) || message.slot === 'host'
        || !['companion', 'enemy'].includes(message.mode)) throw new NetworkError('Invalid host greeting');
      link.slot = message.slot;
      link.ready = true;
      this.slot = message.slot;
      gameState.multiplayerMode = message.mode;
      clearTimeout(link.timeout);
      this.connected = true;
      this.startHeartbeat();
      this.setStatus('Connected. Waiting for the host to start.');
    } else if (message.type === 'refused' && this.role === 'guest') {
      throw new NetworkError(typeof message.reason === 'string' ? message.reason.slice(0, 80) : 'The host refused the connection.');
    } else if (message.type === 'roster' && this.role === 'guest' && link.ready) {
      if (!validRoster(message.players) || !['companion', 'enemy'].includes(message.mode)) throw new NetworkError('Invalid room roster');
      this.roster = message.players;
      gameState.multiplayerMode = message.mode;
      this.setStatus(`${this.roster.length} players in the room. Waiting for the host to start.`);
    } else if (message.type === 'name' && this.role === 'host' && link.ready) {
      if (this.locked) return;
      link.name = this.uniqueName(cleanName(message.name), link.slot!);
      this.refreshRoster();
      this.broadcastRoster();
      this.onChange?.();
    } else if (!link.ready) {
      throw new NetworkError('Unexpected co-op message');
    } else if (message.type === 'ping') {
      return;
    } else if (message.type === 'sound' && this.role === 'guest') {
      if (!Object.prototype.hasOwnProperty.call(SFX, message.name) || message.x !== undefined && !Number.isFinite(message.x)
        || message.y !== undefined && !Number.isFinite(message.y)) throw new NetworkError('Invalid sound event');
      sound.playSound(message.name, message.x, message.y);
    } else if (message.type === 'notice' && this.role === 'guest') {
      if (typeof message.text !== 'string' || message.text.length > 200) throw new NetworkError('Invalid game notice');
      notify(message.text);
    } else if (message.type === 'state' && this.role === 'guest') {
      if (!Number.isSafeInteger(message.seq) || !this.validPacket(message.compressed)) throw new NetworkError('Invalid world packet encoding');
      this.queueState(link, message.seq, message.compressed instanceof ArrayBuffer
        ? new Uint8Array(message.compressed) : Uint8Array.from(message.compressed));
    } else if (message.type === 'level' && this.role === 'guest') {
      if (!this.validPacket(message.compressed)) throw new NetworkError('Invalid level packet encoding');
      const level = await gunzip(message.compressed, 16000000);
      if (this.uplink !== link) return;
      if (!isRecord(level)) throw new NetworkError('Invalid level update');
      this.level = level;
      this.levelChanged = true;
    } else if (message.type === 'input' && this.role === 'host') {
      this.acceptInput(link, message.frame);
    } else if (message.type === 'end' && this.role === 'guest') {
      if (![0, 1, 2].includes(message.winner)) throw new NetworkError('Invalid game result');
      this.onEnd?.(message.winner);
    } else if (message.type === 'lobby' && this.role === 'guest') {
      this.awaitNextMatch();
    } else throw new NetworkError('Unexpected co-op message');
  }

  /** Names must be unique in the room so nobody is mistaken for somebody else. */
  private uniqueName(wanted: string, slot: PlayerSlot): string {
    const base = wanted || `Player ${PLAYER_SLOTS.indexOf(slot) + 1}`;
    const taken = new Set([this.hostName, ...[...this.links.values()].filter(l => l.slot !== slot && l.ready).map(l => l.name)]
      .map(n => n.toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 10)} ${n}`;
    return name;
  }

  private refreshRoster(): void {
    if (this.role !== 'host') return;
    this.roster = [{ slot: 'host', name: this.hostName },
      ...this.guestSlots().map(slot => ({ slot, name: this.links.get(slot)!.name }))];
  }

  private broadcastRoster(): void {
    this.broadcast({ type: 'roster', players: this.roster, mode: gameState.multiplayerMode });
  }

  /** The host's own name changed (or a guest's, which the host then renames if needed). */
  setName(name: string): void {
    const clean = cleanName(name);
    if (this.role === 'guest' && this.uplink?.ready) this.send(this.uplink, { type: 'name', name: clean });
    else if (this.role === 'host' && !this.locked) {
      this.refreshRoster();
      this.broadcastRoster();
      this.onChange?.();
    }
  }

  sendMode(): void {
    this.refreshRoster();
    this.broadcastRoster();
    if (this.role === 'host') this.setStatus(this.waitingText());
  }

  /** Once the match begins the room is closed to newcomers, and every roster name is final. */
  lock(): void {
    this.locked = true;
  }

  /** Whether this browser is still in a room from the last match, so the lobby can reuse it instead of a new invite. */
  get inRoom(): boolean {
    return this.role === 'host' ? this.peer !== null && this.invite !== '' : this.role === 'guest' && this.connected;
  }

  /**
   * Host: the match is over and the same room takes the next one, so nobody needs a new invite. The room opens
   * to newcomers again, every guest's controls start afresh, and the guests are told to wait for the next start.
   */
  reopen(): void {
    if (this.role !== 'host') return;
    this.locked = false;
    this.guestLimit = null;
    for (const link of this.links.values()) {
      link.input = null;
      link.sequence = -1;
    }
    this.refreshRoster();
    this.broadcast({ type: 'lobby' });
    this.broadcastRoster();
    this.setStatus(this.waitingText());
  }

  /** Guest: the last match's world is dropped, so the next one is never mixed with its terrain. */
  private awaitNextMatch(): void {
    this.latest = null;
    this.level = null;
    this.levelChanged = false;
    this.pendingState = null;
    this.setStatus('The host is setting up the next match.');
    this.onLobby?.();
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const link of this.activeLinks()) {
        if (performance.now() - link.lastMessageAt > 10000) {
          this.dropLink(link, this.role === 'guest' ? 'Other player connection timed out.' : `${link.name} connection timed out.`);
        } else this.send(link, { type: 'ping' });
      }
    }, 1000);
  }

  private activeLinks(): Link[] {
    return this.role === 'guest' ? (this.uplink ? [this.uplink] : []) : [...this.links.values()].filter(l => l.ready);
  }

  /** A second, unordered, no-retransmit channel so a lost packet never stalls newer game data. */
  private openFastChannel(link: Link): void {
    try {
      const fast = link.connection.peerConnection.createDataChannel('fast', {
        negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0,
      });
      fast.binaryType = 'arraybuffer';
      fast.onmessage = event => this.receiveFast(link, event.data);
      link.fast = fast;
    } catch (error) {
      log.warn('Unreliable channel unavailable, using the reliable one', { error: errorMessage(error) });
      link.fast = null;
    }
  }

  private closeFast(link: Link): void {
    if (link.fast) link.fast.onmessage = null;
    // Closing a channel the browser already closed throws; that is the state wanted anyway.
    const closed = attempt(() => link.fast?.close(), 'network');
    if (!closed.ok) log.debug('Fast channel was already closed');
    link.fast = null;
  }

  private fastReady(link: Link, limit = 262144): RTCDataChannel | null {
    const fast = link.fast;
    return fast && fast.readyState === 'open' && fast.bufferedAmount < limit ? fast : null;
  }

  private receiveFast(link: Link, data: unknown): void {
    if (!this.owns(link) || !link.ready) return;
    link.lastMessageAt = performance.now();
    try {
      this.handleFast(link, data);
    } catch (error) {
      this.dropLink(link, errorMessage(error));
    }
  }

  /** Held keys from a guest (JSON), or a world update from the host (sequence number, then gzip). */
  private handleFast(link: Link, data: unknown): void {
    if (typeof data === 'string' && this.role === 'host') {
      const message: unknown = JSON.parse(data);
      if (isRecord(message) && message.type === 'input') this.acceptInput(link, message.frame);
    } else if (data instanceof ArrayBuffer && this.role === 'guest' && data.byteLength > 4) {
      this.queueState(link, new DataView(data).getUint32(0), new Uint8Array(data, 4));
    }
  }

  private validPacket(value: unknown): value is ArrayBuffer | Uint8Array {
    if (!(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) return false;
    if (value.byteLength > 2000000) throw new ValidationError('World packet exceeds compressed size limit', { bytes: value.byteLength });
    return true;
  }

  private acceptInput(link: Link, frame: unknown): void {
    if (!validInput(frame)) throw new NetworkError('Invalid remote controls');
    if (frame.sequence <= link.sequence) {
      // A late or reordered frame must not roll the controls back, but its button presses still count.
      if (link.input) mergeIntents(link.input.input.intents, frame.input.intents);
      return;
    }
    link.sequence = frame.sequence;
    if (link.input) mergeIntents(frame.input.intents, link.input.input.intents);
    link.input = frame;
    link.lastInputAt = performance.now();
  }

  /** Only the newest undecoded world update matters; older ones are dropped. */
  private queueState(link: Link, seq: number, bytes: Uint8Array): void {
    if (seq <= this.stateSeqIn) return;
    if (this.pendingState && this.pendingState.seq > seq) return;
    this.pendingState = { seq, bytes };
    if (!this.decoding) void this.drainStates(link);
  }

  private async drainStates(link: Link): Promise<void> {
    this.decoding = true;
    try {
      while (this.pendingState && this.uplink === link) await this.decodeNext(link, this.pendingState);
    } catch (error) {
      this.dropLink(link, errorMessage(error));
    } finally {
      this.decoding = false;
    }
  }

  /** Unpacks one queued world update and, if it is still the newest, makes it the latest. */
  private async decodeNext(link: Link, { seq, bytes }: { seq: number; bytes: Uint8Array }): Promise<void> {
    this.pendingState = null;
    if (seq <= this.stateSeqIn) return;
    const decoded = await gunzip(bytes, 16000000);
    if (this.uplink !== link || seq <= this.stateSeqIn) return;
    if (!isRecord(decoded) || !isRecord(decoded.state) || typeof decoded.paused !== 'boolean') {
      throw new NetworkError('Invalid world update');
    }
    // The terrain and fog arrive separately and less often.
    if (!this.level || !this.slot) return;
    const state: unknown = { ...decoded.state, level: this.level };
    validateWorld(state);
    if (!state.entities.some(e => e.data.playerSlot === this.slot)) throw new NetworkError('Co-op world has no character for this player');
    this.stateSeqIn = seq;
    this.latest = { state, paused: decoded.paused, scores: isPair(decoded.scores) ? decoded.scores : null, levelChanged: this.levelChanged };
    this.levelChanged = false;
    this.onState?.();
  }

  canSendState(): boolean {
    return this.role === 'host' && this.connected && !this.sending && this.guestSlots().length > 0;
  }

  /** Terrain, fog and base layout; large, so it goes on the reliable channel and is sent sparingly. */
  sendLevel(level: LevelState): void {
    if (!this.canSendState()) return;
    void gzip(JSON.stringify(level)).then(compressed => {
      this.broadcast({ type: 'level', compressed });
    }).catch(error => this.fail(errorMessage(error)));
  }

  sendState(state: NetWorldState, paused: boolean, scores: [number, number]): void {
    if (!this.canSendState()) return;
    this.sending = true;
    const seq = this.stateSeqOut++;
    void gzip(JSON.stringify({ state, paused, scores })).then(compressed => {
      const packet = new Uint8Array(compressed.byteLength + 4);
      new DataView(packet.buffer).setUint32(0, seq);
      packet.set(compressed, 4);
      for (const link of this.activeLinks()) this.sendStatePacket(link, seq, compressed, packet);
    }).catch(error => this.fail(errorMessage(error)))
      .finally(() => { this.sending = false; });
  }

  /**
   * A world update goes on the fast channel when it fits in one datagram; otherwise on the reliable one,
   * unless that is already backed up, in which case this update is skipped for a newer one.
   */
  private sendStatePacket(link: Link, seq: number, compressed: Uint8Array, packet: Uint8Array<ArrayBuffer>): void {
    if (!link.connection.open) return;
    const fits = packet.byteLength <= Math.min(FAST_LIMIT, link.connection.peerConnection.sctp?.maxMessageSize ?? FAST_LIMIT);
    const fast = fits ? this.fastReady(link) : null;
    try {
      if (fast) fast.send(packet);
      else if (link.connection.dataChannel.bufferedAmount <= 262144) link.connection.send({ type: 'state', seq, compressed } satisfies Message);
    } catch (error) {
      this.dropLink(link, errorMessage(error));
    }
  }

  sendInput(frame: InputFrame): void {
    const link = this.uplink;
    if (!link?.ready) return;
    // One-shot presses must not be lost, so they take the reliable channel; held keys ride the fast one.
    const fast = hasIntent(frame.input.intents) ? null : this.fastReady(link, 65536);
    if (fast) {
      try { fast.send(JSON.stringify({ type: 'input', frame } satisfies Message)); }
      catch (error) { this.dropLink(link, errorMessage(error)); }
    } else this.send(link, { type: 'input', frame });
  }

  sendSound(name: SfxName, x?: number, y?: number): void {
    this.broadcast({ type: 'sound', name, ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) });
  }
  sendNotice(text: string): void { this.broadcast({ type: 'notice', text }); }
  end(winner: number): void { this.broadcast({ type: 'end', winner }); }

  private broadcast(message: Message): void {
    if (this.role !== 'host') return;
    for (const link of this.activeLinks()) this.send(link, message);
  }

  private send(link: Link, message: Message): void {
    if (!link.connection.open) return;
    try { link.connection.send(message); }
    catch (error) { this.dropLink(link, errorMessage(error)); }
  }

  private setStatus(text: string): void { this.status = text; this.onChange?.(); }

  /** Ends one line. A guest losing the host loses the match; the host only loses that guest. */
  private dropLink(link: Link, text: string): void {
    if (!this.owns(link)) return;
    log.warn('Link dropped', { reason: text, slot: link.slot });
    clearTimeout(link.timeout);
    this.closeFast(link);
    link.connection.removeAllListeners();
    link.connection.close();
    if (this.role === 'guest') {
      this.uplink = null;
      this.connected = false;
      clearTimeout(this.timeout);
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      this.setStatus(text);
      return;
    }
    const slot = link.slot!;
    this.links.delete(slot);
    link.input = null;
    const wasReady = link.ready;
    this.connected = this.guestSlots().length > 0;
    this.refreshRoster();
    this.broadcastRoster();
    this.setStatus(wasReady ? `${link.name} left. ${this.waitingText()}` : text);
    if (wasReady) this.onLeave?.(slot, link.name);
  }

  /** A failure that affects the whole session (signalling, encoding): every line goes down. */
  private fail(text: string): void {
    log.error('Session failed', new NetworkError(text));
    this.connected = false;
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const link of this.allLinks()) {
      clearTimeout(link.timeout);
      this.closeFast(link);
      link.connection.removeAllListeners();
      link.connection.close();
    }
    this.links.clear();
    this.uplink = null;
    this.setStatus(text);
  }

  private allLinks(): Link[] {
    return [...this.links.values(), ...(this.uplink ? [this.uplink] : [])];
  }

  close(): void {
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.onChange = null; this.onState = null; this.onEnd = null; this.onLeave = null; this.onLobby = null;
    for (const link of this.allLinks()) {
      clearTimeout(link.timeout);
      this.closeFast(link);
      link.connection.removeAllListeners();
      link.connection.close();
    }
    this.links.clear();
    this.uplink = null;
    this.peer?.removeAllListeners();
    this.peer?.destroy();
    this.peer = null; this.role = null; this.slot = null;
    this.connected = false; this.invite = ''; this.latest = null;
    this.locked = false; this.guestLimit = null; this.roster = [];
    this.resetStream();
  }

  private resetStream(): void {
    this.stateSeqOut = 0; this.stateSeqIn = -1;
    this.level = null; this.levelChanged = false;
    this.pendingState = null;
  }
}

export const coop = new CoopSession();

export function invitePeer(text: string): string {
  const trimmed = text.trim();
  const id = trimmed.includes('://') ? new URL(trimmed).searchParams.get('join') : trimmed;
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new ValidationError('Invalid invite link or peer ID');
  return id;
}
