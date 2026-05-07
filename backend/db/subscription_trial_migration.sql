-- Trial + subscription migration for KOVO (Supabase / Postgres)
-- Existing organizations: force active subscription for 30 days (Option B)

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'expired'));

UPDATE organizations
SET trial_started_at = COALESCE(trial_started_at, now()),
    subscription_status = 'active',
    subscription_expires_at = COALESCE(subscription_expires_at, now() + interval '30 days'),
    last_payment_at = COALESCE(last_payment_at, now())
WHERE subscription_status IS NULL
   OR subscription_status <> 'active'
   OR subscription_expires_at IS NULL;
