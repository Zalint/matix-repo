--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: fn_apply_stock_movement(); Type: FUNCTION; Schema: public; Owner: matix_admin
--

CREATE FUNCTION public.fn_apply_stock_movement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO stock_levels (tenant_id, product_id, point_of_sale_id, quantity_on_hand)
  VALUES (NEW.tenant_id, NEW.product_id, NEW.point_of_sale_id, NEW.quantity)
  ON CONFLICT (tenant_id, product_id, point_of_sale_id) DO UPDATE
    SET quantity_on_hand = stock_levels.quantity_on_hand + NEW.quantity,
        updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_apply_stock_movement() OWNER TO matix_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public._migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public._migrations OWNER TO matix_admin;

--
-- Name: customers; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    display_name text NOT NULL,
    email text,
    phone text,
    address text,
    segment text,
    credit_limit numeric(14,2) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT customers_credit_limit_check CHECK ((credit_limit >= (0)::numeric))
);

ALTER TABLE ONLY public.customers FORCE ROW LEVEL SECURITY;


ALTER TABLE public.customers OWNER TO matix_admin;

--
-- Name: document_sequences; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.document_sequences (
    tenant_id uuid NOT NULL,
    sequence_type text NOT NULL,
    current_value bigint DEFAULT 0 NOT NULL,
    CONSTRAINT document_sequences_current_value_check CHECK ((current_value >= 0))
);

ALTER TABLE ONLY public.document_sequences FORCE ROW LEVEL SECURITY;


ALTER TABLE public.document_sequences OWNER TO matix_admin;

--
-- Name: plans; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    monthly_price_xof bigint DEFAULT 0 NOT NULL,
    modules text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plans_monthly_price_xof_check CHECK ((monthly_price_xof >= 0))
);


ALTER TABLE public.plans OWNER TO matix_admin;

--
-- Name: points_of_sale; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.points_of_sale (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.points_of_sale FORCE ROW LEVEL SECURITY;


ALTER TABLE public.points_of_sale OWNER TO matix_admin;

--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    family text,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.product_categories FORCE ROW LEVEL SECURITY;


ALTER TABLE public.product_categories OWNER TO matix_admin;

--
-- Name: products; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    category_id uuid,
    CONSTRAINT products_unit_price_check CHECK ((unit_price >= (0)::numeric))
);

ALTER TABLE ONLY public.products FORCE ROW LEVEL SECURITY;


ALTER TABLE public.products OWNER TO matix_admin;

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.role_permissions (
    tenant_id uuid NOT NULL,
    role text NOT NULL,
    module_code text NOT NULL,
    actions text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_permissions_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'superviseur'::text, 'member'::text, 'readonly'::text])))
);

ALTER TABLE ONLY public.role_permissions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.role_permissions OWNER TO matix_admin;

--
-- Name: sale_items; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    discount_amount numeric(14,2) DEFAULT 0 NOT NULL,
    tax_rate numeric(5,4) DEFAULT 0 NOT NULL,
    tax_amount numeric(14,2) DEFAULT 0 NOT NULL,
    line_total numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sale_items_discount_amount_check CHECK ((discount_amount >= (0)::numeric)),
    CONSTRAINT sale_items_line_total_check CHECK ((line_total >= (0)::numeric)),
    CONSTRAINT sale_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT sale_items_tax_amount_check CHECK ((tax_amount >= (0)::numeric)),
    CONSTRAINT sale_items_tax_rate_check CHECK (((tax_rate >= (0)::numeric) AND (tax_rate < (1)::numeric))),
    CONSTRAINT sale_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
);

ALTER TABLE ONLY public.sale_items FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sale_items OWNER TO matix_admin;

--
-- Name: sale_payments; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.sale_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    method text NOT NULL,
    amount numeric(14,2) NOT NULL,
    reference text,
    status text DEFAULT 'succeeded'::text NOT NULL,
    received_at timestamp with time zone,
    received_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sale_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT sale_payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'wave'::text, 'orange_money'::text, 'mtn_momo'::text, 'card'::text, 'credit'::text]))),
    CONSTRAINT sale_payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refunded'::text])))
);

ALTER TABLE ONLY public.sale_payments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sale_payments OWNER TO matix_admin;

