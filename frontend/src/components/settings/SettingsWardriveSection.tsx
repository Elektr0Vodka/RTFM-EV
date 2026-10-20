import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type {
  WardriveAdminStatus,
  WardriveGroup,
  WardriveUser,
  WardriveVisibility,
} from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { WardriveBrokersCard } from './WardriveBrokersCard';
import { WardriveCalibrationCard } from './WardriveCalibrationCard';
import { WardriveChannelsCard } from './WardriveChannelsCard';

const VISIBILITIES: WardriveVisibility[] = ['own', 'groups', 'all'];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wardrive plugin owner admin (shown only when MESHCORE_WARDRIVE is on):
 * the page address, a warning when the main login is off, wardrive users
 * with their radios, visibility and groups, and the groups themselves. The
 * coverage map is in Tools > Wardrive map (WardriveMapPage).
 * Self-contained: it loads and saves through /api/wardrive-admin.
 */
export function SettingsWardriveSection({ className }: { className?: string }) {
  const t = useT();
  const [status, setStatus] = useState<WardriveAdminStatus | null>(null);
  const [users, setUsers] = useState<WardriveUser[]>([]);
  const [groups, setGroupsState] = useState<WardriveGroup[]>([]);
  // The latest groups, also between renders: two membership clicks before the
  // first save returns must both build on what the owner already ticked.
  const groupsRef = useRef<WardriveGroup[]>([]);
  const setGroups = (next: WardriveGroup[]) => {
    groupsRef.current = next;
    setGroupsState(next);
  };
  const [newGroup, setNewGroup] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [nextStatus, nextUsers, nextGroups] = await Promise.all([
        api.getWardriveAdminStatus(),
        api.getWardriveUsers(),
        api.getWardriveGroups(),
      ]);
      setStatus(nextStatus);
      setUsers(nextUsers);
      setGroups(nextGroups);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (action: () => Promise<unknown>) => {
    let failure: string | null = null;
    try {
      await action();
    } catch (err) {
      failure = errorMessage(err);
    }
    await reload();
    // After the reload, which clears the error when it succeeds.
    if (failure) setError(failure);
  };

  const setVisibility = (user: WardriveUser, visibility: WardriveVisibility) =>
    run(() => api.patchWardriveUser(user.id, { visibility }));

  const setDisabled = (user: WardriveUser, disabled: boolean) =>
    run(() => api.patchWardriveUser(user.id, { disabled }));

  const deleteUser = (user: WardriveUser) => {
    if (!window.confirm(t('settings_wardrive_delete_user_confirm', { name: user.username }))) {
      return;
    }
    void run(() => api.deleteWardriveUser(user.id));
  };

  const removeRadio = (publicKey: string) => {
    if (
      !window.confirm(t('settings_wardrive_remove_radio_confirm', { key: publicKey.slice(0, 8) }))
    ) {
      return;
    }
    void run(() => api.deleteWardriveRadio(publicKey));
  };

  const toggleMember = (group: WardriveGroup, user: WardriveUser, member: boolean) => {
    const current = groupsRef.current.find((g) => g.id === group.id) ?? group;
    const others = current.member_ids.filter((id) => id !== user.id);
    const memberIds = member ? [...others, user.id] : others;
    setGroups(
      groupsRef.current.map((g) => (g.id === group.id ? { ...g, member_ids: memberIds } : g))
    );
    return run(() => api.setWardriveGroupMembers(group.id, memberIds));
  };

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    setNewGroup('');
    void run(() => api.createWardriveGroup(name));
  };

  const renameGroup = (group: WardriveGroup, input: HTMLInputElement) => {
    const trimmed = input.value.trim();
    if (!trimmed || trimmed === group.name) return;
    void run(async () => {
      try {
        await api.renameWardriveGroup(group.id, trimmed);
      } catch (err) {
        // Refused (a name already in use): show the stored name again.
        input.value = group.name;
        throw err;
      }
    });
  };

  const deleteGroup = (group: WardriveGroup) => {
    if (!window.confirm(t('settings_wardrive_delete_group_confirm', { name: group.name }))) {
      return;
    }
    void run(() => api.deleteWardriveGroup(group.id));
  };

  const pageUrl = status ? `${window.location.origin}${status.page_path}` : null;

  return (
    <div className={className}>
      <div className="space-y-3" data-testid="wardrive-settings">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_wardrive_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_wardrive_desc')}</p>

        {status?.unprotected && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          >
            {t('settings_wardrive_unprotected')}
          </div>
        )}

        {pageUrl && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
            <div className="text-sm font-medium">{t('settings_wardrive_page_label')}</div>
            <code className="block break-all text-xs">{pageUrl}</code>
            <p className="text-xs text-muted-foreground">{t('settings_wardrive_https_note')}</p>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        )}

        <WardriveChannelsCard />
        <WardriveBrokersCard />
        <WardriveCalibrationCard />

        <h4 className="text-sm font-semibold">{t('settings_wardrive_users_heading')}</h4>
        {users.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('settings_wardrive_no_users')}</p>
        )}
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              data-testid="wardrive-user"
              className="space-y-2 rounded-md border border-border p-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{user.username}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('settings_wardrive_obs_count', { count: user.obs_count })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    aria-label={t('settings_wardrive_visibility_for', { name: user.username })}
                    value={user.visibility}
                    onChange={(e) => void setVisibility(user, e.target.value as WardriveVisibility)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {t(`settings_wardrive_visibility_${v}`)}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={user.disabled}
                      aria-label={t('settings_wardrive_disabled_for', { name: user.username })}
                      onChange={(e) => void setDisabled(user, e.target.checked)}
                    />
                    {t('settings_wardrive_disabled')}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t('settings_wardrive_delete_user', { name: user.username })}
                    onClick={() => deleteUser(user)}
                  >
                    {t('settings_wardrive_delete')}
                  </Button>
                </div>
              </div>

              <ul className="space-y-1">
                {user.radios.map((radio) => (
                  <li key={radio.public_key} className="flex items-center gap-2 text-xs">
                    <code>{radio.public_key.slice(0, 8)}</code>
                    <span className="text-muted-foreground">{radio.name ?? ''}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('settings_wardrive_remove_radio', {
                        key: radio.public_key.slice(0, 8),
                      })}
                      onClick={() => removeRadio(radio.public_key)}
                    >
                      {t('settings_wardrive_remove')}
                    </Button>
                  </li>
                ))}
              </ul>

              {groups.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {groups.map((group) => (
                    <label key={group.id} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={group.member_ids.includes(user.id)}
                        aria-label={t('settings_wardrive_member_of', {
                          name: user.username,
                          group: group.name,
                        })}
                        onChange={(e) => void toggleMember(group, user, e.target.checked)}
                      />
                      {group.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{t('settings_wardrive_map_moved')}</p>

        <h4 className="text-sm font-semibold">{t('settings_wardrive_groups_heading')}</h4>
        <div className="space-y-2">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-wrap items-center gap-2">
              <Input
                defaultValue={group.name}
                aria-label={t('settings_wardrive_group_name', { name: group.name })}
                onBlur={(e) => renameGroup(group, e.currentTarget)}
                className="w-48"
              />
              <span className="text-xs text-muted-foreground">
                {t('settings_wardrive_member_count', { count: group.member_ids.length })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('settings_wardrive_delete_group', { name: group.name })}
                onClick={() => deleteGroup(group)}
              >
                {t('settings_wardrive_delete')}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="wardrive-new-group">{t('settings_wardrive_new_group')}</Label>
              <Input
                id="wardrive-new-group"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                className="w-48"
              />
            </div>
            <Button type="button" size="sm" onClick={addGroup} disabled={!newGroup.trim()}>
              {t('settings_wardrive_add_group')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
