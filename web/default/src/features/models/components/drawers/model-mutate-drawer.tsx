import { useCallback, useEffect, useMemo, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { JsonEditor } from '@/components/json-editor'
import { TagInput } from '@/components/tag-input'
import { getChannels } from '@/features/channels/api'
import type { Channel } from '@/features/channels/types'
import {
  getOptionValue,
  useSystemOptions,
} from '@/features/system-settings/hooks/use-system-options'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import { normalizeJsonString } from '@/features/system-settings/models/utils'
import type { ModelSettings } from '@/features/system-settings/types'
import { safeJsonParse } from '@/features/system-settings/utils/json-parser'
import { createModel, getModel, getVendors, updateModel } from '../../api'
import { ENDPOINT_TEMPLATES, getNameRuleOptions } from '../../constants'
import { modelsQueryKeys, parseModelTags, vendorsQueryKeys } from '../../lib'
import type { BoundChannel, Model } from '../../types'
import { useModels } from '../models-provider'

const extendedModelFormSchema = z.object({
  id: z.number().optional(),
  model_name: z.string().min(1, 'Model name is required'),
  description: z.string(),
  icon: z.string(),
  tags: z.array(z.string()),
  vendor_id: z.number().optional(),
  endpoints: z.string(),
  name_rule: z.number(),
  status: z.boolean(),
  sync_official: z.boolean(),
  price: z.string().optional(),
  ratio: z.string().optional(),
  cacheRatio: z.string().optional(),
  completionRatio: z.string().optional(),
  modelGroupRatio: z.string().optional(),
  image_generation_enabled: z.boolean().default(false),
})

type ExtendedModelFormValues = z.infer<typeof extendedModelFormSchema>

type PricingMode = 'per-token' | 'per-request'
type DrawerMode = 'create' | 'pricing' | 'basic' | 'upstream-pricing'

type AdminModelPricingConfig = {
  pricingMode?: PricingMode
  price?: number
  ratio?: number
  completionRatio?: number
  cacheRatio?: number
}

type AdminModelMeta = {
  image_generation_enabled?: boolean
  imageGenerationEnabled?: boolean
  upstreamPricing?: AdminModelPricingConfig
  upstreamChannelPricing?: Record<string, AdminModelPricingConfig>
}

type ChannelPricingDraft = {
  pricingMode: PricingMode
  price: string
  promptPrice: string
  completionPrice: string
  cacheRatio: string
}

type ModelMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: Model | null
}

const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  'global.pass_through_request_enabled': false,
  'global.thinking_model_blacklist': '[]',
  'global.chat_completions_to_responses_policy': '{}',
  'general_setting.ping_interval_enabled': false,
  'general_setting.ping_interval_seconds': 60,
  'gemini.safety_settings': '',
  'gemini.version_settings': '',
  'gemini.supported_imagine_models': '',
  'gemini.thinking_adapter_enabled': false,
  'gemini.thinking_adapter_budget_tokens_percentage': 0.6,
  'gemini.function_call_thought_signature_enabled': false,
  'gemini.remove_function_response_id_enabled': true,
  'claude.model_headers_settings': '',
  'claude.default_max_tokens': '',
  'claude.thinking_adapter_enabled': true,
  'claude.thinking_adapter_budget_tokens_percentage': 0.8,
  ModelPrice: '',
  ModelGroupRatio: '',
  ModelRatio: '',
  CacheRatio: '',
  CreateCacheRatio: '',
  CompletionRatio: '',
  ImageRatio: '',
  AudioRatio: '',
  AudioCompletionRatio: '',
  ExposeRatioEnabled: false,
  'billing_setting.billing_mode': '{}',
  'billing_setting.billing_expr': '{}',
  'tool_price_setting.prices': '{}',
  TopupGroupRatio: '',
  GroupRatio: '',
  UserUsableGroups: '',
  GroupGroupRatio: '',
  AutoGroups: '',
  DefaultUseAutoGroup: false,
  'group_ratio_setting.group_special_usable_group': '{}',
  'grok.violation_deduction_enabled': false,
  'grok.violation_deduction_amount': 0,
}

function isValidNumber(value: string) {
  if (value === '') return true
  return !Number.isNaN(Number.parseFloat(value))
}

