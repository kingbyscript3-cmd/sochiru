import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { withdrawalSchema } from './wallet-rules';

function throwDb(error: { message: string } | null): never {
  throw new Error(error?.message || 'DATABASE_ERROR');
}

export const getWallet = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const [profile, balance, ledger, withdrawals, achievements, excluded] = await Promise.all([
    context.supabase.from('profiles').select('full_name,email,referral_code,solana_wallet_address').eq('user_id', context.userId).maybeSingle(),
    context.supabase.rpc('get_balance', { _user_id: context.userId }),
    context.supabase.from('ledger').select('id,type,amount,reason,tx_hash,created_at').eq('user_id', context.userId).order('created_at', { ascending: false }).limit(100),
    context.supabase.from('withdrawals').select('id,amount,destination_address,status,tx_hash,rejection_reason,created_at,updated_at').eq('user_id', context.userId).order('created_at', { ascending: false }).limit(100),
    context.supabase.from('user_achievements').select('id,unlocked_at,achievement:achievements(title_en,title_ru,description_en,description_ru,reward_amount)').eq('user_id', context.userId).order('unlocked_at', { ascending: false }),
    context.supabase.rpc('is_self_excluded', { _user_id: context.userId }),
  ]);
  if (profile.error) throwDb(profile.error);
  if (!profile.data) throw new Error('PROFILE_NOT_FOUND');
  if (balance.error) throwDb(balance.error);
  if (ledger.error) throwDb(ledger.error);
  if (withdrawals.error) throwDb(withdrawals.error);
  if (achievements.error) throwDb(achievements.error);
  if (excluded.error) throwDb(excluded.error);

  return {
    profile: profile.data,
    balance: Number(balance.data ?? 0),
    ledger: ledger.data ?? [],
    withdrawals: withdrawals.data ?? [],
    achievements: (achievements.data ?? []).map((item) => {
      const achievement = Array.isArray(item.achievement) ? item.achievement[0] : item.achievement;
      return {
        id: item.id,
        unlockedAt: item.unlocked_at,
        titleEn: achievement?.title_en ?? '',
        titleRu: achievement?.title_ru ?? '',
        descriptionEn: achievement?.description_en ?? '',
        descriptionRu: achievement?.description_ru ?? '',
        rewardAmount: Number(achievement?.reward_amount ?? 0),
      };
    }),
    excluded: Boolean(excluded.data),
  };
});

export const requestWithdrawal = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input) => withdrawalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc('request_withdrawal', {
      _amount: data.amount,
      _destination_address: data.destinationAddress,
    });
    if (error) throwDb(error);
    return { ok: true, id };
  });
