/********************************************************************
 * ROOM SCOUT DATABASE SCHEMA v2 (Separated Roles & Capstone 42 Features)
 ********************************************************************/

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- DROP EXISTING TABLES TO AVOID 'create table if not exists' ISSUES WITH NEW COLUMNS
drop table if exists public.rental_requests cascade;
drop table if exists public.rentals cascade;
drop table if exists public.dorm_reviews cascade;
drop table if exists public.notifications cascade;
drop table if exists public.support_tickets cascade;
drop table if exists public.owner_verifications cascade;
drop table if exists public.system_logs cascade;
drop table if exists public.dorms cascade;
drop table if exists public.profiles cascade;
drop table if exists public.renters cascade;
drop table if exists public.owners cascade;
drop table if exists public.admins cascade;

/********************************************************************
 * 2. ROLE TABLES (Replaces unified profiles table)
 ********************************************************************/

-- RENTERS
create table if not exists public.renters (
    renter_id uuid references auth.users(id) on delete cascade not null primary key,
    updated_at timestamp with time zone,
    username text unique,
    full_name text,
    avatar_url text,
    website text,
    behavior_preferences jsonb default '{}'::jsonb,
    status text default 'active' check (status in ('active', 'inactive'))
);
alter table public.renters enable row level security;
create policy "Renters are viewable by everyone" on public.renters for select using ( true );
create policy "Users can insert their own renter profile" on public.renters for insert with check (auth.uid() = renter_id);
create policy "Users can update own renter profile" on public.renters for update using (auth.uid() = renter_id);

-- OWNERS
create table if not exists public.owners (
    owner_id uuid references auth.users(id) on delete cascade not null primary key,
    updated_at timestamp with time zone,
    username text unique,
    full_name text,
    avatar_url text,
    website text,
    status text default 'active' check (status in ('active', 'inactive'))
);
alter table public.owners enable row level security;
create policy "Owners are viewable by everyone" on public.owners for select using ( true );
create policy "Users can insert their own owner profile" on public.owners for insert with check (auth.uid() = owner_id);
create policy "Users can update own owner profile" on public.owners for update using (auth.uid() = owner_id);

-- ADMINS
create table if not exists public.admins (
    admin_id uuid references auth.users(id) on delete cascade not null primary key,
    updated_at timestamp with time zone,
    username text unique,
    full_name text,
    avatar_url text,
    website text
);
alter table public.admins enable row level security;
create policy "Admins are viewable by everyone" on public.admins for select using ( true );
create policy "Users can insert their own admin profile" on public.admins for insert with check (auth.uid() = admin_id);
create policy "Users can update own admin profile" on public.admins for update using (auth.uid() = admin_id);

-- Trigger to automatically create profile on user signup based on role in metadata
create or replace function public.handle_new_user()
returns trigger as $$
declare
    user_role text;
    user_name text;
    full_name_val text;
begin
    user_role := COALESCE(new.raw_user_metadata->>'role', 'renter');
    user_name := NULLIF(trim(new.raw_user_metadata->>'username'), '');
    full_name_val := NULLIF(trim(new.raw_user_metadata->>'full_name'), '');

    if user_role = 'admin' then
        insert into public.admins (admin_id, username, full_name, updated_at)
        values (new.id, user_name, full_name_val, now())
        on conflict (admin_id) do update set
            username = COALESCE(EXCLUDED.username, public.admins.username),
            full_name = COALESCE(EXCLUDED.full_name, public.admins.full_name),
            updated_at = now();
    elsif user_role = 'owner' then
        insert into public.owners (owner_id, username, full_name, updated_at)
        values (new.id, user_name, full_name_val, now())
        on conflict (owner_id) do update set
            username = COALESCE(EXCLUDED.username, public.owners.username),
            full_name = COALESCE(EXCLUDED.full_name, public.owners.full_name),
            updated_at = now();
    else
        -- default to renter
        insert into public.renters (renter_id, username, full_name, updated_at)
        values (new.id, user_name, full_name_val, now())
        on conflict (renter_id) do update set
            username = COALESCE(EXCLUDED.username, public.renters.username),
            full_name = COALESCE(EXCLUDED.full_name, public.renters.full_name),
            updated_at = now();
    end if;
    return new;
