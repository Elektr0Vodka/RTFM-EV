import { useCallback, useEffect, useState } from 'react';
import { TerminalSquare } from 'lucide-react';

import { api } from '../api';
import { BUDDY_ANCHORS } from '../buddy/buddyAnchors';
import { useT } from '../i18n';
import type { Contact } from '../types';
import { toast } from './ui/sonner';

// Companion firmware 1.18 ContactInfo::isRemoteCLIAllowed() is contact.flags bit 0x10.
const REMOTE_CLI_FLAG = 0x10;

function effective(contact: Contact): boolean {
  return contact.remote_cli ?? (contact.flags & REMOTE_CLI_FLAG) !== 0;
}

/** Whether this contact may run commands on our radio over the mesh (firmware 1.18+). */
export function ContactRemoteCliControl({ contact }: { contact: Contact }) {
  const t = useT();
  const serverValue = effective(contact);
  const [enabled, setEnabled] = useState(serverValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(serverValue);
  }, [serverValue]);

  const toggle = useCallback(async () => {
    if (saving) return;
    const next = !enabled;
    if (next && !window.confirm(t('contact_remote_cli_confirm'))) return;
    setEnabled(next);
    setSaving(true);
    try {
      const result = await api.setContactRemoteCli(contact.public_key, next);
      if (!result.applied_to_radio) toast.success(t('contact_remote_cli_pending'));
    } catch {
      setEnabled(!next);
      toast.error(t('contact_remote_cli_error'));
    } finally {
      setSaving(false);
    }
  }, [contact.public_key, enabled, saving, t]);

  return (
    <div
      data-buddy-anchor={BUDDY_ANCHORS.remoteCli}
      className="px-5 py-3 border-b border-border space-y-1"
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <TerminalSquare className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          {t('contact_remote_cli_label')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('contact_remote_cli_label')}
          disabled={saving}
          onClick={toggle}
          className={`rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
            enabled
              ? 'border-destructive text-destructive'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {enabled ? t('contact_remote_cli_on') : t('contact_remote_cli_off')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('contact_remote_cli_hint')}</p>
    </div>
  );
}
