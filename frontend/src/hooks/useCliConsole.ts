import { useCallback, useRef, useState } from 'react';

export interface CliConsoleEntry {
  command: string;
  response: string;
  timestamp: number;
  outgoing: boolean;
}

/** History and send state for one command-line console (kept in memory only). */
export function useCliConsole(send: (command: string) => Promise<string>) {
  const [history, setHistory] = useState<CliConsoleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const sendCommand = useCallback(async (command: string) => {
    const now = Math.floor(Date.now() / 1000);
    setHistory((prev) => [...prev, { command, response: '', timestamp: now, outgoing: true }]);
    setLoading(true);
    try {
      const reply = await sendRef.current(command);
      setHistory((prev) => [
        ...prev,
        { command, response: reply, timestamp: now, outgoing: false },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setHistory((prev) => [
        ...prev,
        { command, response: `Error: ${message}`, timestamp: now, outgoing: false },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { history, loading, sendCommand };
}
