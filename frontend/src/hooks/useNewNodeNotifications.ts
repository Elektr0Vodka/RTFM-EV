import { useCallback, useEffect, useState } from 'react';
import { toast } from '../components/ui/sonner';
import { contactTypeLabel } from '../components/ContactInfoBody';
import { useT } from '../i18n';
import type { NewNodePayload } from '../wsEvents';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../types';

const STORAGE_KEY = 'meshcore_new_node_notifications_settings';
const NOTIFICATION_ICON_PATH = './favicon-256x256.png';
const ALL_NOTIFIABLE_TYPES = [
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
];

type NotificationPermissionState = NotificationPermission | 'unsupported';

interface StoredSettings {
  /** Master switch. Off by default. */
  enabled: boolean;
  /** Contact type codes (1=Client, 2=Repeater, 3=Room, 4=Sensor) to notify for. */
  types: number[];
}

function getInitialPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

function readStoredSettings(): StoredSettings {
  if (typeof window === 'undefined') {
    return { enabled: false, types: ALL_NOTIFIABLE_TYPES };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { enabled: false, types: ALL_NOTIFIABLE_TYPES };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: false, types: ALL_NOTIFIABLE_TYPES };
    }
    const obj = parsed as Partial<StoredSettings>;
    const types = Array.isArray(obj.types)
      ? obj.types.filter(
          (value): value is number =>
            typeof value === 'number' && ALL_NOTIFIABLE_TYPES.includes(value)
        )
      : ALL_NOTIFIABLE_TYPES;
    return { enabled: obj.enabled === true, types };
  } catch {
    return { enabled: false, types: ALL_NOTIFIABLE_TYPES };
  }
}

function writeStoredSettings(settings: StoredSettings) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function buildContactHash(publicKey: string, label: string): string {
  return `#contact/${encodeURIComponent(publicKey)}/${encodeURIComponent(label)}`;
}

/**
 * Per-browser preference for new-node notifications (plan 28 item 1.5).
 *
 * Local only, same storage model as `useBrowserNotifications`' per-conversation
 * toggle: off by default, gated on the Notification permission, no server
 * setting involved. The backend already batches/rate-limits on busy meshes and
 * suppresses the initial catch-up burst (`app/services/new_node_notify.py`);
 * this hook only decides whether THIS browser shows an OS notification for an
 * event it already received, filtered by the user's chosen node types.
 */
export function useNewNodeNotifications() {
  const t = useT();
  const [permission, setPermission] = useState<NotificationPermissionState>(getInitialPermission);
  const [settings, setSettings] = useState<StoredSettings>(readStoredSettings);

  useEffect(() => {
    setPermission(getInitialPermission());
  }, []);

  const newNodeNotificationsEnabled = permission === 'granted' && settings.enabled;

  const setNewNodeNotificationsEnabled = useCallback(
    async (next: boolean) => {
      if (!next) {
        setSettings((prev) => {
          const updated = { ...prev, enabled: false };
          writeStoredSettings(updated);
          return updated;
        });
        return;
      }

      if (permission === 'unsupported') {
        toast.error(t('toast_new_node_notifications_unsupported_title'), {
          description: t('toast_new_node_notifications_unsupported_desc'),
        });
        return;
      }

      if (permission === 'denied') {
        toast.error(t('toast_new_node_notifications_denied_title'), {
          description: t('toast_new_node_notifications_denied_desc'),
        });
        return;
      }

      const nextPermission = await window.Notification.requestPermission();
      setPermission(nextPermission);

      if (nextPermission === 'granted') {
        setSettings((prev) => {
          const updated = { ...prev, enabled: true };
          writeStoredSettings(updated);
          return updated;
        });
        toast.success(t('toast_new_node_notifications_enabled_title'));
        return;
      }

      toast.error(t('toast_new_node_notifications_not_enabled_title'), {
        description:
          nextPermission === 'denied'
            ? t('toast_new_node_notifications_denied_desc')
            : t('toast_new_node_notifications_dismissed_desc'),
      });
    },
    [permission, t]
  );

  const setNewNodeNotificationType = useCallback((type: number, checked: boolean) => {
    setSettings((prev) => {
      const nextTypes = checked
        ? Array.from(new Set([...prev.types, type]))
        : prev.types.filter((existing) => existing !== type);
      const updated = { ...prev, types: nextTypes };
      writeStoredSettings(updated);
      return updated;
    });
  }, []);

  const handleNewNodeEvent = useCallback(
    (payload: NewNodePayload) => {
      if (!newNodeNotificationsEnabled) {
        return;
      }

      if (!payload.batched) {
        if (payload.type === null || !settings.types.includes(payload.type)) {
          return;
        }
        const label = payload.name || payload.public_key?.slice(0, 12) || '';
        const notification = new window.Notification(t('toast_new_node_title', { name: label }), {
          body: t('toast_new_node_body', { type: contactTypeLabel(payload.type, t) }),
          icon: NOTIFICATION_ICON_PATH,
          tag: `meshcore-new-node-${payload.public_key ?? label}`,
        });
        notification.onclick = () => {
          if (payload.public_key) {
            window.open(
              `${window.location.origin}${window.location.pathname}${buildContactHash(payload.public_key, label)}`,
              '_self'
            );
          }
          window.focus();
          notification.close();
        };
        return;
      }

      const matchedCount = Object.entries(payload.types).reduce((sum, [typeKey, count]) => {
        return settings.types.includes(Number(typeKey)) ? sum + count : sum;
      }, 0);
      if (matchedCount === 0) {
        return;
      }

      const notification = new window.Notification(
        t('toast_new_node_batch_title', { count: matchedCount }),
        {
          body: t('toast_new_node_batch_body'),
          icon: NOTIFICATION_ICON_PATH,
          tag: 'meshcore-new-node-batch',
        }
      );
      notification.onclick = () => {
        window.open(`${window.location.origin}${window.location.pathname}`, '_self');
        window.focus();
        notification.close();
      };
    },
    [newNodeNotificationsEnabled, settings.types, t]
  );

  return {
    newNodeNotificationsSupported: permission !== 'unsupported',
    newNodeNotificationsPermission: permission,
    newNodeNotificationsEnabled,
    newNodeNotificationTypes: settings.types,
    setNewNodeNotificationsEnabled,
    setNewNodeNotificationType,
    handleNewNodeEvent,
  };
}
