import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '../components/ChatHeader';
import { MeshcomodContactNotice } from '../components/MeshcomodContactNotice';
import { MessageInput } from '../components/MessageInput';
import type { Contact } from '../types';
import {
  MESHCOMOD_QUICK_COMMANDS,
  isMeshcomodCommandContact,
  isRiskyMeshcomodCommand,
} from '../utils/meshcomodContact';
import { makeContactChatHeaderProps } from './helpers/chatHeaderProps';

const MESHCOMOD_KEY = '4d455348434d' + '0'.repeat(52);

describe('meshcomod command contact helpers', () => {
  it('recognises the contact by its MESHCM prefix in any case', () => {
    expect(isMeshcomodCommandContact(MESHCOMOD_KEY)).toBe(true);
    expect(isMeshcomodCommandContact(MESHCOMOD_KEY.toUpperCase())).toBe(true);
    expect(isMeshcomodCommandContact('4d455348434d')).toBe(true);
    expect(isMeshcomodCommandContact('bb'.repeat(32))).toBe(false);
    expect(isMeshcomodCommandContact(null)).toBe(false);
  });

  it('marks the commands that restart the radio or can cut the app off', () => {
    for (const risky of [
      'reboot',
      'Bootloader',
      'dfu',
      'ota update',
      'ota  start',
      'ota url https://example.invalid/fw.bin',
      'wifi off',
      'WIFI CLEAR',
      ' tcp off ',
      'ble off',
    ]) {
      expect(isRiskyMeshcomodCommand(risky), risky).toBe(true);
    }
    for (const safe of [
      ...MESHCOMOD_QUICK_COMMANDS,
      'tcp on',
      'ble status',
      'wifi scan',
      'rebooting',
      'ok',
    ]) {
      expect(isRiskyMeshcomodCommand(safe), safe).toBe(false);
    }
  });
});

describe('MeshcomodContactNotice', () => {
  it('explains the chat and hands a command to the message box', () => {
    const onPick = vi.fn();
    render(<MeshcomodContactNotice onPick={onPick} />);
    expect(screen.getByText(/never goes out over LoRa/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'wifi status' }));
    expect(onPick).toHaveBeenCalledWith('wifi status');
  });
});

describe('MessageInput confirmSend', () => {
  it('keeps the text and sends nothing when the confirmation is declined', async () => {
    const onSend = vi.fn(async () => {});
    const confirmSend = vi.fn(() => false);
    render(<MessageInput onSend={onSend} confirmSend={confirmSend} disabled={false} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'reboot' } });
    fireEvent.submit(box.closest('form')!);
    expect(confirmSend).toHaveBeenCalledWith('reboot');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('reboot');
  });

  it('sends when confirmed', async () => {
    const onSend = vi.fn(async () => {});
    render(<MessageInput onSend={onSend} confirmSend={() => true} disabled={false} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'status' } });
    fireEvent.submit(box.closest('form')!);
    expect(onSend).toHaveBeenCalledWith('status');
  });
});

describe('ChatHeader with the Meshcomod contact', () => {
  function meshcomodProps() {
    const props = makeContactChatHeaderProps({
      cliConsoleAvailable: true,
      onToggleCliConsole: vi.fn(),
    });
    const contact = {
      ...(props.contacts[0] as Contact),
      public_key: MESHCOMOD_KEY,
      name: 'Meshcomod',
    };
    return {
      ...props,
      conversation: { type: 'contact' as const, id: MESHCOMOD_KEY, name: 'Meshcomod' },
      contacts: [contact],
    };
  }

  it('hides path discovery and trace', () => {
    render(<ChatHeader {...makeContactChatHeaderProps({ onInsertLocation: vi.fn() })} />);
    expect(screen.getByRole('button', { name: 'Path Discovery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Direct Trace' })).toBeInTheDocument();
    cleanup();

    render(<ChatHeader {...meshcomodProps()} onInsertLocation={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Path Discovery' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Direct Trace' })).toBeNull();
  });
});
