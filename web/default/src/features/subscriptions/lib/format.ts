import type { TFunction } from 'i18next'
import dayjs from '@/lib/dayjs'
import { quotaUnitsToDollars } from '@/lib/format'
import type { SubscriptionPlan } from '../types'

export function formatDuration(
  plan: Partial<SubscriptionPlan>,
  t: TFunction
): string {
  const unit = plan?.duration_unit || 'month'
  const value = plan?.duration_value || 1
  const unitLabels: Record<string, string> = {
    year: t('years'),
    month: t('months'),
    day: t('days'),
    hour: t('hours'),
    custom: t('Custom (seconds)'),
  }
  if (unit === 'custom') {
    const seconds = plan?.custom_seconds || 0
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${t('days')}`
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${t('hours')}`
    return `${seconds} ${t('seconds')}`
  }
  return `${value} ${unitLabels[unit] || unit}`
}

export function formatLimitAmount(
  rawAmount: number | undefined,
  t: TFunction
): string {
  const amount = Number(rawAmount || 0)
  if (amount <= 0) return t('Unlimited')
  return `$${quotaUnitsToDollars(amount).toFixed(2)}`
}

export function formatPlanLimit(
  plan: Partial<SubscriptionPlan>,
  key: 'five_hour_amount' | 'daily_amount' | 'weekly_amount',
  t: TFunction
): string {
  return formatLimitAmount(Number(plan?.[key] || 0), t)
}

export function formatTimestamp(ts: number): string {
  if (!ts) return '-'
  return dayjs(ts * 1000).format('YYYY-MM-DD HH:mm:ss')
}
