CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  full_name text NOT NULL,
  cpf text,
  phone text,
  birth_date date,
  street text,
  address_number text,
  neighborhood text,
  city text,
  observations text NOT NULL DEFAULT '',
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_contact_at timestamptz,
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT customers_name_not_empty CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 180),
  CONSTRAINT customers_cpf_digits CHECK (cpf IS NULL OR cpf ~ '^[0-9]{1,20}$'),
  CONSTRAINT customers_phone_length CHECK (phone IS NULL OR char_length(phone) <= 40),
  CONSTRAINT customers_street_length CHECK (street IS NULL OR char_length(street) <= 180),
  CONSTRAINT customers_address_number_length CHECK (address_number IS NULL OR char_length(address_number) <= 40),
  CONSTRAINT customers_neighborhood_length CHECK (neighborhood IS NULL OR char_length(neighborhood) <= 120),
  CONSTRAINT customers_city_length CHECK (city IS NULL OR char_length(city) <= 120),
  CONSTRAINT customers_observations_length CHECK (char_length(observations) <= 4000),
  CONSTRAINT customers_custom_fields_object CHECK (pg_catalog.jsonb_typeof(custom_fields) = 'object')
);

CREATE UNIQUE INDEX customers_company_cpf_unique
  ON public.customers (company_id, cpf)
  WHERE cpf IS NOT NULL AND cpf <> '';
CREATE INDEX customers_company_name_idx
  ON public.customers (company_id, full_name);
CREATE INDEX customers_company_birthday_idx
  ON public.customers (company_id, birth_date)
  WHERE archived_at IS NULL;
CREATE INDEX customers_company_last_contact_idx
  ON public.customers (company_id, last_contact_at DESC);

CREATE TABLE public.customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  content text NOT NULL,
  attended_by text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_notes_company_customer_fk
    FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT customer_notes_content_length CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000),
  CONSTRAINT customer_notes_attended_by_length CHECK (char_length(attended_by) <= 120)
);

CREATE INDEX customer_notes_company_customer_created_idx
  ON public.customer_notes (company_id, customer_id, created_at DESC);

CREATE TABLE public.customer_procurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  category_id uuid,
  description text NOT NULL,
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'abandoned')),
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  resolved_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_procurations_company_customer_fk
    FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers (company_id, id)
    ON DELETE CASCADE,
  CONSTRAINT customer_procurations_company_category_fk
    FOREIGN KEY (company_id, category_id)
    REFERENCES public.product_categories (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT customer_procurations_description_length CHECK (char_length(btrim(description)) BETWEEN 1 AND 300),
  CONSTRAINT customer_procurations_details_length CHECK (char_length(details) <= 500)
);

CREATE INDEX customer_procurations_company_status_date_idx
  ON public.customer_procurations (company_id, status, occurred_on DESC);
CREATE INDEX customer_procurations_company_customer_date_idx
  ON public.customer_procurations (company_id, customer_id, occurred_on DESC);

CREATE TABLE public.customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp')),
  context text NOT NULL CHECK (context IN ('general', 'reactivation', 'procure', 'birthday')),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  contacted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_contacts_company_customer_fk
    FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers (company_id, id)
    ON DELETE CASCADE
);

CREATE INDEX customer_contacts_company_customer_date_idx
  ON public.customer_contacts (company_id, customer_id, contacted_at DESC);

CREATE TABLE public.customer_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies (id) ON DELETE CASCADE,
  inactive_days integer NOT NULL DEFAULT 60 CHECK (inactive_days BETWEEN 1 AND 3650),
  whatsapp_message text NOT NULL DEFAULT 'Olá {primeiro_nome}! Aqui é da {loja}. Chegaram novidades que têm a sua cara. Passa aqui pra conferir!',
  birthday_message text NOT NULL DEFAULT 'Feliz aniversário, {primeiro_nome}! 🎉 A {loja} preparou um presente pra você: passe na loja esta semana e ganhe um desconto especial.',
  procure_message text NOT NULL DEFAULT 'Olá {primeiro_nome}! Aqui é da {loja}. Chegou o que você estava procurando: {procura}. Quer que a gente separe pra você?',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_settings_message_length CHECK (
    char_length(whatsapp_message) <= 2000
    AND char_length(birthday_message) <= 2000
    AND char_length(procure_message) <= 2000
  )
);

