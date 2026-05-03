// =============================================================================
// WalkPathPanel — deterministic-path simulator (no LLM, no API).
// =============================================================================
//
// Renders an input form generated from the endpoint's resolved request schemas
// (bodySchema / querySchema / paramsSchema), discovers feature-flag toggles by
// walking the endpoint tree, and on submit runs the pure `computeWalkOrder`
// against the provided scope. The resulting walkOrder + decisions are emitted
// to the parent so EndpointView can step-animate the path.
// =============================================================================

import { useEffect, useMemo, useState, useCallback } from 'react'
import styles from './WalkPathPanel.module.css'
import type { CodeNode, EndpointNode, FlowControlNode } from '@topology/core'
import { computeWalkOrder, type WalkResult } from '@/sim/compute-walk-order'
import { buildFormFields, setByPath, coerceInputValue, type FormField } from '@/sim/build-form-fields'

interface FlagToggle {
  name: string
  source: 'env' | 'config' | 'sdk'
  provider?: string
}

interface Props {
  endpoint: EndpointNode
  /** Called when a walk result is computed; null on reset/close. */
  onWalk?: (walk: WalkResult | null) => void
  /** Called with the currently-active node id during step playback (or null). */
  onActiveNode?: (nodeId: string | null) => void
  onClose: () => void
}

// Walk the endpoint tree once to collect all unique feature-flag knobs.
function collectFlags(node: CodeNode | undefined, out: Map<string, FlagToggle> = new Map()): Map<string, FlagToggle> {
  if (!node) return out
  if (node.type === 'flowControl') {
    const ff = (node as FlowControlNode).metadata.featureFlag
    if (ff && !out.has(ff.name)) {
      out.set(ff.name, { name: ff.name, source: ff.source, provider: ff.provider })
    }
    const branches = (node as FlowControlNode).metadata.branches
    if (branches) {
      for (const b of branches) for (const c of b.children) collectFlags(c, out)
    }
  }
  for (const c of node.children) collectFlags(c, out)
  return out
}

function buildAllFields(ep: EndpointNode): { body: FormField[]; query: FormField[]; params: FormField[] } {
  return {
    body:   buildFormFields(ep.metadata.request.bodySchema,   { rootPath: '' }),
    query:  buildFormFields(ep.metadata.request.querySchema,  { rootPath: '' }),
    params: buildFormFields(ep.metadata.request.paramsSchema, { rootPath: '' }),
  }
}

