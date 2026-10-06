import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import {
  listBuckets,
  createBucket,
  listObjects,
  deleteObject,
  getObjectUrl,
  getApiKey,
  setApiKey,
  getOAuthStatus,
  getOAuthConnectUrl,
} from './api'
import type { Bucket, DriveObject, OAuthStatus } from './types'
import { useUploadQueue } from './hooks/useUploadQueue'
import { flattenDataTransferItems, flattenFileList, type PendingFile } from './lib/fileTraversal'
import { getFileIcon } from './lib/fileIcon'
import UploadPanel from './components/UploadPanel'
import {
  HardDrive,
  Folder,
  FolderUp,
  Trash2,
  Upload,
  RefreshCw,
  Plus,
  Download,
  ChevronRight,
  KeyRound,
  LogIn,
  UploadCloud,
  Inbox,
} from 'lucide-react'

const OAUTH_POLL_MS = 5000

function ApiKeyControl({ onChange }: { onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(getApiKey())
  const hasKey = !!getApiKey()

  const save = () => {
    setApiKey(value.trim())
    setEditing(false)
    onChange()
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(getApiKey()); setEditing(true) }}
        className="btn-secondary"
        title={hasKey ? 'API key is set — click to change' : 'No API key set — click to set one'}
      >
        <KeyRound size={16} className={hasKey ? 'text-success' : 'text-neutral'} />
        {hasKey ? 'API key set' : 'Set API key'}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="x-api-key"
        className="input w-48"
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button onClick={save} className="btn-primary">Save</button>
      <button onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
    </div>
  )
}

function OAuthConnectControl() {
  const [status, setStatus] = useState<OAuthStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const s = await getOAuthStatus()
        if (!cancelled) setStatus(s)
      } catch {
        if (!cancelled) setStatus(null)
      }
    }
    poll()
    const id = setInterval(poll, OAUTH_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!status || status.authMode !== 'oauth') return null

  const handleConnect = () => {
    window.open(getOAuthConnectUrl(), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex items-center gap-2">
      {/* "Not connected" is a normal, expected state before first setup —
          it stays neutral gray, not red, so it doesn't read as an error. */}
      <span
        className={`badge ${status.connected ? 'bg-success-bg text-success' : 'bg-neutral-bg text-neutral'}`}
        role="status"
      >
        <span className={`badge-dot ${status.connected ? 'bg-success' : 'bg-neutral'}`} />
        {status.connected ? 'Google Drive connected' : 'Not connected'}
      </span>
      <button onClick={handleConnect} className="btn-primary">
        <LogIn size={16} /> {status.connected ? 'Reconnect' : 'Connect Google Drive'}
      </button>
    </div>
  )
}

