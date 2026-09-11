import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { toast } from '../ui/sonner';
import { cn } from '@/lib/utils';
import { api } from '../../api';
import { useT, type TFn } from '../../i18n';
import type { Channel, Contact, FanoutConfig, HealthStatus } from '../../types';
import {
  COMMUNITY_MQTT_PRESETS,
  REGION_ORDER,
  applyPresetToConfig,
  detectPresetId,
  CUSTOM_PRESET_ID,
  type CommunityPresetRegion,
} from './communityMqttPresets';

const BotCodeEditor = lazy(() =>
  import('../BotCodeEditor').then((m) => ({ default: m.BotCodeEditor }))
);

function getTypeLabels(t: TFn): Record<string, string> {
  return {
    mqtt_private: t('settings_fanout_type_private_mqtt'),
    mqtt_community: t('settings_fanout_type_community_sharing'),
    mqtt_ha: t('settings_fanout_type_home_assistant'),
    bot: t('settings_fanout_type_python_bot'),
    webhook: t('settings_fanout_type_webhook'),
    apprise: t('settings_fanout_type_apprise'),
    sqs: t('settings_fanout_type_amazon_sqs'),
    map_upload: t('settings_fanout_type_map_upload'),
  };
}

const DEFAULT_COMMUNITY_PACKET_TOPIC_TEMPLATE = 'meshcore/{IATA}/{PUBLIC_KEY}/packets';
const DEFAULT_COMMUNITY_BROKER_HOST = 'mqtt-us-v1.letsmesh.net';
const DEFAULT_COMMUNITY_BROKER_PORT = 443;
const DEFAULT_COMMUNITY_TRANSPORT = 'websockets';
const DEFAULT_COMMUNITY_AUTH_MODE = 'token';

function createCommunityConfigDefaults(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    broker_host: DEFAULT_COMMUNITY_BROKER_HOST,
    broker_port: DEFAULT_COMMUNITY_BROKER_PORT,
    transport: DEFAULT_COMMUNITY_TRANSPORT,
    use_tls: true,
    tls_verify: true,
    auth_mode: DEFAULT_COMMUNITY_AUTH_MODE,
    username: '',
    password: '',
    iata: '',
    email: '',
    token_audience: '',
    topic_template: DEFAULT_COMMUNITY_PACKET_TOPIC_TEMPLATE,
    publish_status: true,
    publish_packets: true,
    status_interval_ms: 300000,
    ...overrides,
  };
}

const DEFAULT_BOT_CODE = `def bot(**kwargs) -> str | list[str] | None:
    """
    Process messages and optionally return a reply.

    Args:
        kwargs keys currently provided:
            sender_name: Display name of sender (may be None)
            sender_key: 64-char hex public key (None for channel msgs)
            message_text: The message content
            is_dm: True for direct messages, False for channel
            channel_key: 32-char hex key for channels, None for DMs
            channel_name: Channel name with hash (e.g. "#bot"), None for DMs
            sender_timestamp: Sender's timestamp (unix seconds, may be None)
            path: Hex-encoded routing path (may be None)
            is_outgoing: True if this is our own outgoing message
            path_bytes_per_hop: Bytes per hop in path (1, 2, or 3) when known
            scoped: True if the message carried a regional flood scope,
                False for plain/unscoped flood. Check this first. Set for
                scoped DMs too.
            region: Only meaningful when scoped is True (else always None).
                When scoped, it's the decoded region name, or None if the
                scope matched none of your known_regions. region alone can't
                distinguish unscoped from unrecognized — use scoped.

    Returns:
        None for no reply, a string for a single reply,
        a list of strings to send multiple messages in order, or a dict
        {"region": <name or None>, "message": <str or list[str]>} to scope a
        channel reply to a region for that send only (None/"" = unscoped flood;
        region is ignored for DM replies).
    """
    sender_name = kwargs.get("sender_name")
    message_text = kwargs.get("message_text", "")
    channel_name = kwargs.get("channel_name")
    is_outgoing = kwargs.get("is_outgoing", False)
    path_bytes_per_hop = kwargs.get("path_bytes_per_hop")

    # Don't reply to our own outgoing messages
    if is_outgoing:
        return None
    
    # If you want to make use of persistant data between calls to this function, 
    # you can put that data into the global _bot_globals dictionary, e.g.:
    #
    # bot_globals = globals()["_bot_globals"] 
    # if not "known_sender_names" in bot_globals:
    #     bot_globals["known_sender_names"] = set()
    #
    # bot_globals["known_sender_names"].add(sender_name)

    # Example: Only respond in #bot channel to "!pling" command
    if channel_name == "#bot" and "!pling" in message_text.lower():
        return "[BOT] Plong!"
    return None`;

type DraftType =
  | 'mqtt_private'
  | 'mqtt_ha'
  | 'mqtt_community'
  | 'webhook'
  | 'apprise'
  | 'sqs'
  | 'bot'
  | 'map_upload';

type CreateIntegrationDefinition = {
  value: DraftType;
  savedType: string;
  label: string;
  section: string;
  description: string;
  defaultName: string;
  nameMode: 'counted' | 'fixed';
  defaults: {
    config: Record<string, unknown>;
    scope: Record<string, unknown>;
  };
};

function getCreateIntegrationDefinitions(t: TFn): readonly CreateIntegrationDefinition[] {
  return [
    {
      value: 'mqtt_private',
      savedType: 'mqtt_private',
      label: t('settings_fanout_type_private_mqtt'),
      section: t('settings_fanout_section_private_forwarding'),
      description: t('settings_fanout_desc_mqtt_private'),
      defaultName: 'Private MQTT',
      nameMode: 'counted',
      defaults: {
        config: {
          broker_host: '',
          broker_port: 1883,
          username: '',
          password: '',
          use_tls: false,
          tls_insecure: false,
          topic_prefix: 'meshcore',
        },
        scope: { messages: 'all', raw_packets: 'all' },
      },
    },
    {
      value: 'mqtt_ha',
      savedType: 'mqtt_ha',
      label: t('settings_fanout_type_mqtt_ha_discovery'),
      section: t('settings_fanout_section_private_forwarding'),
      description: t('settings_fanout_desc_mqtt_ha'),
      defaultName: t('settings_fanout_type_home_assistant'),
      nameMode: 'fixed',
      defaults: {
        config: {
          broker_host: '',
          broker_port: 1883,
          username: '',
          password: '',
          use_tls: false,
          tls_insecure: false,
          topic_prefix: 'meshcore',
          tracked_contacts: [],
          tracked_repeaters: [],
        },
        scope: { messages: 'all', raw_packets: 'none' },
      },
    },
    {
      value: 'mqtt_community',
      savedType: 'mqtt_community',
      label: t('settings_fanout_type_community_mqtt_generic'),
      section: t('settings_fanout_type_community_sharing'),
      description: t('settings_fanout_desc_mqtt_community'),
      defaultName: 'Community MQTT',
      nameMode: 'counted',
      defaults: {
        config: createCommunityConfigDefaults(),
        scope: { messages: 'none', raw_packets: 'all' },
      },
    },
    {
      value: 'webhook',
      savedType: 'webhook',
      label: t('settings_fanout_type_webhook'),
      section: t('settings_fanout_section_automation'),
      description: t('settings_fanout_desc_webhook'),
      defaultName: 'Webhook',
      nameMode: 'counted',
      defaults: {
        config: {
          url: '',
          method: 'POST',
          headers: {},
          hmac_secret: '',
          hmac_header: '',
        },
        scope: { messages: 'all', raw_packets: 'none' },
      },
    },
    {
      value: 'apprise',
      savedType: 'apprise',
      label: t('settings_fanout_type_apprise'),
      section: t('settings_fanout_section_automation'),
      description: t('settings_fanout_desc_apprise'),
      defaultName: 'Apprise',
      nameMode: 'counted',
      defaults: {
        config: {
          urls: '',
          preserve_identity: true,
          include_outgoing: false,
          markdown_format: true,
          body_format_dm: '**DM:** {sender_name}: {text} **via:** [{hops_backticked}]',
          body_format_channel:
            '**{channel_name}:** {sender_name}: {text} **via:** [{hops_backticked}]',
        },
        scope: { messages: 'all', raw_packets: 'none' },
      },
    },
    {
      value: 'sqs',
      savedType: 'sqs',
      label: t('settings_fanout_type_amazon_sqs'),
      section: t('settings_fanout_section_private_forwarding'),
      description: t('settings_fanout_desc_sqs'),
      defaultName: 'Amazon SQS',
      nameMode: 'counted',
      defaults: {
        config: {
          queue_url: '',
          region_name: '',
          endpoint_url: '',
          access_key_id: '',
          secret_access_key: '',
          session_token: '',
        },
        scope: { messages: 'all', raw_packets: 'none' },
      },
    },
    {
      value: 'bot',
      savedType: 'bot',
      label: t('settings_fanout_type_python_bot'),
      section: t('settings_fanout_section_automation'),
      description: t('settings_fanout_desc_bot'),
      defaultName: 'Bot',
      nameMode: 'counted',
      defaults: {
        config: {
          code: DEFAULT_BOT_CODE,
        },
        scope: { messages: 'all', raw_packets: 'none' },
      },
    },
    {
      value: 'map_upload',
      savedType: 'map_upload',
      label: t('settings_fanout_type_map_upload'),
      section: t('settings_fanout_type_community_sharing'),
      description: t('settings_fanout_desc_map_upload'),
      defaultName: 'Map Upload',
      nameMode: 'counted',
      defaults: {
        config: {
          api_url: '',
          dry_run: true,
        },
        scope: { messages: 'none', raw_packets: 'all' },
      },
    },
  ];
}

