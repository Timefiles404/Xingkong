// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'loading' | 'streaming' | 'complete' | 'error'

export type PlaygroundMode = 'chat' | 'agent'

export interface MessageVersion {
  id: string
  content: string
}

export interface PlaygroundAttachment {
  id: string
  type: 'image' | 'text'
  name: string
  mimeType?: string
  size?: number
  url?: string
  textContent?: string
}

export interface AgentToolDisplayResult {
  id?: string
  tool: string
  path: string
  ok: boolean
  status?: 'pending' | 'approved' | 'running' | 'denied' | 'complete'
  requiresApproval?: boolean
  summary?: string
  output?: string
  diff?: string
  error?: string
}

export interface Message {
  key: string
  from: MessageRole
  versions: MessageVersion[]
  apiContent?: string
  attachments?: PlaygroundAttachment[]
  isAgentToolResult?: boolean
  isAgentContextEvent?: boolean
  agentToolResults?: AgentToolDisplayResult[]
  agentResponsesOutputItems?: ResponsesOutputHistoryItem[]
  agentToolApprovalId?: string
  sources?: { href: string; title: string }[]
  reasoning?: {
    content: string
    duration: number
  }
  isReasoningStreaming?: boolean
  isReasoningComplete?: boolean
  isContentComplete?: boolean
  status?: MessageStatus
  errorCode?: string | null
}

// API payload types
export interface ChatCompletionMessage {
  role: MessageRole
  content: string | ContentPart[]
}

export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
  }
}

export interface ChatCompletionRequest {
  model: string
  group?: string
  messages: ChatCompletionMessage[]
  stream: boolean
  prompt_cache_key?: string
  reasoning_effort?: OpenAIReasoningEffort
  service_tier?: 'fast'
  temperature?: number
  top_p?: number
  max_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: MessageRole
      content?: string
      reasoning_content?: string
    }
    finish_reason: string | null
  }>
}

export interface ResponsesInputContentPart {
  type: 'input_text' | 'output_text' | 'input_image'
  text?: string
  image_url?: string
}

export interface ResponsesInputMessage {
  type: 'message'
  role: 'user' | 'assistant'
  content: ResponsesInputContentPart[]
}

export interface ResponsesFunctionCallItem {
  type: 'function_call'
  id?: string
  call_id: string
  name: string
  arguments: string
  status?: string
}

export interface ResponsesFunctionCallOutput {
  type: 'function_call_output'
  call_id: string
  output: string
}

export interface ResponsesReasoningOutputItem {
  type: 'reasoning'
  summary?: unknown[]
  encrypted_content?: string
  content?: unknown[]
  status?: string
}

export type ResponsesOutputHistoryItem =
  | ResponsesFunctionCallItem
  | ResponsesReasoningOutputItem

export type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesOutputHistoryItem
  | ResponsesFunctionCallOutput

export interface ResponsesFunctionTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ResponsesRequest {
  model: string
  group?: string
  input: ResponsesInputItem[]
  include?: string[]
  instructions?: string
  previous_response_id?: string
  stream: boolean
  store?: boolean
  prompt_cache_key?: string
  tools?: ResponsesFunctionTool[]
  tool_choice?: 'auto' | 'none'
  parallel_tool_calls?: boolean
  reasoning?: {
    effort: Exclude<OpenAIReasoningEffort, 'none'>
    summary?: 'auto' | 'concise' | 'detailed'
  }
  service_tier?: 'fast' | 'priority'
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
}

export interface ResponsesStreamEvent {
  type: string
  delta?: string
  item_id?: string
  call_id?: string
  arguments?: string | Record<string, unknown>
  item?: {
    type?: string
    id?: string
    call_id?: string
    name?: string
    arguments?: string | Record<string, unknown>
    summary?: unknown[]
    encrypted_content?: string
    status?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }
  part?: {
    type?: string
    text?: string
  }
  response?: {
    id?: string
    output?: Array<{
      type?: string
      id?: string
      call_id?: string
      name?: string
      arguments?: string | Record<string, unknown>
      summary?: unknown[]
      encrypted_content?: string
      status?: string
      content?: Array<{
        type?: string
        text?: string
      }>
    }>
    error?: {
      message?: string
      code?: string
      type?: string
    }
  }
  error?: {
    message?: string
    code?: string
    type?: string
  }
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: MessageRole
      content: string
      reasoning_content?: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Configuration types
export type OpenAIReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

export type OpenAIRequestMode = 'standard' | 'fast' | 'compatible'

export type AgentProviderKind = 'builtin' | 'external'

export type AgentExternalEndpointType = 'chat_completions' | 'responses'

export interface AgentExternalProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  endpointType: AgentExternalEndpointType
  models: ModelOption[]
  selectedModel?: string
}

export interface AgentContextSettings {
  enabled: boolean
  contextLimit: number
  compactThresholdRatio: number
  tailTurns: number
  fontSize: number
  fontFamily: string
  systemPrompt: string
  summaryProviderKind: AgentProviderKind
  summaryBuiltinModel?: string
  summaryExternalProviderId?: string
  summaryExternalModel?: string
}

export interface AgentSettings {
  providerKind: AgentProviderKind
  activeExternalProviderId?: string
  externalProviders: AgentExternalProvider[]
  context: AgentContextSettings
}

export interface AgentContextUsage {
  totalTokens: number
  limitTokens: number
  thresholdTokens: number
  compactedTokens: number
  userTokens: number
  assistantTokens: number
  toolTokens: number
  systemTokens: number
  feeUSD: number
  feeQuota: number
}

export interface PlaygroundConfig {
  model: string
  group: string
  openaiReasoningEffort: OpenAIReasoningEffort
  openaiRequestMode: OpenAIRequestMode
  /** @deprecated use openaiRequestMode instead. Kept for old localStorage data. */
  openaiFastMode: boolean
  temperature: number
  top_p: number
  max_tokens: number
  frequency_penalty: number
  presence_penalty: number
  seed: number | null
  stream: boolean
}

export interface ParameterEnabled {
  temperature: boolean
  top_p: boolean
  max_tokens: boolean
  frequency_penalty: boolean
  presence_penalty: boolean
  seed: boolean
}

// Model and group options
export interface ModelOption {
  label: string
  value: string
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export interface PlaygroundConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  mode?: PlaygroundMode
  workspaceName?: string
  agentPreviousResponseId?: string
  agentResponsesSentMessageCount?: number
  agentResponsesPendingToolCallIds?: string[]
  agentResponsesModel?: string
  agentResponsesWorkspaceName?: string
  agentResponsesStateVersion?: number
  agentContextSummary?: string
  agentContextSummaryUpdatedAt?: number
  agentContextCompactedBeforeKey?: string
  agentContextUsage?: AgentContextUsage
  messages: Message[]
}