exception
    when others then
        return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute procedure public.handle_new_user();


/********************************************************************
 * 3. DORMS – the main listings
 ********************************************************************/
create table if not exists public.dorms (
    dorm_id uuid default uuid_generate_v4() primary key,
    name text not null,
    description text,
    address text not null,
    price decimal(10,2) not null,
    latitude double precision not null,
    longitude double precision not null,
    utilities text[] default '{}',
    amenities text[] default '{}',
    gender_policy text not null,
    curfew text,
    available boolean default true,
    images text[] default '{}',
    is_featured boolean default false,
    owner_id uuid references public.owners(owner_id) not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    
    -- Capstone 42 Additions
    status text default 'active' check (status in ('active', 'inactive')),
    parking_info text,
    pet_friendly boolean default false,
    lgu_certified boolean default false,
    payment_methods text[] default '{}',
    gcash_qr_url text,
    contract_rules text,
    demand_score numeric default 0
);

alter table public.dorms enable row level security;

create policy "Anyone can view available dorms" on public.dorms for select using ( available = true and status = 'active' );
create policy "Owners can view their own dorms" on public.dorms for select using ( auth.uid() = owner_id );
create policy "Owners can insert their own dorms" on public.dorms for insert with check ( auth.uid() = owner_id );
create policy "Owners can update own dorms" on public.dorms for update using ( auth.uid() = owner_id );
create policy "Owners can delete own dorms" on public.dorms for delete using ( auth.uid() = owner_id );

/********************************************************************
 * 4. RENTAL REQUESTS (With Payment & ID Upload)
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.rental_requests (
    request_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    dorm_id uuid NOT NULL REFERENCES public.dorms(dorm_id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.renters(renter_id) ON DELETE CASCADE,
    owner_id uuid NOT NULL REFERENCES public.owners(owner_id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending'::text,
    message text,
    
    -- Capstone 42 additions:
    renter_gov_id_url text,
    payment_proof_url text,
    contract_agreed boolean default false,
    
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rental_requests_pkey PRIMARY KEY (request_id)
);

ALTER TABLE public.rental_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rental requests"
    ON public.rental_requests FOR SELECT
    USING (auth.uid() = user_id OR auth.uid() = owner_id);

CREATE POLICY "Users can insert their own rental requests"
    ON public.rental_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rental requests"
    ON public.rental_requests FOR UPDATE
    USING (auth.uid() = user_id OR auth.uid() = owner_id);


/********************************************************************
 * 5. DORM REVIEWS
 ********************************************************************/
