CREATE OR REPLACE FUNCTION public.enforce_stock_movement_date_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.origin = 'manual'
     AND auth.uid() IS NOT NULL
     AND (NEW.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date
       < (now() AT TIME ZONE 'America/Sao_Paulo')::date
     AND NOT public.has_company_role(
       NEW.company_id,
       ARRAY['owner', 'manager']::text[]
     ) THEN
    RAISE EXCEPTION 'manager_role_required_for_historical_stock_movement'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_stock_movement_date_role()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER stock_movements_enforce_date_role
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_stock_movement_date_role();
