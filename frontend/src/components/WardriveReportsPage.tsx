import { useEffect, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import { loadShareBrand } from '../share/shareBrand';
import type { WardriveGroup, WardriveUser } from '../types';
import { DrivesPanel } from '../wardrive/reports/DrivesPanel';
import { ReportPanel } from '../wardrive/reports/ReportPanel';
import { ReportShare } from '../wardrive/reports/ReportShare';
import type { DriveFilter } from '../wardrive/reports/types';
import { adminDrivesApi } from './wardriveAdminDrivesApi';

const SELECT = 'h-8 rounded-md border border-input bg-background px-2 text-sm';
const DAY_S = 86400;
const WINDOW_DAYS = [7, 30, 365, 0] as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tools > Wardrive reports (shown only when MESHCORE_WARDRIVE is on): every
 * driver's drives, managed by the owner, and reports, share cards and
 * exports over the picked drives or a filter. Reads through /api/wardrive-admin.
 */
export function WardriveReportsPage() {
  const t = useT();
  const [users, setUsers] = useState<WardriveUser[]>([]);
  const [groups, setGroups] = useState<WardriveGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState('');
  const [group, setGroup] = useState('');
  const [radio, setRadio] = useState('');
  const [days, setDays] = useState<number>(30);
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getWardriveUsers(), api.getWardriveGroups()]).then(
      ([nextUsers, nextGroups]) => {
        if (cancelled) return;
        setUsers(nextUsers);
        setGroups(nextGroups);
      },
      (err) => {
        if (!cancelled) setError(errorMessage(err));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const filter: DriveFilter = {
    user_id: user ? Number(user) : undefined,
    group_id: group ? Number(group) : undefined,
    radio_key: radio || undefined,
    since: days ? Math.floor(Date.now() / 1000) - days * DAY_S : undefined,
  };
  const filterKey = `${user}:${group}:${radio}:${days}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-base font-semibold text-foreground">{t('nav_wardrive_reports')}</h2>
        <p className="text-xs text-muted-foreground">{t('wardrive_reports_page_intro')}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error && (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{t('wardrive_map_user')}</span>
            <select
              aria-label={t('wardrive_map_user')}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className={SELECT}
            >
              <option value="">{t('wardrive_map_all_users')}</option>
              {users.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.username}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{t('wardrive_map_group')}</span>
            <select
              aria-label={t('wardrive_map_group')}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className={SELECT}
            >
              <option value="">{t('wardrive_map_all_groups')}</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{t('wardrive_map_radio')}</span>
            <select
              aria-label={t('wardrive_map_radio')}
              value={radio}
              onChange={(e) => setRadio(e.target.value)}
              className={SELECT}
            >
              <option value="">{t('wardrive_map_all_radios')}</option>
              {users
                .filter((u) => !user || String(u.id) === user)
                .flatMap((u) =>
                  u.radios.map((r) => (
                    <option key={r.public_key} value={r.public_key}>
                      {`${r.name || r.public_key.slice(0, 8)} (${u.username})`}
                    </option>
                  ))
                )}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">
              {t('wardrive_reports_window')}
            </span>
            <select
              aria-label={t('wardrive_reports_window')}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className={SELECT}
            >
              {WINDOW_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d
                    ? t('wardrive_page_report_days', { count: d })
                    : t('wardrive_reports_all_time')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('wardrive_reports_drives')}</h3>
          <DrivesPanel
            api={adminDrivesApi}
            filter={filter}
            reloadKey={filterKey}
            selected={picked}
            onSelectedChange={setPicked}
            showDriver
          />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('wardrive_reports_report')}</h3>
          <p className="text-xs text-muted-foreground">
            {picked.length
              ? t('wardrive_page_report_picked', { count: picked.length })
              : t('wardrive_reports_filter_scope')}
          </p>
          <ReportPanel
            api={adminDrivesApi}
            query={picked.length ? { drive: picked } : filter}
            reloadKey={picked.length ? picked.join(',') : filterKey}
            cards={(report) => <ReportShare report={report} brand={loadShareBrand} />}
          />
        </section>
      </div>
    </div>
  );
}
