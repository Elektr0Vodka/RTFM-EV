import { useEffect, useMemo, type ReactNode } from 'react';

import { useLocale, useT, type Locale } from '../i18n';
import enManual from '../content/manual/en.md?raw';
import nlManual from '../content/manual/nl.md?raw';
import deManual from '../content/manual/de.md?raw';
import { parseManual, type ManualBlock, type ManualInline } from '../utils/manualMarkdown';
import { MANUAL_SECTION_EVENT, takeManualSection } from '../utils/manualNavigation';

const MANUAL_SOURCES: Record<Locale, string> = { en: enManual, nl: nlManual, de: deManual };

/** DOM id for a manual section; prefixed so it cannot clash with other ids. */
export function manualSectionDomId(sectionId: string): string {
  return `manual-${sectionId}`;
}

function renderInline(content: ManualInline[]): ReactNode[] {
  return content.map((part, i) => {
    switch (part.kind) {
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-foreground">
            {part.text}
          </strong>
        );
      case 'em':
        return <em key={i}>{part.text}</em>;
      case 'code':
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {part.text}
          </code>
        );
      case 'link': {
        const external = /^https?:/i.test(part.href);
        return (
          <a
            key={i}
            href={part.href}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {part.text}
          </a>
        );
      }
      default:
        return part.text;
    }
  });
}

function renderBlock(block: ManualBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'h3':
      return (
        <h4 key={key} className="mt-5 mb-1.5 text-sm font-semibold text-foreground">
          {renderInline(block.content)}
        </h4>
      );
    case 'p':
      return (
        <p key={key} className="my-2">
          {renderInline(block.content)}
        </p>
      );
    case 'ul':
      return (
        <ul key={key} className="my-2 list-disc space-y-1 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="my-2 list-decimal space-y-1 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      );
  }
}

export function ManualView() {
  const t = useT();
  const { locale } = useLocale();
  const sections = useMemo(
    () => parseManual(MANUAL_SOURCES[locale] ?? MANUAL_SOURCES.en),
    [locale]
  );

  // Scroll inside the pane instead of using href="#id": the URL hash drives the
  // app's routing (#manual), so it must not change.
  const scrollToSection = (sectionId: string) => {
    const target = document.getElementById(manualSectionDomId(sectionId));
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Opened at a section someone asked for (the desktop buddy's page help):
  // on arrival, and again when asked while the guide is already open.
  useEffect(() => {
    const openRequested = () => {
      const sectionId = takeManualSection();
      const target = sectionId ? document.getElementById(manualSectionDomId(sectionId)) : null;
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start' });
      }
    };
    openRequested();
    window.addEventListener(MANUAL_SECTION_EVENT, openRequested);
    return () => window.removeEventListener(MANUAL_SECTION_EVENT, openRequested);
  }, []);

  const toc = (
    <ol className="space-y-0.5 text-sm">
      {sections.map((section) => (
        <li key={section.id}>
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => scrollToSection(section.id)}
          >
            {section.title}
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="font-semibold text-base text-foreground">{t('nav_user_guide')}</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl gap-8 px-4 py-4">
          <nav aria-label={t('manual_contents_heading')} className="hidden w-56 shrink-0 lg:block">
            <div className="sticky top-4">
              <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('manual_contents_heading')}
              </h3>
              {toc}
            </div>
          </nav>

          <article className="min-w-0 max-w-3xl flex-1 text-sm leading-relaxed text-foreground/90">
            <details className="mb-4 rounded-md border border-border bg-card p-2 lg:hidden">
              <summary className="cursor-pointer px-2 py-1 text-sm font-semibold text-foreground">
                {t('manual_contents_heading')}
              </summary>
              <div className="mt-1">{toc}</div>
            </details>

            {sections.map((section) => (
              <section
                key={section.id}
                id={manualSectionDomId(section.id)}
                aria-labelledby={`${manualSectionDomId(section.id)}-title`}
                className="scroll-mt-4 border-b border-border pb-4 mb-4 last:border-b-0"
              >
                <h3
                  id={`${manualSectionDomId(section.id)}-title`}
                  className="mb-2 text-lg font-semibold tracking-tight text-foreground"
                >
                  {section.title}
                </h3>
                {section.blocks.map((block, i) => renderBlock(block, i))}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}
