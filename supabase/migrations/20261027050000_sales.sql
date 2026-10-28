CREATE TABLE public.cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_cash numeric(12, 2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid NOT NULL REFERENCES auth.users (id),
  operator_name text NOT NULL DEFAULT '',
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users (id),
  expected_cash numeric(12, 2),
  counted_cash numeric(12, 2),
  difference numeric(12, 2),
  closing_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_registers_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT cash_registers_closed_state CHECK (
    (status = 'open' AND closed_at IS NULL AND closed_by IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
  ),
  CONSTRAINT cash_registers_closing_values CHECK (
    (counted_cash IS NULL AND expected_cash IS NULL AND difference IS NULL)
    OR (counted_cash >= 0 AND expected_cash >= 0 AND difference IS NOT NULL)
  ),
  CONSTRAINT cash_registers_note_length CHECK (char_length(closing_note) <= 2000),
  CONSTRAINT cash_registers_operator_length CHECK (char_length(operator_name) <= 120)
);

CREATE UNIQUE INDEX cash_registers_one_open_per_company
  ON public.cash_registers (company_id)
  WHERE status = 'open';
CREATE INDEX cash_registers_company_opened_idx
  ON public.cash_registers (company_id, opened_at DESC);

CREATE TABLE public.sales_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies (id) ON DELETE CASCADE,
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

INSERT INTO public.sales_counters (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_company_sales_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.sales_counters (company_id)
  VALUES (NEW.id)
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_seed_sales_counter
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.seed_company_sales_counter();

CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  sale_number bigint NOT NULL,
  cash_register_id uuid NOT NULL,
  customer_id uuid,
  seller_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  sold_at timestamptz NOT NULL DEFAULT now(),
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  promotion_discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (promotion_discount >= 0),
  item_discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (item_discount >= 0),
  sale_discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (sale_discount >= 0),
  total_discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_discount >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  received numeric(12, 2) NOT NULL DEFAULT 0 CHECK (received >= total),
  change_due numeric(12, 2) NOT NULL DEFAULT 0 CHECK (change_due >= 0),
  sale_discount_type text NOT NULL DEFAULT 'amount' CHECK (sale_discount_type IN ('amount', 'percent')),
  sale_discount_value numeric(12, 2) NOT NULL DEFAULT 0 CHECK (sale_discount_value >= 0),
  sale_discount_reason text NOT NULL DEFAULT '',
  observations text NOT NULL DEFAULT '',
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users (id),
  cancellation_reason text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  updated_by uuid NOT NULL REFERENCES auth.users (id),
  CONSTRAINT sales_company_number_unique UNIQUE (company_id, sale_number),
  CONSTRAINT sales_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT sales_company_cash_fk FOREIGN KEY (company_id, cash_register_id)
    REFERENCES public.cash_registers (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_company_customer_fk FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_seller_length CHECK (char_length(btrim(seller_name)) BETWEEN 1 AND 120),
  CONSTRAINT sales_discount_reason_length CHECK (char_length(sale_discount_reason) <= 300),
  CONSTRAINT sales_observations_length CHECK (char_length(observations) <= 2000),
  CONSTRAINT sales_cancellation_reason_length CHECK (char_length(cancellation_reason) <= 500),
  CONSTRAINT sales_cancelled_state CHECK (
    (status = 'active' AND cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  )
);

CREATE INDEX sales_company_sold_at_idx
  ON public.sales (company_id, sold_at DESC);
CREATE INDEX sales_company_customer_idx
  ON public.sales (company_id, customer_id, sold_at DESC);
CREATE INDEX sales_company_cash_idx
  ON public.sales (company_id, cash_register_id, sold_at DESC);

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  product_code text,
  category_name text NOT NULL DEFAULT '',
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  unit_cost numeric(12, 2),
  promotion_quantity integer,
  promotion_price numeric(12, 2),
  promotion_active boolean NOT NULL DEFAULT false,
  promotion_discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (promotion_discount >= 0),
  discount_type text NOT NULL DEFAULT 'amount' CHECK (discount_type IN ('amount', 'percent')),
  discount_value numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discount_reason text NOT NULL DEFAULT '',
  subtotal numeric(12, 2) NOT NULL CHECK (subtotal >= 0),
  item_discount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (item_discount >= 0),
  total numeric(12, 2) NOT NULL CHECK (total >= 0),
  CONSTRAINT sale_items_company_sale_fk FOREIGN KEY (company_id, sale_id)
    REFERENCES public.sales (company_id, id) ON DELETE CASCADE,
  CONSTRAINT sale_items_company_product_fk FOREIGN KEY (company_id, product_id)
    REFERENCES public.products (company_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_promotion_values CHECK (
    (promotion_quantity IS NULL AND promotion_price IS NULL)
    OR (promotion_quantity >= 2 AND promotion_price >= 0)
  ),
  CONSTRAINT sale_items_cost_non_negative CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT sale_items_discount_reason_length CHECK (char_length(discount_reason) <= 300)
);

CREATE INDEX sale_items_company_sale_idx
  ON public.sale_items (company_id, sale_id);
CREATE INDEX sale_items_company_product_idx
  ON public.sale_items (company_id, product_id);

CREATE TABLE public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'pix', 'credit', 'debit', 'other')),
  payment_label text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  CONSTRAINT sale_payments_company_sale_fk FOREIGN KEY (company_id, sale_id)
    REFERENCES public.sales (company_id, id) ON DELETE CASCADE,
  CONSTRAINT sale_payments_label_length CHECK (char_length(payment_label) BETWEEN 1 AND 80)
);

