CREATE OR REPLACE FUNCTION public.enforce_spin_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT count(*) FROM public.spin_requests
      WHERE user_id = NEW.user_id AND created_at >= now() - interval '10 seconds') >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMITED';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_spin_rate_limit
BEFORE INSERT ON public.spin_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_spin_rate_limit();

REVOKE ALL ON FUNCTION public.enforce_spin_rate_limit() FROM PUBLIC;