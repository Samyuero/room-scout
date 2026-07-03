-- ====================================================================
-- ROOM SCOUT: DATABASE SCHEMA ADDITIONS
-- Run this script in your Supabase SQL Editor to apply database additions
-- ====================================================================

/********************************************************************
 * 1. RENTAL REQUESTS TABLE (If not already created)
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.rental_requests (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    dorm_id uuid NOT NULL,
    user_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending'::text,
    message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rental_requests_pkey PRIMARY KEY (id),
    CONSTRAINT rental_requests_dorm_id_fkey FOREIGN KEY (dorm_id) REFERENCES public.dorms(id) ON DELETE CASCADE,
    CONSTRAINT rental_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT rental_requests_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE public.rental_requests ENABLE ROW LEVEL SECURITY;

-- Policies for rental_requests
DROP POLICY IF EXISTS "Users can view their own rental requests" ON public.rental_requests;
CREATE POLICY "Users can view their own rental requests"
    ON public.rental_requests FOR SELECT
    USING (auth.uid() = user_id OR auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can insert their own rental requests" ON public.rental_requests;
CREATE POLICY "Users can insert their own rental requests"
    ON public.rental_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own rental requests" ON public.rental_requests;
CREATE POLICY "Users can update their own rental requests"
    ON public.rental_requests FOR UPDATE
    USING (auth.uid() = user_id OR auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete their own rental requests" ON public.rental_requests;
CREATE POLICY "Users can delete their own rental requests"
    ON public.rental_requests FOR DELETE
    USING (auth.uid() = user_id OR auth.uid() = owner_id);


/********************************************************************
 * 2. NOTIFICATIONS TABLE (If not already created)
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    type text NOT NULL DEFAULT 'info'::text,
    read boolean NOT NULL DEFAULT false,
    related_dorm_id uuid,
    related_request_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id),
    CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT notifications_related_dorm_id_fkey FOREIGN KEY (related_dorm_id) REFERENCES public.dorms(id) ON DELETE SET NULL,
    CONSTRAINT notifications_related_request_id_fkey FOREIGN KEY (related_request_id) REFERENCES public.rental_requests(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Policies for notifications
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications (mark as read)" ON public.notifications;
CREATE POLICY "Users can update their own notifications (mark as read)"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System/Owners can insert notifications for users" ON public.notifications;
CREATE POLICY "System/Owners can insert notifications for users"
    ON public.notifications FOR INSERT
    WITH CHECK (true);


/********************************************************************
 * 3. RENTALS TABLE (For rental tracking history and active tenants)
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.rentals (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    dorm_id uuid NOT NULL,
    user_id uuid, -- Nullable to allow offline renters
    renter_name text NOT NULL,
    renter_phone text,
    status text NOT NULL DEFAULT 'active'::text CHECK (status IN ('active', 'past')),
    start_date timestamp with time zone DEFAULT now() NOT NULL,
    end_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rentals_pkey PRIMARY KEY (id),
    CONSTRAINT rentals_dorm_id_fkey FOREIGN KEY (dorm_id) REFERENCES public.dorms(id) ON DELETE CASCADE,
    CONSTRAINT rentals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

-- Policies for rentals
DROP POLICY IF EXISTS "Users can view their own rentals" ON public.rentals;
CREATE POLICY "Users can view their own rentals"
    ON public.rentals FOR SELECT
    USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.dorms 
            WHERE dorms.dorm_id = rentals.dorm_id AND dorms.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Dorm owners can manage rentals for their dorms" ON public.rentals;
CREATE POLICY "Dorm owners can manage rentals for their dorms"
    ON public.rentals FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.dorms 
            WHERE dorms.dorm_id = rentals.dorm_id AND dorms.owner_id = auth.uid()
        )
    );


/********************************************************************
 * 4. OWNER VERIFICATIONS TABLE
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.owner_verifications (
    verification_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL UNIQUE,
    document_url text, -- permit/ID link in Storage
    status text NOT NULL DEFAULT 'pending'::text CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT owner_verifications_pkey PRIMARY KEY (verification_id),
    CONSTRAINT owner_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(profile_id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE public.owner_verifications ENABLE ROW LEVEL SECURITY;

-- Policies for owner_verifications
DROP POLICY IF EXISTS "Users can view their own verification requests" ON public.owner_verifications;
CREATE POLICY "Users can view their own verification requests"
    ON public.owner_verifications FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own verification request" ON public.owner_verifications;
CREATE POLICY "Users can create their own verification request"
    ON public.owner_verifications FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view and update all verification requests" ON public.owner_verifications;
CREATE POLICY "Admins can view and update all verification requests"
    ON public.owner_verifications FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profile_id = auth.uid() AND role = 'admin'
        )
    );


/********************************************************************
 * 5. SYSTEM LOGS TABLE (AUDIT/BREADCRUMBS)
 ********************************************************************/