--
-- Name: sales; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    point_of_sale_id uuid NOT NULL,
    customer_id uuid,
    user_id uuid NOT NULL,
    status text NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    tax_total numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    paid_total numeric(14,2) DEFAULT 0 NOT NULL,
    change_given numeric(14,2) DEFAULT 0 NOT NULL,
    reference_number text,
    notes text,
    posted_at timestamp with time zone,
    voided_at timestamp with time zone,
    voided_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT sales_change_given_check CHECK ((change_given >= (0)::numeric)),
    CONSTRAINT sales_paid_total_check CHECK ((paid_total >= (0)::numeric)),
    CONSTRAINT sales_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'voided'::text]))),
    CONSTRAINT sales_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT sales_tax_total_check CHECK ((tax_total >= (0)::numeric)),
    CONSTRAINT sales_total_check CHECK ((total >= (0)::numeric))
);

ALTER TABLE ONLY public.sales FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sales OWNER TO matix_admin;

--
-- Name: stock_levels; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.stock_levels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    point_of_sale_id uuid NOT NULL,
    quantity_on_hand numeric(14,3) DEFAULT 0 NOT NULL,
    quantity_reserved numeric(14,3) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_levels_quantity_reserved_check CHECK ((quantity_reserved >= (0)::numeric))
);

ALTER TABLE ONLY public.stock_levels FORCE ROW LEVEL SECURITY;


ALTER TABLE public.stock_levels OWNER TO matix_admin;

--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    point_of_sale_id uuid NOT NULL,
    movement_type text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_cost numeric(14,2),
    reference_table text,
    reference_id uuid,
    reason text,
    performed_by uuid,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['opening'::text, 'sale'::text, 'return'::text, 'adjustment'::text, 'transfer_in'::text, 'transfer_out'::text, 'closing'::text]))),
    CONSTRAINT stock_movements_quantity_check CHECK ((quantity <> (0)::numeric))
);

ALTER TABLE ONLY public.stock_movements FORCE ROW LEVEL SECURITY;


ALTER TABLE public.stock_movements OWNER TO matix_admin;

--
-- Name: tenant_licenses; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.tenant_licenses (
    tenant_id uuid NOT NULL,
    module_code text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    source text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_licenses_source_check CHECK ((source = ANY (ARRAY['plan'::text, 'addon'::text, 'manual'::text])))
);

ALTER TABLE ONLY public.tenant_licenses FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tenant_licenses OWNER TO matix_admin;

--
-- Name: tenant_members; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.tenant_members (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deactivated_at timestamp with time zone,
    CONSTRAINT tenant_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'superviseur'::text, 'member'::text, 'readonly'::text])))
);


ALTER TABLE public.tenant_members OWNER TO matix_admin;

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: matix_admin
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    legal_name text NOT NULL,
    status text NOT NULL,
    country_code character(2) DEFAULT 'SN'::bpchar NOT NULL,
    currency character(3) DEFAULT 'XOF'::bpchar NOT NULL,
    locale text DEFAULT 'fr'::text NOT NULL,
    ninea text,
    rc text,
    trial_ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    plan_id uuid,
    CONSTRAINT tenants_status_check CHECK ((status = ANY (ARRAY['trial'::text, 'active'::text, 'suspended'::text, 'churned'::text])))
);


ALTER TABLE public.tenants OWNER TO matix_admin;

--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (name);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: document_sequences document_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (tenant_id, sequence_type);


--
-- Name: plans plans_code_key; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_code_key UNIQUE (code);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: points_of_sale points_of_sale_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.points_of_sale
    ADD CONSTRAINT points_of_sale_pkey PRIMARY KEY (id);


--
-- Name: points_of_sale points_of_sale_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.points_of_sale
    ADD CONSTRAINT points_of_sale_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_tenant_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_sku_key UNIQUE (tenant_id, sku);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (tenant_id, role, module_code);


--
-- Name: sale_items sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id);


--
-- Name: sale_payments sale_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sale_payments
    ADD CONSTRAINT sale_payments_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: stock_levels stock_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_levels
    ADD CONSTRAINT stock_levels_pkey PRIMARY KEY (id);


