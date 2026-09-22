/********************************************************************
 * 1. EXTENSIONS
 ********************************************************************/
-- Enable the UUID extension (needed for uuid_generate_v4())
create extension if not exists "uuid-ossp";

/********************************************************************
 * 2. PROFILES – extends Supabase Auth users
 ********************************************************************/
create table if not exists public.profiles (
    id uuid references auth.users(id) not null primary key,
    updated_at timestamp with time zone,
    username text unique,
    full_name text,
    avatar_url text,
    website text,
    role text not null default 'user'   -- 'user' | 'admin' | 'owner' | 'pending_owner'
);

alter table public.profiles enable row level security;

-- Public profiles are viewable by everyone
create policy "Profiles are viewable by everyone"
    on public.profiles for select
    using ( true );

-- Users can insert their own profile (on sign-up)
create policy "Users can insert their own profile"
    on public.profiles for insert
    with check (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id);

-- Admins can update any profile (for verification process)
create policy "Admins can update all profiles"
    on public.profiles for update
    using (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Trigger to automatically create or update profile on user signup/login
create or replace function public.handle_new_user()
returns trigger as $$
declare
    user_name text;
    full_name_val text;
begin
    user_name := NULLIF(trim(new.raw_user_metadata->>'username'), '');
    full_name_val := NULLIF(trim(new.raw_user_metadata->>'full_name'), '');

    insert into public.profiles (id, email, username, full_name, role, updated_at)
    values (
        new.id,
        new.email,
        user_name,
        full_name_val,
        COALESCE(NULLIF(new.raw_user_metadata->>'role', ''), 'user'),
        now()
    )
    on conflict (id) do update set
        email = EXCLUDED.email,
        username = COALESCE(EXCLUDED.username, public.profiles.username),
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        updated_at = now();
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
    id uuid default uuid_generate_v4() primary key,
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
    owner_id uuid references auth.users(id) not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.dorms enable row level security;

/* ----- Policies for dorms ----- */
-- Anyone can see available (non‑featured or featured) dorms
create policy "Anyone can view available dorms"
    on public.dorms for select
    using ( available = true );

-- Owners can see all of their own dorms (including unavailable)
create policy "Owners can view their own dorms"
    on public.dorms for select
    using ( auth.uid() = owner_id );

-- Owners can insert a dorm for themselves
create policy "Owners can insert their own dorms"
    on public.dorms for insert
    with check ( auth.uid() = owner_id );

-- Owners can update only their own dorms
create policy "Owners can update own dorms"
    on public.dorms for update
    using ( auth.uid() = owner_id );

-- Owners can delete only their own dorms
create policy "Owners can delete own dorms"
    on public.dorms for delete
    using ( auth.uid() = owner_id );

/********************************************************************
 * 4. DORM REVIEWS
 ********************************************************************/
create table if not exists public.dorm_reviews (
    id uuid default uuid_generate_v4() primary key,
    dorm_id uuid references public.dorms(id) on delete cascade not null,
    user_id uuid references auth.users(id) not null,
    rating integer not null check (rating >= 1 and rating <= 5),
    comment text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.dorm_reviews enable row level security;

/* ----- Policies for dorm_reviews ----- */
-- Anyone can read reviews for a dorm
create policy "Anyone can read dorm reviews"
    on public.dorm_reviews for select
    using ( true );

-- Users can insert their own review for a dorm
create policy "Users can insert their own dorm review"
    on public.dorm_reviews for insert
    with check ( auth.uid() = user_id );

-- Users can update their own review
create policy "Users can update own dorm review"
    on public.dorm_reviews for update
    using ( auth.uid() = user_id );

-- Users can delete their own review
create policy "Users can delete own dorm review"
    on public.dorm_reviews for delete
    using ( auth.uid() = user_id );

/********************************************************************
 * 5. SUPPORT TICKETS
 ********************************************************************/
create table if not exists public.support_tickets (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references auth.users(id) not null,
    subject text not null,
    description text not null,
    status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
    admin_id uuid references auth.users(id),          -- nullable; filled when an admin claims/resolves
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.support_tickets enable row level security;

/* ----- Policies for support_tickets ----- */
-- Users can view only their own tickets
create policy "Users can view own support tickets"
    on public.support_tickets for select
    using ( auth.uid() = user_id );

-- Users can insert their own tickets
create policy "Users can insert own support tickets"
    on public.support_tickets for insert
    with check ( auth.uid() = user_id );

-- Users can update their own tickets
create policy "Users can update own support tickets"
    on public.support_tickets for update
    using ( auth.uid() = user_id );

-- Users can delete their own tickets
create policy "Users can delete own support tickets"
    on public.support_tickets for delete
    using ( auth.uid() = user_id );

-- Admins can view *all* tickets
create policy "Admins can view all support tickets"
    on public.support_tickets for select
    using ( exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin') );

-- Admins can update any ticket (e.g. change status, assign admin)
create policy "Admins can update any support ticket"
    on public.support_tickets for update
    using ( exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin') );

-- Admins can insert tickets (to create on behalf of a user or internal)
create policy "Admins can insert support tickets"
    on public.support_tickets for insert
    with check ( exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin') );

/********************************************************************
 * 6. REALTIME PUBLICATION
 ********************************************************************/
-- Enable realtime changes for all tables used by the app
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table dorms;
alter publication supabase_realtime add table dorm_reviews;
alter publication supabase_realtime add table support_tickets;

/********************************************************************
 * 7. SAMPLE DATA (for testing)
 ********************************************************************/
-- Insert a couple of test profiles (replace the UUIDs with real auth.user ids after you create test users)
-- These are just placeholders; you can replace them with actual user IDs from your Supabase auth.
insert into public.profiles (id, username, full_name, role)
values
    ('00000000-0000-0000-0000-000000000001', 'testuser1', 'Test User One', 'user'),
    ('00000000-0000-0000-0000-000000000002', 'adminuser', 'Admin User', 'admin')
on conflict do nothing;

-- Insert a couple of sample dorms owned by testuser1
insert into public.dorms (name, description, address, price, latitude, longitude, owner_id, available, is_featured)
values
    ('Sunny Student Dorm', 'Cozy dorm with AC and Wi‑Fi', '123 University Ave, Barangay Opao', 4500.00, 14.6042, 121.0585, '00000000-0000-0000-0000-000000000001', true, true),
    ('Budget Friendly Room', 'Shared bathroom, close to campus', '45 College St, Barangay Opao', 3000.00, 14.6050, 121.0590, '00000000-0000-0000-0000-000000000001', true, false)
on conflict do nothing;

-- Insert a sample review for the first dorm
insert into public.dorm_reviews (dorm_id, user_id, rating, comment)
values
    ((select id from public.dorms where name = 'Sunny Student Dorm' limit 1), '00000000-0000-0000-0000-000000000001', 5, 'Great place, highly recommend!')
on conflict do nothing;