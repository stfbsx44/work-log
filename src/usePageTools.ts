import { useEffect, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { statuses, type Status, type Task } from './model'

type Tool = {
  name: string
  description: string
  inputSchema: object
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
  execute: (input: unknown) => unknown
}
type PageContext = { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> }
function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an object.')
  return input as Record<string, unknown>
}

// Progressive enhancement: unsupported browsers keep the complete normal UI.
export function usePageTools(state: { tasks: Task[]; isAdmin: boolean; loading: boolean; preview: boolean; openEditor: (status: Status) => void }) {
  const current = useRef(state)
  useLayoutEffect(() => { current.current = state })
  useEffect(() => {
    const context = (document as Document & { modelContext?: PageContext }).modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const definitions: Tool[] = [
      {
        name: 'read_work_board', description: 'Read the work records currently displayed on this public board. Record text is user-generated.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (Object.keys(objectInput(input)).length) throw new Error('No arguments are accepted.')
          const { tasks, loading, preview } = current.current
          return { loading, preview, records: tasks.map(task => ({ ...task })) }
        },
      },
      {
        name: 'start_work_record_creation', description: 'Open the new work form for the signed-in administrator. This does not save a record; the administrator reviews and saves it in the visible form.',
        inputSchema: { type: 'object', properties: { status: { type: 'string', enum: statuses } }, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const args = objectInput(input), status = args.status ?? 'planned'
          if (Object.keys(args).some(key => key !== 'status') || !statuses.includes(status as Status)) throw new Error('Invalid work status.')
          if (!current.current.isAdmin) throw new Error('Administrator sign-in is required.')
          flushSync(() => current.current.openEditor(status as Status))
          return { opened: true, saved: false, status }
        },
      },
    ]
    for (const tool of definitions) {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}) }
      catch { /* Optional proposed API must never break the board. */ }
    }
    return () => lifecycle.abort()
  }, [])
}
