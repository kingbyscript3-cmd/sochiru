import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Diamond, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { accountQuery } from '@/lib/account-query';
import { prepareSpin, revealSpinSession, spin } from '@/lib/slot.functions';
import { SLOT_BET_VALUES, SLOT_SPIN_COUNTS, clientSeedSchema } from '@/lib/slot-engine';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Session = { sessionId: string; serverSeedHash: string; clientSeed: string; nonce: number };
const symbols = ['◆', '♜', '☾', '✦', '♣', '7', '●'];
const emptyReels = Array.from({ length: 5 }, () => Array.from({ length: 3 }, () => 0));

export function SlotGame({ gameId, gameName }: { gameId: string; gameName: string }) {
  const { t, lang } = useI18n();
  const { data: account } = useSuspenseQuery(accountQuery);
  const queryClient = useQueryClient();
  const prepare = useServerFn(prepareSpin);
  const play = useServerFn(spin);
  const reveal = useServerFn(revealSpinSession);
  const [session, setSession] = useState<Session | null>(null);
  const [clientSeed, setClientSeed] = useState('obsidian-player');
  const [balance, setBalance] = useState(account.balance);
  const [bet, setBet] = useState(1);
  const [spins, setSpins] = useState<1 | 10 | 100>(1);
  const [reels, setReels] = useState<number[][]>(emptyReels);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(0);
  const [revealedSeed, setRevealedSeed] = useState('');
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError('');
    void prepare({ data: { game: gameId, clientSeed: 'obsidian-player' } }).then((result) => {
      if (active) setSession(result);
    }).catch(() => {
      if (active) setError(t.spinSessionError);
    });
    return () => { active = false; };
  }, [gameId, prepare]);

  async function startSession() {
    setError('');
    setRevealedSeed('');
    if (!clientSeedSchema.safeParse(clientSeed).success) {
      setError(t.invalidClientSeed);
      return;
    }
    setBusy(true);
    try {
      const result = await prepare({ data: { game: gameId, clientSeed } });
      setSession(result);
      requestId.current = null;
    } catch {
      setError(t.spinSessionError);
    } finally {
      setBusy(false);
    }
  }

  async function revealSession() {
    if (!session) return;
    setBusy(true);
    try {
      const result = await reveal({ data: { sessionId: session.sessionId } });
      setRevealedSeed(result.serverSeed);
      setSession(null);
      requestId.current = null;
    } catch {
      setError(t.spinSessionError);
    } finally {
      setBusy(false);
    }
  }

  async function submitSpin() {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    setCompleted(0);
    requestId.current ??= crypto.randomUUID();
    let animation: number | undefined;
    try {
      const response = await play({ data: { sessionId: session.sessionId, requestId: requestId.current, game: gameId, bet, spins } });
      animation = window.setInterval(() => {
        setReels((current) => current.map((reel) => reel.map(() => Math.floor(Math.random() * symbols.length))));
      }, 90);
      await new Promise((resolve) => setTimeout(resolve, 900));
      window.clearInterval(animation);
      const finalRound = response.rounds[response.rounds.length - 1];
      if (finalRound) setReels(finalRound.reels);
      setBalance(response.balance);
      setCompleted(response.rounds.length);
      setSession((current) => current ? { ...current, nonce: current.nonce + spins } : current);
      requestId.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      ]);
    } catch (cause) {
      if (animation) window.clearInterval(animation);
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('INSUFFICIENT_BALANCE') || message.includes('Insufficient balance') ? t.insufficientBalance : message.includes('INVALID_BET') ? t.invalidBet : t.spinError);
    } finally {
      setBusy(false);
    }
  }

  const money = (value: number) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

  return <main className="min-h-dvh bg-background px-4 pb-8 text-foreground sm:mx-auto sm:max-w-2xl">
    <header className="flex items-center justify-between border-b border-border py-4"><div><p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Obsidian</p><h1 className="mt-1 text-lg font-semibold">{gameName}</h1></div><div className="text-right"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">{t.balance}</p><p className="font-semibold tabular-nums">{money(balance)} USDC</p></div><Button variant="ghost" size="icon" asChild><Link to="/dashboard" aria-label={t.closeGame}><X /></Link></Button></header>

    <section className="mt-5 border border-border bg-card p-3" aria-label={gameName}>
      <div className="grid grid-cols-5 gap-1.5" aria-live="polite">{reels.map((reel, reelIndex) => <div key={reelIndex} className="space-y-1.5">{reel.map((symbol, rowIndex) => <div key={rowIndex} className={`flex aspect-square items-center justify-center border text-2xl sm:text-4xl ${rowIndex === 1 ? 'border-success/50 bg-success/5 text-success' : 'border-border bg-background text-muted-foreground'} ${busy ? 'animate-pulse' : ''}`}>{symbols[symbol]}</div>)}</div>)}</div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{completed ? `${t.completedSpins}: ${completed}` : t.serverDecides}</span><Diamond className="size-4 text-success" /></div>
    </section>

    {error && <p role="alert" className="mt-4 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

    <section className="mt-5"><Label>{t.betAmount}</Label><div className="mt-2 grid grid-cols-4 gap-2">{SLOT_BET_VALUES.map((value) => <Button key={value} type="button" variant={bet === value ? 'default' : 'outline'} className={bet === value ? 'bg-success text-success-foreground hover:bg-success/90' : ''} disabled={busy} onClick={() => { setBet(value); requestId.current = null; }}>{value}</Button>)}</div></section>
    <section className="mt-5"><Label>{t.spinCount}</Label><div className="mt-2 grid grid-cols-3 gap-2">{SLOT_SPIN_COUNTS.map((value) => <Button key={value} type="button" variant={spins === value ? 'default' : 'outline'} className={spins === value ? 'bg-success text-success-foreground hover:bg-success/90' : ''} disabled={busy} onClick={() => { setSpins(value); requestId.current = null; }}>{value}</Button>)}</div></section>
    <Button className="mt-5 h-14 w-full bg-success text-lg text-success-foreground hover:bg-success/90" disabled={!session || busy} onClick={() => void submitSpin()}>{busy ? <LoaderCircle className="animate-spin" /> : <Diamond />}{busy ? t.spinning : `${t.play} · ${money(bet * spins)} USDC`}</Button>

    <details className="mt-6 border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium"><ShieldCheck className="mr-2 inline size-4 text-success" />{t.provablyFair}</summary><div className="mt-4 space-y-3 text-xs"><div><Label>{t.serverSeedHash}</Label><code className="mt-1 block break-all text-muted-foreground">{session?.serverSeedHash ?? '—'}</code></div><div><Label>{t.clientSeed}</Label><Input className="mt-1 font-mono" value={clientSeed} readOnly={Boolean(session)} maxLength={64} onChange={(event) => setClientSeed(event.target.value)} /></div><p>{t.nonce}: {session?.nonce ?? 0}</p>{session ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void revealSession()}>{t.revealSeed}</Button> : <Button variant="outline" size="sm" disabled={busy} onClick={() => void startSession()}>{t.newFairSession}</Button>}{revealedSeed && <div><Label>{t.revealedServerSeed}</Label><code className="mt-1 block break-all text-success">{revealedSeed}</code></div>}</div></details>
  </main>;
}
