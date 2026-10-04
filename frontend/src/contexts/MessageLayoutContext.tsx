import { createContext, useContext } from 'react';

/**
 * How MessageList lays out a row: the regular bubbles, or classic chat lines
 * (`[12:01] <Nick> text`). Only the chat popup provides `lines`; everything
 * else gets the default.
 */
export type MessageLayout = 'bubbles' | 'lines';

const MessageLayoutContext = createContext<MessageLayout>('bubbles');

export const MessageLayoutProvider = MessageLayoutContext.Provider;

export function useMessageLayout(): MessageLayout {
  return useContext(MessageLayoutContext);
}
