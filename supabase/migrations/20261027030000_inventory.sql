CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_categories_name_not_empty CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT product_categories_company_id_id_unique UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX product_categories_company_name_unique
  ON public.product_categories (company_id, pg_catalog.lower(name));

INSERT INTO public.product_categories (company_id, name, sort_order)
SELECT company.id, category.name, category.position
FROM public.companies AS company
CROSS JOIN (
  VALUES
    ('Camisas', 1),
    ('Shorts', 2),
    ('Calças', 3),
    ('Casacos', 4),
    ('Calçados', 5),
    ('Bonés', 6),
    ('Acessórios', 7),
    ('Óculos', 8),
    ('Perfumes e Cremes', 9)
) AS category(name, position)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.product_categories AS existing
  WHERE existing.company_id = company.id
    AND pg_catalog.lower(existing.name) = pg_catalog.lower(category.name)
);

CREATE OR REPLACE FUNCTION public.seed_company_product_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.product_categories (company_id, name, sort_order)
  VALUES
    (NEW.id, 'Camisas', 1),
    (NEW.id, 'Shorts', 2),
    (NEW.id, 'Calças', 3),
    (NEW.id, 'Casacos', 4),
    (NEW.id, 'Calçados', 5),
    (NEW.id, 'Bonés', 6),
    (NEW.id, 'Acessórios', 7),
    (NEW.id, 'Óculos', 8),
    (NEW.id, 'Perfumes e Cremes', 9)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_seed_product_categories
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.seed_company_product_categories();

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  cost numeric(12, 2),
  price numeric(12, 2) NOT NULL DEFAULT 0,
  current_stock integer NOT NULL DEFAULT 0,
  stock_min integer,
  stock_max integer,
  observations text NOT NULL DEFAULT '',
  promotion jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT products_company_category_fk
    FOREIGN KEY (company_id, category_id)
    REFERENCES public.product_categories (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT products_name_not_empty CHECK (char_length(btrim(name)) BETWEEN 1 AND 180),
  CONSTRAINT products_code_length CHECK (code IS NULL OR char_length(code) <= 80),
  CONSTRAINT products_cost_non_negative CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT products_price_non_negative CHECK (price >= 0),
  CONSTRAINT products_stock_min_non_negative CHECK (stock_min IS NULL OR stock_min >= 0),
  CONSTRAINT products_stock_max_non_negative CHECK (stock_max IS NULL OR stock_max >= 0),
  CONSTRAINT products_stock_limits_order CHECK (
    stock_min IS NULL OR stock_max IS NULL OR stock_min <= stock_max
  ),
  CONSTRAINT products_observations_length CHECK (char_length(observations) <= 4000),
  CONSTRAINT products_promotion_valid CHECK (
    promotion IS NULL OR (
      pg_catalog.jsonb_typeof(promotion) = 'object'
      AND promotion ? 'qtd'
      AND promotion ? 'preco'
      AND (promotion ->> 'qtd') ~ '^[0-9]+$'
      AND (promotion ->> 'qtd')::integer >= 2
      AND (promotion ->> 'preco') ~ '^[0-9]+([.][0-9]{1,2})?$'
      AND (promotion ->> 'preco')::numeric > 0
    )
  )
);

CREATE UNIQUE INDEX products_company_code_unique
  ON public.products (company_id, pg_catalog.lower(code))
  WHERE code IS NOT NULL AND btrim(code) <> '';

CREATE INDEX products_company_category_active_name_idx
  ON public.products (company_id, category_id, active, name);

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  type text NOT NULL,
  direction smallint NOT NULL CHECK (direction IN (-1, 1)),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 2),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  observations text NOT NULL DEFAULT '',
  origin text NOT NULL CHECK (origin IN ('manual', 'system', 'initial', 'sale')),
  reference_id uuid,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_company_product_fk
    FOREIGN KEY (company_id, product_id)
    REFERENCES public.products (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT stock_movements_unit_cost_non_negative CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT stock_movements_observations_length CHECK (char_length(observations) <= 2000)
);

CREATE INDEX stock_movements_company_occurred_at_idx
  ON public.stock_movements (company_id, occurred_at DESC);
CREATE INDEX stock_movements_company_product_occurred_at_idx
  ON public.stock_movements (company_id, product_id, occurred_at DESC);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_categories_select_member
  ON public.product_categories FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY product_categories_insert_manager
  ON public.product_categories FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_role(company_id, ARRAY['owner', 'manager']::text[])
  );

CREATE POLICY product_categories_update_manager
  ON public.product_categories FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]))
  WITH CHECK (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

CREATE POLICY product_categories_delete_manager
  ON public.product_categories FOR DELETE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

CREATE POLICY products_select_member
  ON public.products FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY products_insert_manager
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_role(company_id, ARRAY['owner', 'manager']::text[])
    AND created_by = auth.uid()
    AND current_stock = 0
  );

