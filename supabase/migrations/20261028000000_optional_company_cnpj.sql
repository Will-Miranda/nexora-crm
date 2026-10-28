ALTER TABLE public.companies
  ALTER COLUMN cnpj DROP NOT NULL;

ALTER TABLE public.companies
  DROP CONSTRAINT companies_cnpj_valid,
  ADD CONSTRAINT companies_cnpj_valid CHECK (
    cnpj IS NULL
    OR (
      cnpj = pg_catalog.regexp_replace(cnpj, '[^0-9]', '', 'g')
      AND public.cnpj_is_valid(cnpj)
    )
  );

CREATE OR REPLACE FUNCTION public.create_company(
  p_legal_name text,
  p_trade_name text,
  p_cnpj text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_company_id uuid;
  v_cnpj text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  v_cnpj := NULLIF(pg_catalog.regexp_replace(COALESCE(p_cnpj, ''), '[^0-9]', '', 'g'), '');
  IF v_cnpj IS NOT NULL AND NOT public.cnpj_is_valid(v_cnpj) THEN
    RAISE EXCEPTION 'invalid_cnpj' USING ERRCODE = '22023';
  END IF;

  IF p_legal_name IS NULL OR char_length(btrim(p_legal_name)) NOT BETWEEN 2 AND 180 THEN
    RAISE EXCEPTION 'invalid_legal_name' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (id)
  VALUES (v_user_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.companies (legal_name, trade_name, cnpj, created_by)
  VALUES (
    btrim(p_legal_name),
    NULLIF(btrim(COALESCE(p_trade_name, '')), ''),
    v_cnpj,
    v_user_id
  )
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_members (company_id, user_id, role, status)
  VALUES (v_company_id, v_user_id, 'owner', 'active');

  RETURN v_company_id;
END;
$$;
