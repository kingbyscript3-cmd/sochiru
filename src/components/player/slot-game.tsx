import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Coins, Crown, Diamond, Gem, Landmark, LoaderCircle, Mountain, Repeat2, ShieldCheck, Square, Sun, Trophy } from 'lucide-react';
import { accountQuery } from '@/lib/account-query';
import { prepareSpin, revealSpinSession, spin } from '@/lib/slot.functions';
import { SLOT_BET_VALUES, SLOT_SPIN_COUNTS, clientSeedSchema, countWinningRounds } from '@/lib/slot-engine';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Session = { sessionId: string; serverSeedHash: string; clientSeed: string; nonce: number; rtp: number };
const symbolIcons = [Gem, Landmark, Coins, Crown, Mountain, Sun, Diamond];
const initialReels = Array.from({ length: 5 }, (_, reel) => Array.from({ length: 3 }, (_, row) => (reel + row * 2) % symbolIcons.length));

export function SlotGame({ gameId, gameName }: { gameId: string; gameName: string }) {
  const { t, lang } = useI18n();
  const { data: account } = useSuspenseQuery(accountQuery);
  const queryClient = useQueryClient();
  const prepare = useServerFn(prepareSpin);
  const play = useServerFn(spin);
  const reveal = useServerFn(revealSpinSession);
  const reduceMotion = useReducedMotion();
  const [session, setSession] = useState<Session | null>(null);
  const [clientSeed, setClientSeed] = useState('obsidian-player');
  const [balance, setBalance] = useState(account.balance);
  const [bet, setBet] = useState(1);
  const [spins, setSpins] = useState<1 | 10 | 100>(1);
  const [reels, setReels] = useState<number[][]>(initialReels);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(0);
  const [winning, setWinning] = useState(0);
  const [revealedSeed, setRevealedSeed] = useState('');
  const requestId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const autoRef = useRef(false);
  const balanceRef = useRef(account.balance);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError('');
    void prepare({ data: { game: gameId, clientSeed: 'obsidian-player' } }).then((result) => {
      if (active) setSession(result);
    }).catch(() => {
      if (active) setError(t.spinSessionError);
    });
    return () => { active = false; autoRef.current = false; };
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

  async function executeSpin(): Promise<boolean> {
    if (!session || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setCompleted(0);
    setWinning(0);
    requestId.current ??= crypto.randomUUID();
    let animation: number | undefined;
    try {
      const response = await play({ data: { sessionId: session.sessionId, requestId: requestId.current, game: gameId, bet, spins } });
      if (!reduceMotion) {
        animation = window.setInterval(() => {
          setReels((current) => current.map((reel) => reel.map(() => Math.floor(Math.random() * symbolIcons.length))));
        }, 80);
        await new Promise((resolve) => setTimeout(resolve, 850));
      }
      if (animation) window.clearInterval(animation);
      const finalRound = response.rounds[response.rounds.length - 1];
      if (finalRound) setReels(finalRound.reels);
      const wins = countWinningRounds(response.rounds);
      if (wins > 0) {
        setWinning(wins);
        window.setTimeout(() => setWinning(0), 1600);
      }
      setBalance(response.balance);
      balanceRef.current = response.balance;
      setCompleted(response.rounds.length);
      setSession((current) => current ? { ...current, nonce: current.nonce + spins } : current);
      requestId.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account'] }),
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      ]);
      return true;
    } catch (cause) {
      if (animation) window.clearInterval(animation);
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('INSUFFICIENT_BALANCE') || message.includes('Insufficient balance') ? t.insufficientBalance : message.includes('RATE_LIMITED') ? t.tooManySpins : message.includes('INVALID_BET') ? t.invalidBet : t.spinError);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function toggleAuto() {
    if (autoRef.current) {
      autoRef.current = false;
      setAuto(false);
      return;
    }
    if (!session || busyRef.current) return;
    autoRef.current = true;
    setAuto(true);
    while (autoRef.current) {
      if (balanceRef.current < bet * spins) {
        setError(t.insufficientBalance);
        break;
      }
      const succeeded = await executeSpin();
      if (!succeeded) break;
      if (!reduceMotion) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    autoRef.current = false;
    setAuto(false);
  }

  const money = (value: number) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const multiplier = (session?.rtp ?? 96) / 25;

  return <main className="min-h-dvh bg-background pb-60 text-foreground">
    <header className="flex items-center justify-between border-b border-border px-4 py-4"><Button variant="ghost" size="icon" asChild><Link to="/dashboard" aria-label={t.backHome}><ArrowLeft /></Link></Button><div className="text-center"><p className="text-[10px] uppercase tracking-[0.2em] text-success">Lost Temple</p><h1 className="mt-1 text-sm font-semibold">{gameName}</h1></div><span className="flex size-10 items-center justify-center"><Landmark className="size-5 text-success" /></span></header>

    <section className="relative mx-auto mt-5 max-w-3xl px-3" aria-label={gameName}>
      <div className="grid grid-cols-5 gap-1.5 rounded-sm border border-success/20 bg-card p-2 shadow-[0_0_60px_hsl(var(--success)/0.08)] sm:gap-2 sm:p-4" aria-live="polite">
        {reels.map((reel, reelIndex) => <motion.div key={reelIndex} className="space-y-1.5 sm:space-y-2" animate={busy && !reduceMotion ? { y: [0, -9, 0] } : { y: 0 }} transition={busy && !reduceMotion ? { duration: 0.18, repeat: Infinity, delay: reelIndex * 0.035 } : { duration: 0.2 }}>{reel.map((symbol, rowIndex) => {
          const Icon = symbolIcons[symbol] ?? Gem;
          return <div key={rowIndex} className={`flex aspect-square items-center justify-center border transition-colors ${rowIndex === 1 ? 'border-success/45 bg-success/5 text-success' : 'border-border bg-background text-muted-foreground'}`}><Icon className="size-7 sm:size-10" strokeWidth={1.5} /></div>;
        })}</motion.div>)}
      </div>
      <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground"><span>{completed ? `${t.completedSpins}: ${completed}` : t.serverDecides}</span><span>{t.centralLine}</span></div>
      <AnimatePresence>{winning > 0 && <motion.div role="status" className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }}><motion.div animate={reduceMotion ? {} : { rotate: [-8, 8, -8], scale: [1, 1.2, 1] }} transition={{ duration: 0.5 }}><Trophy className="size-16 text-success" /></motion.div><p className="mt-3 text-4xl font-bold tracking-tight text-success">{t.bigWin}</p><p className="mt-2 text-sm">{winning} {t.winningSpins}</p></motion.div>}</AnimatePresence>
    </section>

    {error && <p role="alert" className="mx-4 mt-4 border border-destructive/30 bg-destructive/5 p-3 text-center text-sm text-destructive">{error}</p>}

    <section className="mx-4 mt-5 border border-border bg-card p-4"><details><summary className="cursor-pointer text-sm font-semibold"><Coins className="mr-2 inline size-4 text-success" />{t.paytable}</summary><div className="mt-4"><div className="flex items-center justify-center gap-2">{symbolIcons.slice(0, 5).map((Icon, index) => <span key={index} className="flex size-10 items-center justify-center border border-success/30 bg-success/5 text-success"><Icon className="size-5" /></span>)}</div><div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm"><span>{t.fiveCentralSymbols}</span><strong className="text-success">{money(multiplier)}×</strong></div><p className="mt-3 text-xs leading-5 text-muted-foreground">{t.paytableNote}</p></div></details></section>

    <details className="mx-4 mt-4 border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium"><ShieldCheck className="mr-2 inline size-4 text-success" />{t.provablyFair}</summary><div className="mt-4 space-y-3 text-xs"><div><Label>{t.serverSeedHash}</Label><code className="mt-1 block break-all text-muted-foreground">{session?.serverSeedHash ?? '—'}</code></div><div><Label>{t.clientSeed}</Label><Input className="mt-1 font-mono" value={clientSeed} readOnly={Boolean(session)} maxLength={64} onChange={(event) => setClientSeed(event.target.value)} /></div><p>{t.nonce}: {session?.nonce ?? 0}</p>{session ? <Button variant="outline" size="sm" disabled={busy || auto} onClick={() => void revealSession()}>{t.revealSeed}</Button> : <Button variant="outline" size="sm" disabled={busy} onClick={() => void startSession()}>{t.newFairSession}</Button>}{revealedSeed && <div><Label>{t.revealedServerSeed}</Label><code className="mt-1 block break-all text-success">{revealedSeed}</code></div>}</div></details>

    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_hsl(var(--background)/0.9)] backdrop-blur"><div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-3"><div><p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{t.balance}</p><p className="text-xl font-semibold tabular-nums" aria-live="polite">{money(balance)} <span className="text-xs text-muted-foreground">USDC</span></p></div><div><Label htmlFor="slot-bet" className="text-[9px] uppercase tracking-widest">{t.betAmount}</Label><select id="slot-bet" className="mt-1 h-9 min-w-24 rounded-md border border-input bg-background px-2 text-sm" value={bet} disabled={busy || auto} onChange={(event) => { setBet(Number(event.target.value)); requestId.current = null; }}>{SLOT_BET_VALUES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div><div><p className="text-[9px] uppercase tracking-widest text-muted-foreground">{t.spinCount}</p><div className="mt-1 flex gap-1">{SLOT_SPIN_COUNTS.map((value) => <button key={value} type="button" disabled={busy || auto} onClick={() => { setSpins(value); requestId.current = null; }} className={`h-9 min-w-9 border px-2 text-xs ${spins === value ? 'border-success bg-success/10 text-success' : 'border-border text-muted-foreground'}`}>{value}</button>)}</div></div></div>
      <div className="mt-3 grid grid-cols-[auto_1fr] gap-2"><Button variant="outline" className={`h-12 px-4 ${auto ? 'border-success text-success' : ''}`} disabled={!session || (busy && !auto)} onClick={() => void toggleAuto()} aria-pressed={auto}>{auto ? <Square /> : <Repeat2 />}<span className="hidden sm:inline">{auto ? t.stopAuto : t.autoPlay}</span><span className="sm:hidden">{auto ? t.stop : t.auto}</span></Button><Button className="h-12 bg-success text-base text-success-foreground hover:bg-success/90" disabled={!session || busy || auto} onClick={() => void executeSpin()}>{busy && !auto ? <LoaderCircle className="animate-spin" /> : <Diamond />}{busy && !auto ? t.spinning : `${t.spin} · ${money(bet * spins)}`}</Button></div>
    </div></div>
  </main>;
}
