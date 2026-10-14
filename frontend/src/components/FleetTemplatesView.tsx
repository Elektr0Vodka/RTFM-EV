/**
 * Tools > Fleet > Config templates: configs with variables, to create a
 * config for an asset from.
 *
 * A template is a config document (the toolbox's file format, or the
 * companion's version 1 file) with `{{name}}` in its text values, plus the
 * list of those variables. It never holds a secret value; the server refuses
 * one. Templates are stored rows only: nothing here reaches a device.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import type {
  FleetConfigProfile,
  FleetConfigTemplate,
  FleetConfigVariable,
  FleetConfigVariableType,
} from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

const PROFILES: FleetConfigProfile[] = ['stock', 'dmc_repeater', 'dmc_observer', 'companion_v1'];
const VARIABLE_TYPES: FleetConfigVariableType[] = ['text', 'number', 'boolean'];
const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground';

interface EditorState {
  /** Null while the template is new and not stored yet. */
  id: number | null;
  name: string;
  description: string;
  profile: FleetConfigProfile;
  role: string;
  /** The document as the text in the editor; parsed on save. */
  document: string;
  variables: FleetConfigVariable[];
}

const NEW_TEMPLATE: EditorState = {
  id: null,
  name: '',
  description: '',
  profile: 'stock',
  role: '',
  document: JSON.stringify({ vars: {} }, null, 2),
  variables: [],
};

