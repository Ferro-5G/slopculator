// The phone's sound pool (src/ui/voices.ts, which the phone app wraps around its audio player): every press
// makes a sound, including the press right after one finishes. The fake player acts like iOS: play() on a clip
// sitting at its end does nothing, and seekTo resolves later. The old player (seekTo(0) then play() back to back)
// went quiet under it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVoicePool, type Player } from '../src/ui/voices';
import { cueMs, VARIANTS, type SoundCue } from '../src/ui/sounds';

interface Fake extends Player { file: string; atEnd: boolean; seeking: boolean; plays: number }
let players: Fake[] = [];

function fake(file: string): Fake {
  const f: Fake = {
    file, atEnd: false, seeking: false, plays: 0, volume: 1,
    play() {
      if (f.atEnd || f.seeking) return; // AVPlayer at the end of its item pauses again at once
      f.plays++;
      setTimeout(() => (f.atEnd = true), 5); // the clip runs out
    },
    pause() {},
    seekTo() {
      f.seeking = true;
      return new Promise<void>((r) => setTimeout(() => { f.seeking = false; f.atEnd = false; r(); }, 3));
    },
  };
  players.push(f);
  return f;
}

let pool: ReturnType<typeof createVoicePool<SoundCue>>;
const plays = () => players.reduce((n, p) => n + p.plays, 0);

beforeEach(() => {
  vi.useFakeTimers();
  players = [];
  pool = createVoicePool<SoundCue>(VARIANTS, (cue, v) => fake(`${cue}-${v}`), cueMs);
});

describe('mobile sound pool', () => {
  it('plays a single-variant cue on every press, spaced like real taps', async () => {
    for (let i = 0; i < 8; i++) {
      pool.play('copy');
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(plays()).toBe(8);
  });

  it('keeps up with fast typing faster than a clip is long', async () => {
    for (let i = 0; i < 30; i++) {
      pool.play('tick');
      await vi.advanceTimersByTimeAsync(40);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(plays()).toBe(30);
  });

  it('does not repeat the same variant twice in a row', async () => {
    const seq: string[] = [];
    for (let i = 0; i < 20; i++) {
      const counts = players.map((p) => p.plays);
      pool.play('fn');
      await vi.advanceTimersByTimeAsync(300);
      seq.push(players[players.findIndex((p, j) => p.plays !== counts[j])].file);
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('sets the volume on every player', () => {
    pool.setVolume(0.2);
    expect(players.every((p) => p.volume === 0.2)).toBe(true);
  });
});
