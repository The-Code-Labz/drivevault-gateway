import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, File, Loader2, X, XCircle } from 'lucide-react'
import type { UploadTask } from '../types'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/** Google-Drive-style floating upload tray, pinned to the bottom-right. One
 * row per file with a live progress bar, final state icon, and a per-file
 * cancel/dismiss control. Collapsible, and only renders at all once there's
 * at least one task to show. */
export default function UploadPanel({
  tasks,
  onCancel,
  onDismissAll,
}: {
  tasks: UploadTask[]
  onCancel: (id: string) => void
  onDismissAll: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  const { done, errored, active, total } = useMemo(() => {
    return {
      done: tasks.filter((t) => t.status === 'done').length,
      errored: tasks.filter((t) => t.status === 'error').length,
      active: tasks.filter((t) => t.status === 'queued' || t.status === 'uploading').length,
      total: tasks.length,
    }
  }, [tasks])

  if (total === 0) return null

  const headline =
    active > 0
      ? `Uploading ${active} item${active === 1 ? '' : 's'}${done > 0 ? ` · ${done} done` : ''}`
      : errored > 0
        ? `${done} uploaded, ${errored} failed`
        : `${done} upload${done === 1 ? '' : 's'} complete`

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg sm:bottom-4 sm:right-4 max-sm:bottom-3 max-sm:left-3 max-sm:right-3 max-sm:w-auto">
      {/* Screen readers get a throttled summary instead of per-percent noise. */}
      <span className="sr-only" role="status" aria-live="polite">{headline}</span>

      <div className="flex items-center justify-between bg-bg px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium tnum">
          {active > 0 && <Loader2 size={14} className="animate-spin text-primary motion-reduce:animate-none" />}
          {headline}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-gray-400 hover:bg-surface-raised hover:text-white"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={onDismissAll}
            className="rounded p-1 text-gray-400 hover:bg-surface-raised hover:text-white"
            title="Dismiss all"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <ul className="max-h-72 overflow-y-auto divide-y divide-border">
          {tasks.map((t) => {
            const pct = t.size > 0 ? Math.min(100, Math.round((t.loaded / t.size) * 100)) : t.status === 'done' ? 100 : 0
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <File size={16} className="shrink-0 text-gray-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate" title={t.relativePath}>{t.relativePath}</div>
                  {t.status === 'uploading' || t.status === 'queued' ? (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full origin-left bg-primary transition-transform duration-150 motion-reduce:transition-none"
                        style={{ transform: `scaleX(${pct / 100})`, width: '100%' }}
                      />
                    </div>
                  ) : t.status === 'error' ? (
                    <div className="truncate text-xs text-danger" title={t.error}>{t.error || 'Upload failed'}</div>
                  ) : (
                    <div className="tnum text-xs text-gray-500">{formatBytes(t.size)}</div>
                  )}
                </div>
                <div className="shrink-0">
                  {t.status === 'done' && <CheckCircle2 size={16} className="text-success" />}
                  {t.status === 'error' && <XCircle size={16} className="text-danger" />}
                  {(t.status === 'queued' || t.status === 'uploading') && (
                    <button onClick={() => onCancel(t.id)} className="rounded p-0.5 text-gray-500 hover:bg-surface-raised hover:text-white" title="Cancel">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
