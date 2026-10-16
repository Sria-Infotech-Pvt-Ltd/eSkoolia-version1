'use client';

/**
 * usePortalNotifications
 *
 * Live push for portal-only events (currently: new InAppMessage) over the
 * same per-user WebSocket group the admin chat feature already uses
 * (ws/chat/, group `user_<id>`) — see backend apps.communication.realtime
 * and ChatConsumer.portal_notification. Routed through a distinct
 * `portal_notification` event type so it never collides with a real
 * Conversation message if ChatWindow is ever mounted for the same account.
 *
 * Connects once per mounted consumer, reconnects on drop (3s backoff,
 * mirrors components/utilities/chat/ChatWindow.tsx's own reconnect delay),
 * and silently stays disconnected if there's no token or API URL yet —
 * callers should treat this as a nice-to-have push layer on top of a
 * regular fetch-on-mount, not the only way data arrives.
 */

import { useEffect, useRef } from 'react';
import { getAccessToken } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/api';

export interface PortalMessageNotification {
  kind: 'message';
  id: number;
  subject: string;
  sender_id: number;
  created_at: string;
}

/**
 * A library event (backend apps/library/services/notifications.py). `id` is the
 * CommunicationNotification row id, so a page can refetch and find it in the bell list.
 */
export interface PortalLibraryNotification {
  kind: 'library';
  event: 'hold_ready' | 'overdue_reminder' | 'replacement_fee' | 'unscanned_flag' | 'request_reviewed';
  id: number;
  title: string;
  body: string;
  link_url: string;
  created_at: string;
}

export type PortalNotification = PortalMessageNotification | PortalLibraryNotification;

export function isLibraryNotification(n: PortalNotification): n is PortalLibraryNotification {
  return n.kind === 'library';
}

export function usePortalNotifications(onNotification: (n: PortalNotification) => void) {
  const handlerRef = useRef(onNotification);
  handlerRef.current = onNotification;

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !API_BASE_URL) return;

    let unmounted = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (unmounted) return;
      const wsUrl = `${API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://')}/ws/chat/?token=${token}`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === 'portal_notification' && payload?.notification) {
            handlerRef.current(payload.notification as PortalNotification);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);
}
