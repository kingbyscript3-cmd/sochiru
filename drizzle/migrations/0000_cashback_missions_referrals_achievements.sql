ALTER TABLE public.missions
  ADD COLUMN deposit_amount numeric,
  ADD COLUMN source_ledger_id bigint REFERENCES public.ledger(id),
  ADD COLUMN rollover numeric NOT NULL DEFAULT 1,
  ADD COLUMN expires_at timestamptz;

CREATE UNIQUE INDEX missions_one_cashback_per_user ON public.missions (user_id);
CREATE UNIQUE INDEX missions_source_ledger_unique ON public.missions (source_ledger_id) WHERE source_ledger_id IS NOT NULL;
CREATE INDEX mission_installments_release_queue ON public.mission_installments (status, due_at) WHERE status = 'pending';
CREATE UNIQUE INDEX profiles_document_number_normalized_unique ON public.profiles (upper(btrim(document_number))) WHERE document_number IS NOT NULL AND btrim(document_number) <> '';

CREATE OR REPLACE FUNCTION public.create_cashback_mission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  mission_id uuid;
  terms jsonb;
  term_version integer := 1;
  expiry_days integer := 30;
  rollover_value numeric := 1;
BEGIN
  IF NEW.type <> 'deposit' OR NEW.amount <= 0 OR NEW.amount > 200 THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.missions WHERE user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  SELECT value INTO terms FROM public.app_settings WHERE key = 'mission_terms';
  IF terms IS NOT NULL THEN
    term_version := GREATEST(1, COALESCE((terms->>'version')::integer, 1));
    expiry_days := LEAST(365, GREATEST(1, COALESCE((terms->>'expiresDays')::integer, 30)));
    rollover_value := LEAST(1000, GREATEST(0, COALESCE((terms->>'rollover')::numeric, 1)));
  END IF;

  INSERT INTO public.missions (
    user_id, total_amount, installments_count, terms_version,
    deposit_amount, source_ledger_id, rollover, expires_at
  ) VALUES (
    NEW.user_id, 100, 5, term_version,
    NEW.amount, NEW.id, rollover_value, now() + make_interval(days => expiry_days)
  ) RETURNING id INTO mission_id;

  INSERT INTO public.mission_installments (mission_id, user_id, sequence, amount, due_at)
  SELECT mission_id, NEW.user_id, sequence, 20,
    date_trunc('day', now()) + (sequence * interval '1 day')
  FROM generate_series(1, 5) AS sequence;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, details)
  VALUES (NULL, 'cashback_mission_created', 'missions', mission_id::text,
    jsonb_build_object('user_id', NEW.user_id, 'deposit_amount', NEW.amount, 'terms_version', term_version));
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_create_cashback_mission
AFTER INSERT ON public.ledger
FOR EACH ROW EXECUTE FUNCTION public.create_cashback_mission();

CREATE OR REPLACE FUNCTION public.release_cashback_installments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  item record;
  entry_id bigint;
  released_count integer := 0;
