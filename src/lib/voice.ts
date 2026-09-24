import { RavenNative } from './native';

/**
 * Speaks guidance one phrase at a time. On Android the phrase plays on the navigation
 * audio stream and briefly ducks whatever music is playing.
 */
export function createVoice(language: string) {
  const queue: string[] = [];
  let speaking = false;
  let enabled = true;

  const pump = async () => {
    if (speaking) return;
    const text = queue.shift();
    if (!text) return;
    speaking = true;
    try {
      await RavenNative.speak({ text, language });
    } catch {
      // no speech engine: guidance stays on screen
    } finally {
      speaking = false;
      void pump();
    }
  };

  return {
    say(text: string) {
      if (!enabled || !text) return;
      // Guidance goes stale quickly: never let more than two phrases wait.
      while (queue.length >= 2) queue.shift();
      queue.push(text);
      void pump();
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) {
        queue.length = 0;
        void RavenNative.stopSpeaking().catch(() => undefined);
      }
    }
  };
}