INSERT INTO public.customer_settings (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_company_customer_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.customer_settings (company_id)
  VALUES (NEW.id)
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_seed_customer_settings
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.seed_company_customer_settings();

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customer_notes_set_updated_at
  BEFORE UPDATE ON public.customer_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customer_procurations_set_updated_at
  BEFORE UPDATE ON public.customer_procurations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customer_settings_set_updated_at
  BEFORE UPDATE ON public.customer_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_procurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select_member
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY customers_insert_manager
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_role(company_id, ARRAY['owner', 'manager']::text[])
    AND created_by = auth.uid()
    AND archived_at IS NULL
  );

CREATE POLICY customers_update_manager
  ON public.customers FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]))
  WITH CHECK (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

CREATE POLICY customer_notes_select_member
  ON public.customer_notes FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY customer_notes_insert_member
  ON public.customer_notes FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id) AND created_by = auth.uid());

CREATE POLICY customer_notes_update_member
  ON public.customer_notes FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY customer_notes_delete_manager
  ON public.customer_notes FOR DELETE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

CREATE POLICY customer_procurations_select_member
  ON public.customer_procurations FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY customer_procurations_insert_member
  ON public.customer_procurations FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id) AND created_by = auth.uid());

CREATE POLICY customer_procurations_update_member
  ON public.customer_procurations FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY customer_procurations_delete_manager
  ON public.customer_procurations FOR DELETE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

CREATE POLICY customer_contacts_select_member
  ON public.customer_contacts FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY customer_settings_select_member
  ON public.customer_settings FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY customer_settings_update_manager
  ON public.customer_settings FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]))
  WITH CHECK (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

REVOKE ALL ON TABLE public.customers, public.customer_notes, public.customer_procurations,
  public.customer_contacts, public.customer_settings
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.customers, public.customer_notes, public.customer_procurations,
  public.customer_contacts, public.customer_settings TO authenticated;

GRANT INSERT (company_id, full_name, cpf, phone, birth_date, street, address_number,
  neighborhood, city, observations, custom_fields, created_by)
  ON TABLE public.customers TO authenticated;
GRANT UPDATE (full_name, cpf, phone, birth_date, street, address_number, neighborhood,
  city, observations, custom_fields)
  ON TABLE public.customers TO authenticated;

GRANT INSERT (company_id, customer_id, content, attended_by, created_by)
  ON TABLE public.customer_notes TO authenticated;
GRANT UPDATE (content, attended_by) ON TABLE public.customer_notes TO authenticated;
GRANT DELETE ON TABLE public.customer_notes TO authenticated;

GRANT INSERT (company_id, customer_id, category_id, description, details, status,
  occurred_on, resolved_at, created_by)
  ON TABLE public.customer_procurations TO authenticated;
GRANT UPDATE (category_id, description, details, status, occurred_on, resolved_at)
  ON TABLE public.customer_procurations TO authenticated;
GRANT DELETE ON TABLE public.customer_procurations TO authenticated;

GRANT UPDATE (inactive_days, whatsapp_message, birthday_message, procure_message)
  ON TABLE public.customer_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.record_customer_contact(
  p_company_id uuid,
  p_customer_id uuid,
  p_context text DEFAULT 'general'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_contact_id uuid;
  v_contacted_at timestamptz := now();
  v_note text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'company_access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_context NOT IN ('general', 'reactivation', 'procure', 'birthday') THEN
    RAISE EXCEPTION 'invalid_contact_context' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customers
  SET last_contact_at = v_contacted_at
  WHERE company_id = p_company_id AND id = p_customer_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.customer_contacts (
    company_id, customer_id, channel, context, created_by, contacted_at
  )
  VALUES (p_company_id, p_customer_id, 'whatsapp', p_context, v_user_id, v_contacted_at)
  RETURNING id INTO v_contact_id;

  v_note := CASE p_context
    WHEN 'reactivation' THEN 'Contato via WhatsApp (reativação de cliente inativo)'
    WHEN 'procure' THEN 'Contato via WhatsApp (avisado sobre item procurado)'
    WHEN 'birthday' THEN 'Contato via WhatsApp (parabéns de aniversário)'
    ELSE NULL
  END;

  IF v_note IS NOT NULL THEN
    INSERT INTO public.customer_notes (company_id, customer_id, content, created_by, created_at)
    VALUES (p_company_id, p_customer_id, v_note, v_user_id, v_contacted_at);
  END IF;

  RETURN v_contact_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_customer_archived(
  p_company_id uuid,
  p_customer_id uuid,
  p_archived boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.customers
  SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END
  WHERE company_id = p_company_id AND id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_customer_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_customer_contact(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_archived(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_contact(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_archived(uuid, uuid, boolean) TO authenticated;
