-- ====================================================================
-- ROOM SCOUT: CAPSTONE 42 SCHEMA ADDITIONS & UPDATES
-- Run this script in your Supabase SQL Editor to apply database updates
-- ====================================================================

-- 1. Profiles Table Updates
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
ADD COLUMN IF NOT EXISTS gov_id_url text,
ADD COLUMN IF NOT EXISTS renter_status text DEFAULT 'unverified' CHECK (renter_status IN ('unverified', 'pending', 'verified', 'rejected')),
ADD COLUMN IF NOT EXISTS behavior_preferences jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS user_type text DEFAULT 'student'; -- student or bpo

-- 2. Dorms Table Updates
ALTER TABLE public.dorms 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
ADD COLUMN IF NOT EXISTS parking_info text, -- e.g. "motorcycle only", "4-wheel", "none"
ADD COLUMN IF NOT EXISTS pet_friendly boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS lgu_certified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_methods text[] DEFAULT '{}'::text[], -- e.g., ['GCash', 'Cash']
ADD COLUMN IF NOT EXISTS gcash_qr_url text, -- For scanning the owner's GCash QR code online
ADD COLUMN IF NOT EXISTS contract_rules text,
ADD COLUMN IF NOT EXISTS demand_score numeric DEFAULT 0;

-- 3. Rental Requests Table Updates (Payments & Contracts)
ALTER TABLE public.rental_requests
ADD COLUMN IF NOT EXISTS contract_agreed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending_verification', 'paid')),
ADD COLUMN IF NOT EXISTS payment_proof_url text,
ADD COLUMN IF NOT EXISTS advance_payment_amount numeric DEFAULT 0;

-- 4. Reservation, Payment, and Refund Process Flow Updates
ALTER TABLE public.rental_requests
ADD COLUMN IF NOT EXISTS request_type text DEFAULT 'rental' CHECK (request_type IN ('rental', 'reservation')),
ADD COLUMN IF NOT EXISTS required_amount numeric,
ADD COLUMN IF NOT EXISTS owner_payment_qr_url text,
ADD COLUMN IF NOT EXISTS contract_url text,
ADD COLUMN IF NOT EXISTS renter_gcash_name text,
ADD COLUMN IF NOT EXISTS renter_gcash_number text,
ADD COLUMN IF NOT EXISTS cancel_reason text,
ADD COLUMN IF NOT EXISTS refund_proof_url text,
ADD COLUMN IF NOT EXISTS refund_sent_at timestamp with time zone;

-- Note for application code: 
-- 1. "required_amount" should be fixed to the dorm's price for rentals.
-- 2. "required_amount" requires owner input for reservations.
-- 3. Refunds for reservations are calculated as 10% deducted from the reservation fee (required_amount).
-- 4. Dorm availability (available = false) should only happen after completing all steps and owner confirmation.
-- 5. "Reserved" state is shown when reservation is confirmed by the dorm owner.

-- Optional: if you don't already have an index for querying active/inactive dorms
CREATE INDEX IF NOT EXISTS idx_dorms_status ON public.dorms(status);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);