function getNumberInputValue(value: unknown, fallback: number): string | number {
  if (value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function getOptionalNumberInputValue(value: unknown): string | number {
  if (value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return '';
}

function parseIntegerInputValue(value: string): number | string {
  if (value === '') return '';
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? value : parsed;
}

function parseFloatInputValue(value: string): number | string {
  if (value === '') return '';
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function normalizeIntegrationConfigForSave(
  configType: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...config };

  if (configType === 'mqtt_private') {
    const port = normalized.broker_port;
    if (port === '' || port === undefined || port === null) {
      normalized.broker_port = 1883;
    } else if (typeof port === 'string') {
      const parsed = Number.parseInt(port, 10);
      normalized.broker_port = Number.isNaN(parsed) ? 1883 : parsed;
    }

    const topicPrefix = String(normalized.topic_prefix ?? '').trim();
    normalized.topic_prefix = topicPrefix || 'meshcore';
  }

  if (configType === 'mqtt_community') {
    const brokerHost = String(normalized.broker_host ?? '').trim();
    normalized.broker_host = brokerHost || DEFAULT_COMMUNITY_BROKER_HOST;

    const port = normalized.broker_port;
    if (port === '' || port === undefined || port === null) {
      normalized.broker_port = DEFAULT_COMMUNITY_BROKER_PORT;
    } else if (typeof port === 'string') {
      const parsed = Number.parseInt(port, 10);
      normalized.broker_port = Number.isNaN(parsed) ? DEFAULT_COMMUNITY_BROKER_PORT : parsed;
    }

    const topicTemplate = String(normalized.topic_template ?? '').trim();
    normalized.topic_template = topicTemplate || DEFAULT_COMMUNITY_PACKET_TOPIC_TEMPLATE;

    normalized.publish_status = normalized.publish_status !== false;
    normalized.publish_packets = normalized.publish_packets !== false;
    const interval =
      typeof normalized.status_interval_ms === 'string'
        ? Number.parseInt(normalized.status_interval_ms, 10)
        : Number(normalized.status_interval_ms);
    normalized.status_interval_ms =
      Number.isFinite(interval) && interval >= 1000 && interval <= 3600000 ? interval : 300000;
  }

  if (configType === 'map_upload') {
    const radius = normalized.geofence_radius_km;
    if (radius === '' || radius === undefined || radius === null) {
      normalized.geofence_radius_km = 0;
    } else if (typeof radius === 'string') {
      const parsed = Number.parseFloat(radius);
      normalized.geofence_radius_km = Number.isNaN(parsed) ? 0 : parsed;
    }
  }

  return normalized;
}

function isDraftType(
  value: string,
  defs: Record<DraftType, CreateIntegrationDefinition>
): value is DraftType {
  return value in defs;
}

function getCreateIntegrationDefinition(
  draftType: DraftType,
  defs: Record<DraftType, CreateIntegrationDefinition>
) {
  return defs[draftType];
}

function normalizeDraftName(
  draftType: DraftType,
  name: string,
  configs: FanoutConfig[],
  defs: Record<DraftType, CreateIntegrationDefinition>,
  typeLabels: Record<string, string>
) {
  const definition = getCreateIntegrationDefinition(draftType, defs);
  if (name) return name;
  if (definition.nameMode === 'fixed') return definition.defaultName;
  return getDefaultIntegrationName(definition.savedType, configs, typeLabels);
}

function normalizeDraftConfig(
  draftType: DraftType,
  config: Record<string, unknown>,
  defs: Record<DraftType, CreateIntegrationDefinition>
) {
  return normalizeIntegrationConfigForSave(
    getCreateIntegrationDefinition(draftType, defs).savedType,
    config
  );
}

function normalizeDraftScope(
  draftType: DraftType,
  scope: Record<string, unknown>,
  defs: Record<DraftType, CreateIntegrationDefinition>
) {
  if (getCreateIntegrationDefinition(draftType, defs).savedType === 'mqtt_community') {
    return { messages: 'none', raw_packets: 'all' };
  }
  return scope;
}

function cloneDraftDefaults(
  draftType: DraftType,
  defs: Record<DraftType, CreateIntegrationDefinition>
) {
  const recipe = getCreateIntegrationDefinition(draftType, defs);
  return {
    config: structuredClone(recipe.defaults.config),
    scope: structuredClone(recipe.defaults.scope),
  };
}

function CreateIntegrationDialog({
  open,
  options,
  selectedType,
  onOpenChange,
  onSelect,
  onCreate,
}: {
  open: boolean;
  options: readonly CreateIntegrationDefinition[];
  selectedType: DraftType | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: DraftType) => void;
  onCreate: () => void;
}) {
  const t = useT();
  const selectedOption =
    options.find((option) => option.value === selectedType) ?? options[0] ?? null;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  const updateScrollHint = useCallback(() => {
    const container = listRef.current;
    if (!container) {
      setShowScrollHint(false);
      return;
    }
    setShowScrollHint(container.scrollTop + container.clientHeight < container.scrollHeight - 8);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updateScrollHint);
    window.addEventListener('resize', updateScrollHint);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateScrollHint);
    };
  }, [open, options, updateScrollHint]);

  const sectionedOptions = [...new Set(options.map((o) => o.section))]
    .map((section) => ({
      section,
      options: options.filter((option) => option.section === section),
    }))
    .filter((group) => group.options.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        hideCloseButton
        className="flex max-h-[calc(100dvh-2rem)] w-[96vw] max-w-[960px] flex-col overflow-hidden p-0 sm:rounded-xl"
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t('settings_fanout_create_integration_title')}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="relative border-b border-border bg-muted/20 md:border-b-0 md:border-r">
            <div
              ref={listRef}
              onScroll={updateScrollHint}
              className="max-h-56 overflow-y-auto p-2 md:max-h-[420px]"
            >
              <div className="space-y-4">
                {sectionedOptions.map((group) => (
                  <div key={group.section} className="space-y-1.5">
                    <div className="px-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.section}
                    </div>
                    {group.options.map((option) => {
                      const selected = option.value === selectedOption?.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={cn(
                            'w-full rounded-md border px-3 py-2 text-left transition-colors',
                            selected
                              ? 'border-primary bg-accent text-foreground'
                              : 'border-transparent bg-transparent hover:bg-accent/70'
                          )}
                          aria-pressed={selected}
                          onClick={() => onSelect(option.value)}
                        >
                          <div className="text-sm font-medium">{option.label}</div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {showScrollHint && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/85 to-transparent px-4 pb-2 pt-8">
                <div className="rounded-full border border-border/80 bg-background/95 px-2 py-1 text-muted-foreground shadow-sm">
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </div>
              </div>
            )}
          </div>

          <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5 md:min-h-[280px] md:max-h-[420px]">
            {selectedOption ? (
              <>
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {selectedOption.section}
                  </div>
                  <h3 className="text-lg font-semibold">{selectedOption.label}</h3>
                </div>

                <p className="text-sm leading-6 text-muted-foreground">
                  {selectedOption.description}
                </p>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t('settings_fanout_no_integration_types')}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common_close')}
          </Button>
          <Button onClick={onCreate} disabled={!selectedOption}>
            {t('common_create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getDetailTypeLabel(
  detailType: string,
  defs: Record<DraftType, CreateIntegrationDefinition>,
  typeLabels: Record<string, string>
) {
  if (isDraftType(detailType, defs)) return getCreateIntegrationDefinition(detailType, defs).label;
  return typeLabels[detailType] || detailType;
}

function fanoutDraftHasUnsavedChanges(
  original: FanoutConfig | null,
  current: {
    name: string;
    config: Record<string, unknown>;
    scope: Record<string, unknown>;
  }
) {
  if (!original) return false;
  return (
    current.name !== original.name ||
    JSON.stringify(current.config) !== JSON.stringify(original.config) ||
    JSON.stringify(current.scope) !== JSON.stringify(original.scope)
  );
}

function formatBrokerSummary(
  config: Record<string, unknown>,
  defaults: { host: string; port: number }
) {
  const host = (config.broker_host as string) || defaults.host;
  const port = typeof config.broker_port === 'number' ? config.broker_port : defaults.port;
  return `${host}:${port}`;
}

function formatPrivateTopicSummary(config: Record<string, unknown>) {
  const prefix = (config.topic_prefix as string) || 'meshcore';
  return `${prefix}/dm:<pubkey>, ${prefix}/gm:<channel>, ${prefix}/raw/...`;
}

function censorAppriseUrl(url: string): string {
  const protoMatch = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
  if (protoMatch) return `${protoMatch[0]}********`;
  return '********';
}

function formatAppriseTargets(urls: string | undefined, t: TFn) {
  const targets = (urls || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (targets.length === 0) return t('settings_fanout_no_targets_configured');

  return targets.map(censorAppriseUrl).join(', ');
}

function formatSqsQueueSummary(config: Record<string, unknown>, t: TFn) {
  const queueUrl = ((config.queue_url as string) || '').trim();
  if (!queueUrl) return t('settings_fanout_no_queue_configured');
  return queueUrl;
}

function getDefaultIntegrationName(
  type: string,
  configs: FanoutConfig[],
  typeLabels: Record<string, string>
) {
  const label = typeLabels[type] || type;
  const nextIndex = configs.filter((cfg) => cfg.type === type).length + 1;
  return `${label} #${nextIndex}`;
}

function getStatusLabel(status: string | undefined, type: string | undefined, t: TFn) {
  if (status === 'connected')
    return type === 'bot' || type === 'webhook' || type === 'apprise' || type === 'map_upload'
      ? t('settings_fanout_status_active')
      : t('settings_fanout_status_connected');
  if (status === 'error') return t('settings_fanout_status_error');
  if (status === 'disconnected') return t('settings_fanout_status_disconnected');
  return t('settings_fanout_status_inactive');
}

function getStatusColor(status: string | undefined, enabled?: boolean) {
  if (enabled === false) return 'bg-muted-foreground';
  if (status === 'connected')
    return 'bg-status-connected shadow-[0_0_6px_hsl(var(--status-connected)/0.5)]';
  if (status === 'error' || status === 'disconnected')
    return 'bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.5)]';
  return 'bg-muted-foreground';
}

function MqttPrivateConfigEditor({
  config,
  scope,
  onChange,
  onScopeChange,
}: {
  config: Record<string, unknown>;
  scope: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  onScopeChange: (scope: Record<string, unknown>) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('settings_fanout_mqtt_private_desc')}
      </p>

      <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
        {t('settings_fanout_mqtt_private_plaintext_warning')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-host">{t('settings_fanout_broker_host_label')}</Label>
          <Input
            id="fanout-mqtt-host"
            type="text"
            placeholder={t('settings_fanout_broker_host_placeholder')}
            value={(config.broker_host as string) || ''}
            onChange={(e) => onChange({ ...config, broker_host: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-port">{t('settings_fanout_broker_port_label')}</Label>
          <Input
            id="fanout-mqtt-port"
            type="number"
            min="1"
            max="65535"
            value={getNumberInputValue(config.broker_port, 1883)}
            onChange={(e) =>
              onChange({ ...config, broker_port: parseIntegerInputValue(e.target.value) })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-user">{t('settings_fanout_username_label')}</Label>
          <Input
            id="fanout-mqtt-user"
            type="text"
            placeholder={t('settings_fanout_optional_placeholder')}
            value={(config.username as string) || ''}
            onChange={(e) => onChange({ ...config, username: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-mqtt-pass">{t('settings_fanout_password_label')}</Label>
          <Input
            id="fanout-mqtt-pass"
            type="password"
            placeholder={t('settings_fanout_optional_placeholder')}
            value={(config.password as string) || ''}
            onChange={(e) => onChange({ ...config, password: e.target.value })}
          />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!!config.use_tls}
          onChange={(e) => onChange({ ...config, use_tls: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">{t('settings_fanout_use_tls_label')}</span>
      </label>

      {!!config.use_tls && (
        <label className="flex items-center gap-3 cursor-pointer ml-7">
          <input
            type="checkbox"
            checked={!!config.tls_insecure}
            onChange={(e) => onChange({ ...config, tls_insecure: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">{t('settings_fanout_skip_cert_verification_label')}</span>
        </label>
      )}

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="fanout-mqtt-prefix">{t('settings_fanout_topic_prefix_label')}</Label>
        <Input
          id="fanout-mqtt-prefix"
          type="text"
          placeholder="meshcore"
          value={(config.topic_prefix as string | undefined) ?? ''}
          onChange={(e) => onChange({ ...config, topic_prefix: e.target.value })}
        />
      </div>

      <Separator />

      <ScopeSelector scope={scope} onChange={onScopeChange} showRawPackets />
    </div>
  );
}

function MqttHaConfigEditor({
  config,
  scope,
  onChange,
  onScopeChange,
}: {
  config: Record<string, unknown>;
  scope: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  onScopeChange: (scope: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [trackedRepeaters, setTrackedRepeaters] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [radioConfig, setRadioConfig] = useState<{ public_key: string; name: string } | null>(null);

  useEffect(() => {
    (async () => {
      const all: Contact[] = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const page = await api.getContacts(pageSize, offset);
        all.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      setContacts(all);
    })().catch(console.error);

    api
      .getRadioConfig()
      .then((radio) => setRadioConfig({ public_key: radio.public_key, name: radio.name }))
      .catch(console.error);

    api
      .getSettings()
      .then((s) => setTrackedRepeaters(s.tracked_telemetry_repeaters ?? []))
      .catch(console.error);
  }, []);

  const selectedContacts = (config.tracked_contacts as string[]) || [];
  const selectedRepeaters = (config.tracked_repeaters as string[]) || [];

  const contactOptions = useMemo(
    () => contacts.filter((c) => c.type === 0 || c.type === 1 || c.type === 3),
    [contacts]
  );

  const repeaterOptions = useMemo(
    () => contacts.filter((c) => c.type === 2 && trackedRepeaters.includes(c.public_key)),
    [contacts, trackedRepeaters]
  );

  const contactSearchLower = contactSearch.toLowerCase().trim();
  const filteredContacts = useMemo(() => {
    const matches = contactOptions.filter((c) => {
      if (!contactSearchLower) return true;
      const name = (c.name || '').toLowerCase();
      const key = c.public_key.toLowerCase();
      return name.includes(contactSearchLower) || key.startsWith(contactSearchLower);
    });
    // Selected contacts sort to top
    return matches.sort((a, b) => {
      const aSelected = selectedContacts.includes(a.public_key) ? 0 : 1;
      const bSelected = selectedContacts.includes(b.public_key) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return (a.name || a.public_key).localeCompare(b.name || b.public_key);
    });
  }, [contactOptions, contactSearchLower, selectedContacts]);

  const selectedContactDetails = contactOptions.filter((c) =>
    selectedContacts.includes(c.public_key)
  );
  const selectedRepeaterDetails = repeaterOptions.filter((c) =>
    selectedRepeaters.includes(c.public_key)
  );
  const prefix = ((config.topic_prefix as string) || 'meshcore').trim() || 'meshcore';

  const nodeIdForKey = useCallback((publicKey: string) => publicKey.slice(0, 12).toLowerCase(), []);

  const topicSummary = useMemo(() => {
    const items: Array<{
      kind: 'radio' | 'event' | 'repeater' | 'contact';
      label: string;
      publicKey: string;
      nodeId: string;
      topics: string[];
    }> = [];

    if (radioConfig?.public_key) {
      const nodeId = nodeIdForKey(radioConfig.public_key);
      items.push({
        kind: 'radio',
        label: radioConfig.name || radioConfig.public_key.slice(0, 12),
        publicKey: radioConfig.public_key,
        nodeId,
        topics: [`${prefix}/${nodeId}/health`],
      });
      items.push({
        kind: 'event',
        label: radioConfig.name || radioConfig.public_key.slice(0, 12),
        publicKey: radioConfig.public_key,
        nodeId,
        topics: [`${prefix}/${nodeId}/events/message`],
      });
    }

    for (const repeater of selectedRepeaterDetails) {
      const nodeId = nodeIdForKey(repeater.public_key);
      items.push({
        kind: 'repeater',
        label: repeater.name || repeater.public_key.slice(0, 12),
        publicKey: repeater.public_key,
        nodeId,
        topics: [`${prefix}/${nodeId}/telemetry`],
      });
    }

    for (const contact of selectedContactDetails) {
      const nodeId = nodeIdForKey(contact.public_key);
      items.push({
        kind: 'contact',
        label: contact.name || contact.public_key.slice(0, 12),
        publicKey: contact.public_key,
        nodeId,
        topics: [`${prefix}/${nodeId}/gps`],
      });
    }

    return items;
  }, [nodeIdForKey, prefix, radioConfig, selectedContactDetails, selectedRepeaterDetails]);

  const kindLabel: Record<(typeof topicSummary)[number]['kind'], string> = {
    radio: t('settings_fanout_ha_kind_local_radio_state'),
    event: t('settings_fanout_ha_kind_message_events'),
    repeater: t('settings_fanout_ha_kind_repeater_telemetry'),
    contact: t('settings_fanout_ha_kind_contact_gps'),
  };
  const localRadioNodeId = radioConfig?.public_key
    ? nodeIdForKey(radioConfig.public_key)
    : '<radio_node_id>';
  const exampleRepeaterNodeId =
    selectedRepeaterDetails.length > 0
      ? nodeIdForKey(selectedRepeaterDetails[0].public_key)
      : '<repeater_node_id>';
  const exampleContactNodeId =
    selectedContactDetails.length > 0
      ? nodeIdForKey(selectedContactDetails[0].public_key)
      : '<contact_node_id>';

  const toggleTrackedContact = (key: string) => {
    const current = [...selectedContacts];
    const idx = current.indexOf(key);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(key);
    onChange({ ...config, tracked_contacts: current });
  };

  const toggleTrackedRepeater = (key: string) => {
    const current = [...selectedRepeaters];
    const idx = current.indexOf(key);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(key);
    onChange({ ...config, tracked_repeaters: current });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">
            {t('settings_fanout_type_mqtt_ha_discovery')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('settings_fanout_ha_intro')}</p>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-md border border-border/70 bg-background/80 p-3">
            <div className="text-sm font-medium text-foreground">
              {t('settings_fanout_ha_step1_title')}
            </div>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_ha_step1_desc')}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/80 p-3">
            <div className="text-sm font-medium text-foreground">
              {t('settings_fanout_ha_step2_title')}
            </div>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_ha_step2_desc')}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/80 p-3">
            <div className="text-sm font-medium text-foreground">
              {t('settings_fanout_ha_step3_title')}
            </div>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_ha_step3_desc')}
            </p>
          </div>
        </div>

        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_ha_uses_prefix')} {/* eslint-disable i18next/no-literal-string */}
          <span
            role="link"
            tabIndex={0}
            className="underline cursor-pointer hover:text-primary transition-colors"
            onClick={() =>
              window.open(
                'https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery',
                '_blank'
              )
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                window.open(
                  'https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery',
                  '_blank'
                );
            }}
          >
            MQTT Discovery
          </span>{' '}
          {t('settings_fanout_ha_uses_suffix')}{' '}
          <span
            role="link"
            tabIndex={0}
            className="underline cursor-pointer hover:text-primary transition-colors"
            onClick={() =>
              window.open(
                'https://github.com/Elektr0Vodka/RTFM-EV/blob/main/README_HA.md',
                '_blank'
              )
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                window.open(
                  'https://github.com/Elektr0Vodka/RTFM-EV/blob/main/README_HA.md',
                  '_blank'
                );
            }}
          >
            README_HA.md
          </span>
          {/* eslint-enable i18next/no-literal-string */}.
        </p>
      </div>

      <details className="group">
        <summary className="text-sm font-medium text-foreground cursor-pointer select-none flex items-center gap-1">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" />
          {t('settings_fanout_ha_created_summary_heading')}
        </summary>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground rounded-md border border-border bg-muted/20 p-3">
          <div>
            <span className="font-medium text-foreground">
              {t('settings_fanout_ha_local_radio_device_label')}
            </span>{' '}
            {t('settings_fanout_ha_always_suffix')}
            <span className="ml-1">{t('settings_fanout_ha_updates_every_60s')}</span>
            <ul className="mt-0.5 ml-4 list-disc space-y-0.5">
              <li>
                <code className="text-[0.6875rem]">
                  {`binary_sensor.meshcore_${localRadioNodeId}_connected`}
                </code>{' '}
                {t('settings_fanout_ha_entity_radio_online_offline')}
              </li>
              <li>
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${localRadioNodeId}_noise_floor`}
                </code>{' '}
                {t('settings_fanout_ha_entity_radio_noise_floor')}
              </li>
            </ul>
          </div>

          <div>
            <span className="font-medium text-foreground">
              {t('settings_fanout_ha_per_tracked_repeater_label')}
            </span>{' '}
            {t('settings_fanout_ha_repeater_update_desc')}
            <ul className="mt-0.5 ml-4 list-disc space-y-0.5">
              <li>
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_battery_voltage`}
                </code>{' '}
                {t('settings_fanout_ha_unit_volts')}
              </li>
              <li>
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_noise_floor`}
                </code>
                ,{' '}
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_last_rssi`}
                </code>
                ,{' '}
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_last_snr`}
                </code>{' '}
                {t('settings_fanout_ha_unit_dbm_db')}
              </li>
              <li>
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_packets_received`}
                </code>
                ,{' '}
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_packets_sent`}
                </code>
              </li>
              <li>
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_uptime`}
                </code>{' '}
                {t('settings_fanout_ha_unit_seconds')}
              </li>
              <li>
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_lpp_temperature_ch1`}
                </code>
                ,{' '}
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleRepeaterNodeId}_lpp_humidity_ch1`}
                </code>
                {t('settings_fanout_ha_cayennelpp_auto_detected')}
              </li>
            </ul>
          </div>

          <div>
            <span className="font-medium text-foreground">
              {t('settings_fanout_ha_per_tracked_contact_label')}
            </span>{' '}
            {t('settings_fanout_ha_contact_update_desc')}
            <ul className="mt-0.5 ml-4 list-disc space-y-0.5">
              <li>
                <code className="text-[0.6875rem]">
                  {`device_tracker.meshcore_${exampleContactNodeId}`}
                </code>{' '}
                {t('settings_fanout_ha_entity_lat_lon')}
              </li>
              <li>
                <code className="text-[0.6875rem]">
                  {`sensor.meshcore_${exampleContactNodeId}_lpp_temperature_ch1`}
                </code>
                {t('settings_fanout_ha_cayennelpp_contact_note')}
              </li>
            </ul>
          </div>

          <div>
            <span className="font-medium text-foreground">
              {t('settings_fanout_ha_message_events_label')}
            </span>{' '}
            {t('settings_fanout_ha_message_events_desc')}
            <ul className="mt-0.5 ml-4 list-disc space-y-0.5">
              <li>
                <code className="text-[0.6875rem]">
                  {`event.meshcore_${localRadioNodeId}_messages`}
                </code>{' '}
                {t('settings_fanout_ha_entity_trigger_automations')}
              </li>
            </ul>
          </div>

          <p className="text-[0.6875rem] mt-1.5">
            {t('settings_fanout_ha_entity_ids_footer_prefix')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <code className="text-[0.6875rem]">{prefix}/&lt;node_id&gt;/health|telemetry|gps</code>.
          </p>
        </div>
      </details>

      <details className="group">
        <summary className="text-sm font-medium text-foreground cursor-pointer select-none flex items-center gap-1">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" />
          {t('settings_fanout_ha_topic_summary_heading')}
        </summary>
        <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            {t('settings_fanout_ha_topic_summary_intro')}
          </p>
          {topicSummary.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {t('settings_fanout_ha_topic_summary_empty')}
            </p>
          ) : (
            <div className="space-y-2">
              {topicSummary.map((item) => (
                <div
                  key={`${item.kind}-${item.publicKey}`}
                  className="rounded border border-border/70 bg-background/70 p-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="font-medium text-foreground">{kindLabel[item.kind]}</span>
                    <span className="text-foreground">{item.label}</span>
                    <span className="font-mono text-[0.6875rem] text-muted-foreground">
                      {t('settings_fanout_ha_node_id_label')} {item.nodeId}
                    </span>
                  </div>
                  <div className="mt-1 text-[0.6875rem] text-muted-foreground font-mono break-all">
                    {t('settings_fanout_ha_key_label')} {item.publicKey}
                  </div>
                  {item.topics.map((topic) => (
                    <div
                      key={topic}
                      className="mt-1 rounded bg-muted px-2 py-1 text-[0.6875rem] font-mono text-foreground break-all"
                    >
                      {topic}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          <p className="text-[0.6875rem] text-muted-foreground">
            {t('settings_fanout_ha_discovery_topics_prefix')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <code className="text-[0.6875rem]">homeassistant/.../config</code>
            {t('settings_fanout_ha_discovery_topics_suffix')}
          </p>
        </div>
      </details>

      <Separator />

      <h3 className="text-base font-semibold tracking-tight">
        {t('settings_fanout_mqtt_broker_heading')}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-ha-host">{t('settings_fanout_broker_host_label')}</Label>
          <Input
            id="fanout-ha-host"
            type="text"
            placeholder={t('settings_fanout_broker_host_placeholder')}
            value={(config.broker_host as string) || ''}
            onChange={(e) => onChange({ ...config, broker_host: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-ha-port">{t('settings_fanout_broker_port_label')}</Label>
          <Input
            id="fanout-ha-port"
            type="number"
            min="1"
            max="65535"
            value={getNumberInputValue(config.broker_port, 1883)}
            onChange={(e) =>
              onChange({ ...config, broker_port: parseIntegerInputValue(e.target.value) })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-ha-user">{t('settings_fanout_username_label')}</Label>
          <Input
            id="fanout-ha-user"
            type="text"
            placeholder={t('settings_fanout_optional_placeholder')}
            value={(config.username as string) || ''}
            onChange={(e) => onChange({ ...config, username: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-ha-pass">{t('settings_fanout_password_label')}</Label>
          <Input
            id="fanout-ha-pass"
            type="password"
            placeholder={t('settings_fanout_optional_placeholder')}
            value={(config.password as string) || ''}
            onChange={(e) => onChange({ ...config, password: e.target.value })}
          />
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!!config.use_tls}
          onChange={(e) => onChange({ ...config, use_tls: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">{t('settings_fanout_use_tls_label')}</span>
      </label>

      {!!config.use_tls && (
        <label className="flex items-center gap-3 cursor-pointer ml-7">
          <input
            type="checkbox"
            checked={!!config.tls_insecure}
            onChange={(e) => onChange({ ...config, tls_insecure: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">{t('settings_fanout_skip_cert_verification_label')}</span>
        </label>
      )}

      <div className="space-y-2">
        <Label htmlFor="fanout-ha-prefix">{t('settings_fanout_topic_prefix_label')}</Label>
        <Input
          id="fanout-ha-prefix"
          type="text"
          placeholder="meshcore"
          value={(config.topic_prefix as string | undefined) ?? ''}
          onChange={(e) => onChange({ ...config, topic_prefix: e.target.value })}
        />
        <p className="text-[0.6875rem] text-muted-foreground">
          {t('settings_fanout_ha_state_updates_prefix')}{' '}
          <code className="text-[0.6875rem]">{prefix}/</code>
          {t('settings_fanout_ha_state_updates_middle')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code className="text-[0.6875rem]">homeassistant/</code>{' '}
          {t('settings_fanout_ha_state_updates_suffix')}
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_fanout_ha_gps_tracked_contacts_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_ha_gps_tracked_contacts_desc_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code className="text-[0.6875rem]">device_tracker</code>{' '}
          {t('settings_fanout_ha_gps_tracked_contacts_desc_suffix')}
        </p>

        {selectedContactDetails.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedContactDetails.map((c) => (
              <span
                key={c.public_key}
                className="inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-full bg-primary/10 text-primary"
              >
                {c.name || c.public_key.slice(0, 12)}
                <button
                  type="button"
                  className="ml-0.5 hover:text-destructive transition-colors"
                  onClick={() => toggleTrackedContact(c.public_key)}
                  aria-label={t('settings_fanout_remove_item_aria', {
                    name: c.name || c.public_key.slice(0, 12),
                  })}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        {contactOptions.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground italic">
            {t('settings_fanout_no_contacts_available')}
          </p>
        ) : (
          <>
            <Input
              type="text"
              placeholder={t('settings_fanout_search_contacts_placeholder', {
                count: contactOptions.length,
              })}
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="max-h-48 overflow-y-auto space-y-1 rounded border border-border p-2">
              {filteredContacts.length === 0 ? (
                <p className="text-[0.8125rem] text-muted-foreground italic py-1">
                  {t('settings_fanout_no_contacts_match', { search: contactSearch })}
                </p>
              ) : (
                filteredContacts.map((c) => (
                  <label
                    key={c.public_key}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(c.public_key)}
                      onChange={() => toggleTrackedContact(c.public_key)}
                      className="h-3.5 w-3.5 rounded border-border"
                    />
                    <span className="truncate">{c.name || c.public_key.slice(0, 12)}</span>
                    <span className="text-[0.625rem] text-muted-foreground ml-auto font-mono shrink-0">
                      {c.public_key.slice(0, 12)}
                    </span>
                  </label>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_fanout_ha_telemetry_tracked_repeaters_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_ha_telemetry_tracked_repeaters_desc')}
        </p>
        {trackedRepeaters.length === 0 ? (
          <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_ha_no_repeaters_tracked')}
          </div>
        ) : repeaterOptions.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground italic">
            {t('settings_fanout_ha_repeaters_not_found')}
          </p>
        ) : (
          <div className="max-h-40 overflow-y-auto space-y-1 rounded border border-border p-2">
            {repeaterOptions.map((c) => (
              <label key={c.public_key} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectedRepeaters.includes(c.public_key)}
                  onChange={() => toggleTrackedRepeater(c.public_key)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <span className="truncate">{c.name || c.public_key.slice(0, 12)}</span>
                <span className="text-[0.625rem] text-muted-foreground ml-auto font-mono">
                  {c.public_key.slice(0, 12)}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_fanout_ha_message_events_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_ha_message_events_fire_prefix')}{' '}
          <code className="text-[0.6875rem]">{`event.meshcore_${localRadioNodeId}_messages`}</code>{' '}
          {t('settings_fanout_ha_message_events_fire_suffix')}
        </p>
      </div>
      <ScopeSelector scope={scope} onChange={onScopeChange} />
    </div>
  );
}

function CommunityTopicControls({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const t = useT();
  const intervalMinutes = (() => {
    const ms = Number(config.status_interval_ms);
    if (!Number.isFinite(ms) || ms <= 0) return 5;
    return Math.round(ms / 60000);
  })();

  return (
    <div className="space-y-2">
      <Separator />
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.publish_status !== false}
          onChange={(e) => onChange({ ...config, publish_status: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">{t('settings_fanout_publish_status')}</span>
      </label>
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.publish_packets !== false}
          onChange={(e) => onChange({ ...config, publish_packets: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm">{t('settings_fanout_publish_packets')}</span>
      </label>
      <div className="space-y-2">
        <Label htmlFor="fanout-comm-interval">{t('settings_fanout_status_interval_min')}</Label>
        <Input
          id="fanout-comm-interval"
          type="number"
          min="1"
          max="60"
          className="w-32"
          value={intervalMinutes}
          onChange={(e) => {
            const m = Number.parseInt(e.target.value, 10);
            const clamped = Number.isNaN(m) ? 5 : Math.min(60, Math.max(1, m));
            onChange({ ...config, status_interval_ms: clamped * 60000 });
          }}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_status_interval_help')}
        </p>
      </div>
    </div>
  );
}

function MqttCommunityConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const t = useT();
  const authMode = (config.auth_mode as string) || DEFAULT_COMMUNITY_AUTH_MODE;
  const currentPresetId = detectPresetId(config);
  const activePreset = COMMUNITY_MQTT_PRESETS.find((p) => p.id === currentPresetId);
  const regionLabels: Record<CommunityPresetRegion, string> = {
    europe: t('settings_fanout_preset_region_europe'),
    north_america: t('settings_fanout_preset_region_north_america'),
    oceania: t('settings_fanout_preset_region_oceania'),
    other: t('settings_fanout_preset_region_other'),
  };

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('settings_fanout_mqtt_community_desc')}
      </p>

      <div className="space-y-2">
        <Label htmlFor="fanout-comm-preset">{t('settings_fanout_preset_label')}</Label>
        <select
          id="fanout-comm-preset"
          value={currentPresetId}
          onChange={(e) => {
            const preset = COMMUNITY_MQTT_PRESETS.find((p) => p.id === e.target.value);
            if (preset) onChange(applyPresetToConfig(config, preset));
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value={CUSTOM_PRESET_ID}>{t('settings_fanout_preset_custom')}</option>
          {REGION_ORDER.map((region) => (
            <optgroup key={region} label={regionLabels[region]}>
              {COMMUNITY_MQTT_PRESETS.filter((p) => p.region === region).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {activePreset?.hasEmbeddedCredentials && (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_preset_note_embedded_creds')}
          </p>
        )}
        {activePreset?.needsBackendSubstitution && (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_preset_note_pubkey_username')}
          </p>
        )}
        {activePreset?.requiresTopicTemplate && (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_preset_note_topic_required')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-comm-host">{t('settings_fanout_broker_host_label')}</Label>
          <Input
            id="fanout-comm-host"
            type="text"
            placeholder={DEFAULT_COMMUNITY_BROKER_HOST}
            value={(config.broker_host as string | undefined) ?? ''}
            onChange={(e) => onChange({ ...config, broker_host: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-comm-port">{t('settings_fanout_broker_port_label')}</Label>
          <Input
            id="fanout-comm-port"
            type="number"
            min="1"
            max="65535"
            value={getNumberInputValue(config.broker_port, DEFAULT_COMMUNITY_BROKER_PORT)}
            onChange={(e) =>
              onChange({
                ...config,
                broker_port: parseIntegerInputValue(e.target.value),
              })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-comm-transport">{t('settings_fanout_transport_label')}</Label>
          <select
            id="fanout-comm-transport"
            value={(config.transport as string) || DEFAULT_COMMUNITY_TRANSPORT}
            onChange={(e) => onChange({ ...config, transport: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="websockets">{t('settings_fanout_transport_websockets')}</option>
            <option value="tcp">{t('settings_fanout_transport_tcp')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-comm-auth-mode">{t('settings_fanout_authentication_label')}</Label>
          <select
            id="fanout-comm-auth-mode"
            value={authMode}
            onChange={(e) => onChange({ ...config, auth_mode: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="token">{t('settings_fanout_auth_token')}</option>
            <option value="none">{t('settings_fanout_auth_none')}</option>
            <option value="password">{t('settings_fanout_auth_username_password')}</option>
          </select>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_auth_hint_letsmesh')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <code>token</code> {t('settings_fanout_auth_hint_meshrank')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <code>none</code>.
          </p>
        </div>
      </div>

      {((config.transport as string) || DEFAULT_COMMUNITY_TRANSPORT) === 'websockets' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fanout-comm-ws-path">{t('settings_fanout_websocket_path_label')}</Label>
            <Input
              id="fanout-comm-ws-path"
              type="text"
              placeholder="/"
              value={(config.websocket_path as string | undefined) ?? ''}
              onChange={(e) => onChange({ ...config, websocket_path: e.target.value })}
            />
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_websocket_path_hint_prefix')} <code>/</code>{' '}
              {t('settings_fanout_websocket_path_hint_middle')}{' '}
              {/* eslint-disable-next-line i18next/no-literal-string */}
              <code>/mqtt</code> {t('settings_fanout_websocket_path_hint_suffix')}
            </p>
          </div>
        </div>
      )}

      {authMode === 'token' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fanout-comm-token-audience">
              {t('settings_fanout_token_audience_label')}
            </Label>
            <Input
              id="fanout-comm-token-audience"
              type="text"
              placeholder={(config.broker_host as string) || DEFAULT_COMMUNITY_BROKER_HOST}
              value={(config.token_audience as string | undefined) ?? ''}
              onChange={(e) => onChange({ ...config, token_audience: e.target.value })}
            />
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_token_audience_hint')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fanout-comm-email">{t('settings_fanout_owner_email_label')}</Label>
            <Input
              id="fanout-comm-email"
              type="email"
              placeholder="you@example.com"
              value={(config.email as string) || ''}
              onChange={(e) => onChange({ ...config, email: e.target.value })}
            />
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_owner_email_hint')}
            </p>
          </div>
        </div>
      )}

      {authMode === 'password' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fanout-comm-username">{t('settings_fanout_username_label')}</Label>
            <Input
              id="fanout-comm-username"
              type="text"
              value={(config.username as string) || ''}
              onChange={(e) => onChange({ ...config, username: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fanout-comm-password">{t('settings_fanout_password_label')}</Label>
            <Input
              id="fanout-comm-password"
              type="password"
              value={(config.password as string) || ''}
              onChange={(e) => onChange({ ...config, password: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.use_tls === undefined ? true : !!config.use_tls}
            onChange={(e) => onChange({ ...config, use_tls: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">{t('settings_fanout_use_tls_label')}</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer ml-7">
          <input
            type="checkbox"
            checked={config.tls_verify === undefined ? true : !!config.tls_verify}
            onChange={(e) => onChange({ ...config, tls_verify: e.target.checked })}
            className="h-4 w-4 rounded border-border"
            disabled={config.use_tls === undefined ? false : !config.use_tls}
          />
          <span className="text-sm">{t('settings_fanout_verify_tls_certificates_label')}</span>
        </label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fanout-comm-iata">{t('settings_fanout_region_code_iata_label')}</Label>
        <Input
          id="fanout-comm-iata"
          type="text"
          maxLength={3}
          placeholder={t('settings_fanout_iata_placeholder')}
          value={(config.iata as string) || ''}
          onChange={(e) => onChange({ ...config, iata: e.target.value.toUpperCase() })}
          className="w-32"
        />
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_fanout_iata_hint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fanout-comm-topic-template">
          {t('settings_fanout_packet_topic_template_label')}
        </Label>
        <Input
          id="fanout-comm-topic-template"
          type="text"
          placeholder={DEFAULT_COMMUNITY_PACKET_TOPIC_TEMPLATE}
          value={(config.topic_template as string | undefined) ?? ''}
          onChange={(e) => onChange({ ...config, topic_template: e.target.value })}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_topic_template_hint_prefix')} <code>{'{IATA}'}</code>{' '}
          {t('settings_fanout_topic_template_hint_and')} <code>{'{PUBLIC_KEY}'}</code>.{' '}
          {t('settings_fanout_topic_template_hint_default')}{' '}
          <code>{DEFAULT_COMMUNITY_PACKET_TOPIC_TEMPLATE}</code>
        </p>
      </div>

      <CommunityTopicControls config={config} onChange={onChange} />
    </div>
  );
}

function BotConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const t = useT();
  const code = (config.code as string) || '';
  return (
    <div className="space-y-3">
      <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md">
        <p className="text-sm text-destructive">
          <strong>{t('settings_fanout_bot_experimental_label')}</strong>{' '}
          {t('settings_fanout_bot_experimental_desc')}
        </p>
      </div>

      <div className="p-3 bg-warning/10 border border-warning/30 rounded-md">
        <p className="text-sm text-warning">
          <strong>{t('settings_fanout_bot_security_warning_label')}</strong>{' '}
          {t('settings_fanout_bot_security_warning_desc')}
        </p>
      </div>

      <div className="p-3 bg-warning/10 border border-warning/30 rounded-md">
        <p className="text-sm text-warning">
          <strong>{t('settings_fanout_bot_dont_wreck_label')}</strong>{' '}
          {t('settings_fanout_bot_dont_wreck_desc')}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_bot_define_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code className="bg-muted px-1 rounded">bot()</code>{' '}
          {t('settings_fanout_bot_define_suffix')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...config, code: DEFAULT_BOT_CODE })}
        >
          {t('settings_fanout_bot_reset_to_example')}
        </Button>
      </div>

      <Suspense
        fallback={
          <div className="h-64 md:h-96 rounded-md border border-input bg-code-editor-bg flex items-center justify-center text-muted-foreground">
            {t('settings_fanout_bot_loading_editor')}
          </div>
        }
      >
        <BotCodeEditor value={code} onChange={(c) => onChange({ ...config, code: c })} />
      </Suspense>

      <div className="text-[0.8125rem] text-muted-foreground space-y-1">
        <p>
          <strong>{t('settings_fanout_bot_available_label')}</strong>{' '}
          {t('settings_fanout_bot_available_desc')}
        </p>
        <p>
          <strong>{t('settings_fanout_bot_limits_label')}</strong>{' '}
          {t('settings_fanout_bot_limits_desc')}
        </p>
        <p>
          <strong>{t('settings_fanout_bot_note_label')}</strong>{' '}
          {t('settings_fanout_bot_note_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code>sender_key</code> {t('settings_fanout_bot_note_is')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code>None</code>. {t('settings_fanout_bot_note_suffix')}
        </p>
      </div>
    </div>
  );
}

function MapUploadConfigEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const t = useT();
  const isDryRun = config.dry_run !== false;
  const [radioLat, setRadioLat] = useState<number | null>(null);
  const [radioLon, setRadioLon] = useState<number | null>(null);

  useEffect(() => {
    api
      .getRadioConfig()
      .then((rc) => {
        setRadioLat(rc.lat ?? 0);
        setRadioLon(rc.lon ?? 0);
      })
      .catch(() => {
        setRadioLat(0);
        setRadioLon(0);
      });
  }, []);

  const radioLatLonConfigured =
    radioLat !== null && radioLon !== null && !(radioLat === 0 && radioLon === 0);

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('settings_fanout_map_upload_desc_prefix')}{' '}
        {/* eslint-disable i18next/no-literal-string */}
        <a
          href="https://map.meshcore.io"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          map.meshcore.io
        </a>
        {/* eslint-enable i18next/no-literal-string */}.{' '}
        {t('settings_fanout_map_upload_desc_key_prefix')}{' '}
        {/* eslint-disable-next-line i18next/no-literal-string */}
        <code>ENABLE_PRIVATE_KEY_EXPORT=1</code>
        {t('settings_fanout_map_upload_desc_suffix')}
      </p>

      <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
        <strong>
          {t('settings_fanout_map_dry_run_status', {
            status: isDryRun ? t('settings_fanout_status_on') : t('settings_fanout_status_off'),
          })}
        </strong>{' '}
        {isDryRun
          ? t('settings_fanout_map_dry_run_on_desc')
          : t('settings_fanout_map_dry_run_off_desc')}
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={isDryRun}
          onChange={(e) => onChange({ ...config, dry_run: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <div>
          <span className="text-sm font-medium">{t('settings_fanout_map_dry_run_label')}</span>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_map_dry_run_desc')}
          </p>
        </div>
      </label>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="fanout-map-api-url">{t('settings_fanout_map_api_url_label')}</Label>
        <Input
          id="fanout-map-api-url"
          type="url"
          placeholder="https://map.meshcore.io/api/v1/uploader/node"
          value={(config.api_url as string) || ''}
          onChange={(e) => onChange({ ...config, api_url: e.target.value })}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_map_api_url_hint_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code>map.meshcore.io</code> {t('settings_fanout_map_api_url_hint_suffix')}
        </p>
      </div>

      <Separator />

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!!config.geofence_enabled}
          onChange={(e) => onChange({ ...config, geofence_enabled: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <div>
          <span className="text-sm font-medium">
            {t('settings_fanout_map_enable_geofence_label')}
          </span>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_map_enable_geofence_desc')}
          </p>
        </div>
      </label>

      {!!config.geofence_enabled && (
        <div className="space-y-3 pl-7">
          {!radioLatLonConfigured && (
            <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
              {t('settings_fanout_map_no_lat_lon_prefix')}{' '}
              <strong>{t('settings_fanout_map_settings_radio_location_path')}</strong>.
            </div>
          )}
          {radioLatLonConfigured && (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_map_using_radio_position')}{' '}
              <code>
                {radioLat?.toFixed(5)}, {radioLon?.toFixed(5)}
              </code>{' '}
              {t('settings_fanout_map_geofence_center_suffix')}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="fanout-map-geofence-radius">
              {t('settings_fanout_map_radius_km_label')}
            </Label>
            <Input
              id="fanout-map-geofence-radius"
              type="number"
              min="0"
              step="any"
              placeholder={t('settings_fanout_map_radius_placeholder')}
              value={getOptionalNumberInputValue(config.geofence_radius_km)}
              onChange={(e) =>
                onChange({
                  ...config,
                  geofence_radius_km: parseFloatInputValue(e.target.value),
                })
              }
            />
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_fanout_map_radius_hint')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

type ScopeMode = 'all' | 'none' | 'only' | 'except';

function getScopeMode(value: unknown): ScopeMode {
  if (value === 'all') return 'all';
  if (value === 'none') return 'none';
  if (typeof value === 'object' && value !== null) {
    // Check if either channels or contacts uses the {except: [...]} shape
    const obj = value as Record<string, unknown>;
    const ch = obj.channels;
    const co = obj.contacts;
    if (
      (typeof ch === 'object' && ch !== null && !Array.isArray(ch)) ||
      (typeof co === 'object' && co !== null && !Array.isArray(co))
    ) {
      return 'except';
    }
    return 'only';
  }
  return 'all';
}

/** Extract the key list from a filter value, whether it's a plain list or {except: [...]} */
function getFilterKeys(filter: unknown): string[] {
  if (Array.isArray(filter)) return filter as string[];
  if (typeof filter === 'object' && filter !== null && 'except' in filter)
    return ((filter as Record<string, unknown>).except as string[]) ?? [];
  return [];
}

const MAX_SCOPE_PILL_DISPLAY = 32;

interface PillsSearchListItem {
  key: string;
  label: string;
  /** Optional trailing monospace hint (e.g. pubkey prefix) */
  trailing?: string;
}

/**
 * Search-and-pills picker for the generic fanout scope selector.
 * Shows selected items as removable pills (up to MAX_SCOPE_PILL_DISPLAY),
 * a search input, and a scrollable list of filtered items with checkboxes.
 * When more than MAX_SCOPE_PILL_DISPLAY items are selected, the pill row
 * collapses to a single informational badge to keep the interface clean.
 */
function PillsSearchList({
  label,
  labelSuffix,
  items,
  selectedKeys,
  onToggle,
  onAll,
  onNone,
  searchPlaceholder,
  emptyItemsMessage,
}: {
  label: string;
  labelSuffix: string;
  items: PillsSearchListItem[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
  searchPlaceholder: string;
  emptyItemsMessage: string;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const searchLower = search.toLowerCase().trim();

  const filtered = useMemo(() => {
    const matches = items.filter((it) => {
      if (!searchLower) return true;
      return (
        it.label.toLowerCase().includes(searchLower) || it.key.toLowerCase().startsWith(searchLower)
      );
    });
    // Selected items sort to top (mirrors the Home Assistant tracked-contacts picker)
    return matches.sort((a, b) => {
      const aSel = selectedKeys.includes(a.key) ? 0 : 1;
      const bSel = selectedKeys.includes(b.key) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.label.localeCompare(b.label);
    });
  }, [items, searchLower, selectedKeys]);

  const selectedDetails = useMemo(
    () => items.filter((it) => selectedKeys.includes(it.key)),
    [items, selectedKeys]
  );
  const overPillLimit = selectedDetails.length > MAX_SCOPE_PILL_DISPLAY;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">
          {label} <span className="text-muted-foreground font-normal">({labelSuffix})</span>
        </Label>
        <span className="flex gap-1">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onAll}
          >
            {t('settings_fanout_all_label')}
          </button>
          <span className="text-xs text-muted-foreground">/</span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onNone}
          >
            {t('settings_fanout_none_label')}
          </button>
        </span>
      </div>

      {selectedDetails.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {overPillLimit ? (
            <span className="inline-flex items-center text-[0.6875rem] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {t('settings_fanout_over_pill_limit', { limit: MAX_SCOPE_PILL_DISPLAY })}
            </span>
          ) : (
            selectedDetails.map((it) => (
              <span
                key={it.key}
                className="inline-flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded-full bg-primary/10 text-primary"
              >
                {it.label}
                <button
                  type="button"
                  className="ml-0.5 hover:text-destructive transition-colors"
                  onClick={() => onToggle(it.key)}
                  aria-label={t('settings_fanout_remove_item_aria', { name: it.label })}
                >
                  &times;
                </button>
              </span>
            ))
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground italic">{emptyItemsMessage}</p>
      ) : (
        <>
          <Input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
          <div className="max-h-48 overflow-y-auto space-y-1 rounded border border-border p-2">
            {filtered.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground italic py-1">
                {t('settings_fanout_no_items_match', { label: label.toLowerCase(), search })}
              </p>
            ) : (
              filtered.map((it) => (
                <label key={it.key} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selectedKeys.includes(it.key)}
                    onChange={() => onToggle(it.key)}
                    className="h-3.5 w-3.5 rounded border-input accent-primary"
                  />
                  <span className="truncate">{it.label}</span>
                  {it.trailing && (
                    <span className="text-[0.625rem] text-muted-foreground ml-auto font-mono shrink-0">
                      {it.trailing}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScopeSelector({
  scope,
  onChange,
  showRawPackets = false,
}: {
  scope: Record<string, unknown>;
  onChange: (scope: Record<string, unknown>) => void;
  showRawPackets?: boolean;
}) {
  const t = useT();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    api.getChannels().then(setChannels).catch(console.error);

    // Paginate to fetch all contacts (API caps at 1000 per request)
    (async () => {
      const all: Contact[] = [];
      const pageSize = 1000;
      let offset = 0;

      while (true) {
        const page = await api.getContacts(pageSize, offset);
        all.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      setContacts(all);
    })().catch(console.error);
  }, []);

  const messages = scope.messages ?? 'all';
  const rawMode = getScopeMode(messages);
  // When raw packets aren't offered, "none" is not a valid choice — treat as "all"
  const mode = !showRawPackets && rawMode === 'none' ? 'all' : rawMode;
  const isListMode = mode === 'only' || mode === 'except';

  const selectedChannels: string[] =
    isListMode && typeof messages === 'object' && messages !== null
      ? getFilterKeys((messages as Record<string, unknown>).channels)
      : [];
  const selectedContacts: string[] =
    isListMode && typeof messages === 'object' && messages !== null
      ? getFilterKeys((messages as Record<string, unknown>).contacts)
      : [];

  /** Wrap channel/contact key lists in the right shape for the current mode */
  const buildMessages = (chKeys: string[], coKeys: string[]) => {
    if (mode === 'except') {
      return {
        channels: { except: chKeys },
        contacts: { except: coKeys },
      };
    }
    return { channels: chKeys, contacts: coKeys };
  };

  const handleModeChange = (newMode: ScopeMode) => {
    if (newMode === 'all' || newMode === 'none') {
      onChange({ ...scope, messages: newMode });
    } else if (newMode === 'only') {
      onChange({ ...scope, messages: { channels: [], contacts: [] } });
    } else {
      onChange({
        ...scope,
        messages: { channels: { except: [] }, contacts: { except: [] } },
      });
    }
  };

  const toggleChannel = (key: string) => {
    const current = [...selectedChannels];
    const idx = current.indexOf(key);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(key);
    onChange({ ...scope, messages: buildMessages(current, selectedContacts) });
  };

  const toggleContact = (key: string) => {
    const current = [...selectedContacts];
    const idx = current.indexOf(key);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(key);
    onChange({ ...scope, messages: buildMessages(selectedChannels, current) });
  };

  // Exclude repeaters (2), rooms (3), and sensors (4)
  const filteredContacts = contacts.filter((c) => c.type === 0 || c.type === 1);

  const modeDescriptions: Record<ScopeMode, string> = {
    all: t('settings_fanout_scope_mode_all'),
    none: t('settings_fanout_scope_mode_none'),
    only: t('settings_fanout_scope_mode_only'),
    except: t('settings_fanout_scope_mode_except'),
  };

  const rawEnabled = showRawPackets && scope.raw_packets === 'all';

  // Warn when the effective scope matches nothing
  const messagesEffectivelyNone =
    mode === 'none' ||
    (mode === 'only' && selectedChannels.length === 0 && selectedContacts.length === 0) ||
    (mode === 'except' &&
      channels.length > 0 &&
      filteredContacts.length > 0 &&
      selectedChannels.length >= channels.length &&
      selectedContacts.length >= filteredContacts.length);
  const showEmptyScopeWarning = messagesEffectivelyNone && !rawEnabled;

  const listHint =
    mode === 'only' ? t('settings_fanout_scope_hint_only') : t('settings_fanout_scope_hint_except');

  const checkboxLabel =
    mode === 'except'
      ? t('settings_fanout_scope_checkbox_exclude')
      : t('settings_fanout_scope_checkbox_include');

  const messageModes: ScopeMode[] = showRawPackets
    ? ['all', 'none', 'only', 'except']
    : ['all', 'only', 'except'];

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">
        {t('settings_fanout_scope_heading')}
      </h3>

      {showRawPackets && (
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={rawEnabled}
            onChange={(e) => onChange({ ...scope, raw_packets: e.target.checked ? 'all' : 'none' })}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">{t('settings_fanout_forward_raw_packets_label')}</span>
        </label>
      )}

      <div className="space-y-1">
        {messageModes.map((m) => (
          <label key={m} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="scope-mode"
              checked={mode === m}
              onChange={() => handleModeChange(m)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm">{modeDescriptions[m]}</span>
          </label>
        ))}
      </div>

      {showEmptyScopeWarning && (
        <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          {t('settings_fanout_scope_empty_warning')}
        </div>
      )}

      {isListMode && (
        <>
          <p className="text-[0.8125rem] text-muted-foreground">{listHint}</p>

          {channels.length > 0 && (
            <PillsSearchList
              label={t('settings_fanout_channels_label')}
              labelSuffix={checkboxLabel}
              items={channels.map((ch) => ({ key: ch.key, label: ch.name }))}
              selectedKeys={selectedChannels}
              onToggle={toggleChannel}
              onAll={() =>
                onChange({
                  ...scope,
                  messages: buildMessages(
                    channels.map((ch) => ch.key),
                    selectedContacts
                  ),
                })
              }
              onNone={() => onChange({ ...scope, messages: buildMessages([], selectedContacts) })}
              searchPlaceholder={t('settings_fanout_search_channels_placeholder', {
                count: channels.length,
              })}
              emptyItemsMessage={t('settings_fanout_no_channels_available')}
            />
          )}

          {filteredContacts.length > 0 && (
            <PillsSearchList
              label={t('settings_fanout_contacts_label')}
              labelSuffix={checkboxLabel}
              items={filteredContacts.map((c) => ({
                key: c.public_key,
                label: c.name || c.public_key.slice(0, 12),
                trailing: c.public_key.slice(0, 12),
              }))}
              selectedKeys={selectedContacts}
              onToggle={toggleContact}
              onAll={() =>
                onChange({
                  ...scope,
                  messages: buildMessages(
                    selectedChannels,
                    filteredContacts.map((c) => c.public_key)
                  ),
                })
              }
              onNone={() => onChange({ ...scope, messages: buildMessages(selectedChannels, []) })}
              searchPlaceholder={t('settings_fanout_search_scope_contacts_placeholder', {
                count: filteredContacts.length,
              })}
              emptyItemsMessage={t('settings_fanout_no_contacts_available')}
            />
          )}
        </>
      )}
    </div>
  );
}

const APPRISE_DEFAULT_DM = '**DM:** {sender_name}: {text} **via:** [{hops_backticked}]';
const APPRISE_DEFAULT_CHANNEL =
  '**{channel_name}:** {sender_name}: {text} **via:** [{hops_backticked}]';
const APPRISE_DEFAULT_DM_PLAIN = 'DM: {sender_name}: {text} via: [{hops}]';
const APPRISE_DEFAULT_CHANNEL_PLAIN = '{channel_name}: {sender_name}: {text} via: [{hops}]';

const APPRISE_SAMPLE_VARS: Record<string, string> = {
  type: 'CHAN',
  text: 'hello world',
  sender_name: 'Alice',
  sender_key: 'a1b2c3d4e5f6',
  channel_name: '#general',
  conversation_key: 'abcdef1234567890',
  hops: '2a, 3b',
  hops_backticked: '`2a`, `3b`',
  hop_count: '2',
  rssi: '-95',
  snr: '6.5',
};

const APPRISE_SAMPLE_VARS_DM: Record<string, string> = {
  ...APPRISE_SAMPLE_VARS,
  type: 'PRIV',
  channel_name: '',
  conversation_key: 'a1b2c3d4e5f6',
};

function appriseApplyFormat(fmt: string, vars: Record<string, string>): string {
  let result = fmt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

/** Render a markdown-ish string into inline React elements (bold, italic, code). */
function appriseRenderMarkdown(s: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  // Split on **bold**, __bold__, *italic*, _italic_, and `code` spans.
  // Longer delimiters first so ** and __ match before * and _.
  const parts = s.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g);
  for (const part of parts) {
    if (
      (part.startsWith('**') && part.endsWith('**')) ||
      (part.startsWith('__') && part.endsWith('__'))
    ) {
      nodes.push(
        <strong key={key++} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (
      (part.startsWith('*') && part.endsWith('*')) ||
      (part.startsWith('_') && part.endsWith('_'))
    ) {
      nodes.push(
        <em key={key++} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    } else if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.6875rem] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    } else if (part) {
      nodes.push(<span key={key++}>{part}</span>);
    }
  }
  return nodes;
}

function AppriseFormatPreview({
  format,
  vars,
  markdown = true,
}: {
  format: string;
  vars: Record<string, string>;
  markdown?: boolean;
}) {
  const t = useT();
  const raw = appriseApplyFormat(format, vars);
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5">
      {markdown && (
        <div>
          <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
            {t('settings_fanout_apprise_rendered_label')}
          </span>
          <p className="text-xs break-all">{appriseRenderMarkdown(raw)}</p>
        </div>
      )}
      <div>
        <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
          {markdown
            ? t('settings_fanout_apprise_raw_label')
            : t('settings_fanout_apprise_preview_label')}
        </span>
        <p className="text-xs font-mono break-all text-muted-foreground">{raw}</p>
      </div>
    </div>
  );
}

function appriseIsDefault(value: unknown, defaultStr: string): boolean {
  if (value == null) return true;
  const s = String(value).trim();
  return s === '' || s === defaultStr;
}

function AppriseConfigEditor({
  config,
  scope,
  onChange,
  onScopeChange,
}: {
  config: Record<string, unknown>;
  scope: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  onScopeChange: (scope: Record<string, unknown>) => void;
}) {
  const t = useT();
  const markdown = config.markdown_format !== false;
  const defaultDm = markdown ? APPRISE_DEFAULT_DM : APPRISE_DEFAULT_DM_PLAIN;
  const defaultChan = markdown ? APPRISE_DEFAULT_CHANNEL : APPRISE_DEFAULT_CHANNEL_PLAIN;
  const dmFormat = ((config.body_format_dm as string) || '').trim() || defaultDm;
  const chanFormat = ((config.body_format_channel as string) || '').trim() || defaultChan;

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('settings_fanout_apprise_intro_prefix')} {/* eslint-disable i18next/no-literal-string */}
        <a
          href="https://github.com/caronc/apprise"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Apprise
        </a>
        {/* eslint-enable i18next/no-literal-string */} {t('settings_fanout_apprise_intro_middle')}{' '}
        <a
          href="https://github.com/caronc/apprise/wiki#supported-notifications"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          {t('settings_fanout_apprise_intro_other_services')}
        </a>
        .
      </p>

      <div className="space-y-2">
        <Label htmlFor="fanout-apprise-urls">
          {t('settings_fanout_apprise_notification_urls_label')}
        </Label>
        <textarea
          id="fanout-apprise-urls"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[80px]"
          placeholder={
            'discord://webhook_id/token\nslack://token_a/token_b/token_c\ntgram://bot_token/chat_id'
          }
          value={(config.urls as string) || ''}
          onChange={(e) => onChange({ ...config, urls: e.target.value })}
          rows={4}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_apprise_urls_hint_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code>?hsreq=no</code> {t('settings_fanout_apprise_urls_hint_suffix')}
        </p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.preserve_identity !== false}
          onChange={(e) => onChange({ ...config, preserve_identity: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <div>
          <span className="text-sm">{t('settings_fanout_apprise_preserve_identity_label')}</span>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_apprise_preserve_identity_desc')}
          </p>
        </div>
      </label>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.include_outgoing === true}
          onChange={(e) => onChange({ ...config, include_outgoing: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <div>
          <span className="text-sm">{t('settings_fanout_apprise_forward_outgoing_label')}</span>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_apprise_forward_outgoing_desc')}
          </p>
        </div>
      </label>

      <Separator />

      <h3 className="text-base font-semibold tracking-tight">
        {t('settings_fanout_message_format_heading')}
      </h3>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={markdown}
          onChange={(e) => {
            const md = e.target.checked;
            const updates: Record<string, unknown> = { ...config, markdown_format: md };
            const curDm = ((config.body_format_dm as string) || '').trim();
            const curChan = ((config.body_format_channel as string) || '').trim();
            if (md) {
              if (!curDm || curDm === APPRISE_DEFAULT_DM_PLAIN)
                updates.body_format_dm = APPRISE_DEFAULT_DM;
              if (!curChan || curChan === APPRISE_DEFAULT_CHANNEL_PLAIN)
                updates.body_format_channel = APPRISE_DEFAULT_CHANNEL;
            } else {
              if (!curDm || curDm === APPRISE_DEFAULT_DM)
                updates.body_format_dm = APPRISE_DEFAULT_DM_PLAIN;
              if (!curChan || curChan === APPRISE_DEFAULT_CHANNEL)
                updates.body_format_channel = APPRISE_DEFAULT_CHANNEL_PLAIN;
            }
            onChange(updates);
          }}
          className="h-4 w-4 rounded border-border"
        />
        <div>
          <span className="text-sm">{t('settings_fanout_apprise_markdown_formatting_label')}</span>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_apprise_markdown_formatting_desc')}
          </p>
        </div>
      </label>

      <details className="group">
        <summary className="text-sm font-medium text-foreground cursor-pointer select-none flex items-center gap-1">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" />
          {t('settings_fanout_apprise_available_variables')}
        </summary>
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs space-y-0.5">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">{'{text}'}</code>
            <span className="text-muted-foreground">{t('settings_fanout_apprise_var_text')}</span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">
              {'{sender_name}'}
            </code>
            <span className="text-muted-foreground">
              {t('settings_fanout_apprise_var_sender_name')}
            </span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">
              {'{sender_key}'}
            </code>
            <span className="text-muted-foreground">
              {t('settings_fanout_apprise_var_sender_key')}
            </span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">
              {'{channel_name}'}
            </code>
            <span className="text-muted-foreground">
              {t('settings_fanout_apprise_var_channel_name')}
            </span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">
              {'{conversation_key}'}
            </code>
            <span className="text-muted-foreground">
              {t('settings_fanout_apprise_var_conversation_key')}
            </span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">{'{type}'}</code>
            <span className="text-muted-foreground">{t('settings_fanout_apprise_var_type')}</span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">{'{hops}'}</code>
            <span className="text-muted-foreground">{t('settings_fanout_apprise_var_hops')}</span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">
              {'{hops_backticked}'}
            </code>
            <span className="text-muted-foreground">
              {t('settings_fanout_apprise_var_hops_backticked')}
            </span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">
              {'{hop_count}'}
            </code>
            <span className="text-muted-foreground">
              {t('settings_fanout_apprise_var_hop_count')}
            </span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">{'{rssi}'}</code>
            <span className="text-muted-foreground">{t('settings_fanout_apprise_var_rssi')}</span>
            <code className="text-[0.6875rem] font-mono bg-muted px-1 rounded">{'{snr}'}</code>
            <span className="text-muted-foreground">{t('settings_fanout_apprise_var_snr')}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {t('settings_fanout_apprise_empty_textareas_hint')}
          </p>
        </div>
      </details>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="fanout-apprise-fmt-dm">
            {t('settings_fanout_apprise_dm_format_label')}
          </Label>
          {!appriseIsDefault(config.body_format_dm, defaultDm) && (
            <button
              type="button"
              aria-label={t('settings_fanout_apprise_reset_dm_format_aria')}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onChange({ ...config, body_format_dm: defaultDm })}
            >
              {t('settings_fanout_reset_to_default')}
            </button>
          )}
        </div>
        <textarea
          id="fanout-apprise-fmt-dm"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[56px]"
          placeholder={defaultDm}
          value={(config.body_format_dm as string) ?? ''}
          onChange={(e) => onChange({ ...config, body_format_dm: e.target.value })}
          rows={2}
        />
        <AppriseFormatPreview format={dmFormat} vars={APPRISE_SAMPLE_VARS_DM} markdown={markdown} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="fanout-apprise-fmt-chan">
            {t('settings_fanout_apprise_channel_format_label')}
          </Label>
          {!appriseIsDefault(config.body_format_channel, defaultChan) && (
            <button
              type="button"
              aria-label={t('settings_fanout_apprise_reset_channel_format_aria')}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onChange({ ...config, body_format_channel: defaultChan })}
            >
              {t('settings_fanout_reset_to_default')}
            </button>
          )}
        </div>
        <textarea
          id="fanout-apprise-fmt-chan"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[56px]"
          placeholder={defaultChan}
          value={(config.body_format_channel as string) ?? ''}
          onChange={(e) => onChange({ ...config, body_format_channel: e.target.value })}
          rows={2}
        />
        <AppriseFormatPreview format={chanFormat} vars={APPRISE_SAMPLE_VARS} markdown={markdown} />
      </div>

      <Separator />

      <ScopeSelector scope={scope} onChange={onScopeChange} />
    </div>
  );
}

function WebhookConfigEditor({
  config,
  scope,
  onChange,
  onScopeChange,
}: {
  config: Record<string, unknown>;
  scope: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  onScopeChange: (scope: Record<string, unknown>) => void;
}) {
  const t = useT();
  const headersStr = JSON.stringify(config.headers ?? {}, null, 2);
  const [headersText, setHeadersText] = useState(headersStr);
  const [headersError, setHeadersError] = useState<string | null>(null);

  const handleHeadersChange = (text: string) => {
    setHeadersText(text);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setHeadersError(t('settings_fanout_webhook_headers_must_be_object'));
        return;
      }
      setHeadersError(null);
      onChange({ ...config, headers: parsed });
    } catch {
      setHeadersError(t('settings_fanout_webhook_headers_invalid_json'));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_fanout_webhook_desc')}</p>

      <div className="space-y-2">
        <Label htmlFor="fanout-webhook-url">{t('settings_fanout_url_label')}</Label>
        <Input
          id="fanout-webhook-url"
          type="url"
          placeholder="https://example.com/webhook"
          value={(config.url as string) || ''}
          onChange={(e) => onChange({ ...config, url: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-webhook-method">{t('settings_fanout_http_method_label')}</Label>
          <select
            id="fanout-webhook-method"
            value={(config.method as string) || 'POST'}
            onChange={(e) => onChange({ ...config, method: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
          </select>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_fanout_hmac_signing_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_hmac_signing_desc_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <code className="bg-muted px-1 rounded">sha256=ab12cd...</code>
          {t('settings_fanout_hmac_signing_desc_suffix')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fanout-webhook-hmac-secret">
              {t('settings_fanout_hmac_secret_label')}
            </Label>
            <Input
              id="fanout-webhook-hmac-secret"
              type="password"
              placeholder={t('settings_fanout_hmac_secret_placeholder')}
              value={(config.hmac_secret as string) || ''}
              onChange={(e) => onChange({ ...config, hmac_secret: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fanout-webhook-hmac-header">
              {t('settings_fanout_signature_header_name_label')}
            </Label>
            <Input
              id="fanout-webhook-hmac-header"
              type="text"
              placeholder="X-Webhook-Signature"
              value={(config.hmac_header as string) || ''}
              onChange={(e) => onChange({ ...config, hmac_header: e.target.value })}
            />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="fanout-webhook-headers">
          {t('settings_fanout_extra_headers_json_label')}
        </Label>
        <textarea
          id="fanout-webhook-headers"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[60px]"
          value={headersText}
          onChange={(e) => handleHeadersChange(e.target.value)}
          placeholder='{"Authorization": "Bearer ..."}'
        />
        {headersError && <p className="text-xs text-destructive">{headersError}</p>}
      </div>

      <Separator />

      <ScopeSelector scope={scope} onChange={onScopeChange} />
    </div>
  );
}

function SqsConfigEditor({
  config,
  scope,
  onChange,
  onScopeChange,
}: {
  config: Record<string, unknown>;
  scope: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  onScopeChange: (scope: Record<string, unknown>) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_fanout_sqs_desc')}</p>

      <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
        {t('settings_fanout_sqs_plaintext_warning')}
      </div>

      <div className="space-y-2">
        <Label htmlFor="fanout-sqs-queue-url">{t('settings_fanout_sqs_queue_url_label')}</Label>
        <Input
          id="fanout-sqs-queue-url"
          type="url"
          placeholder="https://sqs.us-east-1.amazonaws.com/123456789012/mesh-events"
          value={(config.queue_url as string) || ''}
          onChange={(e) => onChange({ ...config, queue_url: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-sqs-region">{t('settings_fanout_sqs_region_label')}</Label>
          <Input
            id="fanout-sqs-region"
            type="text"
            placeholder="us-east-1"
            value={(config.region_name as string) || ''}
            onChange={(e) => onChange({ ...config, region_name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-sqs-endpoint">{t('settings_fanout_sqs_endpoint_url_label')}</Label>
          <Input
            id="fanout-sqs-endpoint"
            type="url"
            placeholder="http://localhost:4566"
            value={(config.endpoint_url as string) || ''}
            onChange={(e) => onChange({ ...config, endpoint_url: e.target.value })}
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_fanout_sqs_endpoint_hint')}
          </p>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_fanout_sqs_static_credentials_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_fanout_sqs_static_credentials_desc')}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fanout-sqs-access-key">
            {t('settings_fanout_sqs_access_key_id_label')}
          </Label>
          <Input
            id="fanout-sqs-access-key"
            type="text"
            value={(config.access_key_id as string) || ''}
            onChange={(e) => onChange({ ...config, access_key_id: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fanout-sqs-secret-key">
            {t('settings_fanout_sqs_secret_access_key_label')}
          </Label>
          <Input
            id="fanout-sqs-secret-key"
            type="password"
            value={(config.secret_access_key as string) || ''}
            onChange={(e) => onChange({ ...config, secret_access_key: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fanout-sqs-session-token">
          {t('settings_fanout_sqs_session_token_label')}
        </Label>
        <Input
          id="fanout-sqs-session-token"
          type="password"
          value={(config.session_token as string) || ''}
          onChange={(e) => onChange({ ...config, session_token: e.target.value })}
        />
      </div>

      <Separator />

      <ScopeSelector scope={scope} onChange={onScopeChange} showRawPackets />
    </div>
  );
}

export function SettingsFanoutSection({
  health,
  onHealthRefresh,
  className,
}: {
  health: HealthStatus | null;
  onHealthRefresh?: () => Promise<void>;
  className?: string;
}) {
  const t = useT();
  const [configs, setConfigs] = useState<FanoutConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<DraftType | null>(null);
  const [editConfig, setEditConfig] = useState<Record<string, unknown>>({});
  const [editScope, setEditScope] = useState<Record<string, unknown>>({});
  const [editName, setEditName] = useState('');
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineEditName, setInlineEditName] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedCreateType, setSelectedCreateType] = useState<DraftType | null>(null);
  const [errorDialogState, setErrorDialogState] = useState<{
    integrationName: string;
    error: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadConfigs = useCallback(async () => {
    try {
      const data = await api.getFanoutConfigs();
      setConfigs(data);
    } catch (err) {
      console.error('Failed to load fanout configs:', err);
    }
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const typeLabels = useMemo(() => getTypeLabels(t), [t]);
  const createIntegrationDefinitions = useMemo(() => getCreateIntegrationDefinitions(t), [t]);
  const definitionsByValue = useMemo(
    () =>
      Object.fromEntries(
        createIntegrationDefinitions.map((definition) => [definition.value, definition])
      ) as Record<DraftType, CreateIntegrationDefinition>,
    [createIntegrationDefinitions]
  );

  const availableCreateOptions = useMemo(
    () =>
      createIntegrationDefinitions.filter(
        (definition) => definition.savedType !== 'bot' || !health?.bots_disabled
      ),
    [createIntegrationDefinitions, health?.bots_disabled]
  );

  useEffect(() => {
    if (!createDialogOpen) return;
    if (availableCreateOptions.length === 0) {
      setSelectedCreateType(null);
      return;
    }
    if (
      selectedCreateType &&
      availableCreateOptions.some((option) => option.value === selectedCreateType)
    ) {
      return;
    }
    setSelectedCreateType(availableCreateOptions[0].value);
  }, [createDialogOpen, availableCreateOptions, selectedCreateType]);

  const handleToggleEnabled = async (cfg: FanoutConfig) => {
    try {
      await api.updateFanoutConfig(cfg.id, { enabled: !cfg.enabled });
      await loadConfigs();
      if (onHealthRefresh) await onHealthRefresh();
      toast.success(
        cfg.enabled
          ? t('settings_fanout_toast_integration_disabled')
          : t('settings_fanout_toast_integration_enabled')
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings_fanout_toast_failed_to_update'));
    }
  };

  const handleEdit = (cfg: FanoutConfig) => {
    setCreateDialogOpen(false);
    setInlineEditingId(null);
    setInlineEditName('');
    setDraftType(null);
    setEditingId(cfg.id);
    setEditConfig(cfg.config);
    setEditScope(cfg.scope);
    setEditName(cfg.name);
  };

  const handleStartInlineEdit = (cfg: FanoutConfig) => {
    setCreateDialogOpen(false);
    setInlineEditingId(cfg.id);
    setInlineEditName(cfg.name);
  };

  const handleCancelInlineEdit = () => {
    setInlineEditingId(null);
    setInlineEditName('');
  };

  const handleBackToList = () => {
    const shouldConfirm =
      draftType !== null ||
      fanoutDraftHasUnsavedChanges(
        editingId ? (configs.find((c) => c.id === editingId) ?? null) : null,
        {
          name: editName,
          config: editConfig,
          scope: editScope,
        }
      );
    if (shouldConfirm && !confirm(t('settings_fanout_confirm_leave_without_saving'))) return;
    setEditingId(null);
    setDraftType(null);
  };

  const handleInlineNameSave = async (cfg: FanoutConfig) => {
    const nextName = inlineEditName.trim();
    if (inlineEditingId !== cfg.id) return;
    if (!nextName) {
      toast.error(t('settings_fanout_toast_name_cannot_be_empty'));
      handleCancelInlineEdit();
      return;
    }
    if (nextName === cfg.name) {
      handleCancelInlineEdit();
      return;
    }
    try {
      await api.updateFanoutConfig(cfg.id, { name: nextName });
      if (editingId === cfg.id) {
        setEditName(nextName);
      }
      await loadConfigs();
      toast.success(t('settings_fanout_toast_name_updated'));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings_fanout_toast_failed_to_update_name')
      );
    } finally {
      handleCancelInlineEdit();
    }
  };

  const handleSave = async (enabled?: boolean) => {
    const currentDraftType = draftType;
    const currentEditingId = editingId;
    if (!currentEditingId && !currentDraftType) return;
    // MeshRank (topic_style MESHRANK) has no default packet topic — the broker
    // assigns one per account, so it must be provided before saving.
    const activeCommunityPreset = COMMUNITY_MQTT_PRESETS.find(
      (p) => p.id === detectPresetId(editConfig)
    );
    if (
      activeCommunityPreset?.requiresTopicTemplate &&
      !String(editConfig.topic_template ?? '').trim()
    ) {
      toast.error(t('settings_fanout_meshrank_topic_required'));
      return;
    }
    setBusy(true);
    try {
      if (currentDraftType) {
        const recipe = getCreateIntegrationDefinition(currentDraftType, definitionsByValue);
        await api.createFanoutConfig({
          type: recipe.savedType,
          name: normalizeDraftName(
            currentDraftType,
            editName.trim(),
            configs,
            definitionsByValue,
            typeLabels
          ),
          config: normalizeDraftConfig(currentDraftType, editConfig, definitionsByValue),
          scope: normalizeDraftScope(currentDraftType, editScope, definitionsByValue),
          enabled: enabled ?? true,
        });
      } else {
        if (!currentEditingId) {
          throw new Error(t('settings_fanout_error_missing_config_id'));
        }
        const editingType = configs.find((cfg) => cfg.id === currentEditingId)?.type ?? '';
        const update: Record<string, unknown> = {
          name: editName,
          config: normalizeIntegrationConfigForSave(editingType, editConfig),
          scope: editScope,
        };
        if (enabled !== undefined) update.enabled = enabled;
        await api.updateFanoutConfig(currentEditingId, update);
      }
      setDraftType(null);
      setEditingId(null);
      await loadConfigs();
      if (onHealthRefresh) {
        try {
          await onHealthRefresh();
        } catch (err) {
          console.error('Failed to refresh health after saving fanout config:', err);
        }
      }
      toast.success(
        enabled
          ? t('settings_fanout_toast_integration_saved_and_enabled')
          : t('settings_fanout_toast_integration_saved')
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings_fanout_toast_failed_to_save'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    const cfg = configs.find((c) => c.id === id);
    if (!confirm(t('settings_fanout_confirm_delete_integration', { name: cfg?.name ?? '' })))
      return;
    try {
      await api.deleteFanoutConfig(id);
      if (editingId === id) setEditingId(null);
      await loadConfigs();
      if (onHealthRefresh) await onHealthRefresh();
      toast.success(t('settings_fanout_toast_integration_deleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings_fanout_toast_failed_to_delete'));
    }
  };

  const handleAddCreate = (type: DraftType) => {
    const definition = getCreateIntegrationDefinition(type, definitionsByValue);
    const defaults = cloneDraftDefaults(type, definitionsByValue);
    setCreateDialogOpen(false);
    setEditingId(null);
    setDraftType(type);
    setEditName(
      definition.nameMode === 'fixed'
        ? definition.defaultName
        : getDefaultIntegrationName(definition.savedType, configs, typeLabels)
    );
    setEditConfig(defaults.config);
    setEditScope(defaults.scope);
  };

  const editingConfig = editingId ? configs.find((c) => c.id === editingId) : null;
  const detailType = draftType ?? editingConfig?.type ?? null;
  const isDraft = draftType !== null;
  const configGroups = Object.entries(typeLabels)
    .map(([type, label]) => ({
      type,
      label,
      configs: configs
        .filter((cfg) => cfg.type === type)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    }))
    .filter((group) => group.configs.length > 0);

  // Detail view
  if (detailType) {
    return (
      <div className={cn('mx-auto w-full max-w-[800px] space-y-4', className)}>
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning transition-colors hover:bg-warning/20"
          onClick={handleBackToList}
        >
          {t('settings_fanout_back_to_list')}
        </button>

        <div className="space-y-2">
          <Label htmlFor="fanout-edit-name">{t('common_name')}</Label>
          <Input
            id="fanout-edit-name"
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          {t('settings_fanout_type_prefix', {
            type: getDetailTypeLabel(detailType, definitionsByValue, typeLabels),
          })}
        </div>

        <Separator />

        {detailType === 'mqtt_private' && (
          <MqttPrivateConfigEditor
            config={editConfig}
            scope={editScope}
            onChange={setEditConfig}
            onScopeChange={setEditScope}
          />
        )}

        {detailType === 'mqtt_ha' && (
          <MqttHaConfigEditor
            config={editConfig}
            scope={editScope}
            onChange={setEditConfig}
            onScopeChange={setEditScope}
          />
        )}

        {detailType === 'mqtt_community' && (
          <MqttCommunityConfigEditor config={editConfig} onChange={setEditConfig} />
        )}

        {detailType === 'bot' && <BotConfigEditor config={editConfig} onChange={setEditConfig} />}

        {detailType === 'apprise' && (
          <AppriseConfigEditor
            config={editConfig}
            scope={editScope}
            onChange={setEditConfig}
            onScopeChange={setEditScope}
          />
        )}

        {detailType === 'webhook' && (
          <WebhookConfigEditor
            config={editConfig}
            scope={editScope}
            onChange={setEditConfig}
            onScopeChange={setEditScope}
          />
        )}

        {detailType === 'sqs' && (
          <SqsConfigEditor
            config={editConfig}
            scope={editScope}
            onChange={setEditConfig}
            onScopeChange={setEditScope}
          />
        )}

        {detailType === 'map_upload' && (
          <MapUploadConfigEditor config={editConfig} onChange={setEditConfig} />
        )}

        <Separator />

        <div className="flex gap-2">
          <Button
            onClick={() => handleSave(true)}
            disabled={busy}
            className="flex-1 bg-status-connected hover:bg-status-connected/90 text-primary-foreground"
          >
            {busy ? t('settings_fanout_saving') : t('settings_fanout_save_as_enabled')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleSave(false)}
            disabled={busy}
            className="flex-1"
          >
            {busy ? t('settings_fanout_saving') : t('settings_fanout_save_as_disabled')}
          </Button>
          {!isDraft && editingConfig && (
            <Button variant="destructive" onClick={() => handleDelete(editingConfig.id)}>
              {t('common_delete')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className={cn('mx-auto w-full max-w-[800px] space-y-4', className)}>
      <div className="rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-warning">
        {t('settings_fanout_experimental_beta_notice')}
      </div>

      {health?.bots_disabled && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {health.bots_disabled_source === 'until_restart'
            ? t('settings_fanout_bots_disabled_until_restart')
            : t('settings_fanout_bots_disabled_by_config')}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setCreateDialogOpen(true)}>
          {t('settings_fanout_add_integration_button')}
        </Button>
      </div>

      <CreateIntegrationDialog
        open={createDialogOpen}
        options={availableCreateOptions}
        selectedType={selectedCreateType}
        onOpenChange={setCreateDialogOpen}
        onSelect={setSelectedCreateType}
        onCreate={() => {
          if (selectedCreateType) {
            handleAddCreate(selectedCreateType);
          }
        }}
      />

      <Dialog
        open={errorDialogState !== null}
        onOpenChange={(open) => {
          if (!open) {
            setErrorDialogState(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>
              {errorDialogState
                ? t('settings_fanout_integration_error_title', {
                    name: errorDialogState.integrationName,
                  })
                : t('settings_fanout_integration_error_default_title')}
            </DialogTitle>
            <DialogDescription>{t('settings_fanout_error_dialog_desc')}</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4 text-sm text-muted-foreground">
            <p className="whitespace-pre-wrap break-words font-mono text-foreground">
              {errorDialogState?.error}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {configGroups.length > 0 && (
        <div className="columns-1 gap-4 md:columns-2">
          {configGroups.map((group) => (
            <section
              key={group.type}
              className="mb-4 inline-block w-full break-inside-avoid space-y-2"
              aria-label={t('settings_fanout_group_integrations_aria', { label: group.label })}
            >
              <div className="px-1 text-sm font-medium text-muted-foreground">{group.label}</div>
              <div className="space-y-2">
                {group.configs.map((cfg) => {
                  const statusEntry = health?.fanout_statuses?.[cfg.id];
                  const status = cfg.enabled ? statusEntry?.status : undefined;
                  const lastError = cfg.enabled ? statusEntry?.last_error : null;
                  const communityConfig = cfg.config as Record<string, unknown>;
                  return (
                    <div
                      key={cfg.id}
                      role="group"
                      aria-label={t('settings_fanout_integration_group_aria', { name: cfg.name })}
                      className="border border-input rounded-md overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
                        <label
                          className="flex items-center cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={cfg.enabled}
                            onChange={() => handleToggleEnabled(cfg)}
                            className="w-4 h-4 rounded border-input accent-primary"
                            aria-label={t('settings_fanout_enable_item_aria', { name: cfg.name })}
                          />
                        </label>

                        <div className="flex-1 min-w-0">
                          {inlineEditingId === cfg.id ? (
                            <Input
                              value={inlineEditName}
                              autoFocus
                              onChange={(e) => setInlineEditName(e.target.value)}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={() => void handleInlineNameSave(cfg)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  handleCancelInlineEdit();
                                }
                              }}
                              aria-label={t('settings_fanout_edit_name_for_aria', {
                                name: cfg.name,
                              })}
                              className="h-8"
                            />
                          ) : (
                            <button
                              type="button"
                              className="block max-w-full cursor-text truncate text-left text-sm font-medium hover:text-foreground/80"
                              onClick={() => handleStartInlineEdit(cfg)}
                            >
                              {cfg.name}
                            </button>
                          )}
                        </div>

                        <div
                          className={cn(
                            'w-2 h-2 rounded-full transition-colors',
                            getStatusColor(status, cfg.enabled)
                          )}
                          title={
                            cfg.enabled
                              ? getStatusLabel(status, cfg.type, t)
                              : t('settings_fanout_status_disabled')
                          }
                          aria-hidden="true"
                        />
                        <span className="text-xs text-muted-foreground hidden sm:inline">
                          {cfg.enabled
                            ? getStatusLabel(status, cfg.type, t)
                            : t('settings_fanout_status_disabled')}
                        </span>

                        {lastError && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 px-0"
                            onClick={() =>
                              setErrorDialogState({
                                integrationName: cfg.name,
                                error: lastError,
                              })
                            }
                            aria-label={t('settings_fanout_view_error_details_aria', {
                              name: cfg.name,
                            })}
                            title={t('settings_fanout_view_latest_error_title')}
                          >
                            <Info className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleEdit(cfg)}
                        >
                          {t('settings_fanout_edit_button')}
                        </Button>
                      </div>

                      {cfg.type === 'mqtt_community' && (
                        <div className="space-y-1 border-t border-input px-3 py-2 text-xs text-muted-foreground">
                          <div>
                            {t('settings_fanout_broker_label')}{' '}
                            {formatBrokerSummary(communityConfig, {
                              host: DEFAULT_COMMUNITY_BROKER_HOST,
                              port: DEFAULT_COMMUNITY_BROKER_PORT,
                            })}
                          </div>
                          <div className="break-all">
                            {t('settings_fanout_topic_label')}{' '}
                            <code>
                              {(communityConfig.topic_template as string) ||
                                DEFAULT_COMMUNITY_PACKET_TOPIC_TEMPLATE}
                            </code>
                          </div>
                        </div>
                      )}

                      {cfg.type === 'mqtt_private' && (
                        <div className="space-y-1 border-t border-input px-3 py-2 text-xs text-muted-foreground">
                          <div>
                            {t('settings_fanout_broker_label')}{' '}
                            {formatBrokerSummary(cfg.config as Record<string, unknown>, {
                              host: '',
                              port: 1883,
                            })}
                          </div>
                          <div className="break-all">
                            {t('settings_fanout_topics_label')}{' '}
                            <code>
                              {formatPrivateTopicSummary(cfg.config as Record<string, unknown>)}
                            </code>
                          </div>
                        </div>
                      )}

                      {cfg.type === 'webhook' && (
                        <div className="space-y-1 border-t border-input px-3 py-2 text-xs text-muted-foreground">
                          <div className="break-all">
                            {t('settings_fanout_url_summary_label')}{' '}
                            <code>
                              {((cfg.config as Record<string, unknown>).url as string) ||
                                t('settings_fanout_not_set')}
                            </code>
                          </div>
                        </div>
                      )}

                      {cfg.type === 'apprise' && (
                        <div className="space-y-1 border-t border-input px-3 py-2 text-xs text-muted-foreground">
                          <div className="break-all">
                            {t('settings_fanout_targets_label')}{' '}
                            <code>
                              {formatAppriseTargets(
                                (cfg.config as Record<string, unknown>).urls as string | undefined,
                                t
                              )}
                            </code>
                          </div>
                        </div>
                      )}

                      {cfg.type === 'sqs' && (
                        <div className="space-y-1 border-t border-input px-3 py-2 text-xs text-muted-foreground">
                          <div className="break-all">
                            {t('settings_fanout_queue_label')}{' '}
                            <code>
                              {formatSqsQueueSummary(cfg.config as Record<string, unknown>, t)}
                            </code>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
