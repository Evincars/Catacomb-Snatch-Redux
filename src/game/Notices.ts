/** Short-lived messages shown at the top of the screen. */
export type Notice = { text: string; ticks: number };

const NOTICE_TICKS = 120;
const MAX_NOTICES = 3;
const notices: Notice[] = [];

export function notify(text: string): void {
  notices.push({ text, ticks: NOTICE_TICKS });
  if (notices.length > MAX_NOTICES) notices.shift();
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
