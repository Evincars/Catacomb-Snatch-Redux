/** Players handing coins to a teammate: who may receive them, and the checks on every transfer. */
import { q, playerInSlot } from '../world';
import type { Entity, PlayerSlot } from '../world';
import { ValidationError, err, ok } from '../core/errors';
import type { Result } from '../core/errors';
import { notify } from './Notices';

/** Everyone else playing on the giver's side, who may be handed coins. */
export function giftRecipients(giver: Entity): Entity[] {
  const found: Entity[] = [];
  for (const player of q.slotted) {
    if (player === giver || player.removed || player.team !== giver.team || !player.playerStats) continue;
    found.push(player);
  }
  return found;
}

/** What the gift window offers at first: half the giver's purse, rounded down. */
export function defaultGift(purse: number): number {
  return Math.floor(Math.max(0, purse) / 2);
}

function nameOf(player: Entity): string {
  return player.playerName ?? 'A player';
}

/** Why this transfer cannot go ahead, or null when it can. */
function giftRefusal(giver: Entity, recipient: Entity | undefined, amount: number): string | null {
  const purse = giver.playerStats?.score ?? 0;
  if (!recipient?.playerStats || recipient.removed) return 'That player is no longer in the game';
  if (recipient === giver || recipient.team !== giver.team) return 'Coins can only be given to a teammate';
  if (!Number.isSafeInteger(amount) || amount < 1) return 'Choose how many coins to give';
  if (amount > purse) return `You only have ${purse} coins`;
  return null;
}

/**
 * Moves `amount` coins from the giver's purse to the recipient's, once it is certain the giver has them and
 * the recipient is a teammate still in the game. Everyone is told; the amount given is returned.
 */
export function giveCoins(giver: Entity, recipient: Entity | undefined, amount: number): Result<number> {
  const refusal = giftRefusal(giver, recipient, amount);
  if (refusal) return err(new ValidationError(refusal, { amount }));
  giver.playerStats!.score -= amount;
  recipient!.playerStats!.score += amount;
  notify(`${nameOf(giver)} gave ${nameOf(recipient!)} ${amount} coins`);
  return ok(amount);
}

/** A transfer asked for by slot, as it arrives over the network from a guest. */
export function giveCoinsBySlot(from: PlayerSlot, to: PlayerSlot, amount: number): Result<number> {
  const giver = playerInSlot(from);
  if (!giver) return err(new ValidationError('The giver is no longer in the game', { from }));
  return giveCoins(giver, playerInSlot(to), amount);
}