export function WalkPathPanel({ endpoint, onWalk, onActiveNode, onClose }: Props) {
  const fields = useMemo(() => buildAllFields(endpoint), [endpoint])
  const flags  = useMemo(() => Array.from(collectFlags(endpoint).values()), [endpoint])

  const [values, setValues] = useState<Record<string, string>>({})
  const [flagState, setFlagState] = useState<Record<string, boolean>>({})
  const [walk, setWalk] = useState<WalkResult | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Reset whenever the endpoint changes.
  useEffect(() => {
    setValues({})
    setFlagState({})
    setWalk(null)
    setStep(0)
    setError(null)
    onWalk?.(null)
    onActiveNode?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint.id])

  // Drive the active-node callback whenever step advances.
  useEffect(() => {
    if (!walk) { onActiveNode?.(null); return }
    onActiveNode?.(walk.walkOrder[step] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk, step])

  const setVal = (path: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.type === 'checkbox' ? String((e.target as HTMLInputElement).checked) : e.target.value
    setValues(prev => ({ ...prev, [path]: v }))
  }

  const buildScope = useCallback((): Record<string, unknown> => {
    const body:   Record<string, unknown> = {}
    const query:  Record<string, unknown> = {}
    const params: Record<string, unknown> = {}
    const apply = (list: FormField[], target: Record<string, unknown>) => {
      for (const f of list) {
        const raw = values[f.path] ?? ''
        const val = coerceInputValue(f, raw)
        if (val === undefined) continue
        setByPath(target, f.path, val)
      }
    }
    apply(fields.body,   body)
    apply(fields.query,  query)
    apply(fields.params, params)

    // Build identifier scope mirroring what handlers see at runtime.
    const env: Record<string, string> = {}
    const features: Record<string, boolean> = {}
    for (const f of flags) {
      if (f.source === 'env') env[f.name] = flagState[f.name] ? 'true' : 'false'
      else features[f.name] = !!flagState[f.name]
    }

    return {
      req: { body, query, params, headers: {} },
      body, query, params,
      process: { env },
      config: { features, flags: features },
      features,
      featureFlags: features,
      flags: features,
    }
  }, [fields, flags, values, flagState])

  const run = useCallback(() => {
    try {
      const scope = buildScope()
      const result = computeWalkOrder(endpoint, scope)
      setWalk(result)
      // Land on the final step so the whole path is visible at once on first
      // run (active = last, everything before it = visited). Users can step
      // backwards to inspect individual decisions.
      setStep(Math.max(0, result.walkOrder.length - 1))
      setError(null)
      onWalk?.(result)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'walk failed')
    }
  }, [endpoint, buildScope, onWalk])

  const reset = useCallback(() => {
    setWalk(null)
    setStep(0)
    setError(null)
    onWalk?.(null)
    onActiveNode?.(null)
  }, [onWalk, onActiveNode])

  const stepPrev = () => setStep(s => Math.max(0, s - 1))
  const stepNext = () => setStep(s => Math.min((walk?.walkOrder.length ?? 1) - 1, s + 1))

  const decisionsByNode = useMemo(() => {
    const m = new Map<string, WalkResult['decisions'][number]>()
    if (walk) for (const d of walk.decisions) m.set(d.nodeId, d)
    return m
  }, [walk])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>walk path</span>
        <span className={styles.tag}>fase 8b</span>
        <button className={styles.closeBtn} onClick={onClose}>×</button>
      </div>

      <div className={styles.body}>
        {error && <span className={styles.error}>{error}</span>}

        {flags.length > 0 && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>feature flags</span>
            {flags.map(f => (
              <label key={f.name} className={styles.flagRow}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={!!flagState[f.name]}
                  onChange={e => setFlagState(prev => ({ ...prev, [f.name]: e.target.checked }))}
                />
                <span style={{ flex: 1 }}>{f.name}</span>
                <span className={styles.flagSource}>{f.provider ?? f.source}</span>
              </label>
            ))}
          </div>
        )}

        {(['params', 'query', 'body'] as const).map(group => {
          const list = fields[group]
          if (list.length === 0) return null
          return (
            <div key={group} className={styles.section}>
              <span className={styles.sectionTitle}>{group}</span>
              {list.map(f => (
                <FormFieldRow key={`${group}.${f.path}`} field={f} value={values[f.path] ?? ''} onChange={setVal(f.path)} />
              ))}
            </div>
          )
        })}

        {fields.body.length === 0 && fields.query.length === 0 && fields.params.length === 0 && flags.length === 0 && (
          <span className={styles.empty}>no inputs detected — endpoint has no resolved schemas or feature flags</span>
        )}

        <div className={styles.runRow}>
          <button className={styles.runBtn} onClick={run}>run walk</button>
          {walk && <button className={styles.clearBtn} onClick={reset}>reset</button>}
        </div>

        {walk && (
          <div className={styles.results}>
            <div className={styles.playRow}>
              <button className={styles.playBtn} onClick={stepPrev} disabled={step === 0} title="previous step">‹</button>
              <button className={styles.playBtn} onClick={stepNext} disabled={step >= walk.walkOrder.length - 1} title="next step">›</button>
              <span className={styles.stepCounter}>
                {walk.walkOrder.length === 0 ? 'empty walk' : `${step + 1} / ${walk.walkOrder.length}${walk.terminated ? ' · terminated' : ''}`}
              </span>
            </div>

            {walk.decisions.length > 0 && (
              <div className={styles.section}>
                <span className={styles.sectionTitle}>decisions</span>
                <div className={styles.decisions}>
                  {walk.decisions.map((d, i) => (
                    <div key={i} className={`${styles.decisionRow} ${styles[d.outcome] ?? ''}`}>
                      <span className={styles.decisionOutcome}>{d.outcome}</span>
                      <span className={styles.decisionLabel}>{d.branchLabel ?? '—'}</span>
                      <span className={styles.decisionOutcome}>{decisionsByNode.has(d.nodeId) ? d.skippedLabels.join(', ') : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FormFieldRow({ field, value, onChange }: {
  field: FormField
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
}) {
  return (
    <div className={styles.fieldRow}>
      <label className={`${styles.fieldLabel} ${field.required ? styles.required : ''}`} title={field.path || '(root)'}>
        {field.label || field.path || '(root)'}
        {field.raw && <span className={styles.fieldHint}> · {field.raw}</span>}
      </label>
      {renderInput(field, value, onChange)}
    </div>
  )
}

function renderInput(
  field: FormField,
  value: string,
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void,
) {
  switch (field.kind) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={value === 'true'}
          onChange={e => onChange({ ...e, target: { ...e.target, value: String(e.target.checked) } } as unknown as React.ChangeEvent<HTMLInputElement>)}
        />
      )
    case 'number':
      return <input type="number" className={styles.input} value={value} onChange={onChange} />
    case 'date':
      return <input type="datetime-local" className={styles.input} value={value} onChange={onChange} />
    case 'enum':
      return (
        <select className={styles.select} value={value} onChange={onChange}>
          <option value="">{field.required ? '— select —' : '(unset)'}</option>
          {(field.options ?? []).map(o => (
            <option key={String(o)} value={String(o)}>{o === null ? 'null' : String(o)}</option>
          ))}
        </select>
      )
    case 'literal':
      return <input className={styles.input} value={String(field.options?.[0] ?? '')} disabled />
    case 'json':
      return <textarea className={styles.textarea} value={value} onChange={onChange} placeholder='e.g. ["a","b"]' />
    case 'string':
    default:
      return <input className={styles.input} value={value} onChange={onChange} />
  }
}
