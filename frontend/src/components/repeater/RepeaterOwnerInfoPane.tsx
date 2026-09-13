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
  publicKey,
  onSaveOwnerInfo,
}: {
  data: RepeaterOwnerInfoResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
  publicKey?: string;
  onSaveOwnerInfo?: (publicKey: string, ownerInfo: string) => void;
}) {
  const t = useT();
  const hasConflict =
    !!data &&
    !data.owner_info_updated &&
    !!data.owner_info &&
    !!data.stored_owner_info &&
    data.owner_info !== data.stored_owner_info;
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
          {data.owner_info_updated && (
            <p className="text-xs text-green-600">{t('repeater_owner_info_autofilled')}</p>
          )}
          {hasConflict && (
            <div className="mt-1">
              <p className="text-xs text-muted-foreground">
                {t('repeater_owner_info_conflict', {
                  fetched: data.owner_info ?? '',
                  stored: data.stored_owner_info ?? '',
                })}
              </p>
              {publicKey && onSaveOwnerInfo && (
                <button
                  type="button"
                  className="mt-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
                  onClick={() => onSaveOwnerInfo(publicKey, data.owner_info!)}
                >
                  {t('repeater_owner_info_override')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </RepeaterPane>
  );
}
