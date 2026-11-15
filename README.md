#  Spin

Crie um cassino de slots como Telegram Mini App usando React + Supabase. O app tem duas áreas: o app do jogador (mobile, tema todo preto) e um painel admin na rota /admin. Idiomas: inglês e russo, com troca em Configurações; todos os textos em arquivos de tradução.



REGRAS CRÍTICAS DE SEGURANÇA (valem para todo o projeto):

- Ative RLS em TODAS as tabelas.

- O saldo e as apostas só podem ser alterados por Edge Functions ou funções SQL atômicas. O cliente nunca escreve em saldo, ledger ou apostas.

- Papéis (admin, financeiro, suporte) ficam em tabela separada user_roles, verificados por função security definer. Nunca guardar papel na tabela de perfil.

- Nenhum segredo no código; usar secrets do Supabase.



Agora crie apenas o banco de dados:

- profiles: user_id, telegram_id (único), email, nome completo, nacionalidade, número do documento (único), endereço, idioma, código de indicação próprio, indicado_por, status (pending, approved, rejected, blocked), motivo_rejeição, endereço_carteira_solana.

- kyc_files: referências aos arquivos de documento e selfie (bucket privado).

- ledger: registros IMUTÁVEIS (bloquear UPDATE e DELETE por trigger) com user_id, tipo (deposit, bet, win, bonus, withdrawal, adjustment), valor, motivo, tx_hash (único quando existir), admin_id, criado_em.

- Saldo = soma do ledger, exposto por view/função. Impedir saldo negativo.

- bets: user_id, jogo, valor, resultado, prêmio, saldo antes/depois, seeds e nonce, criado_em.

- withdrawals: user_id, valor, endereço destino, status (requested, approved, paid, rejected), tx_hash.

- missions, mission_installments, achievements, user_achievements, referrals, deposit_limits, self_exclusions, audit_log, game_settings (RTP por jogo), app_settings (termos da missão).

- user_roles + função has_role.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://sochiru.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ef00da51-2e67-41b9-a93f-6b19f23fff62).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
