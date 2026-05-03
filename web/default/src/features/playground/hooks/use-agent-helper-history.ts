import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  loadHelperAgentConversations,
  saveHelperAgentConversations,
} from '../lib'
import type {
  AgentSettings,
  PlaygroundConversation,
  PlaygroundMode,
} from '../types'

interface UseAgentHelperHistoryOptions {
  isAgentMode: boolean
  helperHistoryKey: string
  conversations: PlaygroundConversation[]
  activeConversationId: string | null
  agentSettings: AgentSettings
  replaceModeConversations: (
    targetMode: PlaygroundMode,
    modeConversations: PlaygroundConversation[],
    nextActiveId?: string | null
  ) => void
  updateAgentSettings: (
    updater: AgentSettings | ((prev: AgentSettings) => AgentSettings)
  ) => void
  setConversationPersistenceEnabled: (enabled: boolean) => void
}

function isUnsupportedHelperHistoryError(error: unknown): boolean {
  return error instanceof Error && /unsupported_fs_op/i.test(error.message)
}

export function useAgentHelperHistory({
  isAgentMode,
  helperHistoryKey,
  conversations,
  activeConversationId,
  agentSettings,
  replaceModeConversations,
  updateAgentSettings,
  setConversationPersistenceEnabled,
}: UseAgentHelperHistoryOptions) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [supported, setSupported] = useState(true)
  const lastSavedRef = useRef('')

  useEffect(() => {
    if (!isAgentMode || !helperHistoryKey) {
      setReady(false)
      setSupported(true)
      setConversationPersistenceEnabled(true)
      return
    }

    let cancelled = false
    setConversationPersistenceEnabled(false)
    setReady(false)
    setSupported(true)
    lastSavedRef.current = ''

    const load = async () => {
      try {
        const state = await loadHelperAgentConversations()
        if (cancelled) return
        replaceModeConversations(
          'agent',
          state.conversations,
          state.activeConversationId
        )
        if (state.agentSettings) {
          updateAgentSettings(state.agentSettings)
        }
        setReady(true)
      } catch (error) {
        if (cancelled) return
        if (isUnsupportedHelperHistoryError(error)) {
          setSupported(false)
          setConversationPersistenceEnabled(true)
          toast.error(t('Helper is too old. Please download the latest helper.'))
          return
        }
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to load helper conversation history')
        )
        setReady(true)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [
    helperHistoryKey,
    isAgentMode,
    replaceModeConversations,
    setConversationPersistenceEnabled,
    t,
    updateAgentSettings,
  ])

  useEffect(() => {
    if (!ready || !helperHistoryKey || !supported) return
    const agentConversations = conversations.filter(
      (conversation) => (conversation.mode || 'chat') === 'agent'
    )
    const activeAgentId = agentConversations.some(
      (conversation) => conversation.id === activeConversationId
    )
      ? activeConversationId
      : agentConversations[0]?.id || null
    const serialized = JSON.stringify({
      conversations: agentConversations,
      activeConversationId: activeAgentId,
    })
    if (serialized === lastSavedRef.current) return

    const timer = window.setTimeout(() => {
      lastSavedRef.current = serialized
      void saveHelperAgentConversations({
        conversations: agentConversations,
        activeConversationId: activeAgentId,
        agentSettings,
      }).catch((error) => {
        lastSavedRef.current = ''
        if (isUnsupportedHelperHistoryError(error)) {
          setSupported(false)
          setConversationPersistenceEnabled(true)
          toast.error(t('Helper is too old. Please download the latest helper.'))
          return
        }
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to save helper conversation history')
        )
      })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [
    activeConversationId,
    agentSettings,
    conversations,
    helperHistoryKey,
    ready,
    setConversationPersistenceEnabled,
    supported,
    t,
  ])

  return { helperHistoryReady: ready, helperHistorySupported: supported }
}
