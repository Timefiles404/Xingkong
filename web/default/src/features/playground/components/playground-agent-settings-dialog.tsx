import { useState } from 'react'
import { nanoid } from 'nanoid'
import { Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getExternalProviderModels } from '../api'
import type {
  AgentExternalEndpointType,
  AgentExternalProvider,
  AgentSettings,
  ModelOption,
} from '../types'

interface PlaygroundAgentSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AgentSettings
  onSettingsChange: (updater: AgentSettings | ((prev: AgentSettings) => AgentSettings)) => void
  builtinModels: ModelOption[]
}

const tabs = [
  { key: 'provider', label: '模型渠道' },
  { key: 'context', label: '上下文压缩' },
  { key: 'appearance', label: '显示与提示词' },
] as const

function emptyProvider(): AgentExternalProvider {
  return {
    id: nanoid(),
    name: '自定义渠道',
    baseUrl: '',
    apiKey: '',
    endpointType: 'chat_completions',
    models: [],
  }
}

export function PlaygroundAgentSettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  builtinModels,
}: PlaygroundAgentSettingsDialogProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['key']>('provider')
  const [loadingProviderId, setLoadingProviderId] = useState<string | null>(null)

  const updateProvider = (
    id: string,
    updater: (provider: AgentExternalProvider) => AgentExternalProvider
  ) => {
    onSettingsChange((prev) => ({
      ...prev,
      externalProviders: prev.externalProviders.map((provider) =>
        provider.id === id ? updater(provider) : provider
      ),
    }))
  }

  const loadModels = async (provider: AgentExternalProvider) => {
    if (!provider.baseUrl.trim() || !provider.apiKey.trim()) {
      toast.error(t('请先填写 Base URL 和 API Key'))
      return
    }
    setLoadingProviderId(provider.id)
    try {
      const models = await getExternalProviderModels(
        provider.baseUrl,
        provider.apiKey,
        provider.endpointType
      )
      updateProvider(provider.id, (item) => ({
        ...item,
        models,
        selectedModel: item.selectedModel || models[0]?.value,
      }))
      toast.success(t('模型列表已更新'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('拉取模型失败'))
    } finally {
      setLoadingProviderId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[min(78vh,840px)] w-[calc(100vw-2rem)] max-w-none flex-col overflow-hidden p-0 sm:max-w-none md:w-[min(88vw,1120px)]'>
        <DialogHeader className='border-b px-6 py-4'>
          <DialogTitle>{t('Agent 设置')}</DialogTitle>
        </DialogHeader>
        <div className='grid min-h-0 flex-1 grid-cols-[220px_1fr]'>
          <aside className='bg-muted/30 border-r p-3'>
            {tabs.map((tab) => (
              <button
                className={cn(
                  'mb-1 flex w-full rounded-lg px-3 py-2 text-left text-sm',
                  activeTab === tab.key
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-background/70'
                )}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                type='button'
              >
                {t(tab.label)}
              </button>
            ))}
          </aside>
          <main className='min-h-0 overflow-y-auto p-6'>
            {activeTab === 'provider' && (
              <div className='space-y-6'>
                <section className='space-y-3'>
                  <div>
                    <h3 className='text-base font-semibold'>{t('模型提供商')}</h3>
                    <p className='text-muted-foreground text-sm'>
                      {t('内置渠道继续消耗 NewAPI 用户额度；外置渠道使用你自己的 API Key，每次模型请求额外扣除 0.05 美元 NewAPI 手续费。')}
                    </p>
                  </div>
                  <Select
                    value={settings.providerKind}
                    onValueChange={(value) =>
                      onSettingsChange((prev) => ({
                        ...prev,
                        providerKind: value as AgentSettings['providerKind'],
                      }))
                    }
                  >
                    <SelectTrigger className='w-52'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='builtin'>{t('内置渠道')}</SelectItem>
                      <SelectItem value='external'>{t('外置渠道')}</SelectItem>
                    </SelectContent>
                  </Select>
                </section>

                <section className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <h3 className='text-base font-semibold'>{t('外置渠道')}</h3>
                    <Button
                      size='sm'
                      type='button'
                      variant='outline'
                      onClick={() =>
                        onSettingsChange((prev) => {
                          const provider = emptyProvider()
                          return {
                            ...prev,
                            providerKind: 'external',
                            activeExternalProviderId:
                              prev.activeExternalProviderId || provider.id,
                            externalProviders: [
                              ...prev.externalProviders,
                              provider,
                            ],
                          }
                        })
                      }
                    >
                      <PlusIcon className='mr-2 size-4' />
                      {t('添加渠道')}
                    </Button>
                  </div>
                  <div className='space-y-3'>
                    {settings.externalProviders.map((provider) => (
                      <div className='rounded-xl border p-4' key={provider.id}>
                        <div className='mb-4 flex items-center justify-between gap-3'>
                          <Input
                            className='max-w-xs font-medium'
                            value={provider.name}
                            onChange={(event) =>
                              updateProvider(provider.id, (item) => ({
                                ...item,
                                name: event.target.value,
                              }))
                            }
                          />
                          <div className='flex items-center gap-2'>
                            <Button
                              size='sm'
                              type='button'
                              variant={
                                settings.activeExternalProviderId === provider.id
                                  ? 'default'
                                  : 'outline'
                              }
                              onClick={() =>
                                onSettingsChange((prev) => ({
                                  ...prev,
                                  providerKind: 'external',
                                  activeExternalProviderId: provider.id,
                                }))
                              }
                            >
                              {t('设为当前')}
                            </Button>
                            <Button
                              size='icon'
                              type='button'
                              variant='ghost'
                              onClick={() =>
                                onSettingsChange((prev) => ({
                                  ...prev,
                                  externalProviders: prev.externalProviders.filter(
                                    (item) => item.id !== provider.id
                                  ),
                                  activeExternalProviderId:
                                    prev.activeExternalProviderId === provider.id
                                      ? undefined
                                      : prev.activeExternalProviderId,
                                }))
                              }
                            >
                              <Trash2Icon className='size-4' />
                            </Button>
                          </div>
                        </div>
                        <div className='grid gap-3 md:grid-cols-2'>
                          <div className='space-y-1.5'>
                            <Label>Base URL</Label>
                            <Input
                              placeholder='https://api.openai.com/v1'
                              value={provider.baseUrl}
                              onChange={(event) =>
                                updateProvider(provider.id, (item) => ({
                                  ...item,
                                  baseUrl: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className='space-y-1.5'>
                            <Label>API Key</Label>
                            <Input
                              type='password'
                              value={provider.apiKey}
                              onChange={(event) =>
                                updateProvider(provider.id, (item) => ({
                                  ...item,
                                  apiKey: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className='space-y-1.5'>
                            <Label>{t('端点类型')}</Label>
                            <Select
                              value={provider.endpointType}
                              onValueChange={(value) =>
                                updateProvider(provider.id, (item) => ({
                                  ...item,
                                  endpointType:
                                    value as AgentExternalEndpointType,
                                }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='chat_completions'>
                                  Chat Completions
                                </SelectItem>
                                <SelectItem value='responses'>Responses</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className='space-y-1.5'>
                            <Label>{t('模型')}</Label>
                            <div className='flex gap-2'>
                              <Select
                                value={provider.selectedModel || ''}
                                onValueChange={(value) =>
                                  updateProvider(provider.id, (item) => ({
                                    ...item,
                                    selectedModel: value,
                                  }))
                                }
                              >
                                <SelectTrigger className='min-w-0 flex-1'>
                                  <SelectValue placeholder={t('先拉取模型')} />
                                </SelectTrigger>
                                <SelectContent>
                                  {provider.models.map((model) => (
                                    <SelectItem
                                      key={model.value}
                                      value={model.value}
                                    >
                                      {model.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                disabled={loadingProviderId === provider.id}
                                onClick={() => void loadModels(provider)}
                                type='button'
                                variant='outline'
                              >
                                {loadingProviderId === provider.id && (
                                  <Loader2Icon className='mr-2 size-4 animate-spin' />
                                )}
                                {t('拉取')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {settings.externalProviders.length === 0 && (
                      <div className='text-muted-foreground rounded-xl border border-dashed p-6 text-sm'>
                        {t('还没有外置渠道。添加后可在输入框下方的渠道按钮中选择。')}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'context' && (
              <div className='max-w-2xl space-y-5'>
                <div className='flex items-center justify-between rounded-xl border p-4'>
                  <div>
                    <Label>{t('自动压缩上下文')}</Label>
                    <p className='text-muted-foreground text-sm'>
                      {t('达到阈值后，在工具调用结束或本轮回复结束时压缩旧消息。')}
                    </p>
                  </div>
                  <Switch
                    checked={settings.context.enabled}
                    onCheckedChange={(checked) =>
                      onSettingsChange((prev) => ({
                        ...prev,
                        context: { ...prev.context, enabled: checked },
                      }))
                    }
                  />
                </div>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div className='space-y-1.5'>
                    <Label>{t('上下文窗口 token')}</Label>
                    <Input
                      min={8000}
                      type='number'
                      value={settings.context.contextLimit}
                      onChange={(event) =>
                        onSettingsChange((prev) => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            contextLimit: Number(event.target.value) || 128000,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>{t('压缩阈值')}</Label>
                    <Input
                      max={0.98}
                      min={0.5}
                      step={0.01}
                      type='number'
                      value={settings.context.compactThresholdRatio}
                      onChange={(event) =>
                        onSettingsChange((prev) => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            compactThresholdRatio:
                              Number(event.target.value) || 0.9,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>{t('保留最近用户轮数')}</Label>
                    <Input
                      min={1}
                      type='number'
                      value={settings.context.tailTurns}
                      onChange={(event) =>
                        onSettingsChange((prev) => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            tailTurns: Number(event.target.value) || 4,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className='rounded-xl border p-4'>
                  <div className='mb-3'>
                    <Label>{t('摘要模型')}</Label>
                    <p className='text-muted-foreground text-sm'>
                      {t('触发压缩时调用该模型生成真实摘要；失败时会使用本地兜底摘要。')}
                    </p>
                  </div>
                  <div className='grid gap-3 md:grid-cols-3'>
                    <div className='space-y-1.5'>
                      <Label>{t('摘要渠道')}</Label>
                      <Select
                        value={settings.context.summaryProviderKind}
                        onValueChange={(value) =>
                          onSettingsChange((prev) => ({
                            ...prev,
                            context: {
                              ...prev.context,
                              summaryProviderKind:
                                value as AgentSettings['providerKind'],
                            },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='builtin'>{t('内置渠道')}</SelectItem>
                          <SelectItem value='external'>{t('外置渠道')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {settings.context.summaryProviderKind === 'external' ? (
                      <>
                        <div className='space-y-1.5'>
                          <Label>{t('外置渠道')}</Label>
                          <Select
                            value={
                              settings.context.summaryExternalProviderId ||
                              settings.activeExternalProviderId ||
                              settings.externalProviders[0]?.id ||
                              ''
                            }
                            onValueChange={(value) =>
                              onSettingsChange((prev) => ({
                                ...prev,
                                context: {
                                  ...prev.context,
                                  summaryExternalProviderId: value,
                                  summaryExternalModel: '',
                                },
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t('选择渠道')} />
                            </SelectTrigger>
                            <SelectContent>
                              {settings.externalProviders.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                  {provider.name || t('外置渠道')}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className='space-y-1.5'>
                          <Label>{t('摘要模型')}</Label>
                          <Select
                            value={settings.context.summaryExternalModel || '__current__'}
                            onValueChange={(value) =>
                              onSettingsChange((prev) => ({
                                ...prev,
                                context: {
                                  ...prev.context,
                                  summaryExternalModel:
                                    value === '__current__' ? '' : value,
                                },
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t('使用渠道当前模型')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='__current__'>
                                {t('使用渠道当前模型')}
                              </SelectItem>
                              {(
                                settings.externalProviders.find(
                                  (provider) =>
                                    provider.id ===
                                    (settings.context.summaryExternalProviderId ||
                                      settings.activeExternalProviderId)
                                )?.models || []
                              ).map((model) => (
                                <SelectItem key={model.value} value={model.value}>
                                  {model.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : (
                      <div className='space-y-1.5 md:col-span-2'>
                        <Label>{t('摘要模型')}</Label>
                        <Select
                          value={settings.context.summaryBuiltinModel || '__current__'}
                          onValueChange={(value) =>
                            onSettingsChange((prev) => ({
                              ...prev,
                              context: {
                                ...prev.context,
                                summaryBuiltinModel:
                                  value === '__current__' ? '' : value,
                              },
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('默认使用当前模型')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='__current__'>
                              {t('默认使用当前模型')}
                            </SelectItem>
                            {builtinModels.map((model) => (
                              <SelectItem key={model.value} value={model.value}>
                                {model.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className='max-w-3xl space-y-5'>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div className='space-y-1.5'>
                    <Label>{t('字号')}</Label>
                    <Input
                      min={12}
                      max={22}
                      type='number'
                      value={settings.context.fontSize}
                      onChange={(event) =>
                        onSettingsChange((prev) => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            fontSize: Number(event.target.value) || 16,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>{t('字体')}</Label>
                    <Input
                      placeholder={t('留空使用站点默认字体')}
                      value={settings.context.fontFamily}
                      onChange={(event) =>
                        onSettingsChange((prev) => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            fontFamily: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className='space-y-1.5'>
                  <Label>{t('Agent 附加系统提示词')}</Label>
                  <Textarea
                    className='min-h-52'
                    placeholder={t('这里的内容会附加到 Agent 系统提示词末尾')}
                    value={settings.context.systemPrompt}
                    onChange={(event) =>
                      onSettingsChange((prev) => ({
                        ...prev,
                        context: {
                          ...prev.context,
                          systemPrompt: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}
