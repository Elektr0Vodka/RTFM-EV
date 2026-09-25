import { useState, useCallback, useEffect, useRef } from 'react';
import { api, ApiError } from '../api';
import { takePrefetchOrFetch } from '../prefetch';
import { toast } from '../components/ui/sonner';
import { initLastMessageTimes } from '../utils/conversationState';
import { readLegacyLocalOrders, clearLegacyLocalOrders } from '../utils/sidebarLayout';
import {
  readLegacyHiddenHopWidths,
  clearLegacyHiddenHopWidths,
} from '../utils/messageHopFilterPreference';
import type { AppSettings, AppSettingsUpdate } from '../types';

export function useAppSettings() {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  // One-time migration guards
  const hasMigratedRef = useRef(false);
  const hasMigratedOrdersRef = useRef(false);
  const hasMigratedHopWidthsRef = useRef(false);
  // Bumped each time the server confirms a new hop-size filter, so the app can
  // re-fetch the unread counts the server derives from it.
  const [hiddenHopWidthsVersion, setHiddenHopWidthsVersion] = useState(0);

  const fetchAppSettings = useCallback(async () => {
    try {
      const data = await takePrefetchOrFetch('settings', api.getSettings);
      setAppSettings(data);
      initLastMessageTimes(data.last_message_times ?? {});
    } catch (err) {
      console.error('Failed to fetch app settings:', err);
    }
  }, []);

  const handleSaveAppSettings = useCallback(
    async (update: AppSettingsUpdate) => {
      await api.updateSettings(update);
      await fetchAppSettings();
    },
    [fetchAppSettings]
  );

  // Chat "Hide by hop size" filter. Optimistic so the message list reacts at
  // once; the server copy drives unread counts and Web Push.
  const handleSetHiddenHopWidths = useCallback(async (widths: number[]) => {
    const next = [...new Set(widths)].sort();
    setAppSettings((prev) => (prev ? { ...prev, hidden_hop_widths: next } : prev));
    try {
      setAppSettings(await api.updateSettings({ hidden_hop_widths: next }));
      setHiddenHopWidthsVersion((v) => v + 1);
    } catch (err) {
      console.error('Failed to save hop-size filter:', err);
      try {
        setAppSettings(await api.getSettings());
      } catch {
        // If refetch also fails, leave optimistic state
      }
    }
  }, []);

  const handleToggleBlockedKey = useCallback(async (key: string) => {
    const normalizedKey = key.toLowerCase();
    setAppSettings((prev) => {
      if (!prev) return prev;
      const current = prev.blocked_keys ?? [];
      const wasBlocked = current.includes(normalizedKey);
      const optimistic = wasBlocked
        ? current.filter((k) => k !== normalizedKey)
        : [...current, normalizedKey];
      return { ...prev, blocked_keys: optimistic };
    });

    try {
      const updatedSettings = await api.toggleBlockedKey(key);
      setAppSettings(updatedSettings);
    } catch (err) {
      console.error('Failed to toggle blocked key:', err);
      try {
        const settings = await api.getSettings();
        setAppSettings(settings);
      } catch {
        // If refetch also fails, leave optimistic state
      }
      toast.error('Failed to update blocked key');
    }
  }, []);

  const handleToggleBlockedName = useCallback(async (name: string) => {
    setAppSettings((prev) => {
      if (!prev) return prev;
      const current = prev.blocked_names ?? [];
      const wasBlocked = current.includes(name);
      const optimistic = wasBlocked ? current.filter((n) => n !== name) : [...current, name];
      return { ...prev, blocked_names: optimistic };
    });

    try {
      const updatedSettings = await api.toggleBlockedName(name);
      setAppSettings(updatedSettings);
    } catch (err) {
      console.error('Failed to toggle blocked name:', err);
      try {
        const settings = await api.getSettings();
        setAppSettings(settings);
      } catch {
        // If refetch also fails, leave optimistic state
      }
      toast.error('Failed to update blocked name');
    }
  }, []);

  const handleToggleTrackedTelemetry = useCallback(async (publicKey: string) => {
    const key = publicKey.toLowerCase();
    setAppSettings((prev) => {
      if (!prev) return prev;
      const current = prev.tracked_telemetry_repeaters ?? [];
      const wasTracked = current.includes(key);
      const optimistic = wasTracked ? current.filter((k) => k !== key) : [...current, key];
      return { ...prev, tracked_telemetry_repeaters: optimistic };
    });

    try {
      const result = await api.toggleTrackedTelemetry(publicKey);
      setAppSettings((prev) =>
        prev ? { ...prev, tracked_telemetry_repeaters: result.tracked_telemetry_repeaters } : prev
      );
    } catch (err) {
      console.error('Failed to toggle tracked telemetry:', err);
      try {
        const settings = await api.getSettings();
        setAppSettings(settings);
      } catch {
        // If refetch also fails, leave optimistic state
      }
      toast.error(
        err instanceof ApiError && err.message ? err.message : 'Failed to update tracked telemetry'
      );
    }
  }, []);

  const handleToggleTrackedTelemetryContact = useCallback(async (publicKey: string) => {
    const key = publicKey.toLowerCase();
    setAppSettings((prev) => {
      if (!prev) return prev;
      const current = prev.tracked_telemetry_contacts ?? [];
      const wasTracked = current.includes(key);
      const optimistic = wasTracked ? current.filter((k) => k !== key) : [...current, key];
      return { ...prev, tracked_telemetry_contacts: optimistic };
    });

    try {
      const result = await api.toggleTrackedTelemetryContact(publicKey);
      setAppSettings((prev) =>
        prev ? { ...prev, tracked_telemetry_contacts: result.tracked_telemetry_contacts } : prev
      );
    } catch (err) {
      console.error('Failed to toggle tracked contact telemetry:', err);
      try {
        const settings = await api.getSettings();
        setAppSettings(settings);
      } catch {
        // If refetch also fails, leave optimistic state
      }
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : 'Failed to update tracked contact telemetry'
      );
    }
  }, []);

  // Legacy favorites migration: if pre-server-side favorites exist in
  // localStorage, toggle each one via the existing API and clear the key.
  useEffect(() => {
    if (!appSettings || hasMigratedRef.current) return;
    hasMigratedRef.current = true;

    const FAVORITES_KEY = 'remoteterm-favorites';
    let localFavorites: Array<{ type: 'channel' | 'contact'; id: string }> = [];
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      if (stored) localFavorites = JSON.parse(stored);
    } catch {
      // corrupt or unavailable
    }
    if (localFavorites.length === 0) return;

    const migrate = async () => {
      let migrated = 0;
      for (const f of localFavorites) {
        try {
          await api.toggleFavorite(f.type, f.id);
          migrated++;
        } catch {
          // Entity may have been deleted; skip and continue
        }
      }
      localStorage.removeItem(FAVORITES_KEY);
      // Reload so contacts/channels pick up the new favorite flags
      if (migrated > 0) window.location.reload();
    };
    migrate();
  }, [appSettings]);

  // One-time migration: move any pre-server-side sidebar drag orders from
  // localStorage to the backend (reverses the old localStorage-only behaviour).
  // Runs once when settings first load; if the server already has an order, the
  // stale local keys are just cleared.
  useEffect(() => {
    if (!appSettings || hasMigratedOrdersRef.current) return;
    hasMigratedOrdersRef.current = true;

    const serverUnset =
      (appSettings.sidebar_section_order?.length ?? 0) === 0 &&
      (appSettings.sidebar_tool_order?.length ?? 0) === 0;
    if (!serverUnset) {
      clearLegacyLocalOrders();
      return;
    }

    const legacy = readLegacyLocalOrders();
    if (!legacy.section && !legacy.tool) return;

    const update: AppSettingsUpdate = {};
    if (legacy.section) update.sidebar_section_order = legacy.section;
    if (legacy.tool) update.sidebar_tool_order = legacy.tool;

    const migrateOrders = async () => {
      try {
        await api.updateSettings(update);
        await fetchAppSettings();
      } finally {
        clearLegacyLocalOrders();
      }
    };
    void migrateOrders();
  }, [appSettings, fetchAppSettings]);

  // One-time migration: the hop-size filter used to be browser-local. Carry an
  // old local choice to the server when the server has none, then drop the key.
  useEffect(() => {
    if (!appSettings || hasMigratedHopWidthsRef.current) return;
    hasMigratedHopWidthsRef.current = true;

    const legacy = readLegacyHiddenHopWidths();
    if (legacy.length === 0 || (appSettings.hidden_hop_widths?.length ?? 0) > 0) {
      clearLegacyHiddenHopWidths();
      return;
    }
    const migrateHopWidths = async () => {
      try {
        setAppSettings(await api.updateSettings({ hidden_hop_widths: legacy }));
        setHiddenHopWidthsVersion((v) => v + 1);
        clearLegacyHiddenHopWidths();
      } catch (err) {
        // Keep the local key so the next load can retry.
        console.error('Failed to migrate hop-size filter:', err);
      }
    };
    void migrateHopWidths();
  }, [appSettings]);

  return {
    appSettings,
    fetchAppSettings,
    handleSaveAppSettings,
    handleSetHiddenHopWidths,
    hiddenHopWidthsVersion,
    handleToggleBlockedKey,
    handleToggleBlockedName,
    handleToggleTrackedTelemetry,
    handleToggleTrackedTelemetryContact,
  };
}
