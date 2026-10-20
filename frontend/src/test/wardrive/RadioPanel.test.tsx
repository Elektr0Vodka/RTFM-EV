import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { RadioPanel } from '../../wardrive/components/RadioPanel';

function renderPanel(over: Partial<ComponentProps<typeof RadioPanel>> = {}) {
  return render(
    <I18nProvider>
      <RadioPanel
        info={{ publicKey: 'AB'.repeat(32), name: 'Car' }}
        lost={false}
        bleSupported
        serialSupported={false}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        {...over}
      />
    </I18nProvider>
  );
}

describe('radio panel battery', () => {
  it('shows volts and percent for a single cell', () => {
    renderPanel({ batteryMv: 3690 });
    expect(screen.getByTestId('wardrive-battery').textContent).toContain('3.69 V, 58 %');
  });

  it('shows only volts for a multi-cell pack', () => {
    renderPanel({ batteryMv: 7400 });
    const line = screen.getByTestId('wardrive-battery').textContent ?? '';
    expect(line).toContain('7.40 V');
    expect(line).not.toContain('%');
  });

  it('says when the battery is low', () => {
    renderPanel({ batteryMv: 3400 });
    expect(screen.getByTestId('wardrive-battery').textContent).toMatch(/low/i);
  });

  it('shows no battery line before the radio answered', () => {
    renderPanel({ batteryMv: null });
    expect(screen.queryByTestId('wardrive-battery')).toBeNull();
  });
});
