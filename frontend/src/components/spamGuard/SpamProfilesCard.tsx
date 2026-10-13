import { useRef, useState } from 'react';

import { api } from '../../api';
import { useFilterProfiles } from '../../hooks/useFilterProfiles';
import { useT } from '../../i18n';
import type { FilterProfile, FilterProfilesState } from '../../types';
import { filterProfileErrorText } from '../../utils/filterProfileErrors';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from '../ui/sonner';
import { type PendingProfileApply, SpamProfileApplyDialog } from './SpamProfileApplyDialog';

const MAX_NAME_LENGTH = 64;

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    // A code, worded by filterProfileErrorText in the user's language.
    reader.onerror = () => reject(new Error('unreadable_file'));
    reader.readAsText(file);
  });
}

/**
 * Spam Guard profiles: saved sets of detection settings plus the mode, applied
 * by hand and shared as files. The card works with the saved settings only, so
 * everything that reads or writes them waits while the form below has edits.
 *
 * `version` is the Spam Guard settings version: a change there can make the
 * profile in use "modified". `onApplied` lets the page load the new settings.
 */
export function SpamProfilesCard({
  version,
  enabled,
  busy,
  formDirty,
  onApplied,
}: {
  version: number;
  enabled: boolean;
  busy: boolean;
  formDirty: boolean;
  onApplied: () => void;
}) {
  const t = useT();
  const profiles = useFilterProfiles('spam_guard', version);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [pending, setPending] = useState<PendingProfileApply | null>(null);

  const list = profiles.state?.profiles ?? [];
  const inUse = profiles.state?.in_use ?? null;
  const used = inUse ? (list.find((profile) => profile.id === inUse.profile_id) ?? null) : null;
  const working = busy || profiles.busy;
  // Reads or writes the saved settings: not while the form has edits, and not while off.
  const locked = working || formDirty || !enabled;

  // A refusal can mean the list here is out of date (a profile deleted in
  // another tab), so it is read again: the row would otherwise only give errors.
  const fail = (raw: string) => {
    toast.error(filterProfileErrorText(t, raw));
    void profiles.reload();
  };

  const run = async (call: () => Promise<FilterProfilesState>) => {
    const error = await profiles.run(call);
    if (error !== null) fail(error);
    return error === null;
  };

  const saveCurrent = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await run(() => api.createFilterProfile('spam_guard', name))) setNewName('');
  };

  const openApply = async (profile: FilterProfile) => {
    try {
      const answer = await api.getFilterProfileChanges(profile.id);
      setPending({ profile, changes: answer.changes });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmApply = async () => {
    if (!pending) return;
    const toProtect = pending.changes.some(
      (change) => change.key === 'mode' && change.to === 'protect'
    );
    await run(() => api.applyFilterProfile(pending.profile.id, toProtect));
    setPending(null);
    // Also after a refusal: a conflict means the settings changed elsewhere.
    onApplied();
  };

  const saveName = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    if (await run(() => api.updateFilterProfile(renaming.id, { name }))) setRenaming(null);
  };

  const remove = (profile: FilterProfile) => {
    if (!window.confirm(t('spam_profiles_delete_confirm', { name: profile.name }))) return;
    void run(() => api.deleteFilterProfile(profile.id));
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    await run(async () => api.importFilterProfile(await readText(file)));
    // The same file can be picked again after it was corrected.
    if (fileRef.current) fileRef.current.value = '';
  };

  const summary = (profile: FilterProfile) =>
    t('spam_profiles_summary', {
      mode: t(`spam_mode_${profile.payload.mode}`),
      sensitivity: t(`spam_sensitivity_${profile.payload.sensitivity}`),
    });

  return (
    <section
      className="space-y-3 rounded-md border border-border/60 p-3"
      data-testid="spam-profiles"
    >
      <h3 className="text-sm font-semibold text-foreground">{t('spam_profiles_title')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('spam_profiles_desc')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          {used
            ? t(inUse?.modified ? 'spam_profiles_in_use_modified' : 'spam_profiles_in_use', {
                name: used.name,
              })
            : t('spam_profiles_none_in_use')}
        </span>
        {used && inUse?.modified && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={locked}
              onClick={() => void run(() => api.updateFilterProfile(used.id, { capture: true }))}
            >
              {t('spam_profiles_save_to')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={locked}
              onClick={() => void openApply(used)}
            >
              {t('spam_profiles_revert')}
            </Button>
          </>
        )}
      </div>

      {formDirty && (
        <p className="text-[0.8125rem] text-warning">{t('spam_profiles_unsaved_hint')}</p>
      )}

      {list.length === 0 ? (
        <p className="text-[0.8125rem] italic text-muted-foreground">{t('spam_profiles_empty')}</p>
      ) : (
        <ul className="space-y-1">
          {list.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted px-2 py-1"
              data-testid={`spam-profile-${profile.id}`}
            >
              {renaming?.id === profile.id ? (
                <span className="flex flex-wrap items-center gap-1">
                  <Input
                    className="h-8 w-56"
                    aria-label={t('spam_profiles_rename_label', { name: profile.name })}
                    value={renaming.name}
                    maxLength={MAX_NAME_LENGTH}
                    onChange={(event) => setRenaming({ id: profile.id, name: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={working || !renaming.name.trim()}
                    onClick={() => void saveName()}
                  >
                    {t('spam_profiles_rename_save')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setRenaming(null)}
                  >
                    {t('spam_profiles_rename_cancel')}
                  </Button>
                </span>
              ) : (
                <span className="min-w-0">
                  <span className="block truncate text-sm">{profile.name}</span>
                  <span className="block text-xs text-muted-foreground">{summary(profile)}</span>
                  {profile.description && (
                    <span className="block text-xs text-muted-foreground">
                      {profile.description}
                    </span>
                  )}
                </span>
              )}
              <span className="flex shrink-0 flex-wrap gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={locked}
                  aria-label={t('spam_profiles_apply_label', { name: profile.name })}
                  onClick={() => void openApply(profile)}
                >
                  {t('spam_profiles_apply')}
                </Button>
                <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                  <a href={api.filterProfileExportUrl(profile.id)} download>
                    {t('spam_profiles_export')}
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={working}
                  onClick={() => setRenaming({ id: profile.id, name: profile.name })}
                >
                  {t('spam_profiles_rename')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={working}
                  aria-label={t('spam_profiles_delete_label', { name: profile.name })}
                  onClick={() => remove(profile)}
                >
                  {t('spam_profiles_delete')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 w-56"
          placeholder={t('spam_profiles_new_placeholder')}
          aria-label={t('spam_profiles_new_placeholder')}
          value={newName}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked || !newName.trim()}
          onClick={() => void saveCurrent()}
        >
          {t('spam_profiles_save_current')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => fileRef.current?.click()}
        >
          {t('spam_profiles_import')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="spam-profile-file"
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
      </div>

      <SpamProfileApplyDialog
        pending={pending}
        busy={working}
        onConfirm={() => void confirmApply()}
        onClose={() => setPending(null)}
      />
    </section>
  );
}
