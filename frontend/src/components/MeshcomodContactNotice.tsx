import { useT } from '../i18n';
import { MESHCOMOD_QUICK_COMMANDS } from '../utils/meshcomodContact';
import { Button } from './ui/button';

/**
 * Above the chat with meshcomod's command contact: what is sent here runs on
 * the radio, plus buttons that put a command in the message box. A button
 * never sends; the user still presses Send.
 */
export function MeshcomodContactNotice({ onPick }: { onPick: (command: string) => void }) {
  const t = useT();
  return (
    <div
      data-meshcomod-contact-notice=""
      className="mx-4 mt-3 space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
    >
      <p>{t('meshcomod_contact_notice')}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('meshcomod_contact_quick')}</span>
        {MESHCOMOD_QUICK_COMMANDS.map((command) => (
          <Button
            key={command}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 font-mono text-xs"
            title={t('meshcomod_contact_quick_title')}
            onClick={() => onPick(command)}
          >
            {command}
          </Button>
        ))}
      </div>
    </div>
  );
}
