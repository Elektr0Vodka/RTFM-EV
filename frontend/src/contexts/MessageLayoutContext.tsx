import { createContext, useContext } from 'react';

/**
 * How MessageList lays out a row: the regular bubbles, classic chat lines
 * (`[12:01] <Nick> text`), or cards (sender and time on top, the text, then a
 * row of chips). Only the chat popup provides `lines`, and only the app shell
 * under an Atlas-layout theme provides `cards`; everything else gets the
 * default.
 */
export type MessageLayout = 'bubbles' | 'lines' | 'cards';

const MessageLayoutContext = createContext<MessageLayout>('bubbles');

export const MessageLayoutProvider = MessageLayoutContext.Provider;

export function useMessageLayout(): MessageLayout {
  return useContext(MessageLayoutContext);
}
