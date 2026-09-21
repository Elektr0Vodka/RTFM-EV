import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DateTimeField } from '../components/DateTimeField';
import { resolveDateTimeFormat, setActiveDateTimeFormat } from '../utils/dateTimeFormat';

afterEach(() => {
  setActiveDateTimeFormat(resolveDateTimeFormat('auto', 'en'));
});

describe('DateTimeField', () => {
  it('displays a date value in the active format (dd/mm/yyyy under 24h_dmy)', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('24h_dmy', 'en'));
    render(<DateTimeField mode="date" value="2026-09-21" onChange={() => {}} aria-label="added" />);
    expect((screen.getByLabelText('added') as HTMLInputElement).value).toBe('21/09/2026');
  });

  it('displays the same value as mm/dd/yyyy under 12h_mdy', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('12h_mdy', 'en'));
    render(<DateTimeField mode="date" value="2026-09-21" onChange={() => {}} aria-label="added" />);
    expect((screen.getByLabelText('added') as HTMLInputElement).value).toBe('09/21/2026');
  });

  it('parses typed input (in the active format) and emits the native value on blur', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('24h_dmy', 'en'));
    const onChange = vi.fn();
    render(<DateTimeField mode="date" value="" onChange={onChange} aria-label="added" />);
    const input = screen.getByLabelText('added');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '21/09/2026' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('2026-09-21');
  });

  it('shows a placeholder in the active format and a calendar button', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('24h_dmy', 'en'));
    render(<DateTimeField mode="datetime" value="" onChange={() => {}} aria-label="from" />);
    expect((screen.getByLabelText('from') as HTMLInputElement).placeholder).toBe(
      'dd/mm/yyyy HH:mm'
    );
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeInTheDocument();
  });

  it('does not emit when the typed value is unparseable', () => {
    setActiveDateTimeFormat(resolveDateTimeFormat('24h_dmy', 'en'));
    const onChange = vi.fn();
    render(<DateTimeField mode="date" value="2026-09-21" onChange={onChange} aria-label="added" />);
    const input = screen.getByLabelText('added');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'garbage' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
