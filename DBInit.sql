-- ============================================================
-- SETUP — run once in the Supabase SQL Editor
-- Covers: Trade Master journal table + Meditate storage policies
-- ============================================================

-- ---------- 1. TRADE JOURNAL (Trade Master) ----------
create table if not exists public.trade_journal (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  symbol      text not null,
  side        text not null check (side in ('buy','sell')),
  lot         numeric not null check (lot > 0),
  entry_price numeric,
  sl          numeric not null,
  tp          numeric not null,
  reason      text not null check (char_length(reason) >= 10),
  status      text not null default 'sent',
  created_at  timestamptz not null default now()
);

create index if not exists trade_journal_user_created
  on public.trade_journal (user_id, created_at desc);

alter table public.trade_journal enable row level security;

drop policy if exists "journal owner select" on public.trade_journal;
create policy "journal owner select" on public.trade_journal
  for select using (auth.uid() = user_id);

drop policy if exists "journal owner insert" on public.trade_journal;
create policy "journal owner insert" on public.trade_journal
  for insert with check (auth.uid() = user_id);

-- journal is append-only: no update/delete policies on purpose.
-- (nobody edits history on this desk.)

-- ---------- 2. MEDITATE AUDIO BUCKET ----------
-- Create a PRIVATE bucket named meditate_audio (Storage > New bucket,
-- public = OFF), then run these policies. Files live under
-- <user_id>/<filename>, so each user only touches their own folder.

drop policy if exists "meditate owner read" on storage.objects;
create policy "meditate owner read" on storage.objects
  for select using (
    bucket_id = 'meditate_audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "meditate owner insert" on storage.objects;
create policy "meditate owner insert" on storage.objects
  for insert with check (
    bucket_id = 'meditate_audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "meditate owner delete" on storage.objects;
create policy "meditate owner delete" on storage.objects
  for delete using (
    bucket_id = 'meditate_audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );


-- =============================================================
-- Gembel App - Schema only (no data), with functions, triggers,
-- and Row Level Security policies
-- Rebuilt from gembelsql_v20260707-e26d6ca.sql
-- =============================================================

-- -------------------------------------------------------------
-- 1. TABLES
-- -------------------------------------------------------------

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    plan_until timestamp with time zone,
    phone text,
    wallet_type text DEFAULT 'nothing'::text NOT NULL,
    wallet_number text,
    bio text,
    CONSTRAINT profiles_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'elite'::text]))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text]))),
    CONSTRAINT profiles_wallet_type_check CHECK ((wallet_type = ANY (ARRAY['nothing'::text, 'gopay'::text, 'btc'::text])))
);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

-- profiles.id references auth.users(id) in the original Supabase project.
-- Uncomment if this table lives in a Supabase project with the auth schema:
-- ALTER TABLE ONLY public.profiles
--     ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


CREATE TABLE public.app_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text,
    prompt text NOT NULL,
    status text DEFAULT 'antre'::text NOT NULL,
    app_url text,
    apk_url text,
    admin_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT app_requests_status_check CHECK ((status = ANY (ARRAY['antre'::text, 'diproses'::text, 'selesai'::text])))
);

ALTER TABLE ONLY public.app_requests
    ADD CONSTRAINT app_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.app_requests
    ADD CONSTRAINT app_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


CREATE TABLE public.payment_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount integer DEFAULT 19999 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT payment_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])))
);

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


CREATE TABLE public.user_calendar_data (
    user_id uuid NOT NULL,
    goals jsonb DEFAULT '[]'::jsonb NOT NULL,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    theme text DEFAULT 'light'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_calendar_data
    ADD CONSTRAINT user_calendar_data_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.user_calendar_data
    ADD CONSTRAINT user_calendar_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


CREATE TABLE public.user_progbar_data (
    user_id uuid NOT NULL,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    current_state jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_progbar_data
    ADD CONSTRAINT user_progbar_data_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.user_progbar_data
    ADD CONSTRAINT user_progbar_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


-- -------------------------------------------------------------
-- 2. FUNCTIONS
-- -------------------------------------------------------------

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), 'user')
  on conflict (id) do nothing;
  return new;