create table if not exists public.dorm_reviews (
    review_id uuid default uuid_generate_v4() primary key,
    dorm_id uuid references public.dorms(dorm_id) on delete cascade not null,
    user_id uuid references public.renters(renter_id) not null,
    rating integer not null check (rating >= 1 and rating <= 5),
    comment text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.dorm_reviews enable row level security;
create policy "Anyone can read dorm reviews" on public.dorm_reviews for select using ( true );
create policy "Users can insert their own dorm review" on public.dorm_reviews for insert with check ( auth.uid() = user_id );
create policy "Users can update own dorm review" on public.dorm_reviews for update using ( auth.uid() = user_id );
create policy "Users can delete own dorm review" on public.dorm_reviews for delete using ( auth.uid() = user_id );


/********************************************************************
 * 6. OWNER VERIFICATIONS 
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.owner_verifications (
    verification_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL UNIQUE REFERENCES public.owners(owner_id) ON DELETE CASCADE,
    document_url text,
    status text NOT NULL DEFAULT 'pending'::text CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by uuid REFERENCES public.admins(admin_id) ON DELETE SET NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT owner_verifications_pkey PRIMARY KEY (verification_id)
);
ALTER TABLE public.owner_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own verification requests" ON public.owner_verifications;
CREATE POLICY "Users can view their own verification requests" ON public.owner_verifications FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own verification request" ON public.owner_verifications;
CREATE POLICY "Users can create their own verification request" ON public.owner_verifications FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can view and update all verification requests" ON public.owner_verifications;
CREATE POLICY "Admins can view and update all verification requests" ON public.owner_verifications FOR ALL USING (EXISTS (SELECT 1 FROM public.admins WHERE admin_id = auth.uid()));


/********************************************************************
 * 7. SUPPORT TICKETS
 ********************************************************************/
create table if not exists public.support_tickets (
    ticket_id uuid default uuid_generate_v4() primary key,
    user_id uuid references auth.users(id) not null, -- any user can make ticket
    subject text not null,
    description text not null,
    status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
    admin_id uuid references public.admins(admin_id),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.support_tickets enable row level security;
create policy "Users can view own support tickets" on public.support_tickets for select using ( auth.uid() = user_id );
create policy "Users can insert own support tickets" on public.support_tickets for insert with check ( auth.uid() = user_id );
create policy "Admins can view all support tickets" on public.support_tickets for select using ( exists (select 1 from public.admins where admins.admin_id = auth.uid()) );
create policy "Admins can update any support ticket" on public.support_tickets for update using ( exists (select 1 from public.admins where admins.admin_id = auth.uid()) );

/********************************************************************
 * 8. REALTIME PUBLICATION
 ********************************************************************/
alter publication supabase_realtime add table renters;
alter publication supabase_realtime add table owners;
alter publication supabase_realtime add table admins;
alter publication supabase_realtime add table dorms;
alter publication supabase_realtime add table dorm_reviews;
alter publication supabase_realtime add table rental_requests;
alter publication supabase_realtime add table support_tickets;

/********************************************************************
 * 9. RENTALS (Active & Past Tenancies)
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.rentals (
    rental_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    dorm_id uuid NOT NULL REFERENCES public.dorms(dorm_id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.renters(renter_id) ON DELETE SET NULL, -- Nullable for manual offline tenants
    renter_name text, -- For offline tenants
    renter_phone text, -- For offline tenants
    status text NOT NULL DEFAULT 'active'::text CHECK (status IN ('active', 'past')),
    start_date timestamp with time zone DEFAULT now(),
    end_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rentals_pkey PRIMARY KEY (rental_id)
);

ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their dorm rentals"
    ON public.rentals FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.dorms WHERE dorms.dorm_id = rentals.dorm_id AND dorms.owner_id = auth.uid()));

CREATE POLICY "Owners can update their dorm rentals"
    ON public.rentals FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.dorms WHERE dorms.dorm_id = rentals.dorm_id AND dorms.owner_id = auth.uid()));

CREATE POLICY "Owners can insert their dorm rentals"
    ON public.rentals FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM public.dorms WHERE dorms.dorm_id = rentals.dorm_id AND dorms.owner_id = auth.uid()));

CREATE POLICY "Renters can view their own rentals"
    ON public.rentals FOR SELECT
    USING (user_id = auth.uid());

alter publication supabase_realtime add table rentals;

/********************************************************************
 * 10. NOTIFICATIONS
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.notifications (
    notification_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    message text NOT NULL,
    type text NOT NULL,
    read boolean NOT NULL DEFAULT false,
    related_dorm_id uuid REFERENCES public.dorms(dorm_id) ON DELETE CASCADE,
    related_request_id uuid REFERENCES public.rental_requests(request_id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (notification_id)
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
    ON public.notifications FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "System can insert notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (true);

alter publication supabase_realtime add table notifications;

/********************************************************************
 * 11. SYSTEM LOGS
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.system_logs (
    log_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    action text NOT NULL,
    admin_id uuid REFERENCES public.admins(admin_id) ON DELETE SET NULL,
    details text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_logs_pkey PRIMARY KEY (log_id)
);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view system logs" ON public.system_logs FOR SELECT USING (EXISTS (SELECT 1 FROM public.admins WHERE admin_id = auth.uid()));
CREATE POLICY "System can insert logs" ON public.system_logs FOR INSERT WITH CHECK (true);