function parseNumberOrUndefined(value?: string) {
  if (!value || value.trim() === '') return undefined
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function normalizeUsdPerCnyRate(value: unknown) {
  const raw =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : 0
  if (!Number.isFinite(raw) || raw <= 0) return null
  return raw
}

function stringifyMeta(meta: AdminModelMeta) {
  if (
    meta.imageGenerationEnabled !== undefined &&
    meta.image_generation_enabled === undefined
  ) {
    meta.image_generation_enabled = meta.imageGenerationEnabled
  }
  delete meta.imageGenerationEnabled

  if (
    !meta.image_generation_enabled &&
    !meta.upstreamPricing &&
    (!meta.upstreamChannelPricing ||
      Object.keys(meta.upstreamChannelPricing).length === 0)
  ) {
    return ''
  }
  return JSON.stringify(meta)
}

function buildChannelPricingDraft(
  pricing?: AdminModelPricingConfig
): ChannelPricingDraft {
  const pricingMode: PricingMode =
    pricing?.pricingMode ||
    (pricing?.price !== undefined ? 'per-request' : 'per-token')

  const promptPrice =
    pricingMode === 'per-token' && pricing?.ratio !== undefined
      ? String(pricing.ratio * 2)
      : ''
  const completionPrice =
    pricingMode === 'per-token' &&
    pricing?.ratio !== undefined &&
    pricing?.completionRatio !== undefined
      ? String(pricing.ratio * 2 * pricing.completionRatio)
      : ''

  return {
    pricingMode,
    price:
      pricingMode === 'per-request' && pricing?.price !== undefined
        ? String(pricing.price)
        : '',
    promptPrice,
    completionPrice,
    cacheRatio:
      pricingMode === 'per-token' && pricing?.cacheRatio !== undefined
        ? String(pricing.cacheRatio)
        : '',
  }
}

function normalizeChannelPricingDraft(
  draft: ChannelPricingDraft
): AdminModelPricingConfig | undefined {
  if (draft.pricingMode === 'per-request') {
    const price = parseNumberOrUndefined(draft.price)
    if (price === undefined) return undefined
    return {
      pricingMode: 'per-request',
      price,
    }
  }

  const promptPrice = parseNumberOrUndefined(draft.promptPrice)
  const completionPrice = parseNumberOrUndefined(draft.completionPrice)
  const cacheRatio = parseNumberOrUndefined(draft.cacheRatio)

  const ratio = promptPrice !== undefined ? promptPrice / 2 : undefined
  const completionRatio =
    promptPrice !== undefined &&
    completionPrice !== undefined &&
    promptPrice > 0
      ? completionPrice / promptPrice
      : undefined

  const result: AdminModelPricingConfig = {
    pricingMode: 'per-token',
    ratio,
    completionRatio,
    cacheRatio,
  }

  const hasValue = Object.values(result).some((value) => value !== undefined)
  return hasValue ? result : undefined
}

function extractChannelUpstreamRate(channel?: Channel | null): number | null {
  if (!channel?.settings) return null
  try {
    const parsed = JSON.parse(channel.settings) as {
      profit_upstream_usd_per_cny?: unknown
      profit_upstream_cny_per_usd?: unknown
    }
    let normalized: number | null = null
    if (parsed.profit_upstream_usd_per_cny !== undefined) {
      normalized = normalizeUsdPerCnyRate(parsed.profit_upstream_usd_per_cny)
    } else if (parsed.profit_upstream_cny_per_usd !== undefined) {
      const legacyRate = normalizeUsdPerCnyRate(
        parsed.profit_upstream_cny_per_usd
      )
      normalized = legacyRate ? 1 / legacyRate : null
    }
    if (normalized) {
      return normalized
    }
  } catch {
    return null
  }
  return null
}

export function ModelMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: ModelMutateDrawerProps) {
  const { t } = useTranslation()
  const { open: dialogType } = useModels()
  const queryClient = useQueryClient()
  const isEditing = Boolean(currentRow?.id)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pricingMode, setPricingMode] = useState<PricingMode>('per-token')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [promptPrice, setPromptPrice] = useState('')
  const [completionPrice, setCompletionPrice] = useState('')
  const [oldModelName, setOldModelName] = useState('')
  const [boundChannels, setBoundChannels] = useState<BoundChannel[]>([])
  const [channelPricingDrafts, setChannelPricingDrafts] = useState<
    Record<string, ChannelPricingDraft>
  >({})

  const drawerMode: DrawerMode = useMemo(() => {
    switch (dialogType) {
      case 'update-model-pricing':
        return 'pricing'
      case 'update-model-basic':
        return 'basic'
      case 'update-model-upstream-pricing':
        return 'upstream-pricing'
      default:
        return 'create'
    }
  }, [dialogType])

  const showBasicSections = drawerMode === 'create' || drawerMode === 'basic'
  const showPricingSection =
    drawerMode === 'create' || drawerMode === 'pricing'
  const showUpstreamPricingSection = drawerMode === 'upstream-pricing'
  const showStatusSection = drawerMode === 'create' || drawerMode === 'basic'

  const { data: vendorsData } = useQuery({
    queryKey: vendorsQueryKeys.list(),
    queryFn: () => getVendors({ page_size: 1000 }),
    enabled: open,
  })

  const vendors = vendorsData?.data?.items || []

  const { data: modelData } = useQuery({
    queryKey: modelsQueryKeys.detail(currentRow?.id || 0),
    queryFn: () => getModel(currentRow!.id),
    enabled: open && isEditing,
  })

  const { data: channelsData } = useQuery({
    queryKey: ['channels-upstream-pricing'],
    queryFn: () => getChannels({ p: 1, page_size: 2000 }),
    enabled: open && showUpstreamPricingSection,
  })

  const { data: systemOptionsData } = useSystemOptions()
  const updateOption = useUpdateOption()

  const modelSettings = useMemo(() => {
    if (!systemOptionsData?.data) return null
    return getOptionValue(systemOptionsData.data, DEFAULT_MODEL_SETTINGS)
  }, [systemOptionsData])

  const channelMap = useMemo(() => {
    const items = channelsData?.data?.items || []
    return new Map<number, Channel>(items.map((item) => [item.id, item]))
  }, [channelsData])

  const form = useForm<ExtendedModelFormValues>({
    resolver: zodResolver(extendedModelFormSchema),
    defaultValues: {
      model_name: '',
      description: '',
      icon: '',
      tags: [],
      vendor_id: undefined,
      endpoints: '',
      name_rule: 0,
      status: true,
      sync_official: true,
      price: '',
      ratio: '',
      cacheRatio: '',
      completionRatio: '',
      modelGroupRatio: '',
      image_generation_enabled: false,
    },
  })

  const buildBaseModelData = useCallback(
    (model?: Model | null): ExtendedModelFormValues => ({
      id: model?.id,
      model_name: model?.model_name || '',
      description: model?.description || '',
      icon: model?.icon || '',
      tags: parseModelTags(model?.tags),
      vendor_id: model?.vendor_id,
      endpoints: model?.endpoints || '',
      name_rule: model?.name_rule || 0,
      status: model ? model.status === 1 : true,
      sync_official: model ? model.sync_official === 1 : true,
      price: '',
      ratio: '',
      cacheRatio: '',
      completionRatio: '',
      modelGroupRatio: '',
      image_generation_enabled: false,
    }),
    []
  )

  useEffect(() => {
    if (!open) return

    if (!isEditing) {
      setOldModelName('')
      setPricingMode('per-token')
      setPromptPrice('')
      setCompletionPrice('')
      setAdvancedOpen(false)
      setBoundChannels(currentRow?.bound_channels || [])
      setChannelPricingDrafts({})
      form.reset(buildBaseModelData(currentRow))
      return
    }

    const model = modelData?.data
    if (!model) return

    const needsSystemPricingSettings =
      drawerMode === 'create' || drawerMode === 'pricing' || drawerMode === 'basic'
    if (needsSystemPricingSettings && !modelSettings) {
      return
    }

    setOldModelName(model.model_name)
    setBoundChannels(model.bound_channels || [])

    const nextValues = buildBaseModelData(model)
    const adminMeta = safeJsonParse<AdminModelMeta>(model.admin_meta, {
      fallback: {},
      silent: true,
    })
    const upstreamPricing = adminMeta.upstreamPricing
    const upstreamChannelPricing = adminMeta.upstreamChannelPricing || {}
    nextValues.image_generation_enabled =
      adminMeta.image_generation_enabled === true ||
      adminMeta.imageGenerationEnabled === true
    const nextChannelDrafts: Record<string, ChannelPricingDraft> = {}
    for (const channel of model.bound_channels || []) {
      nextChannelDrafts[String(channel.id)] = buildChannelPricingDraft(
        upstreamChannelPricing[String(channel.id)]
      )
    }
    setChannelPricingDrafts(nextChannelDrafts)

    const priceMap = safeJsonParse<Record<string, number>>(
      modelSettings?.ModelPrice,
      { fallback: {}, silent: true }
    )
    const ratioMap = safeJsonParse<Record<string, number>>(
      modelSettings?.ModelRatio,
      { fallback: {}, silent: true }
    )
    const cacheMap = safeJsonParse<Record<string, number>>(
      modelSettings?.CacheRatio,
      { fallback: {}, silent: true }
    )
    const completionMap = safeJsonParse<Record<string, number>>(
      modelSettings?.CompletionRatio,
      { fallback: {}, silent: true }
    )
    const modelGroupRatioMap = safeJsonParse<
      Record<string, Record<string, number>>
    >(modelSettings?.ModelGroupRatio, {
      fallback: {},
      silent: true,
    })

    const modelName = model.model_name
    const currentPricing =
      drawerMode === 'upstream-pricing'
        ? upstreamPricing
        : {
            pricingMode:
              priceMap[modelName] !== undefined ? 'per-request' : 'per-token',
            price: priceMap[modelName],
            ratio: ratioMap[modelName],
            cacheRatio: cacheMap[modelName],
            completionRatio: completionMap[modelName],
          }

    const nextPricingMode =
      currentPricing?.pricingMode ||
      (currentPricing?.price !== undefined ? 'per-request' : 'per-token')
    setPricingMode(nextPricingMode)

    if (nextPricingMode === 'per-request') {
      nextValues.price =
        currentPricing?.price !== undefined ? String(currentPricing.price) : ''
      nextValues.ratio = ''
      nextValues.completionRatio = ''
      nextValues.cacheRatio = ''
      setPromptPrice('')
      setCompletionPrice('')
      setAdvancedOpen(false)
    } else {
      nextValues.ratio =
        currentPricing?.ratio !== undefined ? String(currentPricing.ratio) : ''
      nextValues.completionRatio =
        currentPricing?.completionRatio !== undefined
          ? String(currentPricing.completionRatio)
          : ''
      nextValues.cacheRatio =
        currentPricing?.cacheRatio !== undefined
          ? String(currentPricing.cacheRatio)
          : ''
      nextValues.modelGroupRatio =
        drawerMode === 'upstream-pricing'
          ? ''
          : JSON.stringify(modelGroupRatioMap[modelName] || {}, null, 2)
      nextValues.price = ''

      if (currentPricing?.ratio !== undefined) {
        const prompt = currentPricing.ratio * 2
        setPromptPrice(String(prompt))
        setCompletionPrice(
          currentPricing.completionRatio !== undefined
            ? String(prompt * currentPricing.completionRatio)
            : ''
        )
      } else {
        setPromptPrice('')
        setCompletionPrice('')
      }
      setAdvancedOpen(currentPricing?.cacheRatio !== undefined)
    }

    form.reset(nextValues)
  }, [
    open,
    isEditing,
    currentRow,
    modelData,
    form,
    modelSettings,
    drawerMode,
    buildBaseModelData,
  ])

  const handlePromptPriceChange = (value: string) => {
    if (!isValidNumber(value)) return
    setPromptPrice(value)
    if (value && !Number.isNaN(Number.parseFloat(value))) {
      form.setValue('ratio', String(Number.parseFloat(value) / 2))
      if (
        completionPrice &&
        !Number.isNaN(Number.parseFloat(completionPrice)) &&
        Number.parseFloat(value) > 0
      ) {
        form.setValue(
          'completionRatio',
          String(Number.parseFloat(completionPrice) / Number.parseFloat(value))
        )
      }
    } else {
      form.setValue('ratio', '')
      form.setValue('completionRatio', '')
    }
  }

  const handleCompletionPriceChange = (value: string) => {
    if (!isValidNumber(value)) return
    setCompletionPrice(value)
    if (
      value &&
      promptPrice &&
      !Number.isNaN(Number.parseFloat(value)) &&
      !Number.isNaN(Number.parseFloat(promptPrice)) &&
      Number.parseFloat(promptPrice) > 0
    ) {
      form.setValue(
        'completionRatio',
        String(Number.parseFloat(value) / Number.parseFloat(promptPrice))
      )
    } else {
      form.setValue('completionRatio', '')
    }
  }

  const syncModelPricingOptions = useCallback(
    async (values: ExtendedModelFormValues, modelName: string) => {
      if (!modelSettings) return

      const priceMap = safeJsonParse<Record<string, number>>(
        modelSettings.ModelPrice,
        { fallback: {}, silent: true }
      )
      const ratioMap = safeJsonParse<Record<string, number>>(
        modelSettings.ModelRatio,
        { fallback: {}, silent: true }
      )
      const cacheMap = safeJsonParse<Record<string, number>>(
        modelSettings.CacheRatio,
        { fallback: {}, silent: true }
      )
      const completionMap = safeJsonParse<Record<string, number>>(
        modelSettings.CompletionRatio,
        { fallback: {}, silent: true }
      )
      const modelGroupRatioMap = safeJsonParse<
        Record<string, Record<string, number>>
      >(modelSettings.ModelGroupRatio, {
        fallback: {},
        silent: true,
      })

      if (isEditing && oldModelName && oldModelName !== modelName) {
        if (drawerMode !== 'pricing') {
          if (priceMap[oldModelName] !== undefined) {
            priceMap[modelName] = priceMap[oldModelName]
          }
          if (ratioMap[oldModelName] !== undefined) {
            ratioMap[modelName] = ratioMap[oldModelName]
          }
          if (cacheMap[oldModelName] !== undefined) {
            cacheMap[modelName] = cacheMap[oldModelName]
          }
          if (completionMap[oldModelName] !== undefined) {
            completionMap[modelName] = completionMap[oldModelName]
          }
          if (modelGroupRatioMap[oldModelName] !== undefined) {
            modelGroupRatioMap[modelName] = modelGroupRatioMap[oldModelName]
          }
        }

        delete priceMap[oldModelName]
        delete ratioMap[oldModelName]
        delete cacheMap[oldModelName]
        delete completionMap[oldModelName]
        delete modelGroupRatioMap[oldModelName]
      }

      if (drawerMode === 'pricing' || drawerMode === 'create') {
        delete priceMap[modelName]
        delete ratioMap[modelName]
        delete cacheMap[modelName]
        delete completionMap[modelName]
        delete modelGroupRatioMap[modelName]

        if (pricingMode === 'per-request') {
          const price = parseNumberOrUndefined(values.price)
          if (price !== undefined) {
            priceMap[modelName] = price
          }
        } else {
          const ratio = parseNumberOrUndefined(values.ratio)
          const cacheRatio = parseNumberOrUndefined(values.cacheRatio)
          const completionRatio = parseNumberOrUndefined(values.completionRatio)

          if (ratio !== undefined) {
            ratioMap[modelName] = ratio
          }
          if (cacheRatio !== undefined) {
            cacheMap[modelName] = cacheRatio
          }
          if (completionRatio !== undefined) {
            completionMap[modelName] = completionRatio
          }
        }

        const parsedModelGroupRatio = safeJsonParse<Record<string, number>>(
          values.modelGroupRatio,
          { fallback: {}, silent: true }
        )
        if (Object.keys(parsedModelGroupRatio).length > 0) {
          modelGroupRatioMap[modelName] = parsedModelGroupRatio
        }
      }

      const updates = [
        { key: 'ModelPrice', value: normalizeJsonString(JSON.stringify(priceMap)) },
        { key: 'ModelRatio', value: normalizeJsonString(JSON.stringify(ratioMap)) },
        { key: 'CacheRatio', value: normalizeJsonString(JSON.stringify(cacheMap)) },
        {
          key: 'CompletionRatio',
          value: normalizeJsonString(JSON.stringify(completionMap)),
        },
        {
          key: 'ModelGroupRatio',
          value: normalizeJsonString(JSON.stringify(modelGroupRatioMap)),
        },
      ].filter((item) => {
        const current = normalizeJsonString(
          modelSettings[item.key as keyof ModelSettings] as string
        )
        return item.value !== current
      })

      for (const update of updates) {
        await updateOption.mutateAsync(update)
      }
    },
    [
      modelSettings,
      isEditing,
      oldModelName,
      drawerMode,
      pricingMode,
      updateOption,
    ]
  )

  const updateChannelPricingDraft = useCallback(
    (
      channelId: number,
      updater: (draft: ChannelPricingDraft) => ChannelPricingDraft
    ) => {
      setChannelPricingDrafts((prev) => {
        const key = String(channelId)
        const current = prev[key] || buildChannelPricingDraft()
        return {
          ...prev,
          [key]: updater(current),
        }
      })
    },
    []
  )

  const onSubmit = useCallback(
    async (values: ExtendedModelFormValues) => {
      setIsSubmitting(true)
      try {
        const existingAdminMeta = safeJsonParse<AdminModelMeta>(
          (modelData?.data || currentRow)?.admin_meta,
          { fallback: {}, silent: true }
        )

        const modelPayload: Partial<Model> & { id?: number } = {
          id: isEditing ? currentRow?.id : undefined,
          model_name: values.model_name,
          description: values.description,
          icon: values.icon,
          tags: values.tags.join(','),
          vendor_id: values.vendor_id,
          endpoints: values.endpoints,
          name_rule: values.name_rule,
          status: values.status ? 1 : 0,
          sync_official: values.sync_official ? 1 : 0,
          admin_meta: currentRow?.admin_meta || '',
        }

        if (drawerMode !== 'upstream-pricing') {
          existingAdminMeta.image_generation_enabled =
            pricingMode === 'per-request' && values.image_generation_enabled
          modelPayload.admin_meta = stringifyMeta(existingAdminMeta)
        }

        if (drawerMode === 'upstream-pricing') {
          const upstreamPricing: AdminModelPricingConfig = {
            pricingMode,
            price:
              pricingMode === 'per-request'
                ? parseNumberOrUndefined(values.price)
                : undefined,
            ratio:
              pricingMode === 'per-token'
                ? parseNumberOrUndefined(values.ratio)
                : undefined,
            completionRatio:
              pricingMode === 'per-token'
                ? parseNumberOrUndefined(values.completionRatio)
                : undefined,
            cacheRatio:
              pricingMode === 'per-token'
                ? parseNumberOrUndefined(values.cacheRatio)
                : undefined,
          }
          const hasPricing = Object.values(upstreamPricing).some(
            (value) => value !== undefined
          )
          existingAdminMeta.upstreamPricing = hasPricing
            ? upstreamPricing
            : undefined
          const nextUpstreamChannelPricing = Object.fromEntries(
            Object.entries(channelPricingDrafts)
              .map(([channelId, draft]) => [
                channelId,
                normalizeChannelPricingDraft(draft),
              ])
              .filter((entry): entry is [string, AdminModelPricingConfig] =>
                entry[1] !== undefined
              )
          )
          existingAdminMeta.upstreamChannelPricing =
            Object.keys(nextUpstreamChannelPricing).length > 0
              ? nextUpstreamChannelPricing
              : undefined
          modelPayload.admin_meta = stringifyMeta(existingAdminMeta)
        } else if (modelData?.data?.admin_meta) {
          modelPayload.admin_meta = modelData.data.admin_meta
        }

        const response =
          isEditing && modelPayload.id
            ? await updateModel(modelPayload as Partial<Model> & { id: number })
            : await createModel(modelPayload)

        if (!response.success) {
          toast.error(response.message || 'Operation failed')
          return
        }

        if (drawerMode !== 'upstream-pricing') {
          await syncModelPricingOptions(values, values.model_name)
        }

        toast.success(
          isEditing
            ? t('Model updated successfully')
            : t('Model created successfully')
        )
        queryClient.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
        queryClient.invalidateQueries({
          queryKey: modelsQueryKeys.detail(currentRow?.id || 0),
        })
        queryClient.invalidateQueries({ queryKey: ['system-options'] })
        queryClient.invalidateQueries({ queryKey: ['pricing'] })
        onOpenChange(false)
      } catch (error) {
        toast.error((error as Error).message || 'Operation failed')
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      currentRow,
      channelPricingDrafts,
      drawerMode,
      isEditing,
      modelData,
      onOpenChange,
      pricingMode,
      queryClient,
      syncModelPricingOptions,
      t,
    ]
  )

  const handleFillEndpointTemplate = (templateKey: string) => {
    const template = ENDPOINT_TEMPLATES[templateKey]
    if (!template) return
    form.setValue(
      'endpoints',
      JSON.stringify({ [templateKey]: template }, null, 2)
    )
  }

  const drawerTitle = useMemo(() => {
    if (!isEditing) return t('Create Model')
    switch (drawerMode) {
      case 'pricing':
        return t('Pricing Edit')
      case 'basic':
        return t('Model Basic Settings')
      case 'upstream-pricing':
        return t('Upstream Pricing Edit')
      default:
        return t('Edit Model')
    }
  }, [drawerMode, isEditing, t])

  const drawerDescription = useMemo(() => {
    if (!isEditing) {
      return t(
        'Add a new model to the system by providing the necessary information.'
      )
    }
    switch (drawerMode) {
      case 'pricing':
        return t("Update pricing settings and click save when you're done.")
      case 'basic':
        return t("Update basic model settings and click save when you're done.")
      case 'upstream-pricing':
        return t(
          "Update private upstream pricing settings for administrators and click save when you're done."
        )
      default:
        return t("Update model configuration and click save when you're done.")
    }
  }, [drawerMode, isEditing, t])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col sm:max-w-2xl'>
        <SheetHeader className='text-start'>
          <SheetTitle>{drawerTitle}</SheetTitle>
          <SheetDescription>{drawerDescription}</SheetDescription>
        </SheetHeader>

            <Form {...form}>
          <form
            id='model-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex-1 space-y-6 overflow-y-auto px-4'
          >
            {showBasicSections && (
              <>
                <div className='space-y-4'>
                  <h3 className='text-sm font-semibold'>
                    {t('Basic Information')}
                  </h3>

                  <FormField
                    control={form.control}
                    name='model_name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Model Name *')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('gpt-4, claude-3-opus, etc.')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('The unique identifier for this model')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='description'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Description')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('Describe this model...')}
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='icon'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Icon')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('OpenAI, Anthropic, etc.')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className='text-xs'>
                          {t('@lobehub/icons key')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='vendor_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Vendor')}</FormLabel>
                        <Select
                          onValueChange={(value) =>
                            field.onChange(
                              value ? Number.parseInt(value, 10) : undefined
                            )
                          }
                          value={field.value ? String(field.value) : undefined}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('Select vendor')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {vendors.map((vendor) => (
                              <SelectItem
                                key={vendor.id}
                                value={String(vendor.id)}
                              >
                                {vendor.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='tags'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Tags')}</FormLabel>
                        <FormControl>
                          <TagInput
                            value={field.value || []}
                            onChange={field.onChange}
                            placeholder={t('Add tags...')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Press Enter or comma to add tags')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='image_generation_enabled'
                    render={({ field }) => (
                      <FormItem className='flex flex-col gap-3 rounded-2xl border p-4'>
                        <div className='space-y-1'>
                          <FormLabel>{t('Image generation model')}</FormLabel>
                          <FormDescription>
                            {pricingMode === 'per-request'
                              ? t(
                                  'Enable this to expose the model in the image-generation workspace.'
                                )
                              : t(
                                  'Only pay-per-request models can be marked as image-generation models.'
                                )}
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            disabled={pricingMode !== 'per-request'}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className='space-y-4'>
                  <h3 className='text-sm font-semibold'>{t('Matching Rules')}</h3>

                  <FormField
                    control={form.control}
                    name='name_rule'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Name Rule')}</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={(value) =>
                              field.onChange(Number.parseInt(value, 10))
                            }
                            value={String(field.value)}
                            className='grid grid-cols-2 gap-4'
                          >
                            {getNameRuleOptions(t).map((option) => (
                              <div
                                key={option.value}
                                className='flex items-center space-x-2'
                              >
                                <RadioGroupItem
                                  value={String(option.value)}
                                  id={`rule-${option.value}`}
                                />
                                <Label
                                  htmlFor={`rule-${option.value}`}
                                  className='cursor-pointer font-normal'
                                >
                                  {option.label}
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </FormControl>
                        <FormDescription>
                          {t('How this model name should match requests')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <h3 className='text-sm font-semibold'>{t('Endpoints')}</h3>
                    <Select onValueChange={handleFillEndpointTemplate}>
                      <SelectTrigger size='sm' className='w-[200px]'>
                        <SelectValue placeholder={t('Load template...')} />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(ENDPOINT_TEMPLATES).map((key) => (
                          <SelectItem key={key} value={key}>
                            {key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <FormField
                    control={form.control}
                    name='endpoints'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Endpoint Configuration')}</FormLabel>
                        <FormControl>
                          <JsonEditor
                            value={field.value || ''}
                            onChange={field.onChange}
                            keyPlaceholder='endpoint_type'
                            valuePlaceholder='{"path": "/v1/...", "method": "POST"}'
                            keyLabel='Endpoint Type'
                            valueLabel='Configuration'
                            valueType='any'
                            emptyMessage={t(
                              'No endpoints configured. Switch to JSON mode or add rows to define endpoints.'
                            )}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Define API endpoints for this model (JSON format)'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />
              </>
            )}

            {(showPricingSection || showUpstreamPricingSection) && (
              <>
                <div className='space-y-4'>
                  <h3 className='text-sm font-semibold'>
                    {t('Pricing Configuration')}
                  </h3>

                  <div className='space-y-4'>
                    <Label>{t('Pricing mode')}</Label>
                    <RadioGroup
                      value={pricingMode}
                      onValueChange={(value) =>
                        setPricingMode(value as PricingMode)
                      }
                    >
                      <div className='flex items-center space-x-2'>
                        <RadioGroupItem value='per-token' id='per-token' />
                        <Label htmlFor='per-token' className='font-normal'>
                          {t('按量计费')}
                        </Label>
                      </div>
                      <div className='flex items-center space-x-2'>
                        <RadioGroupItem value='per-request' id='per-request' />
                        <Label htmlFor='per-request' className='font-normal'>
                          {t('按次计费')}
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {pricingMode === 'per-request' ? (
                    <FormField
                      control={form.control}
                      name='price'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Fixed price (USD)')}</FormLabel>
                          <FormControl>
                            <Input
                              type='text'
                              placeholder='0.01'
                              {...field}
                              onChange={(e) => {
                                const value = e.target.value
                                if (isValidNumber(value)) {
                                  field.onChange(value)
                                }
                              }}
                            />
                          </FormControl>
                          <FormDescription>
                            {t(
                              'Cost in USD per request, regardless of tokens used.'
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <>
                      <div className='space-y-4'>
                        <div className='space-y-2'>
                          <Label>{t('Prompt price (USD / million tokens)')}</Label>
                          <Input
                            type='text'
                            placeholder='2.0'
                            value={promptPrice}
                            onChange={(e) =>
                              handlePromptPriceChange(e.target.value)
                            }
                          />
                        </div>

                        <div className='space-y-2'>
                          <Label>{t('Completion price (USD / million tokens)')}</Label>
                          <Input
                            type='text'
                            placeholder='4.0'
                            value={completionPrice}
                            onChange={(e) =>
                              handleCompletionPriceChange(e.target.value)
                            }
                          />
                        </div>
                      </div>

                      <Collapsible
                        open={advancedOpen}
                        onOpenChange={setAdvancedOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <Button
                            type='button'
                            variant='outline'
                            className='flex w-full items-center justify-between'
                          >
                            {t('Advanced options')}
                            <ChevronDown
                              className={`h-4 w-4 transition-transform duration-200 ${
                                advancedOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className='space-y-6 pt-6'>
                          <FormField
                            control={form.control}
                            name='cacheRatio'
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('Cache ratio')}</FormLabel>
                                <FormControl>
                                  <Input
                                    type='text'
                                    placeholder='0.1'
                                    {...field}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      if (isValidNumber(value)) {
                                        field.onChange(value)
                                      }
                                    }}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t('Discount ratio for cache hits.')}
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </CollapsibleContent>
                      </Collapsible>

                      {!showUpstreamPricingSection && (
                        <FormField
                          control={form.control}
                          name='modelGroupRatio'
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('Group Multipliers')}</FormLabel>
                              <FormControl>
                                <JsonEditor
                                  value={field.value || ''}
                                  onChange={field.onChange}
                                  keyPlaceholder='default'
                                  valuePlaceholder='5'
                                  keyLabel={t('User token group')}
                                  valueLabel={t('Multiplier')}
                                  valueType='number'
                                  emptyMessage={t(
                                    'Optional. Configure per-token-group multipliers for this model.'
                                  )}
                                />
                              </FormControl>
                              <FormDescription>
                                {t(
                                  'Final charge multiplier = system group multiplier × model group multiplier.'
                                )}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </>
                  )}

                  {showUpstreamPricingSection && boundChannels.length > 0 && (
                    <div className='space-y-4 border-t pt-4'>
                      <div className='space-y-1'>
                        <h4 className='text-sm font-semibold'>
                          {t('Per-Channel Upstream Pricing')}
                        </h4>
                        <p className='text-muted-foreground text-sm'>
                          {t(
                            'Each bound upstream channel can override the default upstream pricing. These values stay private to administrators.'
                          )}
                        </p>
                      </div>

                      <div className='space-y-4'>
                        {boundChannels.map((channel) => {
                          const draft =
                            channelPricingDrafts[String(channel.id)] ||
                            buildChannelPricingDraft()
                          const channelInfo = channelMap.get(channel.id)
                          const upstreamRate =
                            extractChannelUpstreamRate(channelInfo)

                          return (
                            <div
                              key={channel.id}
                              className='space-y-4 rounded-xl border p-4'
                            >
                              <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                                <div>
                                  <div className='font-medium'>
                                    {channel.name}
                                  </div>
                                  <div className='text-muted-foreground text-xs'>
                                    {t('Channel ID')}: {channel.id}
                                  </div>
                                </div>
                                <div className='text-muted-foreground text-xs'>
                                  {upstreamRate && upstreamRate > 0
                                    ? t('Upstream rate: 1 CNY = {{rate}} USD', {
                                        rate: upstreamRate.toFixed(4),
                                      })
                                    : t('Upstream rate not configured in channel')}
                                </div>
                              </div>

                              <RadioGroup
                                value={draft.pricingMode}
                                onValueChange={(value) =>
                                  updateChannelPricingDraft(channel.id, (prev) => ({
                                    ...prev,
                                    pricingMode: value as PricingMode,
                                  }))
                                }
                              >
                                <div className='flex items-center space-x-2'>
                                  <RadioGroupItem
                                    value='per-token'
                                    id={`channel-${channel.id}-per-token`}
                                  />
                                  <Label
                                    htmlFor={`channel-${channel.id}-per-token`}
                                    className='font-normal'
                                  >
                                    {t('按量计费')}
                                  </Label>
                                </div>
                                <div className='flex items-center space-x-2'>
                                  <RadioGroupItem
                                    value='per-request'
                                    id={`channel-${channel.id}-per-request`}
                                  />
                                  <Label
                                    htmlFor={`channel-${channel.id}-per-request`}
                                    className='font-normal'
                                  >
                                    {t('按次计费')}
                                  </Label>
                                </div>
                              </RadioGroup>

                              {draft.pricingMode === 'per-request' ? (
                                <div className='space-y-2'>
                                  <Label>{t('Fixed price (USD)')}</Label>
                                  <Input
                                    type='text'
                                    placeholder='0.01'
                                    value={draft.price}
                                    onChange={(e) => {
                                      const value = e.target.value
                                      if (!isValidNumber(value)) return
                                      updateChannelPricingDraft(
                                        channel.id,
                                        (prev) => ({
                                          ...prev,
                                          price: value,
                                        })
                                      )
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className='grid gap-4 md:grid-cols-3'>
                                  <div className='space-y-2'>
                                    <Label>{t('Prompt price (USD / million tokens)')}</Label>
                                    <Input
                                      type='text'
                                      placeholder='2.0'
                                      value={draft.promptPrice}
                                      onChange={(e) => {
                                        const value = e.target.value
                                        if (!isValidNumber(value)) return
                                        updateChannelPricingDraft(
                                          channel.id,
                                          (prev) => ({
                                            ...prev,
                                            promptPrice: value,
                                          })
                                        )
                                      }}
                                    />
                                  </div>
                                  <div className='space-y-2'>
                                    <Label>
                                      {t('Completion price (USD / million tokens)')}
                                    </Label>
                                    <Input
                                      type='text'
                                      placeholder='4.0'
                                      value={draft.completionPrice}
                                      onChange={(e) => {
                                        const value = e.target.value
                                        if (!isValidNumber(value)) return
                                        updateChannelPricingDraft(
                                          channel.id,
                                          (prev) => ({
                                            ...prev,
                                            completionPrice: value,
                                          })
                                        )
                                      }}
                                    />
                                  </div>
                                  <div className='space-y-2'>
                                    <Label>{t('Cache ratio')}</Label>
                                    <Input
                                      type='text'
                                      placeholder='0.1'
                                      value={draft.cacheRatio}
                                      onChange={(e) => {
                                        const value = e.target.value
                                        if (!isValidNumber(value)) return
                                        updateChannelPricingDraft(
                                          channel.id,
                                          (prev) => ({
                                            ...prev,
                                            cacheRatio: value,
                                          })
                                        )
                                      }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <Separator />
              </>
            )}

            {showStatusSection && (
              <div className='space-y-4'>
                <h3 className='text-sm font-semibold'>{t('Status')}</h3>

                <FormField
                  control={form.control}
                  name='status'
                  render={({ field }) => (
                    <FormItem className='flex items-center justify-between rounded-lg border p-4'>
                      <div className='space-y-0.5'>
                        <FormLabel className='text-base'>
                          {t('Enabled')}
                        </FormLabel>
                        <FormDescription>
                          {t('Enable or disable this model')}
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
              </div>
            )}
          </form>
        </Form>

        <SheetFooter className='gap-2'>
          <SheetClose asChild>
            <Button variant='outline' disabled={isSubmitting}>
              {t('Cancel')}
            </Button>
          </SheetClose>
          <Button form='model-form' type='submit' disabled={isSubmitting}>
            {isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {isEditing ? t('Update Model') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
