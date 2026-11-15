import { z } from 'zod';

export const SLOT_BET_VALUES = [0.20, 0.50, 1, 2, 5, 10, 15, 20, 25, 50, 100] as const;
export const SLOT_SPIN_COUNTS = [1, 10, 100] as const;
export const SLOT_SYMBOLS = 7;
const WIN_CHANCE = 0.25;

export const clientSeedSchema = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
export const prepareSpinSchema = z.object({
  game: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/),
  clientSeed: clientSeedSchema,
});
export const spinSchema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  game: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/),
  bet: z.number().finite().refine((value) => SLOT_BET_VALUES.includes(value as typeof SLOT_BET_VALUES[number]), 'INVALID_BET'),
  spins: z.union([z.literal(1), z.literal(10), z.literal(100)]),
});

export type SlotRound = { reels: number[][]; payout: number };

export function randomServerSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function uint32(bytes: Uint8Array, index: number) {
  const offset = index * 4;
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function uniform(bytes: Uint8Array, index: number) {
  return uint32(bytes, index) / 4_294_967_296;
}

async function fairBytes(key: CryptoKey, clientSeed: string, nonce: number, draw: number) {
  const message = new TextEncoder().encode(`${clientSeed}:${nonce}:${draw}`);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
}

export async function generateSlotRounds(options: {
  serverSeed: string;
  clientSeed: string;
  startNonce: number;
  bet: number;
  spins: 1 | 10 | 100;
  rtp: number;
}): Promise<SlotRound[]> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(options.serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const winMultiplier = options.rtp / 100 / WIN_CHANCE;
  const rounds: SlotRound[] = [];

  for (let spin = 0; spin < options.spins; spin += 1) {
    const nonce = options.startNonce + spin;
    const first = await fairBytes(key, options.clientSeed, nonce, 0);
    const second = await fairBytes(key, options.clientSeed, nonce, 1);
    const won = uniform(first, 0) < WIN_CHANCE;
    const reels = Array.from({ length: 5 }, () => Array.from({ length: 3 }, () => 0));
    for (let index = 0; index < 15; index += 1) {
      const bytes = index < 8 ? first : second;
      const randomIndex = index < 8 ? index + 1 : index - 8;
      const reel = Math.floor(index / 3);
      const row = index % 3;
      reels[reel]![row] = Math.floor(uniform(bytes, randomIndex) * SLOT_SYMBOLS);
    }
    const winSymbol = Math.floor(uniform(first, 1) * SLOT_SYMBOLS);
    if (won) {
      for (let reel = 0; reel < 5; reel += 1) reels[reel]![1] = winSymbol;
    } else if (reels.every((reel) => reel[1] === reels[0]![1])) {
      reels[4]![1] = ((reels[4]![1] ?? 0) + 1) % SLOT_SYMBOLS;
    }
    const payout = won ? Math.round(options.bet * winMultiplier * 100) / 100 : 0;
    rounds.push({ reels, payout });
  }
  return rounds;
}
