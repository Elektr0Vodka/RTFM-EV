import { RepeaterPane, NotFetched, KvRow } from './repeaterPaneShared';
import { useT } from '../../i18n';
import type { RepeaterOwnerInfoResponse, PaneState } from '../../types';

function LabeledBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-0.5">
      <span className="text-sm text-muted-foreground whitespace-nowrap">{label}</span>
      <p className="text-sm font-medium mt-0.5 break-words">{value}</p>
    </div>
  );
}

export function OwnerInfoPane({
  data,
  state,
  onRefresh,
  disabled,
}: {
  data: RepeaterOwnerInfoResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <RepeaterPane
      title={t('repeater_owner_info_title')}
      state={state}
      onRefresh={onRefresh}
      disabled={disabled}
    >
      {!data ? (
        <NotFetched />
      ) : (
        <div className="space-y-1">
          <LabeledBlock label={t('repeater_owner_info_title')} value={data.owner_info ?? '—'} />
          <KvRow label={t('repeater_firmware_label')} value={data.firmware_version ?? '—'} />
          {data.name && <KvRow label={t('common_name')} value={data.name} />}
          <KvRow label={t('repeater_guest_password_label')} value={data.guest_password ?? '—'} />
        </div>
      )}
    </RepeaterPane>
  );
}
