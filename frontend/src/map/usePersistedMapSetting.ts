import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/** Read a JSON value from localStorage, falling back when it is missing,
 *  unreadable (private mode, blocked storage) or rejected by `isValid`. */
export function readMapSetting<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** useState that survives a reload: per-browser map UI preference stored as
 *  JSON under `key`. Invalid or missing stored values yield `fallback`. */
export function usePersistedMapSetting<T>(
  key: string,
  fallback: T,
  isValid: (v: unknown) => v is T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readMapSetting(key, fallback, isValid));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);
  return [value, setValue];
}

export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

export const isNumberIn =
  (min: number, max: number) =>
  (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export const isOneOf =
  <T extends string | number>(options: readonly T[]) =>
  (v: unknown): v is T =>
    (options as readonly unknown[]).includes(v);
