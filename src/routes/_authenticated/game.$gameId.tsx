import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { checkGameAccess } from '@/lib/player.functions';
import { slots } from '@/lib/slots';
import { pageHead } from '@/lib/metadata';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
export const Route = createFileRoute('/_authenticated/game/$gameId')({ head: ({ params }) => pageHead(slots.find(s => s.id === params.gameId)?.name ?? 'Game', 'Obsidian Slots full-screen game.'), loader: async ({ params }) => { if (!slots.some(s => s.id === params.gameId)) throw notFound(); await checkGameAccess(); }, component: Game });
function Game() { const { gameId } = Route.useParams(); const game = slots.find(s => s.id === gameId); const { t } = useI18n(); if (!game) return null; return <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center"><Button variant="ghost" size="icon" className="absolute right-5 top-5" asChild><Link to="/dashboard" aria-label={t.closeGame}><X/></Link></Button><h1 className="mb-6 text-3xl font-semibold">{game.name}</h1><img src={game.art} alt={game.name} width={768} height={1024} className="game-cover"/><p className="mt-6 text-muted-foreground">{t.gameUnavailable}</p><Button variant="outline" asChild className="mt-5"><Link to="/dashboard">{t.closeGame}</Link></Button></main>; }