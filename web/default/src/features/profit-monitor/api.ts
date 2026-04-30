import { api } from '@/lib/api'

export type ProfitOverviewResponse = {
  success: boolean
  message?: string
  data?: {
    period: string
    summary: {
      operating_profit_cny: number
      gross_profit_cny: number
      cash_flow_cny: number
      outstanding_liability_cny: number
      revenue_cny: number
      upstream_cost_cny: number
      breakage_cny: number
      finance_cost_cny: number
    }
    trend: Array<{
      time: string
      operating_profit: number
      gross_profit: number
      cash_flow: number
      revenue: number
      upstream_cost: number
      breakage: number
      finance_cost: number
    }>
    parameter_trend: Array<{
      time: string
      downstream: number
      upstream: number
      fee: number
    }>
    chains: Array<{
      key: string
      label: string
      items: Array<{
        key: string
        label: string
        value: number
      }>
    }>
  }
}

export async function getProfitOverview(
  period: 'day' | 'week' | 'month'
): Promise<ProfitOverviewResponse> {
  const res = await api.get('/api/profit/overview', { params: { period } })
  return res.data
}
