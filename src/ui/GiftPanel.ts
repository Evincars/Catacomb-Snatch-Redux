import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { PlayerSlot } from '../world';
import { defaultGift } from '../game/CoinGift';

/** Someone the coins can go to, as the dropdown lists them. */
export type GiftRecipient = { slot: PlayerSlot; name: string };

/** Size and place of the window on the 512x384 game surface. */
const PANEL = { x: 136, y: 104, width: 240, height: 150 };

const PANEL_STYLE = 'position:fixed;box-sizing:border-box;display:none;flex-direction:column;gap:6px;padding:10px 12px;'
  + 'background:#241a13;color:#ffdd88;border:2px solid #8b613d;font-family:monospace;z-index:20';
const FIELD_STYLE = 'box-sizing:border-box;width:100%;background:#3a2a1e;color:#fff;border:1px solid #d9a454;font-family:monospace';
const BUTTON_STYLE = 'flex:1;background:#7a4a24;color:#fff;border:1px solid #d9a454;font-family:monospace;cursor:pointer';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.style.cssText = style;
  el.textContent = text;
  return el;
}

/**
 * The give-coins window laid over the canvas: pick a teammate from the dropdown, then drag the slider or type
 * the amount, which can never go above the coins in hand. It starts at half of them.
 */
export class GiftPanel {
  readonly element = element('div', PANEL_STYLE);
  /** Called with the chosen teammate and amount when the player presses Give. */
  onSend: ((to: PlayerSlot, amount: number) => void) | null = null;
  onClose: (() => void) | null = null;

  private readonly title = element('div', 'text-align:center;font-weight:bold', 'GIVE COINS');
  private readonly recipient = element('select', FIELD_STYLE);
  private readonly slider = element('input', 'width:100%;accent-color:#d9a454');
  private readonly amount = element('input', FIELD_STYLE);
  private readonly message = element('div', 'min-height:1em;color:#ff8888;font-size:0.85em');
  private purse = 0;
  private recipients: readonly GiftRecipient[] = [];
  private readonly place: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.setAttribute('aria-label', 'Coins to give');
    this.amount.type = 'number';
    this.amount.min = '0';
    this.amount.setAttribute('aria-label', 'Coins to give');
    this.recipient.setAttribute('aria-label', 'Teammate to give coins to');
    this.slider.addEventListener('input', () => this.setAmount(Number(this.slider.value)));
    this.amount.addEventListener('input', () => this.setAmount(Number(this.amount.value)));
    this.element.addEventListener('keydown', (event) => this.handleKey(event));

    const buttons = element('div', 'display:flex;gap:8px');
    const give = element('button', BUTTON_STYLE, 'Give');
    const cancel = element('button', BUTTON_STYLE, 'Cancel');
    give.addEventListener('click', () => this.send());
    cancel.addEventListener('click', () => this.close());
    buttons.append(give, cancel);
    this.element.append(this.title, this.recipient, this.slider, this.amount, this.message, buttons);
    document.body.appendChild(this.element);

    this.place = () => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH;
      const sy = rect.height / GAME_HEIGHT;
      this.element.style.left = `${rect.left + PANEL.x * sx}px`;
      this.element.style.top = `${rect.top + PANEL.y * sy}px`;
      this.element.style.width = `${PANEL.width * sx}px`;
      this.element.style.minHeight = `${PANEL.height * sy}px`;
      this.element.style.fontSize = `${Math.max(11, 9 * sy)}px`;
    };
    window.addEventListener('resize', this.place);
  }

  get visible(): boolean {
    return this.element.style.display !== 'none';
  }

  open(recipients: readonly GiftRecipient[], purse: number): void {
    this.recipients = recipients;
    this.recipient.replaceChildren(...recipients.map(({ slot, name }) => {
      const option = element('option', '', name);
      option.value = slot;
      return option;
    }));
    this.message.textContent = '';
    this.setPurse(purse);
    this.setAmount(defaultGift(purse));
    this.element.style.display = 'flex';
    this.place();
    this.recipient.focus();
  }

  close(): void {
    if (!this.visible) return;
    this.element.style.display = 'none';
    this.onClose?.();
  }

  /** Keeps the most that can be given in step with the coins actually in hand. */
  setPurse(purse: number): void {
    this.purse = Math.max(0, Math.floor(purse));
    this.title.textContent = `GIVE COINS (you have ${this.purse})`;
    this.slider.max = String(this.purse);
    this.amount.max = String(this.purse);
    if (this.current() > this.purse) this.setAmount(this.purse);
  }

  /** The amount, whole and within what the player has, shown the same in the slider and the box. */
  private setAmount(value: number): void {
    const amount = Number.isFinite(value) ? Math.min(this.purse, Math.max(0, Math.floor(value))) : 0;
    this.slider.value = String(amount);
    if (Number(this.amount.value) !== amount) this.amount.value = String(amount);
    this.message.textContent = '';
  }

  private current(): number {
    return Math.floor(Number(this.amount.value) || 0);
  }

  private send(): void {
    const amount = this.current();
    const chosen = this.recipients.find((r) => r.slot === this.recipient.value);
    if (!chosen) {
      this.message.textContent = 'Choose a teammate';
      return;
    }
    if (amount < 1 || amount > this.purse) {
      this.message.textContent = amount < 1 ? 'Give at least 1 coin' : `You only have ${this.purse} coins`;
      return;
    }
    this.onSend?.(chosen.slot, amount);
    this.close();
  }

  /** Typing stays in the window; Enter gives, Escape cancels. */
  private handleKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.code === 'Enter') this.send();
    if (event.code === 'Escape') this.close();
  }

  destroy(): void {
    window.removeEventListener('resize', this.place);
    this.element.remove();
  }
}
