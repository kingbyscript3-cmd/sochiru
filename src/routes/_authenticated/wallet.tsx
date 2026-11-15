import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { accountQuery } from '@/lib/account-query';
import { walletQuery } from '@/lib/wallet-query';
import { WALLET_PANELS, type WalletPanel } from '@/lib/wallet-rules';
import { PlayerShell } from '@/components/player/player-shell';
import { WalletDashboard } from '@/components/player/wallet-dashboard';
import { pageHead } from '@/lib/metadata';

export const Route = createFileRoute('/_authenticated/wallet')({
  head: () => pageHead('Wallet & profile', 'Your Obsidian Slots balance, USDC deposits, withdrawals, history and achievements.'),
  validateSearch: (search: Record<string, unknown>): { tab?: WalletPanel } => WALLET_PANELS.includes(search['tab'] as WalletPanel) ? { tab: search['tab'] as WalletPanel } : {},
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(accountQuery),
      context.queryClient.ensureQueryData(walletQuery),
    ]);
  },
  component: Wallet,
});

function Wallet() {
  const { data } = useSuspenseQuery(accountQuery);
  const { tab } = Route.useSearch();
  if (data.profile.status !== 'approved') return <Navigate to="/dashboard" />;
  return <PlayerShell><WalletDashboard panel={tab ?? 'history'} /></PlayerShell>;
}
