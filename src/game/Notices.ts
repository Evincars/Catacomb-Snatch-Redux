import { sound } from '../audio/SoundPlayer';

/** Short-lived messages shown at the top of the screen. */
export type Notice = { text: string; ticks: number };

const NOTICE_TICKS = 120;
const MAX_NOTICES = 3;
const notices: Notice[] = [];
export const noticeEvents: { onNotice: ((text: string) => void) | null } = { onNotice: null };

export function notify(text: string): void {
  if (quiet) return;
  noticeEvents.onNotice?.(text);
  notices.push({ text, ticks: NOTICE_TICKS });
  if (notices.length > MAX_NOTICES) notices.shift();
}

let quiet = false;

/**
 * Runs `action` with notices and unpositioned interface sounds muted when
 * `silent` is set, for actions taken by the computer opponent.
 */
export function quietly(silent: boolean, action: () => void): void {
  if (!silent) {
    action();
    return;
  }
  quiet = true;
  sound.muteInterface = true;
  try {
    action();
  } finally {
    quiet = false;
    sound.muteInterface = false;
  }
}

export function takeNotices(): Notice[] {
  return notices;
}

export function updateNotices(): void {
  for (let i = notices.length - 1; i >= 0; i--) {
    if (--notices[i].ticks <= 0) notices.splice(i, 1);
  }
}

export function clearNotices(): void {
  notices.length = 0;
}
