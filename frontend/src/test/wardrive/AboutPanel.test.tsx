import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n';
import { AboutPanel } from '../../wardrive/screen/AboutPanel';

describe('wardrive about panel', () => {
  it('says the page transmits only with Auto-discover on and links to the projects it feeds', () => {
    render(
      <I18nProvider>
        <AboutPanel />
      </I18nProvider>
    );
    expect(screen.getByText(/transmits only while you switch Auto-discover on/)).toBeTruthy();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://mesh-hunter.eu');
    expect(hrefs).toContain('https://meshcore-analyzer.eu');
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
});