CREATE INDEX sale_payments_company_sale_idx
  ON public.sale_payments (company_id, sale_id);

ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_registers_select_member
  ON public.cash_registers FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY sales_select_member
  ON public.sales FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY sale_items_select_member
  ON public.sale_items FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY sale_payments_select_member
  ON public.sale_payments FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

REVOKE ALL ON TABLE public.cash_registers, public.sales, public.sale_items, public.sale_payments,
  public.sales_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cash_registers, public.sales, public.sale_items, public.sale_payments
  TO authenticated;

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_company_id uuid,
  p_opening_cash numeric,
  p_operator_name text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cash_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'company_access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_opening_cash IS NULL OR p_opening_cash < 0 OR p_opening_cash > 9999999999.99
     OR char_length(btrim(COALESCE(p_operator_name, ''))) > 120 THEN
    RAISE EXCEPTION 'invalid_cash_opening' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cash_registers (company_id, opening_cash, opened_by, operator_name)
  VALUES (p_company_id, p_opening_cash, auth.uid(), btrim(COALESCE(p_operator_name, '')))
  RETURNING id INTO v_cash_id;
  RETURN v_cash_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_register(
  p_company_id uuid,
  p_cash_register_id uuid,
  p_counted_cash numeric,
  p_closing_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cash public.cash_registers%ROWTYPE;
  v_expected numeric(12, 2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'company_access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 OR p_counted_cash > 9999999999.99
     OR char_length(COALESCE(p_closing_note, '')) > 2000 THEN
    RAISE EXCEPTION 'invalid_cash_closing' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cash
  FROM public.cash_registers
  WHERE company_id = p_company_id AND id = p_cash_register_id
  FOR UPDATE;
  IF NOT FOUND OR v_cash.status <> 'open' THEN
    RAISE EXCEPTION 'cash_register_not_open' USING ERRCODE = 'P0002';
  END IF;
  IF v_cash.opened_by <> auth.uid()
     AND NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'cash_register_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT round(
    v_cash.opening_cash + COALESCE(sum(payment.amount), 0),
    2
  ) INTO v_expected
  FROM public.sales AS sale
  LEFT JOIN public.sale_payments AS payment
    ON payment.company_id = sale.company_id AND payment.sale_id = sale.id
    AND payment.payment_method = 'cash'
  WHERE sale.company_id = p_company_id
    AND sale.cash_register_id = p_cash_register_id
    AND sale.status = 'active';

  UPDATE public.cash_registers
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid(),
      expected_cash = v_expected,
      counted_cash = p_counted_cash,
      difference = round(p_counted_cash - v_expected, 2),
      closing_note = btrim(COALESCE(p_closing_note, ''))
  WHERE company_id = p_company_id AND id = p_cash_register_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_closed_cash_register(
  p_company_id uuid,
  p_cash_register_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cash public.cash_registers%ROWTYPE;
  v_expected numeric(12, 2);
BEGIN
  SELECT * INTO v_cash
  FROM public.cash_registers
  WHERE company_id = p_company_id AND id = p_cash_register_id AND status = 'closed';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT round(v_cash.opening_cash + COALESCE(sum(payment.amount), 0), 2)
  INTO v_expected
  FROM public.sales AS sale
  LEFT JOIN public.sale_payments AS payment
    ON payment.company_id = sale.company_id AND payment.sale_id = sale.id
    AND payment.payment_method = 'cash'
  WHERE sale.company_id = p_company_id
    AND sale.cash_register_id = p_cash_register_id
    AND sale.status = 'active';

  UPDATE public.cash_registers
  SET expected_cash = v_expected,
      difference = counted_cash - v_expected
  WHERE company_id = p_company_id AND id = p_cash_register_id AND status = 'closed';
END;
$$;

CREATE OR REPLACE FUNCTION public.save_sale(
  p_company_id uuid,
  p_cash_register_id uuid,
  p_sale_id uuid,
  p_customer_id uuid,
  p_seller_name text,
  p_items jsonb,
  p_payments jsonb,
  p_sale_discount_type text,
  p_sale_discount_value numeric,
  p_sale_discount_reason text,
  p_observations text,
  p_sold_at timestamptz,
  p_allow_negative_stock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_cash public.cash_registers%ROWTYPE;
  v_sale public.sales%ROWTYPE;
  v_existing_cash_id uuid;
  v_product public.products%ROWTYPE;
  v_item jsonb;
  v_payment jsonb;
  v_sale_id uuid;
  v_sale_number bigint;
  v_cash_id uuid;
  v_item_id uuid;
  v_quantity integer;
  v_unit_price numeric(12, 2);
  v_unit_cost numeric(12, 2);
  v_promotion_quantity integer;
  v_promotion_price numeric(12, 2);
  v_promotion_active boolean;
  v_promotion_discount numeric(12, 2);
  v_discount_type text;
  v_discount_value numeric(12, 2);
  v_discount_reason text;
  v_subtotal numeric(12, 2);
  v_item_base numeric(12, 2);
  v_item_discount numeric(12, 2);
  v_line_total numeric(12, 2);
  v_subtotal_total numeric(12, 2) := 0;
  v_promotion_total numeric(12, 2) := 0;
  v_item_discount_total numeric(12, 2) := 0;
  v_before_sale_discount numeric(12, 2);
  v_sale_discount numeric(12, 2);
  v_total_discount numeric(12, 2);
  v_total numeric(12, 2);
  v_received numeric(12, 2) := 0;
  v_change numeric(12, 2);
  v_change_left numeric(12, 2);
  v_payment_amount numeric(12, 2);
  v_applied_amount numeric(12, 2);
  v_non_cash numeric(12, 2) := 0;
  v_number_of_products integer;
  v_locked_products integer;
  v_available integer;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'company_access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_sale_id IS NOT NULL
     AND NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required_to_edit_sale' USING ERRCODE = '42501';
  END IF;
  IF p_allow_negative_stock
     AND NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required_for_negative_stock' USING ERRCODE = '42501';
  END IF;
  IF p_seller_name IS NULL OR char_length(btrim(p_seller_name)) NOT BETWEEN 1 AND 120
     OR char_length(COALESCE(p_observations, '')) > 2000
     OR p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR p_payments IS NULL OR pg_catalog.jsonb_typeof(p_payments) <> 'array'
     THEN
    RAISE EXCEPTION 'invalid_sale_data' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_sale_data' USING ERRCODE = '22023';
  END IF;
  IF p_sale_discount_type IS NULL OR p_sale_discount_type NOT IN ('amount', 'percent')
     OR p_sale_discount_value IS NULL OR p_sale_discount_value < 0
     OR (p_sale_discount_type = 'percent' AND p_sale_discount_value > 100)
     OR p_sale_discount_value > 9999999999.99
     OR char_length(COALESCE(p_sale_discount_reason, '')) > 300 THEN
    RAISE EXCEPTION 'invalid_sale_discount' USING ERRCODE = '22023';
  END IF;
  IF p_sale_discount_value > 0 AND char_length(btrim(COALESCE(p_sale_discount_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'sale_discount_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE company_id = p_company_id AND id = p_customer_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = '23503';
  END IF;

  IF p_sale_id IS NOT NULL THEN
    SELECT cash_register_id INTO v_existing_cash_id
    FROM public.sales
    WHERE company_id = p_company_id AND id = p_sale_id
      AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'active_sale_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_cash_id := v_existing_cash_id;
    SELECT * INTO v_cash
    FROM public.cash_registers
    WHERE company_id = p_company_id AND id = v_cash_id
    FOR UPDATE;
    SELECT * INTO v_sale
    FROM public.sales
    WHERE company_id = p_company_id AND id = p_sale_id
    FOR UPDATE;
    IF NOT FOUND OR v_sale.status <> 'active' OR v_sale.cash_register_id <> v_cash_id THEN
      RAISE EXCEPTION 'active_sale_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_cash.status = 'closed'
       AND NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
      RAISE EXCEPTION 'manager_role_required_for_closed_cash_sale' USING ERRCODE = '42501';
    END IF;
    v_sale_id := v_sale.id;
    v_sale_number := v_sale.sale_number;
  ELSE
    IF p_cash_register_id IS NULL THEN
      RAISE EXCEPTION 'cash_register_required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_cash
    FROM public.cash_registers
    WHERE company_id = p_company_id AND id = p_cash_register_id
    FOR UPDATE;
    IF NOT FOUND OR v_cash.status <> 'open' THEN
      RAISE EXCEPTION 'cash_register_not_open' USING ERRCODE = 'P0002';
    END IF;
    v_cash_id := v_cash.id;
  END IF;

  SELECT count(DISTINCT (item.value ->> 'product_id')::uuid)
  INTO v_number_of_products
  FROM pg_catalog.jsonb_array_elements(p_items) AS item(value)
  WHERE item.value ? 'product_id';

  PERFORM product.id
  FROM public.products AS product
  JOIN (
    SELECT DISTINCT (item.value ->> 'product_id')::uuid AS product_id
    FROM pg_catalog.jsonb_array_elements(p_items) AS item(value)
    WHERE item.value ? 'product_id'
    UNION
    SELECT old_item.product_id
    FROM public.sale_items AS old_item
    WHERE p_sale_id IS NOT NULL AND old_item.company_id = p_company_id AND old_item.sale_id = p_sale_id
  ) AS requested ON requested.product_id = product.id
  WHERE product.company_id = p_company_id
  ORDER BY product.id
  FOR UPDATE OF product;

  SELECT count(*)
  INTO v_locked_products
  FROM public.products AS product
  WHERE product.company_id = p_company_id
    AND product.id IN (
      SELECT DISTINCT (item.value ->> 'product_id')::uuid
      FROM pg_catalog.jsonb_array_elements(p_items) AS item(value)
      WHERE item.value ? 'product_id'
    );
  IF v_number_of_products = 0 OR v_locked_products <> v_number_of_products THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = '23503';
  END IF;

  IF p_sale_id IS NOT NULL THEN
    UPDATE public.products AS product
    SET current_stock = product.current_stock + old_items.quantity
    FROM (
      SELECT product_id, sum(quantity)::integer AS quantity
      FROM public.sale_items
      WHERE company_id = p_company_id AND sale_id = p_sale_id
      GROUP BY product_id
    ) AS old_items
    WHERE product.company_id = p_company_id AND product.id = old_items.product_id;
    DELETE FROM public.stock_movements
    WHERE company_id = p_company_id AND origin = 'sale' AND reference_id = p_sale_id;
    DELETE FROM public.sale_items WHERE company_id = p_company_id AND sale_id = p_sale_id;
    DELETE FROM public.sale_payments WHERE company_id = p_company_id AND sale_id = p_sale_id;
  ELSE
    INSERT INTO public.sales_counters (company_id, last_number)
    VALUES (p_company_id, 1)
    ON CONFLICT (company_id) DO UPDATE
      SET last_number = public.sales_counters.last_number + 1
    RETURNING last_number INTO v_sale_number;
    v_sale_id := gen_random_uuid();
    INSERT INTO public.sales (
      id, company_id, sale_number, cash_register_id, customer_id, seller_name,
      sold_at, created_by, updated_by
    )
    VALUES (
      v_sale_id, p_company_id, v_sale_number, v_cash_id, p_customer_id, btrim(p_seller_name),
      COALESCE(p_sold_at, now()), v_user_id, v_user_id
    );
  END IF;

  FOR v_item IN SELECT item.value FROM pg_catalog.jsonb_array_elements(p_items) AS item(value)
  LOOP
    IF NOT (v_item ? 'product_id') OR NOT (v_item ? 'quantity') OR NOT (v_item ? 'unit_price') THEN
      RAISE EXCEPTION 'invalid_sale_item' USING ERRCODE = '22023';
    END IF;
    v_item_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_unit_price := (v_item ->> 'unit_price')::numeric(12, 2);
    v_promotion_quantity := NULLIF(v_item ->> 'promotion_quantity', '')::integer;
    v_promotion_price := NULLIF(v_item ->> 'promotion_price', '')::numeric(12, 2);
    v_promotion_active := COALESCE((v_item ->> 'promotion_active')::boolean, false);
    v_discount_type := COALESCE(v_item ->> 'discount_type', 'amount');
    v_discount_value := COALESCE(NULLIF(v_item ->> 'discount_value', '')::numeric, 0);
    v_discount_reason := btrim(COALESCE(v_item ->> 'discount_reason', ''));

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 100000
       OR v_unit_price IS NULL OR v_unit_price < 0
       OR v_discount_type NOT IN ('amount', 'percent')
       OR v_discount_value < 0 OR (v_discount_type = 'percent' AND v_discount_value > 100)
       OR v_discount_value > 9999999999.99
       OR char_length(v_discount_reason) > 300 THEN
      RAISE EXCEPTION 'invalid_sale_item_values' USING ERRCODE = '22023';
    END IF;
    IF v_discount_value > 0 AND char_length(v_discount_reason) = 0 THEN
      RAISE EXCEPTION 'item_discount_reason_required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE company_id = p_company_id AND id = v_item_id;
    IF NOT FOUND OR (NOT v_product.active AND p_sale_id IS NULL) THEN
      RAISE EXCEPTION 'product_not_available' USING ERRCODE = '23503';
    END IF;
    IF v_promotion_quantity IS NOT NULL
       AND (v_promotion_quantity < 2 OR v_promotion_price IS NULL OR v_promotion_price < 0) THEN
      RAISE EXCEPTION 'invalid_product_promotion' USING ERRCODE = '22023';
    END IF;

    v_subtotal := round(v_quantity * v_unit_price, 2);
    v_promotion_discount := 0;
    IF v_promotion_active AND v_promotion_quantity IS NOT NULL
       AND v_quantity >= v_promotion_quantity THEN
      v_promotion_discount := round(
        pg_catalog.floor(v_quantity::numeric / v_promotion_quantity)
          * (v_promotion_quantity * v_unit_price - v_promotion_price),
        2
      );
      v_promotion_discount := greatest(0, v_promotion_discount);
    END IF;
    v_item_base := greatest(0, v_subtotal - v_promotion_discount);
    v_item_discount := CASE
      WHEN v_discount_type = 'percent' THEN round(v_item_base * v_discount_value / 100, 2)
      ELSE round(v_discount_value, 2)
    END;
    v_item_discount := least(v_item_base, v_item_discount);
    v_line_total := round(v_item_base - v_item_discount, 2);

    INSERT INTO public.sale_items (
      company_id, sale_id, product_id, product_name, product_code, category_name,
      quantity, unit_price, unit_cost, promotion_quantity, promotion_price,
      promotion_active, promotion_discount, discount_type, discount_value,
      discount_reason, subtotal, item_discount, total
    )
    SELECT p_company_id, v_sale_id, v_product.id, v_product.name, v_product.code,
      COALESCE(category.name, ''), v_quantity, v_unit_price, v_product.cost,
      v_promotion_quantity, v_promotion_price, v_promotion_active, v_promotion_discount,
      v_discount_type, v_discount_value, v_discount_reason, v_subtotal,
      v_item_discount, v_line_total
    FROM public.product_categories AS category
    WHERE category.company_id = p_company_id AND category.id = v_product.category_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_category_not_found' USING ERRCODE = '23503';
    END IF;

    v_subtotal_total := v_subtotal_total + v_subtotal;
    v_promotion_total := v_promotion_total + v_promotion_discount;
    v_item_discount_total := v_item_discount_total + v_item_discount;

    SELECT product.current_stock INTO v_available
    FROM public.products AS product
    WHERE product.company_id = p_company_id AND product.id = v_item_id;
    IF v_available < v_quantity AND NOT p_allow_negative_stock THEN
      RAISE EXCEPTION 'insufficient_stock:product=%,available=%,requested=%',
        v_product.name, v_available, v_quantity USING ERRCODE = '23514';
    END IF;
    UPDATE public.products
    SET current_stock = current_stock - v_quantity
    WHERE company_id = p_company_id AND id = v_item_id;
    INSERT INTO public.stock_movements (
      company_id, product_id, type, direction, quantity, unit_cost,
      occurred_at, observations, origin, reference_id, created_by
    )
    VALUES (
      p_company_id, v_item_id, 'Venda', -1, v_quantity, v_product.cost,
      COALESCE(p_sold_at, now()), 'Venda #' || v_sale_number, 'sale', v_sale_id, v_user_id
    );
  END LOOP;

  v_before_sale_discount := greatest(0, v_subtotal_total - v_promotion_total - v_item_discount_total);
  v_sale_discount := CASE
    WHEN p_sale_discount_type = 'percent'
      THEN round(v_before_sale_discount * p_sale_discount_value / 100, 2)
    ELSE round(p_sale_discount_value, 2)
  END;
  v_sale_discount := least(v_before_sale_discount, v_sale_discount);
  v_total_discount := round(v_promotion_total + v_item_discount_total + v_sale_discount, 2);
  v_total := round(v_before_sale_discount - v_sale_discount, 2);
  IF pg_catalog.jsonb_array_length(p_payments) = 0 AND v_total > 0 THEN
    RAISE EXCEPTION 'payment_required' USING ERRCODE = '22023';
  END IF;

  FOR v_payment IN
    SELECT item.value
    FROM pg_catalog.jsonb_array_elements(p_payments) WITH ORDINALITY AS item(value, position)
    ORDER BY item.position
  LOOP
    IF v_payment ->> 'method' NOT IN ('cash', 'pix', 'credit', 'debit', 'other')
       OR char_length(btrim(COALESCE(v_payment ->> 'label', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_payment_method' USING ERRCODE = '22023';
    END IF;
    v_payment_amount := (v_payment ->> 'amount')::numeric(12, 2);
    IF v_payment_amount IS NULL OR v_payment_amount < 0 THEN
      RAISE EXCEPTION 'invalid_payment_amount' USING ERRCODE = '22023';
    END IF;
    v_received := v_received + v_payment_amount;
    IF v_payment ->> 'method' <> 'cash' THEN
      v_non_cash := v_non_cash + v_payment_amount;
    END IF;
  END LOOP;
  v_received := round(v_received, 2);
  v_non_cash := round(v_non_cash, 2);
  IF v_received < v_total THEN
    RAISE EXCEPTION 'payment_incomplete:received=%,total=%', v_received, v_total USING ERRCODE = '22023';
  END IF;
  v_change := round(v_received - v_total, 2);
  IF v_non_cash > v_total OR v_non_cash + v_change > v_received THEN
    RAISE EXCEPTION 'change_must_be_paid_in_cash' USING ERRCODE = '22023';
  END IF;
  v_change_left := v_change;

  FOR v_payment IN
    SELECT item.value
    FROM pg_catalog.jsonb_array_elements(p_payments) WITH ORDINALITY AS item(value, position)
    ORDER BY item.position DESC
  LOOP
    v_payment_amount := (v_payment ->> 'amount')::numeric(12, 2);
    v_applied_amount := v_payment_amount;
    IF v_payment ->> 'method' = 'cash' AND v_change_left > 0 THEN
      v_applied_amount := greatest(0, v_payment_amount - least(v_payment_amount, v_change_left));
      v_change_left := greatest(0, v_change_left - v_payment_amount);
    END IF;
    IF v_applied_amount > 0 THEN
      INSERT INTO public.sale_payments (company_id, sale_id, payment_method, payment_label, amount)
      VALUES (
        p_company_id, v_sale_id, v_payment ->> 'method',
        btrim(v_payment ->> 'label'), round(v_applied_amount, 2)
      );
    END IF;
  END LOOP;

  UPDATE public.sales
  SET cash_register_id = v_cash_id,
      customer_id = p_customer_id,
      seller_name = btrim(p_seller_name),
      sold_at = COALESCE(p_sold_at, now()),
      subtotal = round(v_subtotal_total, 2),
      promotion_discount = round(v_promotion_total, 2),
      item_discount = round(v_item_discount_total, 2),
      sale_discount = v_sale_discount,
      total_discount = v_total_discount,
      total = v_total,
      received = v_received,
      change_due = v_change,
      sale_discount_type = p_sale_discount_type,
      sale_discount_value = p_sale_discount_value,
      sale_discount_reason = btrim(COALESCE(p_sale_discount_reason, '')),
      observations = btrim(COALESCE(p_observations, '')),
      updated_at = now(),
      updated_by = v_user_id
  WHERE company_id = p_company_id AND id = v_sale_id;
  IF v_cash.status = 'closed' THEN
    PERFORM public.refresh_closed_cash_register(p_company_id, v_cash_id);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total,
    'received', v_received, 'change_due', v_change
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_sale(
  p_company_id uuid,
  p_sale_id uuid,
  p_reason text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_cash_id uuid;
  v_item record;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;
  IF char_length(COALESCE(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'cancellation_reason_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT cash_register_id INTO v_cash_id
  FROM public.sales
  WHERE company_id = p_company_id AND id = p_sale_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.cash_registers
  WHERE company_id = p_company_id AND id = v_cash_id
  FOR UPDATE;
  SELECT * INTO v_sale
  FROM public.sales
  WHERE company_id = p_company_id AND id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND OR v_sale.status <> 'active' OR v_sale.cash_register_id <> v_cash_id THEN
    RAISE EXCEPTION 'active_sale_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM product.id
  FROM public.products AS product
  JOIN (
    SELECT DISTINCT product_id FROM public.sale_items
    WHERE company_id = p_company_id AND sale_id = p_sale_id
  ) AS items ON items.product_id = product.id
  WHERE product.company_id = p_company_id
  ORDER BY product.id
  FOR UPDATE OF product;

  FOR v_item IN
    SELECT product_id, sum(quantity)::integer AS quantity
    FROM public.sale_items
    WHERE company_id = p_company_id AND sale_id = p_sale_id
    GROUP BY product_id
  LOOP
    UPDATE public.products
    SET current_stock = current_stock + v_item.quantity
    WHERE company_id = p_company_id AND id = v_item.product_id;
    INSERT INTO public.stock_movements (
      company_id, product_id, type, direction, quantity, occurred_at,
      observations, origin, reference_id, created_by
    )
    VALUES (
      p_company_id, v_item.product_id, 'Cancelamento de venda', 1,
      v_item.quantity, now(), 'Cancelamento da venda #' || v_sale.sale_number,
      'sale', p_sale_id, auth.uid()
    );
  END LOOP;

  UPDATE public.sales
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = btrim(COALESCE(p_reason, '')),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE company_id = p_company_id AND id = p_sale_id;
  PERFORM public.refresh_closed_cash_register(p_company_id, v_cash_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reactivate_sale(
  p_company_id uuid,
  p_sale_id uuid,
  p_allow_negative_stock boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_cash_id uuid;
  v_item record;
  v_available integer;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_allow_negative_stock
     AND NOT public.has_company_role(p_company_id, ARRAY['owner', 'manager']::text[]) THEN
    RAISE EXCEPTION 'manager_role_required_for_negative_stock' USING ERRCODE = '42501';
  END IF;

  SELECT cash_register_id INTO v_cash_id
  FROM public.sales
  WHERE company_id = p_company_id AND id = p_sale_id AND status = 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancelled_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.cash_registers
  WHERE company_id = p_company_id AND id = v_cash_id
  FOR UPDATE;
  SELECT * INTO v_sale
  FROM public.sales
  WHERE company_id = p_company_id AND id = p_sale_id
  FOR UPDATE;
  IF NOT FOUND OR v_sale.status <> 'cancelled' OR v_sale.cash_register_id <> v_cash_id THEN
    RAISE EXCEPTION 'cancelled_sale_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM product.id
  FROM public.products AS product
  JOIN (
    SELECT DISTINCT product_id FROM public.sale_items
    WHERE company_id = p_company_id AND sale_id = p_sale_id
  ) AS items ON items.product_id = product.id
  WHERE product.company_id = p_company_id
  ORDER BY product.id
  FOR UPDATE OF product;

  FOR v_item IN
    SELECT product_id, sum(quantity)::integer AS quantity
    FROM public.sale_items
    WHERE company_id = p_company_id AND sale_id = p_sale_id
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    SELECT current_stock INTO v_available
    FROM public.products
    WHERE company_id = p_company_id AND id = v_item.product_id;
    IF v_available < v_item.quantity AND NOT p_allow_negative_stock THEN
      RAISE EXCEPTION 'insufficient_stock:product=%,available=%,requested=%',
        v_item.product_id, v_available, v_item.quantity USING ERRCODE = '23514';
    END IF;
    UPDATE public.products
    SET current_stock = current_stock - v_item.quantity
    WHERE company_id = p_company_id AND id = v_item.product_id;
    INSERT INTO public.stock_movements (
      company_id, product_id, type, direction, quantity, unit_cost,
      occurred_at, observations, origin, reference_id, created_by
    )
    SELECT p_company_id, product.id, 'Reativação de venda', -1,
      v_item.quantity, product.cost, now(),
      'Reativação da venda #' || v_sale.sale_number, 'sale', p_sale_id, auth.uid()
    FROM public.products AS product
    WHERE product.company_id = p_company_id AND product.id = v_item.product_id;
  END LOOP;

  UPDATE public.sales
  SET status = 'active',
      cancelled_at = NULL,
      cancelled_by = NULL,
      cancellation_reason = '',
      updated_at = now(),
      updated_by = auth.uid()
  WHERE company_id = p_company_id AND id = p_sale_id;
  PERFORM public.refresh_closed_cash_register(p_company_id, v_cash_id);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_sales_counter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_cash_register(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_register(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_closed_cash_register(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_sale(uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, numeric, text, text, timestamptz, boolean)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reactivate_sale(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_sale(uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, numeric, text, text, timestamptz, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_sale(uuid, uuid, boolean) TO authenticated;
