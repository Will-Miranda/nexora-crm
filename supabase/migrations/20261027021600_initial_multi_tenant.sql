CREATE OR REPLACE FUNCTION public.cnpj_is_valid(p_cnpj text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  v_digits text;
  v_sum integer;
  v_weight integer;
  v_check_digit integer;
  v_i integer;
BEGIN
  v_digits := pg_catalog.regexp_replace(p_cnpj, '[^0-9]', '', 'g');

  IF v_digits !~ '^[0-9]{14}$'
     OR v_digits = pg_catalog.repeat(pg_catalog.substr(v_digits, 1, 1), 14) THEN
    RETURN false;
  END IF;

  v_sum := 0;
  FOR v_i IN 1..12 LOOP
    v_weight := CASE WHEN v_i <= 4 THEN 6 - v_i ELSE 14 - v_i END;
    v_sum := v_sum + pg_catalog.substr(v_digits, v_i, 1)::integer * v_weight;
  END LOOP;

  v_check_digit := CASE WHEN v_sum % 11 < 2 THEN 0 ELSE 11 - (v_sum % 11) END;
  IF v_check_digit <> pg_catalog.substr(v_digits, 13, 1)::integer THEN
    RETURN false;
  END IF;

  v_sum := 0;
  FOR v_i IN 1..13 LOOP
    v_weight := CASE WHEN v_i <= 5 THEN 7 - v_i ELSE 15 - v_i END;
    v_sum := v_sum + pg_catalog.substr(v_digits, v_i, 1)::integer * v_weight;
  END LOOP;

  v_check_digit := CASE WHEN v_sum % 11 < 2 THEN 0 ELSE 11 - (v_sum % 11) END;
  RETURN v_check_digit = pg_catalog.substr(v_digits, 14, 1)::integer;
END;
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_full_name_length CHECK (full_name IS NULL OR char_length(full_name) <= 120)
);

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  cnpj text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_legal_name_not_empty CHECK (char_length(btrim(legal_name)) BETWEEN 2 AND 180),
  CONSTRAINT companies_trade_name_length CHECK (trade_name IS NULL OR char_length(trade_name) <= 180),
  CONSTRAINT companies_cnpj_valid CHECK (
    cnpj = pg_catalog.regexp_replace(cnpj, '[^0-9]', '', 'g')
    AND public.cnpj_is_valid(cnpj)
  )
);

CREATE TABLE public.company_members (
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'operator')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE INDEX company_members_user_status_idx
  ON public.company_members (user_id, status);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members AS membership
    WHERE membership.company_id = p_company_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(
  p_company_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members AS membership
    WHERE membership.company_id = p_company_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
      AND membership.role = ANY (p_roles)
  );
$$;

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

  v_cnpj := pg_catalog.regexp_replace(COALESCE(p_cnpj, ''), '[^0-9]', '', 'g');
  IF NOT public.cnpj_is_valid(v_cnpj) THEN
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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_update_own
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY companies_select_member
  ON public.companies FOR SELECT TO authenticated
  USING (public.is_company_member(id));

CREATE POLICY companies_update_owner
  ON public.companies FOR UPDATE TO authenticated
  USING (public.has_company_role(id, ARRAY['owner']::text[]))
  WITH CHECK (public.has_company_role(id, ARRAY['owner']::text[]));

CREATE POLICY company_members_select_self_or_manager
  ON public.company_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_company_role(company_id, ARRAY['owner', 'manager']::text[])
  );

REVOKE ALL ON TABLE public.profiles, public.companies, public.company_members
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles, public.companies, public.company_members
  TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (legal_name, trade_name) ON TABLE public.companies TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_company_role(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_company(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company(text, text, text) TO authenticated;
