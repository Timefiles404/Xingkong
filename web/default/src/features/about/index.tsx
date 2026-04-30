import { BookOpen, Boxes, Cable, Compass, ImageIcon, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PublicLayout } from '@/components/layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TutorialCard = {
  title: string
  description: string
  icon: typeof BookOpen
  items: string[]
}

export function About() {
  const { i18n } = useTranslation()
  const isZh = i18n.language.toLowerCase().startsWith('zh')

  const cards: TutorialCard[] = isZh
    ? [
        {
          title: '接入地址',
          description: '默认提供 OpenAI 兼容接口，推荐优先使用标准 `/v1` 路径。',
          icon: Cable,
          items: [
            '主站地址：`https://new.xingkongai.online`',
            'API Base：`https://new.xingkongai.online/v1`',
            '控制台概览页中的 API 信息与这里保持一致。',
          ],
        },
        {
          title: '认证方式',
          description: '在控制台创建 API Key 后，将其作为 Bearer Token 传入即可。',
          icon: KeyRound,
          items: [
            '请求头：`Authorization: Bearer <你的密钥>`',
            '建议为不同项目单独创建密钥，便于日志和额度追踪。',
            '如调用失败，先检查密钥状态、额度和模型权限。',
          ],
        },
        {
          title: '模型使用',
          description: '可在“在线模型测试”里直接验证模型是否可用，再接入你的客户端。',
          icon: Boxes,
          items: [
            '聊天、推理、嵌入等模型统一从同一个入口访问。',
            '实际可见模型以渠道配置和模型管理结果为准。',
            '若模型列表异常，优先检查渠道可用性与模型映射。',
          ],
        },
        {
          title: '绘图能力',
          description: '绘图相关配置已并入新版控制台，适合统一管理图像生成入口。',
          icon: ImageIcon,
          items: [
            '仅在已开启绘图能力时向前台展示对应入口。',
            '建议先在后台完成模型、倍率和策略配置，再开放给用户。',
            '如无绘图需求，可在系统设置中保持关闭。',
          ],
        },
      ]
    : [
        {
          title: 'API Endpoints',
          description:
            'The service exposes OpenAI-compatible endpoints. Use the standard `/v1` path by default.',
          icon: Cable,
          items: [
            'Primary site: `https://new.xingkongai.online`',
            'API base: `https://new.xingkongai.online/v1`',
            'The overview page mirrors the same endpoint information.',
          ],
        },
        {
          title: 'Authentication',
          description:
            'Create an API key in the console and send it as a Bearer token.',
          icon: KeyRound,
          items: [
            'Header: `Authorization: Bearer <your-key>`',
            'Use separate keys per project for cleaner audit trails.',
            'If a request fails, check key status, quota, and model permissions first.',
          ],
        },
        {
          title: 'Model Access',
          description:
            'Validate availability in Online Model Testing before wiring a client.',
          icon: Boxes,
          items: [
            'Chat, reasoning, embeddings, and related capabilities share one gateway.',
            'Visible models depend on channel configuration and model management.',
            'If the catalog looks wrong, inspect channels and model mappings first.',
          ],
        },
        {
          title: 'Image Generation',
          description:
            'Drawing settings are managed directly in the new console UI.',
          icon: ImageIcon,
          items: [
            'Expose drawing features only after the backend configuration is ready.',
            'Set model, ratio, and policy defaults before enabling it for users.',
            'Keep it disabled if image generation is not part of your deployment.',
          ],
        },
      ]

  return (
    <PublicLayout>
      <div className='mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-14'>
        <section className='relative overflow-hidden rounded-[2rem] border border-border/60 bg-card/85 shadow-sm backdrop-blur'>
          <div
            aria-hidden
            className='absolute inset-0 opacity-70'
            style={{
              background: [
                'radial-gradient(circle at top left, oklch(0.82 0.11 230 / 0.22), transparent 32%)',
                'radial-gradient(circle at 80% 20%, oklch(0.78 0.12 170 / 0.18), transparent 28%)',
                'linear-gradient(135deg, transparent, oklch(0.97 0.01 250 / 0.22))',
              ].join(','),
            }}
          />
          <div className='relative grid gap-8 p-8 md:grid-cols-[1.15fr_0.85fr] md:p-12'>
            <div className='space-y-5'>
              <div className='inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-medium'>
                <BookOpen className='size-3.5' />
                {isZh ? '使用教程' : 'Tutorial'}
              </div>
              <div className='space-y-3'>
                <h1 className='text-3xl font-semibold tracking-tight md:text-5xl'>
                  {isZh ? '星空接入指南' : 'Xingkong Quick Start'}
                </h1>
                <p className='text-muted-foreground max-w-2xl text-sm leading-6 md:text-base'>
                  {isZh
                    ? '这里直接提供新版前端所需的核心说明：接入地址、认证方式、模型使用和绘图能力。页面样式会自动跟随当前明暗主题。'
                    : 'This page is now a first-party tutorial built directly into the new frontend. It covers endpoints, authentication, model usage, and image-generation setup.'}
                </p>
              </div>
            </div>
            <Card className='border-border/60 bg-background/75 shadow-none'>
              <CardHeader className='pb-3'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Compass className='size-4' />
                  {isZh ? '快速入口' : 'Quick Links'}
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                <div className='rounded-xl border border-border/60 bg-card px-4 py-3'>
                  <div className='font-medium'>{isZh ? '控制台入口' : 'Console'}</div>
                  <div className='text-muted-foreground mt-1 break-all'>
                    https://new.xingkongai.online
                  </div>
                </div>
                <div className='rounded-xl border border-border/60 bg-card px-4 py-3'>
                  <div className='font-medium'>API Base</div>
                  <div className='text-muted-foreground mt-1 break-all'>
                    https://new.xingkongai.online/v1
                  </div>
                </div>
                <div className='text-muted-foreground text-xs leading-5'>
                  {isZh
                    ? '建议先在“在线模型测试”验证模型和参数，再接入你自己的客户端或服务。'
                    : 'Validate models in Online Model Testing first, then wire the same configuration into your own client or service.'}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className='mt-6 grid gap-4 md:grid-cols-2'>
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <Card
                key={card.title}
                className='border-border/60 bg-card/80 shadow-sm backdrop-blur'
              >
                <CardHeader>
                  <CardTitle className='flex items-center gap-2 text-lg'>
                    <Icon className='size-5' />
                    {card.title}
                  </CardTitle>
                  <p className='text-muted-foreground text-sm leading-6'>
                    {card.description}
                  </p>
                </CardHeader>
                <CardContent>
                  <ul className='text-muted-foreground space-y-2 text-sm leading-6'>
                    {card.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </section>
      </div>
    </PublicLayout>
  )
}
