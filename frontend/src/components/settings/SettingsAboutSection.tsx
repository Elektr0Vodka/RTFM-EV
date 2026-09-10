import type { HealthStatus } from '../../types';
import { Separator } from '../ui/separator';
import { useT } from '../../i18n';

const GITHUB_URL = 'https://github.com/jkingsman/Remote-Terminal-for-MeshCore';

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
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <h3 className="text-lg font-semibold">RemoteTerm for MeshCore</h3>
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
            {t('settings_about_made_by')}{' '}
            {/* eslint-disable i18next/no-literal-string */}
            <a
              href="https://jacksbrain.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Jack Kingsman
            </a>
            {/* eslint-enable i18next/no-literal-string */}
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
