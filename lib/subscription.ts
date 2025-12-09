export type UserSubscription = {
  id: string;
  user_id: string;
  tier_id: string | null;
  tier_name: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  metadata?: any;
};