--
-- Name: stock_levels stock_levels_tenant_id_product_id_point_of_sale_id_key; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_levels
    ADD CONSTRAINT stock_levels_tenant_id_product_id_point_of_sale_id_key UNIQUE (tenant_id, product_id, point_of_sale_id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: tenant_licenses tenant_licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.tenant_licenses
    ADD CONSTRAINT tenant_licenses_pkey PRIMARY KEY (tenant_id, module_code);


--
-- Name: tenant_members tenant_members_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (tenant_id, user_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_customers_phone ON public.customers USING btree (tenant_id, phone) WHERE ((phone IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_customers_tenant; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_customers_tenant ON public.customers USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_points_of_sale_active; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_points_of_sale_active ON public.points_of_sale USING btree (tenant_id, is_active) WHERE (deleted_at IS NULL);


--
-- Name: idx_points_of_sale_tenant; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_points_of_sale_tenant ON public.points_of_sale USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_product_categories_tenant; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_product_categories_tenant ON public.product_categories USING btree (tenant_id, family, display_order) WHERE (deleted_at IS NULL);


--
-- Name: idx_products_tenant; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_products_tenant ON public.products USING btree (tenant_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_products_tenant_category; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_products_tenant_category ON public.products USING btree (tenant_id, category_id) WHERE ((deleted_at IS NULL) AND (category_id IS NOT NULL));


--
-- Name: idx_sale_items_tenant_product; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_sale_items_tenant_product ON public.sale_items USING btree (tenant_id, product_id);


--
-- Name: idx_sale_items_tenant_sale; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_sale_items_tenant_sale ON public.sale_items USING btree (tenant_id, sale_id);


--
-- Name: idx_sale_payments_tenant_method; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_sale_payments_tenant_method ON public.sale_payments USING btree (tenant_id, method, created_at DESC);


--
-- Name: idx_sale_payments_tenant_sale; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_sale_payments_tenant_sale ON public.sale_payments USING btree (tenant_id, sale_id);


--
-- Name: idx_sales_ref_unique; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE UNIQUE INDEX idx_sales_ref_unique ON public.sales USING btree (tenant_id, reference_number) WHERE (reference_number IS NOT NULL);


--
-- Name: idx_sales_tenant_customer; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_sales_tenant_customer ON public.sales USING btree (tenant_id, customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_sales_tenant_pos; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_sales_tenant_pos ON public.sales USING btree (tenant_id, point_of_sale_id, posted_at DESC) WHERE (posted_at IS NOT NULL);


--
-- Name: idx_sales_tenant_status; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_sales_tenant_status ON public.sales USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_stock_levels_tenant_pos; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_stock_levels_tenant_pos ON public.stock_levels USING btree (tenant_id, point_of_sale_id);


--
-- Name: idx_stock_levels_tenant_product; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_stock_levels_tenant_product ON public.stock_levels USING btree (tenant_id, product_id);


--
-- Name: idx_stock_movements_ref; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_stock_movements_ref ON public.stock_movements USING btree (tenant_id, reference_table, reference_id) WHERE (reference_table IS NOT NULL);


--
-- Name: idx_stock_movements_tenant_pos; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_stock_movements_tenant_pos ON public.stock_movements USING btree (tenant_id, point_of_sale_id, performed_at DESC);


--
-- Name: idx_stock_movements_tenant_product; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_stock_movements_tenant_product ON public.stock_movements USING btree (tenant_id, product_id, performed_at DESC);


--
-- Name: idx_tenant_licenses_enabled; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_tenant_licenses_enabled ON public.tenant_licenses USING btree (tenant_id, module_code) WHERE (enabled = true);


--
-- Name: idx_tenant_members_active; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_tenant_members_active ON public.tenant_members USING btree (tenant_id, user_id) WHERE (deactivated_at IS NULL);


--
-- Name: idx_tenant_members_user; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_tenant_members_user ON public.tenant_members USING btree (user_id);


--
-- Name: idx_tenants_plan; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_tenants_plan ON public.tenants USING btree (plan_id);


--
-- Name: idx_tenants_status; Type: INDEX; Schema: public; Owner: matix_admin
--

CREATE INDEX idx_tenants_status ON public.tenants USING btree (status) WHERE (deleted_at IS NULL);


--
-- Name: stock_movements trg_stock_movements_apply; Type: TRIGGER; Schema: public; Owner: matix_admin
--

CREATE TRIGGER trg_stock_movements_apply AFTER INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.fn_apply_stock_movement();


--
-- Name: customers customers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: document_sequences document_sequences_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: points_of_sale points_of_sale_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.points_of_sale
    ADD CONSTRAINT points_of_sale_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: product_categories product_categories_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id);


--
-- Name: products products_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: role_permissions role_permissions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sale_items sale_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: sale_items sale_items_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;


--
-- Name: sale_items sale_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sale_items
    ADD CONSTRAINT sale_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: sale_payments sale_payments_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sale_payments
    ADD CONSTRAINT sale_payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;


--
-- Name: sale_payments sale_payments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sale_payments
    ADD CONSTRAINT sale_payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: sales sales_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: sales sales_point_of_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_point_of_sale_id_fkey FOREIGN KEY (point_of_sale_id) REFERENCES public.points_of_sale(id);


--
-- Name: sales sales_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: stock_levels stock_levels_point_of_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_levels
    ADD CONSTRAINT stock_levels_point_of_sale_id_fkey FOREIGN KEY (point_of_sale_id) REFERENCES public.points_of_sale(id);


--
-- Name: stock_levels stock_levels_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_levels
    ADD CONSTRAINT stock_levels_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: stock_levels stock_levels_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_levels
    ADD CONSTRAINT stock_levels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: stock_movements stock_movements_point_of_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_point_of_sale_id_fkey FOREIGN KEY (point_of_sale_id) REFERENCES public.points_of_sale(id);


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: stock_movements stock_movements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tenant_licenses tenant_licenses_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.tenant_licenses
    ADD CONSTRAINT tenant_licenses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_members tenant_members_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenants tenants_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: matix_admin
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id);


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: document_sequences; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: points_of_sale; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.points_of_sale ENABLE ROW LEVEL SECURITY;

--
-- Name: product_categories; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_items; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

--
-- Name: sale_payments; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: sales; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_levels; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: customers tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.customers USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: document_sequences tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.document_sequences USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: points_of_sale tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.points_of_sale USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: product_categories tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.product_categories USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: products tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.products USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: role_permissions tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.role_permissions USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: sale_items tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.sale_items USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: sale_payments tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.sale_payments USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: sales tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.sales USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: stock_levels tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.stock_levels USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: stock_movements tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.stock_movements USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: tenant_licenses tenant_isolation; Type: POLICY; Schema: public; Owner: matix_admin
--

CREATE POLICY tenant_isolation ON public.tenant_licenses USING ((tenant_id = (current_setting('app.tenant_id'::text))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.tenant_id'::text))::uuid));


--
-- Name: tenant_licenses; Type: ROW SECURITY; Schema: public; Owner: matix_admin
--

ALTER TABLE public.tenant_licenses ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO matix_app;


--
-- Name: TABLE _migrations; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public._migrations TO matix_app;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customers TO matix_app;


--
-- Name: TABLE document_sequences; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.document_sequences TO matix_app;


--
-- Name: TABLE plans; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.plans TO matix_app;


--
-- Name: TABLE points_of_sale; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.points_of_sale TO matix_app;


--
-- Name: TABLE product_categories; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.product_categories TO matix_app;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.products TO matix_app;


--
-- Name: TABLE role_permissions; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_permissions TO matix_app;


--
-- Name: TABLE sale_items; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sale_items TO matix_app;


--
-- Name: TABLE sale_payments; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sale_payments TO matix_app;


--
-- Name: TABLE sales; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sales TO matix_app;


--
-- Name: TABLE stock_levels; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_levels TO matix_app;


--
-- Name: TABLE stock_movements; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.stock_movements TO matix_app;


--
-- Name: TABLE tenant_licenses; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_licenses TO matix_app;


--
-- Name: TABLE tenant_members; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_members TO matix_app;


--
-- Name: TABLE tenants; Type: ACL; Schema: public; Owner: matix_admin
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenants TO matix_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: matix_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE matix_admin IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO matix_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: matix_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE matix_admin IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO matix_app;


--
-- PostgreSQL database dump complete
--