CREATE TABLE IF NOT EXISTS public.system_logs (
    log_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid, -- Nullable for pre-auth actions
    action text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_logs_pkey PRIMARY KEY (log_id),
    CONSTRAINT system_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(profile_id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- Policies for system_logs
DROP POLICY IF EXISTS "Users can insert logs" ON public.system_logs;
CREATE POLICY "Users can insert logs"
    ON public.system_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Admins can view all logs" ON public.system_logs;
CREATE POLICY "Admins can view all logs"
    ON public.system_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profile_id = auth.uid() AND role = 'admin'
        )
    );


/********************************************************************
 * 6. FUNCTIONS & TRIGGERS (AUTOMATION & SYNC)
 ********************************************************************/

-- cancel_rental RPC function
CREATE OR REPLACE FUNCTION public.cancel_rental(p_dorm_id uuid)
RETURNS void AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    -- 1. Delete standard request
    DELETE FROM public.rental_requests
    WHERE dorm_id = p_dorm_id AND user_id = v_user_id;

    -- 2. Mark active rental as past
    UPDATE public.rentals
    SET status = 'past', end_date = now(), updated_at = now()
    WHERE dorm_id = p_dorm_id AND user_id = v_user_id AND status = 'active';

    -- 3. Set the dorm as available
    UPDATE public.dorms
    SET available = true, updated_at = now()
    WHERE dorm_id = p_dorm_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Trigger: On rental_requests updates (when approved by owner)
CREATE OR REPLACE FUNCTION public.handle_rental_request_update()
RETURNS trigger AS $$
DECLARE
    v_renter_name text;
    v_renter_phone text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger function
CREATE OR REPLACE FUNCTION public.handle_rental_request_update()
RETURNS trigger AS $$
DECLARE
    v_renter_name text;
    v_renter_phone text;
BEGIN
    IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status != 'accepted') THEN
        -- Get profile details using renamed profile_id column
        SELECT full_name, website INTO v_renter_name, v_renter_phone
        FROM public.profiles
        WHERE profile_id = NEW.user_id;

        -- Create active rental log
        INSERT INTO public.rentals (dorm_id, user_id, renter_name, renter_phone, status, start_date)
        VALUES (NEW.dorm_id, NEW.user_id, COALESCE(v_renter_name, 'Registered User'), v_renter_phone, 'active', now())
        ON CONFLICT DO NOTHING;

        -- Mark dorm unavailable using renamed dorm_id column
        UPDATE public.dorms
        SET available = false, updated_at = now()
        WHERE dorm_id = NEW.dorm_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_rental_request_updated ON public.rental_requests;
CREATE TRIGGER on_rental_request_updated
    AFTER UPDATE ON public.rental_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_rental_request_update();


-- Trigger: On rental_requests deletion (when ended by owner)
CREATE OR REPLACE FUNCTION public.handle_rental_request_deletion()
RETURNS trigger AS $$
BEGIN
    -- Mark active rental as past
    UPDATE public.rentals
    SET status = 'past', end_date = now(), updated_at = now()
    WHERE dorm_id = OLD.dorm_id AND user_id = OLD.user_id AND status = 'active';
    
    -- Make dorm available using renamed dorm_id column
    UPDATE public.dorms
    SET available = true, updated_at = now()
    WHERE dorm_id = OLD.dorm_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_rental_request_deleted ON public.rental_requests;
CREATE TRIGGER on_rental_request_deleted
    BEFORE DELETE ON public.rental_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_rental_request_deletion();


-- Trigger: Sync dorm availability when rentals are directly modified (manually adding/removing offline renters)
CREATE OR REPLACE FUNCTION public.handle_rentals_sync()
RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'active' THEN
        UPDATE public.dorms
        SET available = false, updated_at = now()
        WHERE dorm_id = NEW.dorm_id;
    ELSIF NEW.status = 'past' AND OLD.status = 'active' THEN
        UPDATE public.dorms
        SET available = true, updated_at = now()
        WHERE dorm_id = NEW.dorm_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_rentals_sync ON public.rentals;
CREATE TRIGGER on_rentals_sync
    AFTER INSERT OR UPDATE ON public.rentals
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_rentals_sync();


/********************************************************************
 * 7. ENABLE REALTIME
 ********************************************************************/
-- Enable Realtime for the new tables
ALTER PUBLICATION supabase_realtime ADD TABLE rental_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE rentals;
ALTER PUBLICATION supabase_realtime ADD TABLE owner_verifications;