end; $$;

CREATE FUNCTION public.apply_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.status = 'confirmed' and (old.status is distinct from 'confirmed') then
    new.confirmed_at = now();
    update public.profiles
      set plan = 'elite',
          plan_until = greatest(coalesce(plan_until, now()), now()) + interval '30 days'
      where id = new.user_id;
  end if;
  return new;
end; $$;

CREATE FUNCTION public.set_request_expiry() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare uplan text;
begin
  if new.status = 'selesai' and (old.status is distinct from 'selesai') then
    select plan into uplan from public.profiles where id = new.user_id;
    if coalesce(uplan, 'free') = 'free' then
      new.expires_at = now() + interval '3 hours';
    else
      new.expires_at = null;
    end if;
  end if;
  return new;
end; $$;

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin new.updated_at = now(); return new; end;
$$;


-- -------------------------------------------------------------
-- 3. TRIGGERS
-- -------------------------------------------------------------

-- Auto-create a profile row whenever a new auth user signs up.
-- Requires the Supabase auth schema; omit if not using Supabase auth.
-- CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--     FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_apply_payment BEFORE UPDATE ON public.payment_requests
    FOR EACH ROW EXECUTE FUNCTION public.apply_payment();

CREATE TRIGGER trg_caldata_touch BEFORE UPDATE ON public.user_calendar_data
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_progbar_touch BEFORE UPDATE ON public.user_progbar_data
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_request_expiry BEFORE UPDATE ON public.app_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_request_expiry();

CREATE TRIGGER trg_requests_touch BEFORE UPDATE ON public.app_requests
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- -------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_calendar_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progbar_data ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT USING ((auth.uid() = id));

CREATE POLICY profiles_select_admin ON public.profiles
    FOR SELECT USING (public.is_admin());

CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE USING ((auth.uid() = id))
    WITH CHECK (
        (auth.uid() = id)
        AND (role = ( SELECT profiles_1.role FROM public.profiles profiles_1 WHERE (profiles_1.id = auth.uid()) ))
        AND (plan = ( SELECT profiles_1.plan FROM public.profiles profiles_1 WHERE (profiles_1.id = auth.uid()) ))
        AND (NOT (plan_until IS DISTINCT FROM ( SELECT profiles_1.plan_until FROM public.profiles profiles_1 WHERE (profiles_1.id = auth.uid()) )))
    );

CREATE POLICY profiles_update_admin ON public.profiles
    FOR UPDATE USING (public.is_admin());

-- app_requests
CREATE POLICY requests_select_own ON public.app_requests
    FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY requests_select_admin ON public.app_requests
    FOR SELECT USING (public.is_admin());

CREATE POLICY requests_insert_own ON public.app_requests
    FOR INSERT WITH CHECK ((auth.uid() = user_id));

CREATE POLICY requests_update_admin ON public.app_requests
    FOR UPDATE USING (public.is_admin());

-- payment_requests
CREATE POLICY pay_select_own ON public.payment_requests
    FOR SELECT USING ((auth.uid() = user_id));

CREATE POLICY pay_select_admin ON public.payment_requests
    FOR SELECT USING (public.is_admin());

CREATE POLICY pay_insert_own ON public.payment_requests
    FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (status = 'pending'::text)));

CREATE POLICY pay_update_admin ON public.payment_requests
    FOR UPDATE USING (public.is_admin());

-- user_calendar_data
CREATE POLICY caldata_all_own ON public.user_calendar_data
    USING ((auth.uid() = user_id))
    WITH CHECK ((auth.uid() = user_id));

CREATE POLICY caldata_select_admin ON public.user_calendar_data
    FOR SELECT USING (public.is_admin());

-- user_progbar_data
CREATE POLICY progbar_all_own ON public.user_progbar_data
    USING ((auth.uid() = user_id))
    WITH CHECK ((auth.uid() = user_id));

CREATE POLICY progbar_select_admin ON public.user_progbar_data
    FOR SELECT USING (public.is_admin());