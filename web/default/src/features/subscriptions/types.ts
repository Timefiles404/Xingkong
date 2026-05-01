import { z } from 'zod'

// ============================================================================
// Subscription Plan Schema & Types
// ============================================================================

export const subscriptionPlanSchema = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().optional(),
  price_amount: z.number(),
  currency: z.string().default('USD'),
  duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
  duration_value: z.number(),
  custom_seconds: z.number().optional(),
  enabled: z.boolean(),
  sort_order: z.number(),
  max_purchase_per_user: z.number(),
  total_amount: z.number(),
  five_hour_amount: z.number().optional(),
  daily_amount: z.number().optional(),
  weekly_amount: z.number().optional(),
  upgrade_group: z.string().optional(),
  model_limits_enabled: z.boolean().optional(),
  model_limits: z.string().optional(),
  stripe_price_id: z.string().optional(),
  creem_product_id: z.string().optional(),
})

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>

export interface PlanRecord {
  plan: SubscriptionPlan
}

export interface PlanSubscriber {
  subscription_id: number
  user_id: number
  username: string
  status: string
  start_time: number
  end_time: number
  amount_total: number
  amount_used: number
  remaining_amount: number
  five_hour_usage: number
  daily_usage: number
  weekly_usage: number
  model_limits?: string
  model_limits_enabled?: boolean
}

export interface PlanSubscriberRecord {
  member: PlanSubscriber
}

// ============================================================================
// User Subscription Schema & Types
// ============================================================================

export const userSubscriptionSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  plan_id: z.number(),
  status: z.string(),
  source: z.string().optional(),
  start_time: z.number(),
  end_time: z.number(),
  amount_total: z.number(),
  amount_used: z.number(),
  amount_five_hour_limit: z.number().optional(),
  amount_daily_limit: z.number().optional(),
  amount_weekly_limit: z.number().optional(),
  paid_amount: z.number().optional(),
  model_limits_enabled: z.boolean().optional(),
  model_limits: z.string().optional(),
})

export type UserSubscription = z.infer<typeof userSubscriptionSchema>

export interface UserSubscriptionRecord {
  subscription: UserSubscription
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PlanPayload {
  plan: Partial<SubscriptionPlan>
}

export interface SubscriptionPayRequest {
  plan_id: number
  payment_method?: string
}

export interface SubscriptionPayResponse {
  success: boolean
  message?: string
  data?: {
    pay_link?: string
    checkout_url?: string
  }
  url?: string
}

export interface SubscriptionWalletPurchaseResponse {
  success: boolean
  message?: string
  data?: {
    subscription?: UserSubscription
  }
}

export interface SubscriptionCancelPreviewResponse {
  success: boolean
  message?: string
  data?: {
    refund_quota: number
  }
}

export interface SubscriptionCancelResponse {
  success: boolean
  message?: string
  data?: {
    refund_quota: number
    downgrade_group?: string
  }
}

export interface CreateUserSubscriptionRequest {
  plan_id: number
}

// ============================================================================
// Self Subscription Data (user-facing)
// ============================================================================

export interface SelfSubscriptionData {
  billing_preference: string
  subscriptions: UserSubscriptionRecord[]
  all_subscriptions: UserSubscriptionRecord[]
}

// ============================================================================
// Dialog Types
// ============================================================================

export type SubscriptionsDialogType =
  | 'create'
  | 'update'
  | 'toggle-status'
  | 'delete'
