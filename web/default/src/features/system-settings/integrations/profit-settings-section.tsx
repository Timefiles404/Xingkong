import * as React from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const profitSettingsSchema = z.object({
  DownstreamCNYPerUSD: z.coerce.number().min(0),
  DefaultUpstreamCNYPerUSD: z.coerce.number().min(0),
  SubscriptionBreakageEnabled: z.boolean(),
  ProfitMonitorDetailRetentionDays: z.coerce.number().int().min(1),
  ProfitMonitorChartDays: z.coerce.number().int().min(1),
})

type ProfitSettingsValues = z.infer<typeof profitSettingsSchema>

type ProfitSettingsSectionProps = {
  defaultValues: ProfitSettingsValues
}

export function ProfitSettingsSection({
  defaultValues,
}: ProfitSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<ProfitSettingsValues>({
    resolver: zodResolver(profitSettingsSchema),
    defaultValues,
  })

  React.useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = React.useCallback(
    async (values: ProfitSettingsValues) => {
      const updates = [
        {
          key: 'profit_setting.downstream_cny_per_usd',
          value: values.DownstreamCNYPerUSD,
        },
        {
          key: 'profit_setting.default_upstream_cny_per_usd',
          value: values.DefaultUpstreamCNYPerUSD,
        },
        {
          key: 'profit_setting.subscription_breakage_enabled',
          value: values.SubscriptionBreakageEnabled,
        },
        {
          key: 'profit_setting.profit_monitor_detail_retention_days',
          value: values.ProfitMonitorDetailRetentionDays,
        },
        {
          key: 'profit_setting.profit_monitor_chart_days',
          value: values.ProfitMonitorChartDays,
        },
      ]

      for (const item of updates) {
        await updateOption.mutateAsync(item)
      }
    },
    [updateOption]
  )

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
        <SettingsSection
          title={t('Profit Related Settings')}
          description={t(
            'Configure default exchange rates, breakage recognition, and retention ranges used by the profit workspace.'
          )}
        >
          <div className='grid gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='DownstreamCNYPerUSD'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Downstream Exchange Rate (1 CNY = ? USD)')}
                  </FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2 rounded-md border px-3'>
                      <span className='text-muted-foreground shrink-0 text-sm'>
                        1 CNY =
                      </span>
                      <Input
                        type='number'
                        step='0.0001'
                        className='border-0 px-0 shadow-none focus-visible:ring-0'
                        {...field}
                      />
                      <span className='text-muted-foreground shrink-0 text-sm'>
                        USD
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Default sell-side exchange-rate snapshot used when RMB income is converted to USD-denominated quota. Example: 1 CNY = 0.1389 USD.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='DefaultUpstreamCNYPerUSD'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Default Upstream Exchange Rate (1 CNY = ? USD)')}
                  </FormLabel>
                  <FormControl>
                    <div className='flex items-center gap-2 rounded-md border px-3'>
                      <span className='text-muted-foreground shrink-0 text-sm'>
                        1 CNY =
                      </span>
                      <Input
                        type='number'
                        step='0.0001'
                        className='border-0 px-0 shadow-none focus-visible:ring-0'
                        {...field}
                      />
                      <span className='text-muted-foreground shrink-0 text-sm'>
                        USD
                      </span>
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Fallback buy-side exchange-rate snapshot when a channel-specific upstream rate is not configured. Example: 1 CNY = 0.1389 USD.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ProfitMonitorDetailRetentionDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Detail Retention Days')}</FormLabel>
                  <FormControl>
                    <Input type='number' step='1' {...field} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'How long to keep verbose profit-monitor detail records available for drill-down.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ProfitMonitorChartDays'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Default Chart Range Days')}</FormLabel>
                  <FormControl>
                    <Input type='number' step='1' {...field} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Default time range used by profit trend charts before administrators switch the interval manually.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='SubscriptionBreakageEnabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel>{t('Enable Subscription Breakage')}</FormLabel>
                  <FormDescription>
                    {t(
                      'When subscriptions expire and remaining quota is forfeited, allow profit monitoring to treat the residual liability as breakage income.'
                    )}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </SettingsSection>

        <div className='flex justify-end'>
          <Button type='submit' disabled={updateOption.isPending}>
            {t('Save changes')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
