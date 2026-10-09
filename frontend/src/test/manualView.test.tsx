import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualView, manualSectionDomId } from '../components/ManualView';
import { I18nProvider, STORAGE_KEY } from '../i18n';
import { requestManualSection } from '../utils/manualNavigation';

function renderManual() {
  return render(
    <I18nProvider>
      <ManualView />
    </I18nProvider>
  );
}

describe('ManualView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the title and a table of contents in English', () => {
    renderManual();
    expect(screen.getByRole('heading', { level: 2, name: 'User Guide' })).toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: 'Contents' });
    const entries = within(toc).getAllByRole('button');
    expect(entries.map((b) => b.textContent)).toContain('Getting started');
    expect(entries.length).toBeGreaterThan(5);
    expect(document.getElementById(manualSectionDomId('overview'))).not.toBeNull();
  });

  it('scrolls to a section without changing the URL hash', () => {
    window.location.hash = '#manual';
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderManual();
    const toc = screen.getByRole('navigation', { name: 'Contents' });
    fireEvent.click(within(toc).getByRole('button', { name: 'Map' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#manual');
  });

  it('opens at a section that was asked for, also while it is already open', () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    requestManualSection('map');
    renderManual();
    expect(scrolled).toEqual([manualSectionDomId('map')]);

    act(() => requestManualSection('tools'));
    expect(scrolled).toEqual([manualSectionDomId('map'), manualSectionDomId('tools')]);
  });

  it('follows the interface language', () => {
    localStorage.setItem(STORAGE_KEY, 'nl');
    renderManual();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Gebruikershandleiding' })
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Inhoud' })).toBeInTheDocument();
    expect(screen.getAllByText('Aan de slag').length).toBeGreaterThan(0);
  });
});
