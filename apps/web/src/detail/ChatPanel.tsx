import React, { useEffect, useRef, useState } from 'react'
import { topologyApi } from '@/api/topology.api'
import type { ChatMessage, ChatToolCallTrace } from '@/api/types'
import { renderMarkdown } from '@/utils/markdown'
import styles from './ChatPanel.module.css'

interface UiMessage extends ChatMessage {
  /** Tool calls produced when generating this assistant message (only on assistant role). */
  trace?: ChatToolCallTrace[]
}

interface Props {
  /** Optional default topology context — surfaced in the header and sent with every request. */
  topologyId?: string
  open: boolean
  onClose: () => void
}

/**
 * Chat drawer that talks to the API tool-use agent (Fase 5b).
 *
 * Stateless on the server side: we re-send the entire transcript each round.
 * The trace returned from each call is attached to the resulting assistant
 * bubble so the user can audit which tools the agent invoked.
 */
export function ChatPanel({ topologyId, open, onClose }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [traceOpen, setTraceOpen] = useState<Record<number, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  // Esc to close (only when no input is focused)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const tag = (e.target as Element)?.tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') return
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function handleSend() {
    const text = input.trim()
    if (!text || pending) return
    setError(null)
    const newUser: UiMessage = { role: 'user', content: text }
    const next = [...messages, newUser]
    setMessages(next)
    setInput('')
    setPending(true)
    try {
      const res = await topologyApi.chat({
        messages: next.map(({ role, content }) => ({ role, content })),
        topologyId,
      })
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: res.reply || '(no reply)', trace: res.trace },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'chat request failed')
    } finally {
      setPending(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  function clearChat() {
    setMessages([])
    setError(null)
    setTraceOpen({})
  }

  return (
    <aside className={styles.drawer} role="dialog" aria-label="topology chat">
      <header className={styles.header}>
        <span className={styles.title}>chat</span>
        {topologyId && <span className={styles.contextPill}>{topologyId}</span>}
        <button className={styles.iconBtn} onClick={clearChat} title="clear conversation">clear</button>
        <button className={styles.iconBtn} onClick={onClose} title="close (esc)">×</button>
      </header>

      <div className={styles.messages} ref={scrollRef}>
        {messages.length === 0 && !pending && (
          <div className={styles.empty}>
            ask anything about your topologies.
            <div className={styles.emptyHint}>
              try: <code>"list topologies"</code>, <code>"what does endpoint X do?"</code>, <code>"what changed since last analysis?"</code>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={[
              styles.bubble,
              m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              m.role === 'user' ? 'bubble--user' : 'bubble--assistant',
            ].join(' ')}
          >
            <span className={styles.role}>{m.role}</span>
            {m.role === 'assistant' ? (
              <div
                className={`${styles.body} ${styles.bodyMd}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
              />
            ) : (
              <div className={styles.body}>{m.content}</div>
            )}
            {m.trace && m.trace.length > 0 && (
              <>
                <button
                  className={styles.traceToggle}
                  onClick={() => setTraceOpen(o => ({ ...o, [i]: !o[i] }))}
                >
                  {traceOpen[i] ? '▾' : '▸'} {m.trace.length} tool call{m.trace.length === 1 ? '' : 's'}
                </button>
                {traceOpen[i] && (
                  <div className={styles.trace}>
                    {m.trace.map((t, j) => (
                      <div
                        key={j}
                        className={[styles.traceItem, t.error ? styles.traceItemErr : ''].join(' ')}
                      >
                        <span className={styles.traceTool}>{t.tool}</span>
                        <span>{t.error ? `error: ${t.error}` : `${t.durationMs}ms`}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {pending && (
          <div className={styles.statusRow}>
            <span className={styles.spinner} />
            thinking…
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="ask a question…"
          disabled={pending}
        />
        <div className={styles.composerRow}>
          <span className={styles.hint}>⌘/ctrl+enter to send</span>
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={pending || !input.trim()}
          >
            send
          </button>
        </div>
      </div>
    </aside>
  )
}

interface FabProps {
  onClick: () => void
}

/** Small floating action button to open the chat drawer. */
export function ChatFab({ onClick }: FabProps) {
  return (
    <button className={styles.fab} onClick={onClick} title="open chat">
      ✦
    </button>
  )
}
