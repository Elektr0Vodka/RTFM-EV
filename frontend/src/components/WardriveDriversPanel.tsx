import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import type { WardriveAuditEntry, WardriveGroup, WardriveUser, WardriveVisibility } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const VISIBILITIES: WardriveVisibility[] = ['own', 'groups', 'all'];
const MIN_PASSWORD = 10;
const AUDIT_LIMIT = 100;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const when = (sec: number) => new Date(sec * 1000).toLocaleString();

export interface ViewAsChoice {
  asUser?: number;
  asGroup?: number;
}

/**
 * Tools > Wardrive, Drivers tab: the owner manages the drivers (visibility,
 * disable, delete, radios, groups and membership), sees when each last
 * logged in, sets a new password (RTFM-EV sends no mail, so this is the
 * reset), reads the audit log and opens the map as a driver. Moved here from
 * Settings > Wardrive, which keeps the module's configuration.
 */
export function WardriveDriversPanel({ onViewAs }: { onViewAs?: (v: ViewAsChoice) => void }) {
  const t = useT();
  const [users, setUsers] = useState<WardriveUser[]>([]);
  const [groups, setGroupsState] = useState<WardriveGroup[]>([]);
  // The latest groups, also between renders: two membership clicks before the
  // first save returns must both build on what the owner already ticked.
  const groupsRef = useRef<WardriveGroup[]>([]);
  const setGroups = (next: WardriveGroup[]) => {
    groupsRef.current = next;
    setGroupsState(next);
  };
  const [audit, setAudit] = useState<WardriveAuditEntry[]>([]);
  const [newGroup, setNewGroup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [passwordDone, setPasswordDone] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [nextUsers, nextGroups, nextAudit] = await Promise.all([
        api.getWardriveUsers(),
        api.getWardriveGroups(),
        api.getWardriveAudit(AUDIT_LIMIT),
      ]);
      setUsers(nextUsers);
      setGroups(nextGroups);
      setAudit(nextAudit.entries);
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

  const savePassword = (user: WardriveUser) => {
    const value = password;
    void run(async () => {
      await api.setWardrivePassword(user.id, value);
      setPasswordFor(null);
      setPassword('');
      setPasswordDone(t('wardrive_drivers_password_done', { name: user.username }));
    });
  };

  const actorOf = (e: WardriveAuditEntry) =>
    e.actor_kind === 'owner'
      ? t('wardrive_audit_owner')
      : (e.actor_name ?? (e.actor_id !== null ? `#${e.actor_id}` : '?'));

  return (
    <div className="space-y-3 p-4" data-testid="wardrive-drivers">
      <p className="text-xs text-muted-foreground">{t('wardrive_drivers_intro')}</p>
      {error && (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      )}
      {passwordDone && (
        <p className="text-xs text-success" aria-live="polite">
          {passwordDone}
        </p>
      )}

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
                <div className="text-xs text-muted-foreground">
                  {user.last_login_at
                    ? t('wardrive_drivers_last_login', { when: when(user.last_login_at) })
                    : t('wardrive_drivers_never')}
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
                {onViewAs && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onViewAs({ asUser: user.id })}
                  >
                    {t('wardrive_drivers_view_as', { name: user.username })}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('wardrive_drivers_set_password_for', { name: user.username })}
                  onClick={() => {
                    setPasswordFor(passwordFor === user.id ? null : user.id);
                    setPassword('');
                    setPasswordDone(null);
                  }}
                >
                  {t('wardrive_drivers_set_password')}
                </Button>
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

            {passwordFor === user.id && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`wardrive-password-${user.id}`}>
                    {t('wardrive_drivers_password_label')}
                  </Label>
                  <Input
                    id={`wardrive-password-${user.id}`}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-56"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={password.length < MIN_PASSWORD}
                  onClick={() => savePassword(user)}
                >
                  {t('wardrive_drivers_password_save')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPasswordFor(null);
                    setPassword('');
                  }}
                >
                  {t('wardrive_drivers_password_cancel')}
                </Button>
              </div>
            )}

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
            {onViewAs && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onViewAs({ asGroup: group.id })}
              >
                {t('wardrive_drivers_view_as', { name: group.name })}
              </Button>
            )}
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

      <section aria-label={t('wardrive_drivers_audit')} className="space-y-1">
        <h4 className="text-sm font-semibold">{t('wardrive_drivers_audit')}</h4>
        {audit.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('wardrive_drivers_audit_none')}</p>
        ) : (
          <ul className="max-h-80 space-y-0.5 overflow-y-auto text-xs">
            {audit.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-muted-foreground">{when(e.at)}</span>
                <span className="font-medium">{actorOf(e)}</span>
                <span>{t(`wardrive_audit_${e.action}`)}</span>
                {e.target_kind && e.target_id && (
                  <span className="text-muted-foreground">{`${e.target_kind} ${e.target_id.slice(0, 16)}`}</span>
                )}
                {e.detail && (
                  <span className="break-all text-muted-foreground">
                    {JSON.stringify(e.detail)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
