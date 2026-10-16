import { useState } from 'react';
import { ChevronDown, ChevronUp, Lock } from 'lucide-react';

import { useT } from '../../i18n';
import { BUDDY_ANCHORS } from '../../buddy/buddyAnchors';
import type { Contact, Conversation } from '../../types';
import { SensorDashboardBody } from './SensorDashboardBody';

/**
 * Collapsible sensor login + dashboard shown above a sensor's chat. The chat
 * stays: stock sensors send their alerts as plain DMs (SensorMesh::sendAlert).
 * Collapsed by default so the messages are what you see first.
 */
export function SensorDashboardPanel({
  conversation,
  contacts,
}: {
  conversation: Conversation;
  contacts: Contact[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t('sensor_dashboard_login');

  return (
    <div data-buddy-anchor={BUDDY_ANCHORS.sensorPanel} className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={label}
        className="w-full flex items-center justify-between gap-2 px-4 py-2 bg-muted/40 text-sm font-medium hover:bg-muted/60 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {label}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="max-h-[60vh] overflow-y-auto p-4">
          <SensorDashboardBody conversation={conversation} contacts={contacts} />
        </div>
      )}
    </div>
  );
}
