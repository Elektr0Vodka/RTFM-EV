// A tiny wrapper around one reused HTMLAudioElement for the mention/DM cue.
// Volume is 0..100 (settings units), clamped to the element's 0..1 internally.
// play() is fire-and-forget: a rejected autoplay promise is swallowed so it
// never throws into the WebSocket handler. Repeat plays inside COALESCE_MS are
// ignored so a burst of mentions/DMs makes one sound, not many.

const COALESCE_MS = 300;

export interface MentionSoundPlayerDeps {
  makeAudio?: () => HTMLAudioElement;
  now?: () => number;
}

export interface MentionSoundPlayer {
  setSource(url: string): void;
  setVolume(volume0to100: number): void;
  play(): void;
  unlock(): void;
  dispose(): void;
}

export function createMentionSoundPlayer(deps: MentionSoundPlayerDeps = {}): MentionSoundPlayer {
  const now = deps.now ?? (() => Date.now());
  const audio = (deps.makeAudio ?? (() => new Audio()))();
  let lastPlay = -Infinity;
  let unlocked = false;

  return {
    setSource(url: string) {
      if (audio.src !== url) {
        audio.src = url;
      }
    },
    setVolume(v: number) {
      audio.volume = Math.max(0, Math.min(1, v / 100));
    },
    play() {
      const t = now();
      if (t - lastPlay < COALESCE_MS) return;
      lastPlay = t;
      try {
        audio.currentTime = 0;
        // audio.play() can throw synchronously (e.g. jsdom "not implemented")
        // or reject (autoplay blocked); swallow both so the caller never sees it.
        void Promise.resolve(audio.play()).catch(() => {});
      } catch {
        /* environment without media playback; ignore */
      }
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const prevVol = audio.volume;
      try {
        audio.muted = true;
        void Promise.resolve(audio.play())
          .then(() => {
            try {
              audio.pause();
              audio.currentTime = 0;
            } catch {
              /* ignore */
            }
          })
          .catch(() => {})
          .finally(() => {
            audio.muted = false;
            audio.volume = prevVol;
          });
      } catch {
        audio.muted = false;
        audio.volume = prevVol;
      }
    },
    dispose() {
      try {
        audio.pause();
      } catch {
        /* environment without media playback; ignore */
      }
      audio.src = '';
    },
  };
}
