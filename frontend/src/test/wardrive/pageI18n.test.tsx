import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useT } from '../../i18n';
import { WardrivePageI18n } from '../../wardrive/pageI18n';

function Title() {
  const t = useT();
  return <h1>{t('wardrive_page_title')}</h1>;
}

function Intro() {
  const t = useT();
  return <p>{t('wardrive_page_offline')}</p>;
}

afterEach(() => {
  localStorage.clear();
});

describe('wardrive page language', () => {
  it('loads the saved language and translates with it', async () => {
    localStorage.setItem('locale', 'nl');
    render(
      <WardrivePageI18n>
        <Intro />
      </WardrivePageI18n>
    );
    expect(await screen.findByText(/Offline: RTFM-EV is niet bereikbaar/)).toBeTruthy();
    expect(document.documentElement.lang).toBe('nl');
  });

  it('uses English when nothing is saved', async () => {
    render(
      <WardrivePageI18n>
        <Title />
      </WardrivePageI18n>
    );
    expect(await screen.findByText('Wardrive')).toBeTruthy();
  });

  it('shows English while another language is still loading', () => {
    localStorage.setItem('locale', 'de');
    render(
      <WardrivePageI18n>
        <Intro />
      </WardrivePageI18n>
    );
    expect(screen.getByText(/Working offline/)).toBeTruthy();
  });
});