function editorOf(template: FleetConfigTemplate): EditorState {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
    profile: template.profile,
    role: template.role ?? '',
    document: JSON.stringify(template.document, null, 2),
    variables: template.variables.map((variable) => ({ ...variable })),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FleetTemplatesView({
  onBack,
}: {
  /** Back to the fleet list. */
  onBack: () => void;
}) {
  const t = useT();
  const [templates, setTemplates] = useState<FleetConfigTemplate[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setTemplates(await api.fleetConfigTemplates(signal));
      } catch (err) {
        if (!isAbortError(err)) {
          setError(t('fleet_templates_load_failed', { error: errorMessage(err) }));
        }
      }
    },
    [t]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const open = (next: EditorState | null) => {
    setEditor(next);
    setError(null);
    setSaved(false);
    setDeleteArmed(false);
  };

  const change = (patch: Partial<EditorState>) => {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
    setDeleteArmed(false);
  };

  const changeVariable = (index: number, patch: Partial<FleetConfigVariable>) => {
    if (!editor) return;
    change({
      variables: editor.variables.map((variable, at) =>
        at === index ? { ...variable, ...patch } : variable
      ),
    });
  };

  const save = async () => {
    if (!editor) return;
    let document: unknown;
    try {
      document = JSON.parse(editor.document);
    } catch {
      document = null;
    }
    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
      setError(t('fleet_template_not_json'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fields = {
        name: editor.name.trim(),
        description: editor.description.trim() || null,
        profile: editor.profile,
        role: editor.role.trim() || null,
        document: document as Record<string, unknown>,
        variables: editor.variables.map((variable) => ({
          ...variable,
          name: variable.name.trim(),
        })),
      };
      const stored =
        editor.id === null
          ? await api.createFleetConfigTemplate(fields)
          : await api.updateFleetConfigTemplate(editor.id, fields);
      setEditor(editorOf(stored));
      setSaved(true);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Two clicks: a deleted template does not come back.
  const remove = async () => {
    if (!editor || editor.id === null) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    setBusy(true);
    try {
      await api.deleteFleetConfigTemplate(editor.id);
      open(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          type="button"
          data-testid="fleet-templates-back"
          onClick={onBack}
          aria-label={t('fleet_asset_back')}
          title={t('fleet_asset_back')}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="mr-auto min-w-0">
          <h2 className="text-base font-semibold text-foreground">{t('fleet_templates_title')}</h2>
          <p className="text-xs text-muted-foreground">{t('fleet_templates_intro')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="fleet-template-new"
          onClick={() => open({ ...NEW_TEMPLATE })}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t('fleet_template_new')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4" data-testid="fleet-templates">
          {templates === null && !error && (
            <p className="text-sm text-muted-foreground">{t('common_loading')}</p>
          )}
          {templates !== null && templates.length === 0 && editor === null && (
            <p
              className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
              data-testid="fleet-templates-empty"
            >
              {t('fleet_templates_empty')}
            </p>
          )}
          {templates !== null && templates.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card text-xs">
              {templates.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    data-testid={`fleet-template-${template.id}`}
                    aria-current={editor?.id === template.id ? 'true' : undefined}
                    onClick={() => open(editorOf(template))}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-background aria-[current=true]:bg-background"
                  >
                    <span className="font-medium text-foreground">{template.name}</span>
                    <span>{t(`fleet_config_profile_${template.profile}`)}</span>
                    {template.role && (
                      <span className="text-muted-foreground">{template.role}</span>
                    )}
                    <span className="text-muted-foreground">
                      {t('fleet_template_variables_count', { count: template.variables.length })}
                    </span>
                    {template.description && (
                      <span className="w-full text-muted-foreground">{template.description}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {editor && (
            <form
              className="space-y-3 rounded-lg border border-border bg-card p-4 text-xs"
              data-testid="fleet-template-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="font-medium text-foreground">{t('fleet_template_name')}</span>
                  <Input
                    data-testid="fleet-template-name"
                    value={editor.name}
                    onChange={(e) => change({ name: e.target.value })}
                    maxLength={200}
                    className="h-9 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-foreground">{t('fleet_field_role')}</span>
                  <Input
                    data-testid="fleet-template-role"
                    value={editor.role}
                    onChange={(e) => change({ role: e.target.value })}
                    maxLength={200}
                    className="h-9 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-foreground">{t('fleet_config_profile')}</span>
                  <select
                    data-testid="fleet-template-profile"
                    value={editor.profile}
                    onChange={(e) => change({ profile: e.target.value as FleetConfigProfile })}
                    className={`${SELECT_CLASS} block w-full`}
                  >
                    {PROFILES.map((profile) => (
                      <option key={profile} value={profile}>
                        {t(`fleet_config_profile_${profile}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-foreground">
                    {t('fleet_template_description')}
                  </span>
                  <Input
                    data-testid="fleet-template-description"
                    value={editor.description}
                    onChange={(e) => change({ description: e.target.value })}
                    maxLength={4000}
                    className="h-9 text-sm"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="font-medium text-foreground">{t('fleet_template_document')}</span>
                <textarea
                  data-testid="fleet-template-document"
                  value={editor.document}
                  onChange={(e) => change({ document: e.target.value })}
                  rows={16}
                  spellCheck={false}
                  autoCapitalize="none"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px] text-foreground"
                />
                <span className="block text-muted-foreground">
                  {t('fleet_template_document_hint')}
                </span>
              </label>

              <div className="space-y-2">
                <p className="font-medium text-foreground">{t('fleet_template_variables')}</p>
                {editor.variables.length === 0 && (
                  <p className="text-muted-foreground">{t('fleet_template_no_variables')}</p>
                )}
                {editor.variables.map((variable, index) => (
                  // The index is the identity here: a row has no id and its name is being typed.
                  <div
                    key={index}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_2fr_auto]"
                  >
                    <Input
                      data-testid={`fleet-template-var-name-${index}`}
                      value={variable.name}
                      onChange={(e) => changeVariable(index, { name: e.target.value })}
                      maxLength={64}
                      placeholder={t('fleet_template_var_name')}
                      aria-label={t('fleet_template_var_name')}
                      autoCapitalize="none"
                      spellCheck={false}
                      className="h-9 font-mono text-xs"
                    />
                    <select
                      data-testid={`fleet-template-var-type-${index}`}
                      value={variable.type}
                      onChange={(e) =>
                        changeVariable(index, { type: e.target.value as FleetConfigVariableType })
                      }
                      aria-label={t('fleet_template_var_type')}
                      className={SELECT_CLASS}
                    >
                      {VARIABLE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`fleet_template_var_type_${type}`)}
                        </option>
                      ))}
                    </select>
                    <Input
                      data-testid={`fleet-template-var-default-${index}`}
                      value={variable.default}
                      onChange={(e) => changeVariable(index, { default: e.target.value })}
                      maxLength={200}
                      placeholder={t('fleet_template_var_default')}
                      aria-label={t('fleet_template_var_default')}
                      className="h-9 text-xs"
                    />
                    <Input
                      data-testid={`fleet-template-var-description-${index}`}
                      value={variable.description}
                      onChange={(e) => changeVariable(index, { description: e.target.value })}
                      maxLength={200}
                      placeholder={t('fleet_template_description')}
                      aria-label={t('fleet_template_description')}
                      className="h-9 text-xs"
                    />
                    <button
                      type="button"
                      data-testid={`fleet-template-var-remove-${index}`}
                      onClick={() =>
                        change({ variables: editor.variables.filter((_item, at) => at !== index) })
                      }
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {t('fleet_template_var_remove')}
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="fleet-template-var-add"
                  onClick={() =>
                    change({
                      variables: [
                        ...editor.variables,
                        { name: '', description: '', default: '', type: 'text' },
                      ],
                    })
                  }
                >
                  {t('fleet_template_var_add')}
                </Button>
              </div>

              {error && (
                <p className="text-destructive" role="alert">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  data-testid="fleet-template-save"
                  disabled={busy || editor.name.trim() === ''}
                >
                  {t('fleet_save')}
                </Button>
                {saved && (
                  <span className="text-success" data-testid="fleet-template-saved">
                    {t('fleet_saved')}
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => open(null)}
                  data-testid="fleet-template-close"
                >
                  {t('common_close')}
                </Button>
                {editor.id !== null && (
                  <Button
                    type="button"
                    variant={deleteArmed ? 'destructive' : 'outline'}
                    size="sm"
                    data-testid="fleet-template-delete"
                    disabled={busy}
                    className="ml-auto"
                    onClick={() => void remove()}
                  >
                    {deleteArmed ? t('fleet_delete_confirm') : t('fleet_template_delete')}
                  </Button>
                )}
              </div>
            </form>
          )}

          {error && !editor && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
