import { useCallback, useEffect, useState } from 'react';

import { api, isAbortError } from '../api';
import { toast } from '../components/ui/sonner';
import { useT } from '../i18n';
import type { ContactAnalytics, TelemetryHistoryEntry } from '../types';

export interface ContactInfoData {
  analytics: ContactAnalytics | null;
  loading: boolean;
  telemetryLoading: boolean;
  telemetryHistory: TelemetryHistoryEntry[];
  fetchTelemetry: () => Promise<void>;
}

/**
 * Shared data loader for the contact info surfaces (mobile Sheet + desktop
 * full-page view). Accepts the same `contactKey` the pane uses: a full public
 * key, or a `name:<value>` token for name-only contacts. Telemetry is only
 * available for real (keyed) contacts.
 */
export function useContactInfoData(contactKey: string | null): ContactInfoData {
  const t = useT();
  const isNameOnly = contactKey?.startsWith('name:') ?? false;
  const nameOnlyValue = isNameOnly && contactKey ? contactKey.slice(5) : null;

  const [analytics, setAnalytics] = useState<ContactAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryHistoryEntry[]>([]);

  useEffect(() => {
    if (!contactKey) {
      setAnalytics(null);
      return;
    }

    const controller = new AbortController();
    setAnalytics(null);
    setLoading(true);
    const request =
      isNameOnly && nameOnlyValue
        ? api.getContactAnalytics({ name: nameOnlyValue }, controller.signal)
        : api.getContactAnalytics({ publicKey: contactKey }, controller.signal);

    request
      .then((data) => {
        if (!controller.signal.aborted) setAnalytics(data);
      })
      .catch((err) => {
        if (!isAbortError(err)) {
          console.error('Failed to fetch contact analytics:', err);
          toast.error(t('toast_failed_load_contact_info'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [contactKey, isNameOnly, nameOnlyValue, t]);

  useEffect(() => {
    if (!contactKey || isNameOnly) {
      setTelemetryHistory([]);
      return;
    }
    let cancelled = false;
    api
      .contactTelemetryHistory(contactKey)
      .then((data) => {
        if (!cancelled) setTelemetryHistory(data);
      })
      .catch(() => {
        if (!cancelled) setTelemetryHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [contactKey, isNameOnly]);

  const fetchTelemetry = useCallback(async () => {
    if (!contactKey || isNameOnly) return;
    setTelemetryLoading(true);
    try {
      const result = await api.requestContactTelemetry(contactKey);
      setTelemetryHistory(result.telemetry_history);
    } catch (err) {
      if (!isAbortError(err)) {
        toast.error(err instanceof Error ? err.message : t('toast_failed_fetch_telemetry'));
      }
    } finally {
      setTelemetryLoading(false);
    }
  }, [contactKey, isNameOnly, t]);

  return { analytics, loading, telemetryLoading, telemetryHistory, fetchTelemetry };
}
