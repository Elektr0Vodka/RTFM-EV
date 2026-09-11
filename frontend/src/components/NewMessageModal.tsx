import { useEffect, useRef, useState } from 'react';
import { Dice5 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { toast } from './ui/sonner';
import { useT, useLocale, type TFn } from '../i18n';
import { formatNumber } from '../utils/localeFormat';

type Tab = 'new-contact' | 'new-channel' | 'hashtag' | 'bulk-hashtag';

interface BulkParseResult {
  channelNames: string[];
  invalidNames: string[];
}

interface NewMessageModalProps {
  open: boolean;
  undecryptedCount: number;
  showBulkAddChannelTab?: boolean;
  prefillRequest?:
    | {
        tab: 'hashtag';
        hashtagName: string;
        nonce: number;
      }
    | {
        tab: 'new-contact';
        publicKey: string;
        name: string;
        nonce: number;
      }
    | null;
  onClose: () => void;
  onCreateContact: (
    name: string,
    publicKey: string,
    tryHistorical: boolean,
    type?: number
  ) => Promise<void>;
  onCreateChannel: (name: string, key: string, tryHistorical: boolean) => Promise<void>;
  onCreateHashtagChannel: (name: string, tryHistorical: boolean) => Promise<void>;
  onBulkAddHashtagChannels: (channelNames: string[], tryHistorical: boolean) => Promise<void>;
}

function validateHashtagName(channelName: string, permitExtended: boolean, t: TFn): string | null {
  if (!channelName) {
    return t('chat_channel_name_required');
  }
  // The on-radio channel name field holds 32 UTF-8 bytes including the leading '#'.
  if (new TextEncoder().encode(`#${channelName}`).length > 32) {
    return t('chat_channel_name_too_long');
  }
  if (permitExtended) {
    // Hashed verbatim, matching meshcore_py / meshcore-cli / meshcore.js — any character
    // (capitals, whitespace, '&', accents, …) yields a valid SHA256-derived key.
    return null;
  }
  if (!/^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/.test(channelName)) {
    return t('chat_channel_name_invalid_chars');
  }
  return null;
}

function parseBulkHashtagNames(rawText: string, permitExtended: boolean, t: TFn): BulkParseResult {
  // When extended names are permitted, whitespace can be part of a name, so split on
  // newlines/commas only. Otherwise keep the whitespace-delimited behavior.
  const tokens = rawText
    .split(permitExtended ? /[\n,]+/ : /[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const invalidNames: string[] = [];
  const channelNames: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const stripped = token.replace(/^#+/, '');
    const validationError = validateHashtagName(stripped, permitExtended, t);
    if (validationError) {
      invalidNames.push(token);
      continue;
    }

    const normalized = permitExtended ? stripped : stripped.toLowerCase();
    const channelName = `#${normalized}`;
    if (seen.has(channelName)) {
      continue;
    }
    seen.add(channelName);
    channelNames.push(channelName);
  }

  return { channelNames, invalidNames };
}

export function NewMessageModal({
  open,
  undecryptedCount,
  showBulkAddChannelTab = false,
  prefillRequest = null,
  onClose,
  onCreateContact,
  onCreateChannel,
  onCreateHashtagChannel,
  onBulkAddHashtagChannels,
}: NewMessageModalProps) {
  const t = useT();
  const { locale } = useLocale();
  const [tab, setTab] = useState<Tab>('new-contact');
  const [name, setName] = useState('');
  const [contactType, setContactType] = useState(1);
  const [contactKey, setContactKey] = useState('');
  const [channelKey, setChannelKey] = useState('');
  const [bulkChannelText, setBulkChannelText] = useState('');
  const [tryHistorical, setTryHistorical] = useState(false);
  const [permitExtended, setPermitExtended] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const hashtagInputRef = useRef<HTMLInputElement>(null);
  const bulkTextareaRef = useRef<HTMLTextAreaElement>(null);

  const resetForm = () => {
    setName('');
    setContactType(1);
    setContactKey('');
    setChannelKey('');
    setBulkChannelText('');
    setTryHistorical(false);
    setPermitExtended(false);
    setError('');
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    if (prefillRequest) {
      setTab(prefillRequest.tab);
      setChannelKey('');
      setBulkChannelText('');
      setTryHistorical(false);
      setPermitExtended(false);
      setError('');
      setLoading(false);
      if (prefillRequest.tab === 'hashtag') {
        setName(prefillRequest.hashtagName);
        setContactKey('');
        requestAnimationFrame(() => {
          hashtagInputRef.current?.focus();
        });
      } else {
        // new-contact prefill (e.g. "add contact from analyzer")
        setName(prefillRequest.name);
        setContactKey(prefillRequest.publicKey);
        setContactType(1);
      }
      return;
    }

    if (showBulkAddChannelTab) {
      setTab('bulk-hashtag');
      setName('');
      setContactKey('');
      setChannelKey('');
      setBulkChannelText('');
      setTryHistorical(false);
      setPermitExtended(false);
      setError('');
      setLoading(false);
      requestAnimationFrame(() => {
        bulkTextareaRef.current?.focus();
      });
      return;
    }

    setTab('new-contact');
  }, [open, prefillRequest, showBulkAddChannelTab]);

  const handleCreate = async () => {
    setError('');
    setLoading(true);

    try {
      if (tab === 'new-contact') {
        if (!name.trim() || !contactKey.trim()) {
          setError(t('chat_name_and_key_required'));
          return;
        }
        await onCreateContact(name.trim(), contactKey.trim(), tryHistorical, contactType);
      } else if (tab === 'new-channel') {
        if (!name.trim() || !channelKey.trim()) {
          setError(t('chat_channel_name_and_key_required'));
          return;
        }
        await onCreateChannel(name.trim(), channelKey.trim(), tryHistorical);
      } else if (tab === 'hashtag') {
        const channelName = name.trim();
        const validationError = validateHashtagName(channelName, permitExtended, t);
        if (validationError) {
          setError(validationError);
          return;
        }
        const normalizedName = permitExtended ? channelName : channelName.toLowerCase();
        await onCreateHashtagChannel(`#${normalizedName}`, tryHistorical);
      } else {
        const { channelNames, invalidNames } = parseBulkHashtagNames(
          bulkChannelText,
          permitExtended,
          t
        );
        if (channelNames.length === 0) {
          setError(t('chat_enter_valid_channel_name'));
          return;
        }
        if (invalidNames.length > 0) {
          setError(t('chat_invalid_channel_names', { names: invalidNames.join(', ') }));
          return;
        }
        await onBulkAddHashtagChannels(channelNames, tryHistorical);
      }

      resetForm();
      onClose();
    } catch (err) {
      toast.error(t('toast_failed_create_conversation'), {
        description: err instanceof Error ? err.message : undefined,
      });
      setError(err instanceof Error ? err.message : t('error_failed_to_create'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndAddAnother = async () => {
    setError('');
    const channelName = name.trim();
    const validationError = validateHashtagName(channelName, permitExtended, t);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const normalizedName = permitExtended ? channelName : channelName.toLowerCase();
      await onCreateHashtagChannel(`#${normalizedName}`, tryHistorical);
      setName('');
      hashtagInputRef.current?.focus();
    } catch (err) {
      toast.error(t('toast_failed_create_conversation'), {
        description: err instanceof Error ? err.message : undefined,
      });
      setError(err instanceof Error ? err.message : t('error_failed_to_create'));
    } finally {
      setLoading(false);
    }
  };

  const showHistoricalOption = undecryptedCount > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('chat_new_conversation')}</DialogTitle>
          <DialogDescription className="sr-only">
            {tab === 'new-contact' && t('chat_new_contact_description')}
            {tab === 'new-channel' && t('chat_new_channel_description')}
            {tab === 'hashtag' && t('chat_new_hashtag_description')}
            {tab === 'bulk-hashtag' && t('chat_bulk_hashtag_description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab);
            resetForm();
          }}
          className="w-full"
        >
          <TabsList
            className={
              showBulkAddChannelTab ? 'grid w-full grid-cols-4' : 'grid w-full grid-cols-3'
            }
          >
            <TabsTrigger value="new-contact">{t('common_contact')}</TabsTrigger>
            <TabsTrigger value="new-channel">{t('chat_private_channel')}</TabsTrigger>
            <TabsTrigger value="hashtag">{t('chat_hashtag_channel')}</TabsTrigger>
            {showBulkAddChannelTab && (
              <TabsTrigger value="bulk-hashtag">{t('chat_bulk_add_channel')}</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="new-contact" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contact-name">{t('common_name')}</Label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('chat_placeholder_contact_name')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-key">{t('common_public_key')}</Label>
              <Input
                id="contact-key"
                value={contactKey}
                onChange={(e) => setContactKey(e.target.value)}
                placeholder={t('chat_placeholder_public_key_hex')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-type">{t('common_type')}</Label>
              <select
                id="contact-type"
                value={contactType}
                onChange={(e) => setContactType(Number(e.target.value))}
                className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
              >
                <option value={1}>{t('common_client')}</option>
                <option value={2}>{t('common_repeater')}</option>
                <option value={3}>{t('common_room_server')}</option>
              </select>
            </div>
          </TabsContent>

          <TabsContent value="new-channel" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channel-name">{t('chat_channel_name_label')}</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('chat_placeholder_channel_name')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channel-key">{t('chat_channel_key_label')}</Label>
              <div className="flex gap-2">
                <Input
                  id="channel-key"
                  value={channelKey}
                  onChange={(e) => setChannelKey(e.target.value)}
                  placeholder={t('chat_placeholder_preshared_key')}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const bytes = new Uint8Array(16);
                    crypto.getRandomValues(bytes);
                    const hex = Array.from(bytes)
                      .map((byte) => byte.toString(16).padStart(2, '0'))
                      .join('');
                    setChannelKey(hex);
                  }}
                  title={t('chat_generate_random_key')}
                  aria-label={t('chat_generate_random_key')}
                >
                  <Dice5 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="hashtag" className="mt-4">
            <div className="space-y-2">
              <Label htmlFor="hashtag-name">{t('chat_hashtag_channel')}</Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">#</span>
                <Input
                  ref={hashtagInputRef}
                  id="hashtag-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('chat_placeholder_hashtag_name')}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={permitExtended}
                  onChange={(e) => setPermitExtended(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-sm">{t('chat_permit_extended_chars')}</span>
              </label>
              <p className="pl-7 text-xs text-muted-foreground">
                {t('chat_permit_extended_help_single')}
              </p>
            </div>
          </TabsContent>

          {showBulkAddChannelTab && (
            <TabsContent value="bulk-hashtag" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bulk-hashtag-names">{t('chat_bulk_add_channel')}</Label>
                <textarea
                  ref={bulkTextareaRef}
                  id="bulk-hashtag-names"
                  aria-label={t('a11y_bulk_channel_names')}
                  value={bulkChannelText}
                  onChange={(e) => setBulkChannelText(e.target.value)}
                  placeholder={'#ops\nmesh-chat\nanother-channel'}
                  className="min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  {permitExtended ? t('chat_bulk_help_extended') : t('chat_bulk_help_normal')}
                </p>
              </div>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={permitExtended}
                    onChange={(e) => setPermitExtended(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="text-sm">{t('chat_permit_extended_chars')}</span>
                </label>
                <p className="pl-7 text-xs text-muted-foreground">
                  {t('chat_permit_extended_help_bulk')}
                </p>
              </div>
            </TabsContent>
          )}
        </Tabs>

        {showHistoricalOption && (
          <div className="space-y-1">
            <div className="flex items-center justify-end space-x-2">
              <Label
                htmlFor="try-historical"
                className="cursor-pointer text-sm text-muted-foreground"
              >
                {t('chat_try_decrypt', {
                  count: undecryptedCount,
                  n: formatNumber(locale, undecryptedCount),
                })}
              </Label>
              <Checkbox
                id="try-historical"
                checked={tryHistorical}
                onCheckedChange={(checked) => setTryHistorical(checked === true)}
              />
            </div>
            {tryHistorical && (
              <p className="text-right text-xs text-muted-foreground">
                {t('chat_messages_stream_in_background')}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive" role="alert">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              resetForm();
              onClose();
            }}
          >
            {t('common_cancel')}
          </Button>
          {tab === 'hashtag' && (
            <Button variant="secondary" onClick={handleCreateAndAddAnother} disabled={loading}>
              {loading ? t('common_creating') : t('chat_create_and_add_another')}
            </Button>
          )}
          <Button onClick={handleCreate} disabled={loading}>
            {loading
              ? tab === 'bulk-hashtag'
                ? t('common_adding')
                : t('common_creating')
              : tab === 'bulk-hashtag'
                ? t('chat_add_channels')
                : t('common_create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
