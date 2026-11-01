// The menu's About tab: what the page does and the projects it feeds.
import { useT } from '../../i18n';

const LINKS: [string, string][] = [
  ['wardrive_page_about_meshhunter', 'https://mesh-hunter.eu'],
  ['wardrive_page_about_analyzer', 'https://meshcore-analyzer.eu'],
];

export function AboutPanel() {
  const t = useT();
  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-base font-semibold">{t('wardrive_page_title')}</h2>
      <p>{t('wardrive_page_intro')}</p>
      <p className="text-muted-foreground">{t('wardrive_page_about_listens')}</p>
      <ul className="space-y-1">
        {LINKS.map(([key, href]) => (
          <li key={href}>
            <a
              className="text-primary underline"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(key)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
