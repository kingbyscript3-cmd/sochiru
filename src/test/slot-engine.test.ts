import { describe, expect, it } from 'vitest';
import { generateSlotRounds, randomServerSeed, sha256Hex, spinSchema } from '@/lib/slot-engine';

describe('slot engine rules', () => {
  it('accepts only the requested bets and 1, 10 or 100 spins', () => {
    const base = { sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), game: 'lost-temple' };
    expect(spinSchema.safeParse({ ...base, bet: 0.2, spins: 1 }).success).toBe(true);
    expect(spinSchema.safeParse({ ...base, bet: 100, spins: 100 }).success).toBe(true);
    expect(spinSchema.safeParse({ ...base, bet: 0.3, spins: 1 }).success).toBe(false);
    expect(spinSchema.safeParse({ ...base, bet: 1, spins: 5 }).success).toBe(false);
  });

  it('generates a cryptographically random 32-byte seed and publishes its SHA-256 hash', async () => {
    const first = randomServerSeed();
    const second = randomServerSeed();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(await sha256Hex('obsidian')).toBe('4e2295dd929e424aa1afde7049924cb231f451c9884d7915ae33690b73b227ec');
  });

  it('is deterministic for the same seeds and nonce and returns every requested round', async () => {
    const options = { serverSeed: 'a'.repeat(64), clientSeed: 'player_seed', startNonce: 7, bet: 1, spins: 10 as const, rtp: 96 };
    const first = await generateSlotRounds(options);
    const second = await generateSlotRounds(options);
    expect(first).toEqual(second);
    expect(first).toHaveLength(10);
    expect(first.every((round) => round.reels.length === 5 && round.reels.every((reel) => reel.length === 3))).toBe(true);
    expect(first.every((round) => round.payout === 0 || round.payout === 3.84)).toBe(true);
  });
});
