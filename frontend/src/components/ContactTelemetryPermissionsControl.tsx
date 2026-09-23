import { useCallback, useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import type { Contact, ContactTelemetryPermissions } from '../types';
import { toast } from './ui/sonner';

// Firmware TELEM_PERM_* bits. The radio keeps them in contact.flags >> 1
// (flags bit 0 is its favourite bit).
const PERM_BITS: Record<keyof ContactTelemetryPermissions, number> = {
  base: 0x01,
  location: 0x02,
  environment: 0x04,
};

const PERM_ORDER: (keyof ContactTelemetryPermissions)[] = ['base', 'location', 'environment'];

const PERM_LABEL_KEY: Record<keyof ContactTelemetryPermissions, string> = {
  base: 'contact_telemetry_perms_base',
  location: 'contact_telemetry_perms_location',
  environment: 'contact_telemetry_perms_environment',
};

function effectivePerms(contact: Contact): number {
  return contact.telemetry_perms ?? (contact.flags >> 1) & 0x07;
}

function toRequest(perms: number): ContactTelemetryPermissions {
  return {
    base: (perms & PERM_BITS.base) !== 0,
    location: (perms & PERM_BITS.location) !== 0,
    environment: (perms & PERM_BITS.environment) !== 0,
  };
}

/**
 * Per-contact telemetry sharing: which telemetry this radio answers with when
 * the contact requests it. Only honoured by the firmware for categories whose
 * radio-wide mode is Per-Contact (Settings > Radio).
 */
export function ContactTelemetryPermissionsControl({ contact }: { contact: Contact }) {
  const t = useT();
  const publicKey = contact.public_key;
  const serverPerms = effectivePerms(contact);
  const [perms, setPerms] = useState(serverPerms);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPerms(serverPerms);
  }, [serverPerms]);

  const toggle = useCallback(
    async (key: keyof ContactTelemetryPermissions) => {
      if (saving) return;
      const previous = perms;
      const next = perms ^ PERM_BITS[key];
      setPerms(next);
      setSaving(true);
      try {
        const result = await api.setContactTelemetryPermissions(publicKey, toRequest(next));
        if (!result.applied_to_radio) toast.success(t('contact_telemetry_perms_pending'));
      } catch {
        setPerms(previous);
        toast.error(t('contact_telemetry_perms_error'));
      } finally {
        setSaving(false);
      }
    },
    [perms, publicKey, saving, t]
  );

  return (
    <div className="px-5 py-3 border-b border-border space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Share2 className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t('contact_telemetry_perms_label')}</span>
      </div>
      <div className="flex gap-1" role="group" aria-label={t('contact_telemetry_perms_label')}>
        {PERM_ORDER.map((key) => {
          const active = (perms & PERM_BITS[key]) !== 0;
          return (
            <button
              key={key}
              type="button"
              disabled={saving}
              aria-pressed={active}
              onClick={() => void toggle(key)}
              className={`flex-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(PERM_LABEL_KEY[key])}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('contact_telemetry_perms_hint', {
          perContact: t('settings_radio_telemetry_per_contact'),
        })}
      </p>
    </div>
  );
}
