// The coverage map's one-time walkthrough (map.mesh-hunter.eu shows one on a
// first visit): what the map shows, the controls, and the position caveat.
import { useT } from '../../i18n';

export function IntroCard({ onClose }: { onClose(): void }) {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-label={t('wardrive_cov_intro_title')}
      className="pointer-events-auto absolute inset-x-2 top-12 z-40 mx-auto max-w-md space-y-2 rounded-md border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl"
    >
      <h2 className="text-base font-semibold">{t('wardrive_cov_intro_title')}</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>{t('wardrive_cov_intro_1')}</li>
        <li>{t('wardrive_cov_intro_2')}</li>
        <li>{t('wardrive_cov_intro_3')}</li>
        <li>{t('wardrive_cov_intro_4')}</li>
      </ul>
      <p className="text-xs text-muted-foreground">{t('wardrive_cov_intro_disclaimer')}</p>
      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground"
          onClick={onClose}
        >
          {t('wardrive_cov_intro_ok')}
        </button>
      </div>
    </div>
  );
}
