CREATE OR REPLACE FUNCTION public.play_slot_spins(
  _session_id uuid,
  _request_id uuid,
  _bet numeric,
  _spins integer,
  _results jsonb,
  _response jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  session record;
  existing_response jsonb;
  player_status public.profile_status;
  settings record;
  balance_before numeric;
  balance_after numeric;
  total_payout numeric;
  total_debit numeric;
BEGIN
  SELECT * INTO session FROM public.slot_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SPIN_SESSION_NOT_FOUND'; END IF;

  SELECT response INTO existing_response FROM public.spin_requests
  WHERE request_id = _request_id AND session_id = _session_id AND user_id = session.user_id;
  IF existing_response IS NOT NULL THEN RETURN existing_response; END IF;
  IF EXISTS (SELECT 1 FROM public.spin_requests WHERE request_id = _request_id) THEN
    RAISE EXCEPTION 'REQUEST_ID_IN_USE';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(session.user_id::text, 0));
  SELECT status INTO player_status FROM public.profiles WHERE user_id = session.user_id FOR UPDATE;
  IF player_status <> 'approved' THEN RAISE EXCEPTION 'PLAYER_NOT_APPROVED'; END IF;
  IF public.is_self_excluded(session.user_id) THEN RAISE EXCEPTION 'SELF_EXCLUDED'; END IF;
  IF session.status <> 'active' THEN RAISE EXCEPTION 'SPIN_SESSION_REVEALED'; END IF;

  SELECT * INTO settings FROM public.game_settings WHERE game = session.game;
  IF NOT FOUND OR NOT settings.enabled THEN RAISE EXCEPTION 'GAME_DISABLED'; END IF;
  IF _bet IS NULL OR round(_bet, 2) <> _bet OR _bet NOT IN (0.20,0.50,1,2,5,10,15,20,25,50,100)
     OR _bet < settings.min_bet OR _bet > settings.max_bet THEN
    RAISE EXCEPTION 'INVALID_BET';
  END IF;
  IF _spins NOT IN (1,10,100) OR jsonb_typeof(_results) <> 'array' OR jsonb_array_length(_results) <> _spins THEN
    RAISE EXCEPTION 'INVALID_SPIN_COUNT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_results) item
    WHERE jsonb_typeof(item->'reels') <> 'array'
       OR (item->>'payout')::numeric < 0
       OR (item->>'payout')::numeric > 1000000000
  ) THEN RAISE EXCEPTION 'INVALID_SPIN_RESULTS'; END IF;

  total_debit := _bet * _spins;
  SELECT COALESCE(sum((item->>'payout')::numeric), 0) INTO total_payout FROM jsonb_array_elements(_results) item;
  SELECT COALESCE(sum(amount), 0) INTO balance_before FROM public.ledger WHERE user_id = session.user_id;
  IF balance_before < total_debit THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  balance_after := balance_before - total_debit + total_payout;
  _response := jsonb_set(_response, '{balance}', to_jsonb(balance_after), true);

  WITH parsed AS (
    SELECT item.value AS result, item.ordinality, (item.value->>'payout')::numeric AS payout
    FROM jsonb_array_elements(_results) WITH ORDINALITY AS item(value, ordinality)
  ), running AS (
    SELECT parsed.*,
      COALESCE(sum(payout) OVER (ORDER BY ordinality ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 0) - payout AS prior_payout
    FROM parsed
  )
  INSERT INTO public.bets (
    user_id, game, amount, result, payout, balance_before, balance_after,
    server_seed_hash, client_seed, nonce
  )
  SELECT session.user_id, session.game, _bet, result, payout,
    balance_before + prior_payout - (_bet * (ordinality - 1)),
    balance_before + prior_payout + payout - (_bet * ordinality),
    session.server_seed_hash, session.client_seed, session.nonce + ordinality - 1
  FROM running;

  INSERT INTO public.ledger (user_id, type, amount, reason, reference_id)
  VALUES (session.user_id, 'bet', -total_debit, 'Slot spin batch', session.id);
  IF total_payout > 0 THEN
    INSERT INTO public.ledger (user_id, type, amount, reason, reference_id)
    VALUES (session.user_id, 'win', total_payout, 'Slot spin prize', session.id);
  END IF;

  UPDATE public.slot_sessions SET nonce = nonce + _spins WHERE id = session.id;
  INSERT INTO public.spin_requests (request_id, user_id, session_id, response)
  VALUES (_request_id, session.user_id, session.id, _response);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, details)
  VALUES (session.user_id, 'slot_spins_completed', 'slot_sessions', session.id::text,
    jsonb_build_object('request_id', _request_id, 'game', session.game, 'bet', _bet,
      'spins', _spins, 'debit', total_debit, 'payout', total_payout, 'balance_after', balance_after));
  RETURN _response;
END;
$function$;

REVOKE ALL ON FUNCTION public.play_slot_spins(uuid,uuid,numeric,integer,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.play_slot_spins(uuid,uuid,numeric,integer,jsonb,jsonb) TO service_role;