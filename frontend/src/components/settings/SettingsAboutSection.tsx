import type { HealthStatus } from '../../types';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { useT } from '../../i18n';

const GITHUB_URL = 'https://github.com/Elektr0Vodka/RTFM-EV';

export function SettingsAboutSection({
  health,
  className,
}: {
  health?: HealthStatus | null;
  className?: string;
}) {
  const t = useT();
  const version = health?.app_info?.version ?? 'unknown';
  const commit = health?.app_info?.commit_hash;

  return (
    <div className={className}>
      <div className="space-y-6">
        {/* Version */}
        <div className="text-center space-y-1">
          <h3 className="text-lg font-semibold">RTFM-EV</h3>
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <div className="text-sm text-muted-foreground">
            v{version}
            {commit ? (
              <>
                <span className="mx-1.5">·</span>
                <span className="font-mono text-xs" title={commit}>
                  {commit}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <Separator />

        {/* Author & License */}
        <div className="text-sm text-center space-y-2">
          <p>
            {t('settings_about_maintained_by')} {/* eslint-disable i18next/no-literal-string */}
            <a
              href="https://github.com/Elektr0Vodka"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Elektr0Vodka
            </a>
            {'. '}
            {/* eslint-enable i18next/no-literal-string */}
            {t('settings_about_originally_by')} {/* eslint-disable i18next/no-literal-string */}
            <a
              href="https://jacksbrain.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Jack Kingsman
            </a>{' '}
            {/* eslint-enable i18next/no-literal-string */}
            {t('settings_about_on_hiatus')}
          </p>
          <p>
            {t('settings_about_licensed_under')}{' '}
            <a
              href={`${GITHUB_URL}/blob/main/LICENSE.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {t('settings_about_mit_license')}
            </a>
          </p>
          <p>
            {t('settings_about_free_forever')}{' '}
            <a
              href="https://ko-fi.com/jackkingsman"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {t('settings_about_buy_coffee')}
            </a>
          </p>
        </div>

        <Separator />

        {/* Links */}
        <div className="flex justify-center gap-4 text-sm">
          {/* eslint-disable i18next/no-literal-string */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            GitHub
          </a>
          {/* eslint-enable i18next/no-literal-string */}
          <a
            href={`${GITHUB_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('settings_about_report_bug')}
          </a>
          <a
            href={`${GITHUB_URL}/blob/main/CHANGELOG.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('settings_about_changelog')}
          </a>
        </div>

        <Separator />

        {/* Discord */}
        <div className="text-sm text-center space-y-3">
          <p className="text-muted-foreground">
            {t('settings_about_discord_intro')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string */}
            <span className="font-mono">#rtfm-ev</span> {t('settings_about_discord_outro')}
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="https://discord.dutchmeshcore.nl" target="_blank" rel="noopener noreferrer">
              {t('settings_about_join_discord')}
            </a>
          </Button>
        </div>

        <Separator />

        {/* Acknowledgements */}
        <div className="text-sm text-center text-muted-foreground space-y-2">
          <p>{t('settings_about_acknowledgements')}</p>
          <p>
            {/* eslint-disable i18next/no-literal-string */}
            <a
              href="https://github.com/meshcore-dev/MeshCore"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              MeshCore
            </a>
            <span className="mx-1.5">·</span>
            <a
              href="https://github.com/meshcore-dev/meshcore_py"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              meshcore_py
            </a>
            {/* eslint-enable i18next/no-literal-string */}
          </p>
        </div>

        <Separator />

        <div className="text-center">
          <a
            href="./api/debug"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            {t('settings_about_debug_snapshot')}
          </a>
        </div>
      </div>
    </div>
  );
}
