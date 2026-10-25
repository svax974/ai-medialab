/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

export const SHARE_SERVICES = ['mail', 'whatsapp', 'messages', 'x', 'facebook', 'instagram'] as const;
export type ShareService = (typeof SHARE_SERVICES)[number];

/**
 * What reaches the recipient: `attached` the file is in the message the service opens, `clipboard` the file is on the
 * clipboard (paste it in the message), `none` only the text is prefilled (no way to carry a file on this system).
 */
export type ShareOutcome = 'attached' | 'clipboard' | 'none';

export interface ShareCommand {
  file: string;
  args: string[];
}

export interface SharePlan {
  outcome: ShareOutcome;
  /** Run in order; a command of `optional` steps may fail, the next one then replaces it. */
  steps: ShareCommand[][];
}

export interface ShareInput {
  /** Absolute path of the file to send. */
  path: string;
  text: string;
  subject: string;
}

export function isShareService(value: unknown): value is ShareService {
  return typeof value === 'string' && (SHARE_SERVICES as readonly string[]).includes(value);
}

const q = encodeURIComponent;

/** Web link of a service with the text prefilled (a link cannot carry a file). */
export function shareLink(service: ShareService, { text, subject }: ShareInput): string {
  switch (service) {
    case 'mail': return `mailto:?subject=${q(subject)}&body=${q(text)}`;
    case 'whatsapp': return `https://wa.me/?text=${q(text)}`;
    case 'messages': return `sms:&body=${q(text)}`;
    case 'x': return `https://x.com/intent/post?text=${q(text)}`;
    case 'facebook': return 'https://www.facebook.com/';
    case 'instagram': return 'https://www.instagram.com/';
  }
}

/** Mail.app: a new message with the file attached (AppleScript, arguments passed apart so no text is ever run as code). */
const MAIL_SCRIPT = [
  'on run argv',
  'set theFile to POSIX file (item 1 of argv)',
  'tell application "Mail"',
  'set m to make new outgoing message with properties {subject:(item 2 of argv), content:((item 3 of argv) & return & return), visible:true}',
  'tell content of m to make new attachment with properties {file name:theFile} at after the last paragraph',
  'activate',
  'end tell',
  'end run',
];

const CLIPBOARD_SCRIPT = ['on run argv', 'set the clipboard to (POSIX file (item 1 of argv))', 'end run'];

const osascript = (lines: string[], ...args: string[]): ShareCommand => ({
  file: 'osascript',
  args: [...lines.flatMap((line) => ['-e', line]), '--', ...args],
});

/** The way a link is opened on each system. */
function opener(platform: NodeJS.Platform, url: string): ShareCommand {
  if (platform === 'darwin') return { file: 'open', args: [url] };
  if (platform === 'win32') return { file: 'cmd', args: ['/c', 'start', '', url] };
  return { file: 'xdg-open', args: [url] };
}

/**
 * Commands that send a file to a service. On macOS Mail gets the file itself; the other services open with the text and
 * the file copied to the clipboard (no web link or URL scheme accepts a local file), WhatsApp in its app when installed.
 * Elsewhere the service opens with the text only.
 */
export function sharePlan(service: ShareService, platform: NodeJS.Platform, input: ShareInput): SharePlan {
  const link = shareLink(service, input);
  if (platform !== 'darwin') return { outcome: 'none', steps: [[opener(platform, link)]] };
  if (service === 'mail') return { outcome: 'attached', steps: [[osascript(MAIL_SCRIPT, input.path, input.subject, input.text)]] };
  const clipboard = osascript(CLIPBOARD_SCRIPT, input.path);
  const open = service === 'whatsapp'
    ? [opener(platform, `whatsapp://send?text=${q(input.text)}`), opener(platform, link)]
    : [opener(platform, link)];
  return { outcome: 'clipboard', steps: [[clipboard], open] };
}