BEGIN
  UPDATE public.mission_installments i
  SET status = 'cancelled'
  FROM public.missions m
  WHERE i.mission_id = m.id AND i.status = 'pending'
    AND m.status = 'active' AND m.expires_at IS NOT NULL AND m.expires_at <= now();
  UPDATE public.missions m
  SET status = 'expired'
  WHERE m.status = 'active' AND m.expires_at IS NOT NULL AND m.expires_at <= now();

  FOR item IN
    SELECT i.id, i.mission_id, i.user_id, i.amount
    FROM public.mission_installments i
    JOIN public.missions m ON m.id = i.mission_id
    WHERE i.status = 'pending' AND m.status = 'active'
      AND i.due_at <= now() AND (m.expires_at IS NULL OR m.expires_at > now())
    ORDER BY i.due_at, i.sequence
    FOR UPDATE OF i, m SKIP LOCKED
  LOOP
    INSERT INTO public.ledger (user_id, type, amount, reason, reference_id)
    VALUES (item.user_id, 'bonus', item.amount, 'Daily cashback installment', item.mission_id)
    RETURNING id INTO entry_id;
    UPDATE public.mission_installments
    SET status = 'paid', paid_at = now(), ledger_id = entry_id
    WHERE id = item.id;
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, details)
    VALUES (NULL, 'cashback_installment_released', 'mission_installments', item.id::text,
      jsonb_build_object('user_id', item.user_id, 'mission_id', item.mission_id, 'ledger_id', entry_id, 'amount', item.amount));
    released_count := released_count + 1;
  END LOOP;

  UPDATE public.missions m
  SET status = 'completed'
  WHERE m.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.mission_installments i
    WHERE i.mission_id = m.id AND i.status = 'pending'
  );
  RETURN released_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_cashback_installments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_cashback_installments() TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_achievements(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  achievement record;
  metric numeric;
  qualifies boolean;
  unlocked_count integer := 0;
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;
  FOR achievement IN SELECT id, criteria FROM public.achievements WHERE active LOOP
    IF EXISTS (SELECT 1 FROM public.user_achievements WHERE user_id = _user_id AND achievement_id = achievement.id) THEN
      CONTINUE;
    END IF;
    qualifies := false;
    CASE achievement.criteria->>'type'
      WHEN 'first_deposit' THEN
        SELECT EXISTS (SELECT 1 FROM public.ledger WHERE user_id = _user_id AND type = 'deposit' AND amount > 0) INTO qualifies;
      WHEN 'first_bet' THEN
        SELECT EXISTS (SELECT 1 FROM public.bets WHERE user_id = _user_id) INTO qualifies;
      WHEN 'bet_count' THEN
        SELECT count(*) INTO metric FROM public.bets WHERE user_id = _user_id;
        qualifies := metric >= GREATEST(1, COALESCE((achievement.criteria->>'threshold')::numeric, 1));
      WHEN 'total_wagered' THEN
        SELECT COALESCE(sum(amount), 0) INTO metric FROM public.bets WHERE user_id = _user_id;
        qualifies := metric >= GREATEST(0, COALESCE((achievement.criteria->>'threshold')::numeric, 0));
      ELSE
        qualifies := false;
    END CASE;
    IF qualifies THEN
      INSERT INTO public.user_achievements (user_id, achievement_id)
      VALUES (_user_id, achievement.id) ON CONFLICT (user_id, achievement_id) DO NOTHING;
      IF FOUND THEN unlocked_count := unlocked_count + 1; END IF;
    END IF;
  END LOOP;
  RETURN unlocked_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_achievements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_achievements(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_ledger_achievements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type = 'deposit' AND NEW.amount > 0 THEN
    PERFORM public.evaluate_achievements(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_bet_achievements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.evaluate_achievements(NEW.user_id);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_evaluate_ledger_achievements
AFTER INSERT ON public.ledger
FOR EACH ROW EXECUTE FUNCTION public.evaluate_ledger_achievements();

CREATE TRIGGER trg_evaluate_bet_achievements
AFTER INSERT ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.evaluate_bet_achievements();

CREATE OR REPLACE FUNCTION public.admin_save_cashback_terms(
  _version integer, _rollover numeric, _expires_days integer, _terms text, _withdrawal_rules text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_staff_role(ARRAY['admin']::public.app_role[]);
  IF _version < 1 OR _rollover < 0 OR _rollover > 1000 OR _expires_days < 1 OR _expires_days > 365
     OR _terms IS NULL OR length(trim(_terms)) < 10 OR length(_terms) > 20000
     OR _withdrawal_rules IS NULL OR length(trim(_withdrawal_rules)) < 3 OR length(_withdrawal_rules) > 5000 THEN
    RAISE EXCEPTION 'INVALID_MISSION_TERMS';
  END IF;
  INSERT INTO public.app_settings (key, value, updated_by)
  VALUES ('mission_terms', jsonb_build_object(
    'version', _version, 'rollover', _rollover, 'expiresDays', _expires_days,
    'terms', trim(_terms), 'withdrawalRules', trim(_withdrawal_rules)
  ), auth.uid())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = auth.uid();
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, details)
  VALUES (auth.uid(), 'mission_terms_saved', 'app_settings', 'mission_terms',
    jsonb_build_object('version', _version, 'rollover', _rollover, 'expires_days', _expires_days));
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_kyc(_full_name text, _nationality text, _document_number text, _address text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE p public.profiles; uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO p FROM public.profiles WHERE user_id = uid FOR UPDATE;
  IF NOT (p.status = 'rejected' OR (p.status = 'pending' AND p.kyc_submitted_at IS NULL)) THEN
    RAISE EXCEPTION 'KYC cannot be submitted in current status';
  END IF;
  IF length(trim(coalesce(_full_name,''))) < 3 OR length(trim(coalesce(_document_number,''))) < 3
     OR length(trim(coalesce(_address,''))) < 5 OR _nationality !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'Invalid KYC data';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kyc_files WHERE user_id = uid AND kind = 'document_front'
                 AND created_at > coalesce(p.kyc_submitted_at, '-infinity'))
     OR NOT EXISTS (SELECT 1 FROM public.kyc_files WHERE user_id = uid AND kind = 'selfie'
                 AND created_at > coalesce(p.kyc_submitted_at, '-infinity')) THEN
    RAISE EXCEPTION 'Document photo and selfie required';
  END IF;
  PERFORM set_config('app.profile_guard_bypass', '1', true);
  UPDATE public.profiles SET
    full_name = trim(_full_name), nationality = _nationality,
    document_number = upper(trim(_document_number)), address = trim(_address),
    status = 'pending', rejection_reason = NULL, kyc_submitted_at = now()
  WHERE user_id = uid;
  PERFORM set_config('app.profile_guard_bypass', '0', true);
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id)
  VALUES (uid, 'kyc_submitted', 'profiles', uid::text);
END;
$function$;