CREATE POLICY products_update_manager
  ON public.products FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]))
  WITH CHECK (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

CREATE POLICY products_delete_manager
  ON public.products FOR DELETE TO authenticated
  USING (public.has_company_role(company_id, ARRAY['owner', 'manager']::text[]));

CREATE POLICY stock_movements_select_member
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

REVOKE ALL ON TABLE public.product_categories, public.products, public.stock_movements
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.product_categories TO authenticated;
GRANT INSERT (company_id, name, active, sort_order)
  ON TABLE public.product_categories TO authenticated;
GRANT UPDATE (name, active, sort_order)
  ON TABLE public.product_categories TO authenticated;
GRANT SELECT ON TABLE public.products, public.stock_movements TO authenticated;
GRANT INSERT (
  company_id, category_id, code, name, cost, price, stock_min, stock_max,
  observations, promotion, active, created_by
) ON TABLE public.products TO authenticated;
GRANT UPDATE (
  category_id, code, name, cost, price, stock_min, stock_max,
  observations, promotion, active
) ON TABLE public.products TO authenticated;

CREATE OR REPLACE FUNCTION public.register_stock_movement(
  p_company_id uuid,
  p_product_id uuid,
  p_type text,
  p_direction smallint,
  p_quantity integer,
  p_unit_cost numeric,
  p_occurred_at timestamptz,
  p_observations text,
  p_origin text DEFAULT 'manual',
  p_update_product_cost boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_movement_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'company_access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_direction NOT IN (-1, 1) OR p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_stock_quantity' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL OR char_length(btrim(p_type)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_movement_type' USING ERRCODE = '22023';
  END IF;
  IF p_origin NOT IN ('manual', 'system', 'initial') THEN
    RAISE EXCEPTION 'invalid_movement_origin' USING ERRCODE = '22023';
  END IF;
  IF p_origin <> 'manual'
     AND NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_update_product_cost
     AND NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'invalid_unit_cost' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET current_stock = current_stock + (p_direction * p_quantity),
      cost = CASE WHEN p_update_product_cost AND p_unit_cost IS NOT NULL THEN p_unit_cost ELSE cost END
  WHERE company_id = p_company_id AND id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.stock_movements (
    company_id, product_id, type, direction, quantity, unit_cost,
    occurred_at, observations, origin, created_by
  )
  VALUES (
    p_company_id, p_product_id, btrim(p_type), p_direction, p_quantity,
    p_unit_cost, COALESCE(p_occurred_at, now()),
    COALESCE(p_observations, ''), p_origin, v_user_id
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_stock_movement(
  p_company_id uuid,
  p_movement_id uuid,
  p_product_id uuid,
  p_type text,
  p_direction smallint,
  p_quantity integer,
  p_unit_cost numeric,
  p_occurred_at timestamptz,
  p_observations text,
  p_update_product_cost boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old public.stock_movements%ROWTYPE;
  v_user_id uuid;
  v_product_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL
     OR NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_direction NOT IN (-1, 1) OR p_quantity IS NULL OR p_quantity <= 0
     OR p_type IS NULL OR char_length(btrim(p_type)) NOT BETWEEN 1 AND 100
     OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'invalid_stock_movement' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old
  FROM public.stock_movements
  WHERE company_id = p_company_id AND id = p_movement_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movement_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old.origin = 'sale' THEN
    RAISE EXCEPTION 'sale_movement_must_be_changed_from_sale' USING ERRCODE = '22023';
  END IF;

  PERFORM product.id
  FROM public.products AS product
  WHERE product.company_id = p_company_id
    AND product.id IN (v_old.product_id, p_product_id)
  ORDER BY product.id
  FOR UPDATE;

  SELECT count(*) INTO v_product_count
  FROM public.products AS product
  WHERE product.company_id = p_company_id
    AND product.id IN (v_old.product_id, p_product_id);
  IF v_product_count <> CASE WHEN v_old.product_id = p_product_id THEN 1 ELSE 2 END THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '23503';
  END IF;

  UPDATE public.products
  SET current_stock = current_stock - (v_old.direction * v_old.quantity)
  WHERE company_id = p_company_id AND id = v_old.product_id;

  UPDATE public.products
  SET current_stock = current_stock + (p_direction * p_quantity),
      cost = CASE WHEN p_update_product_cost AND p_unit_cost IS NOT NULL THEN p_unit_cost ELSE cost END
  WHERE company_id = p_company_id AND id = p_product_id;

  UPDATE public.stock_movements
  SET product_id = p_product_id,
      type = btrim(p_type),
      direction = p_direction,
      quantity = p_quantity,
      unit_cost = p_unit_cost,
      occurred_at = COALESCE(p_occurred_at, now()),
      observations = COALESCE(p_observations, '')
  WHERE company_id = p_company_id AND id = p_movement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_stock_movement(
  p_company_id uuid,
  p_movement_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_movement public.stock_movements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_movement
  FROM public.stock_movements
  WHERE company_id = p_company_id AND id = p_movement_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'movement_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_movement.origin = 'sale' THEN
    RAISE EXCEPTION 'sale_movement_must_be_deleted_from_sale' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET current_stock = current_stock - (v_movement.direction * v_movement.quantity)
  WHERE company_id = p_company_id AND id = v_movement.product_id;

  DELETE FROM public.stock_movements
  WHERE company_id = p_company_id AND id = p_movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_stock_movement(uuid, uuid, text, smallint, integer, numeric, timestamptz, text, text, boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seed_company_product_categories() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_stock_movement(uuid, uuid, uuid, text, smallint, integer, numeric, timestamptz, text, boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_stock_movement(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_stock_movement(uuid, uuid, text, smallint, integer, numeric, timestamptz, text, text, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_stock_movement(uuid, uuid, uuid, text, smallint, integer, numeric, timestamptz, text, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_stock_movement(uuid, uuid)
  TO authenticated;
