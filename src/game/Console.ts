import type { Entity } from '../world';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 10;
const MONEY_MAX = 1_000_000;

/** Testing switches set from the console; reset whenever a level opens. */
export const cheats = { speed: 1 };

export function resetCheats(): void {
  cheats.speed = 1;
}

export type ConsoleContext = { player: Entity | undefined };

export const HELP_LINES = [
  'All Commands',
  '-------------',
  'help : Displays all possible commands',
  'money <amount> : Adds coins to your purse (also: give money <amount>)',
  'god [on|off] : Toggles taking no damage',
  'speed <0.25-10> : Runs the game faster or slower',
  'speed normal : Returns the game to normal speed',
];

function parseAmount(text: string | undefined): number | null {
  if (text === undefined || !/^-?\d+$/.test(text)) return null;
  return Number(text);
}

function giveMoney(player: Entity, amount: number | null): string[] {
  if (amount === null || amount === 0 || Math.abs(amount) > MONEY_MAX) {
    return [`Usage: /money <amount>, up to ${MONEY_MAX}`];
  }
  const stats = player.playerStats;
  if (!stats) return ['You have no purse'];
  stats.score = Math.max(0, stats.score + amount);
  return [`${amount > 0 ? 'Gave' : 'Took'} ${Math.abs(amount)} coins, you now hold ${stats.score}`];
}

function setGod(player: Entity, arg: string | undefined): string[] {
  const health = player.health;
  if (!health) return ['You cannot be hurt anyway'];
  if (arg !== undefined && arg !== 'on' && arg !== 'off') return ['Usage: /god [on|off]'];
  health.immortal = arg === undefined ? !health.immortal : arg === 'on';
  if (health.immortal) health.current = health.max;
  return [`God mode ${health.immortal ? 'on' : 'off'}`];
}

function setSpeed(arg: string | undefined): string[] {
  if (arg === 'normal' || arg === 'reset') {
    cheats.speed = 1;
    return ['Game speed back to normal'];
  }
  const value = arg === undefined ? NaN : Number(arg);
  if (!Number.isFinite(value) || value < SPEED_MIN || value > SPEED_MAX) {
    return [`Usage: /speed <${SPEED_MIN}-${SPEED_MAX}> or /speed normal`, `Current speed: x${cheats.speed}`];
  }
  cheats.speed = value;
  return [`Game speed x${value}`];
}

/** Runs one console line and returns what to print. */
export function runCommand(line: string, ctx: ConsoleContext): string[] {
  const text = line.trim();
  if (!text) return [];
  if (!text.startsWith('/')) return ['Type commands with a slash in front, like /help'];

  const [name, ...args] = text.slice(1).toLowerCase().split(/\s+/);
  const player = ctx.player;

  switch (name) {
    case 'help':
      return HELP_LINES;
    case 'money':
      return player ? giveMoney(player, parseAmount(args[0])) : ['No player'];
    case 'give':
      if (args[0] !== 'money') return ['Usage: /give money <amount>'];
      return player ? giveMoney(player, parseAmount(args[1])) : ['No player'];
    case 'god':
      return player ? setGod(player, args[0]) : ['No player'];
    case 'speed':
      return setSpeed(args[0]);
    default:
      return [`Unknown command: /${name}. If in doubt, type /help`];
  }
}
