import { BrowserWindow, Notification } from 'electron';
import type { MailMessageSummary } from '../shared/accounts.js';

let enabled = true;
let activateApp: () => void = () => {};

export interface NewMailNotification {
  title: string;
  body: string;
  subtitle: string;
}

export function setMailNotificationsEnabled(value: boolean): void {
  enabled = value;
}

export function setMailNotificationActivationHandler(handler: () => void): void {
  activateApp = handler;
}

export function newlyArrivedUnreadMessages(
  messagesBeforeSync: readonly MailMessageSummary[],
  syncedAtBeforeSync: string | null,
  uidValidityBeforeSync: string | null,
  messagesAfterSync: readonly MailMessageSummary[],
  uidValidityAfterSync: string | null,
): MailMessageSummary[] {
  if (!syncedAtBeforeSync || uidValidityBeforeSync !== uidValidityAfterSync) return [];
  const knownUids = new Set(messagesBeforeSync.map(({ uid }) => uid));
  return messagesAfterSync.filter(({ uid, unread }) => unread && !knownUids.has(uid));
}

function senderLabel(message: MailMessageSummary): string {
  const sender = message.from[0];
  return sender?.name?.trim() || sender?.address?.trim() || 'Unknown sender';
}

export function newMailNotification(
  accountName: string,
  messages: readonly MailMessageSummary[],
): NewMailNotification | null {
  if (messages.length === 0) return null;
  if (messages.length === 1) {
    return {
      title: `New mail from ${senderLabel(messages[0])}`,
      body: messages[0].subject,
      subtitle: accountName,
    };
  }
  return {
    title: `${messages.length} new messages`,
    body: accountName,
    subtitle: accountName,
  };
}

export function showNewMailNotification(
  accountName: string,
  messages: readonly MailMessageSummary[],
): void {
  if (!enabled || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
  const content = newMailNotification(accountName, messages);
  if (!content) return;
  const notification = new Notification(content);
  notification.on('click', activateApp);
  notification.show();
}
