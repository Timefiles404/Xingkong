import type { IntegrationSettings } from '../types'
import { createSectionRegistry } from '../utils/section-registry'
import { EmailSettingsSection } from './email-settings-section'
import { MonitoringSettingsSection } from './monitoring-settings-section'
import { PaymentSettingsSection } from './payment-settings-section'
import { ProfitSettingsSection } from './profit-settings-section'
import { WorkerSettingsSection } from './worker-settings-section'

function normalizeUsdPerCnyRate(value: number | undefined) {
  if (!value || value <= 0) return 1 / 7.2
  return value
}

const INTEGRATIONS_SECTIONS = [
  {
    id: 'payment',
    titleKey: 'Payment Gateway',
    descriptionKey: 'Configure payment gateway integrations',
    build: (settings: IntegrationSettings) => (
      <PaymentSettingsSection
        defaultValues={{
          PayAddress: settings.PayAddress,
          EpayId: settings.EpayId,
          EpayKey: settings.EpayKey,
          Price: settings.Price,
          MinTopUp: settings.MinTopUp,
          CustomCallbackAddress: settings.CustomCallbackAddress,
          PayMethods: settings.PayMethods,
          AmountOptions: settings['payment_setting.amount_options'],
          AmountDiscount: settings['payment_setting.amount_discount'],
          ExternalRedemptionPurchase:
            settings['payment_setting.external_redemption_purchase'],
          StripeApiSecret: settings.StripeApiSecret,
          StripeWebhookSecret: settings.StripeWebhookSecret,
          StripePriceId: settings.StripePriceId,
          StripeUnitPrice: settings.StripeUnitPrice,
          StripeMinTopUp: settings.StripeMinTopUp,
          StripePromotionCodesEnabled: settings.StripePromotionCodesEnabled,
          CreemApiKey: settings.CreemApiKey,
          CreemWebhookSecret: settings.CreemWebhookSecret,
          CreemTestMode: settings.CreemTestMode,
          CreemProducts: settings.CreemProducts,
        }}
        waffoDefaultValues={{
          WaffoEnabled: settings.WaffoEnabled ?? false,
          WaffoApiKey: settings.WaffoApiKey ?? '',
          WaffoPrivateKey: settings.WaffoPrivateKey ?? '',
          WaffoPublicCert: settings.WaffoPublicCert ?? '',
          WaffoSandboxPublicCert: settings.WaffoSandboxPublicCert ?? '',
          WaffoSandboxApiKey: settings.WaffoSandboxApiKey ?? '',
          WaffoSandboxPrivateKey: settings.WaffoSandboxPrivateKey ?? '',
          WaffoSandbox: settings.WaffoSandbox ?? false,
          WaffoMerchantId: settings.WaffoMerchantId ?? '',
          WaffoCurrency: settings.WaffoCurrency ?? 'USD',
          WaffoUnitPrice: settings.WaffoUnitPrice ?? 1,
          WaffoMinTopUp: settings.WaffoMinTopUp ?? 1,
          WaffoNotifyUrl: settings.WaffoNotifyUrl ?? '',
          WaffoReturnUrl: settings.WaffoReturnUrl ?? '',
          WaffoPayMethods: settings.WaffoPayMethods ?? '[]',
        }}
        waffoPancakeDefaultValues={{
          WaffoPancakeEnabled: settings.WaffoPancakeEnabled ?? false,
          WaffoPancakeSandbox: settings.WaffoPancakeSandbox ?? false,
          WaffoPancakeMerchantID: settings.WaffoPancakeMerchantID ?? '',
          WaffoPancakePrivateKey: settings.WaffoPancakePrivateKey ?? '',
          WaffoPancakeWebhookPublicKey:
            settings.WaffoPancakeWebhookPublicKey ?? '',
          WaffoPancakeWebhookTestKey: settings.WaffoPancakeWebhookTestKey ?? '',
          WaffoPancakeStoreID: settings.WaffoPancakeStoreID ?? '',
          WaffoPancakeProductID: settings.WaffoPancakeProductID ?? '',
          WaffoPancakeReturnURL: settings.WaffoPancakeReturnURL ?? '',
          WaffoPancakeCurrency: settings.WaffoPancakeCurrency ?? 'USD',
          WaffoPancakeUnitPrice: settings.WaffoPancakeUnitPrice ?? 1,
          WaffoPancakeMinTopUp: settings.WaffoPancakeMinTopUp ?? 1,
        }}
      />
    ),
  },
  {
    id: 'profit',
    titleKey: 'Profit Related Settings',
    descriptionKey: 'Configure exchange rates and profit-monitor parameters',
    build: (settings: IntegrationSettings) => (
      <ProfitSettingsSection
        defaultValues={{
          DownstreamCNYPerUSD: normalizeUsdPerCnyRate(
            settings['profit_setting.downstream_cny_per_usd']
          ),
          DefaultUpstreamCNYPerUSD: normalizeUsdPerCnyRate(
            settings['profit_setting.default_upstream_cny_per_usd']
          ),
          SubscriptionBreakageEnabled:
            settings['profit_setting.subscription_breakage_enabled'] ?? true,
          ProfitMonitorDetailRetentionDays:
            settings['profit_setting.profit_monitor_detail_retention_days'] ??
            90,
          ProfitMonitorChartDays:
            settings['profit_setting.profit_monitor_chart_days'] ?? 30,
        }}
      />
    ),
  },
  {
    id: 'email',
    titleKey: 'SMTP Email',
    descriptionKey: 'Configure SMTP email settings',
    build: (settings: IntegrationSettings) => (
      <EmailSettingsSection
        defaultValues={{
          SMTPServer: settings.SMTPServer,
          SMTPPort: settings.SMTPPort,
          SMTPAccount: settings.SMTPAccount,
          SMTPFrom: settings.SMTPFrom,
          SMTPToken: settings.SMTPToken,
          SMTPSSLEnabled: settings.SMTPSSLEnabled,
          SMTPForceAuthLogin: settings.SMTPForceAuthLogin,
        }}
      />
    ),
  },
  {
    id: 'worker',
    titleKey: 'Worker Proxy',
    descriptionKey: 'Configure worker service settings',
    build: (settings: IntegrationSettings) => (
      <WorkerSettingsSection
        defaultValues={{
          WorkerUrl: settings.WorkerUrl,
          WorkerValidKey: settings.WorkerValidKey,
          WorkerAllowHttpImageRequestEnabled:
            settings.WorkerAllowHttpImageRequestEnabled,
        }}
      />
    ),
  },
  {
    id: 'monitoring',
    titleKey: 'Monitoring & Alerts',
    descriptionKey: 'Configure channel monitoring and automation',
    build: (settings: IntegrationSettings) => (
      <MonitoringSettingsSection
        defaultValues={{
          ChannelDisableThreshold: settings.ChannelDisableThreshold,
          QuotaRemindThreshold: settings.QuotaRemindThreshold,
          AutomaticDisableChannelEnabled:
            settings.AutomaticDisableChannelEnabled,
          AutomaticEnableChannelEnabled: settings.AutomaticEnableChannelEnabled,
          AutomaticDisableKeywords: settings.AutomaticDisableKeywords,
          AutomaticDisableStatusCodes: settings.AutomaticDisableStatusCodes,
          AutomaticRetryStatusCodes: settings.AutomaticRetryStatusCodes,
          'monitor_setting.auto_test_channel_enabled':
            settings['monitor_setting.auto_test_channel_enabled'],
          'monitor_setting.auto_test_channel_minutes':
            settings['monitor_setting.auto_test_channel_minutes'],
        }}
      />
    ),
  },
] as const

export type IntegrationSectionId = (typeof INTEGRATIONS_SECTIONS)[number]['id']

const integrationsRegistry = createSectionRegistry<
  IntegrationSectionId,
  IntegrationSettings
>({
  sections: INTEGRATIONS_SECTIONS,
  defaultSection: 'payment',
  basePath: '/system-settings/integrations',
  urlStyle: 'path',
})

export const INTEGRATIONS_SECTION_IDS = integrationsRegistry.sectionIds
export const INTEGRATIONS_DEFAULT_SECTION = integrationsRegistry.defaultSection
export const getIntegrationsSectionNavItems =
  integrationsRegistry.getSectionNavItems
export const getIntegrationsSectionContent =
  integrationsRegistry.getSectionContent