function formatBytes(n?: string) {
  const bytes = parseInt(n || '0', 10)
  if (bytes === 0) return '—'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function Breadcrumb({ prefix, onNavigate }: { prefix: string; onNavigate: (p: string) => void }) {
  const parts = prefix.split('/').filter(Boolean)
  return (
    <nav aria-label="Current path" className="flex items-center gap-2 text-sm text-gray-400">
      <button onClick={() => onNavigate('')} className="rounded hover:text-white">Home</button>
      {parts.map((part, idx) => {
        const path = parts.slice(0, idx + 1).join('/') + '/'
        const isLast = idx === parts.length - 1
        return (
          <div key={path} className="flex items-center gap-2">
            <ChevronRight size={14} />
            <button
              onClick={() => onNavigate(path)}
              aria-current={isLast ? 'location' : undefined}
              className={`rounded hover:text-white ${isLast ? 'font-medium text-gray-200' : ''}`}
            >
              {part}
            </button>
          </div>
        )
      })}
    </nav>
  )
}

function Home() {
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  const [objects, setObjects] = useState<DriveObject[]>([])
  const [prefixes, setPrefixes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newBucketName, setNewBucketName] = useState('')
  const [showNewBucket, setShowNewBucket] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  // Refs mirror the "currently viewed" bucket/prefix so a background
  // upload's completion callback always refreshes whatever the user is
  // actually looking at right now, not whatever was open when the upload
  // started (they may well have navigated to a different folder by then).
  const selectedBucketRef = useRef(selectedBucket)
  const prefixRef = useRef(prefix)
  useEffect(() => { selectedBucketRef.current = selectedBucket }, [selectedBucket])
  useEffect(() => { prefixRef.current = prefix }, [prefix])

  const loadBuckets = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listBuckets()
      setBuckets(data)
    } catch (err: any) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadObjects = async (bucket: string, p: string) => {
    setLoading(true)
    setError('')
    try {
      const data = await listObjects(bucket, p)
      setObjects(data.objects)
      setPrefixes(data.prefixes)
    } catch (err: any) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBuckets()
  }, [])

  useEffect(() => {
    if (selectedBucket) {
      loadObjects(selectedBucket, prefix)
    }
  }, [selectedBucket, prefix])

  const { tasks, enqueue, cancelTask, dismissAll } = useUploadQueue(() => {
    if (selectedBucketRef.current) loadObjects(selectedBucketRef.current, prefixRef.current)
  })

  const handleCreateBucket = async () => {
    if (!newBucketName.trim()) return
    try {
      await createBucket(newBucketName.trim())
      setNewBucketName('')
      setShowNewBucket(false)
      await loadBuckets()
    } catch (err: any) {
      setError(err.response?.data?.message || err.message)
    }
  }

  const handleFilesSelected = (pending: PendingFile[]) => {
    if (!selectedBucket || pending.length === 0) return
    enqueue(selectedBucket, prefix, pending)
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFilesSelected(flattenFileList(e.target.files))
    e.target.value = ''
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current++
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (!e.dataTransfer.items || e.dataTransfer.items.length === 0) return
    if (!selectedBucket) {
      setError('Open a bucket before dragging files in — drops land in whichever bucket/folder is currently open.')
      return
    }
    const pending = await flattenDataTransferItems(e.dataTransfer.items)
    handleFilesSelected(pending)
  }

  // Safety net: without this, dropping a file anywhere the React handlers
  // below don't cover (e.g. outside the root div's box, or if a future
  // layout change leaves a gap) falls through to the browser's native
  // "navigate to this file" behavior instead of silently doing nothing —
  // which is exactly what made this look broken rather than just inert.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const handleDelete = async (key: string) => {
    if (!selectedBucket) return
    if (!confirm(`Delete ${key}?`)) return
    try {
      await deleteObject(selectedBucket, key)
      await loadObjects(selectedBucket, prefix)
    } catch (err: any) {
      setError(err.response?.data?.message || err.message)
    }
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative min-h-screen p-6"
    >
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm motion-reduce:backdrop-blur-none">
          <div className="flex min-h-[220px] w-[min(420px,calc(100vw-32px))] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary bg-surface p-8 text-center shadow-lg">
            <UploadCloud size={40} className="text-primary" />
            <p className="text-sm font-semibold text-gray-100">
              {selectedBucket ? 'Drop files to upload' : 'Open a bucket first'}
            </p>
            <p className="text-xs text-gray-400">
              {selectedBucket
                ? `Destination: ${selectedBucket}/${prefix || ''}`
                : 'Drops land in whichever bucket is currently open.'}
            </p>
          </div>
        </div>
      )}

      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="text-primary" size={32} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">DriveVault Gateway</h1>
            <p className="text-sm text-gray-400">Google Drive exposed as S3-compatible object storage</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OAuthConnectControl />
          <ApiKeyControl onChange={loadBuckets} />
          <button onClick={loadBuckets} className="btn-secondary">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger-bg p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {!selectedBucket ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Buckets</h2>
            <button onClick={() => setShowNewBucket(true)} className="btn-primary">
              <Plus size={16} /> New bucket
            </button>
          </div>

          {showNewBucket && (
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                autoFocus
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
                placeholder="bucket-name"
                className="input flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateBucket()
                  if (e.key === 'Escape') setShowNewBucket(false)
                }}
              />
              <button onClick={handleCreateBucket} className="btn-primary">Create</button>
              <button onClick={() => setShowNewBucket(false)} className="btn-secondary">Cancel</button>
            </div>
          )}

          {loading ? (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-raised motion-reduce:animate-none" />
              ))}
            </div>
          ) : buckets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <HardDrive size={32} className="text-gray-600" />
              <p className="text-gray-400">No buckets yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {buckets.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBucket(b.name)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md motion-reduce:hover:translate-y-0"
                >
                  <Folder className="text-yellow-500" />
                  <div>
                    <div className="font-medium">{b.name}</div>
                    <div className="tnum text-xs text-gray-500">{b.createdTime ? new Date(b.createdTime).toLocaleDateString() : '—'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`rounded-xl border p-6 transition-colors ${
            isDragging ? 'border-primary bg-primary-subtle' : 'border-border bg-surface'
          }`}
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <button
                onClick={() => { setSelectedBucket(null); setPrefix('') }}
                className="text-sm text-primary hover:underline"
              >
                ← Back to buckets
              </button>
              <h2 className="mt-1 text-lg font-semibold">{selectedBucket}</h2>
              <Breadcrumb prefix={prefix} onNavigate={setPrefix} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => fileInputRef.current?.click()} className="btn-primary">
                <Upload size={16} /> Upload files
              </button>
              <button onClick={() => folderInputRef.current?.click()} className="btn-secondary">
                <FolderUp size={16} /> Upload folder
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
                {...({ webkitdirectory: 'true', directory: 'true' } as any)}
              />
              <button onClick={() => loadObjects(selectedBucket, prefix)} className="btn-ghost" title="Refresh objects">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="overflow-hidden rounded-lg border border-border" aria-live="polite" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex h-[52px] items-center gap-3 border-b border-border px-4 last:border-b-0">
                  <div className="h-4 w-4 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
                  <div className="h-3 w-48 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg">
                  <tr>
                    <th className="px-4 py-3 font-medium text-gray-400">Name</th>
                    <th className="px-4 py-3 font-medium text-gray-400">Size</th>
                    <th className="px-4 py-3 font-medium text-gray-400">Modified</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {prefixes.map((p) => (
                    <tr key={p} className="hover:bg-surface-raised">
                      <td className="px-4 py-3">
                        <button onClick={() => setPrefix(p)} className="flex items-center gap-2 text-primary hover:underline">
                          <Folder size={16} className="text-yellow-500" /> {p.slice(prefix.length).replace(/\/$/, '')}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-500">—</td>
                      <td className="px-4 py-3 text-gray-500">—</td>
                      <td className="px-4 py-3 text-right text-gray-500">—</td>
                    </tr>
                  ))}
                  {objects.map((o) => {
                    const { icon: Icon, className } = getFileIcon(o.name)
                    return (
                    <tr key={o.key} className="transition-colors hover:bg-surface-raised">
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon size={16} className={`shrink-0 ${className}`} />
                          <span className="truncate" title={o.name}>{o.name}</span>
                        </div>
                      </td>
                      <td className="tnum px-4 py-3">{formatBytes(o.size)}</td>
                      <td className="tnum px-4 py-3">{o.lastModified ? new Date(o.lastModified).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <a
                            href={getObjectUrl(selectedBucket, o.key)}
                            className="btn-ghost"
                            title={`Download ${o.name}`}
                          >
                            <Download size={16} />
                          </a>
                          <button
                            onClick={() => handleDelete(o.key)}
                            className="btn-destructive"
                            title={`Delete ${o.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                  {prefixes.length === 0 && objects.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-14 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-2">
                          <Inbox size={28} className="text-gray-600" />
                          <span>This folder is empty.</span>
                          <span className="text-xs text-gray-600">Drop files anywhere on this page, or choose files above.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <UploadPanel tasks={tasks} onCancel={cancelTask} onDismissAll={dismissAll} />
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}

export default App
