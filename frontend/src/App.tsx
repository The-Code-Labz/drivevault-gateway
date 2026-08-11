import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { listBuckets, createBucket, listObjects, deleteObject, uploadObject, getObjectUrl } from './api'
import type { Bucket, DriveObject } from './types'
import { HardDrive, Folder, File, Trash2, Upload, RefreshCw, Plus, Download, ChevronRight } from 'lucide-react'

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
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <button onClick={() => onNavigate('')} className="hover:text-white">Home</button>
      {parts.map((part, idx) => {
        const path = parts.slice(0, idx + 1).join('/') + '/'
        return (
          <div key={path} className="flex items-center gap-2">
            <ChevronRight size={14} />
            <button onClick={() => onNavigate(path)} className="hover:text-white">{part}</button>
          </div>
        )
      })}
    </div>
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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedBucket || !e.target.files || e.target.files.length === 0) return
    setLoading(true)
    setError('')
    try {
      for (const file of Array.from(e.target.files)) {
        const key = prefix ? `${prefix}${file.name}` : file.name
        await uploadObject(selectedBucket, key, file)
      }
      await loadObjects(selectedBucket, prefix)
    } catch (err: any) {
      setError(err.response?.data?.message || err.message)
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

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
    <div className="min-h-screen p-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="text-blue-500" size={32} />
          <div>
            <h1 className="text-2xl font-bold">DriveVault Gateway</h1>
            <p className="text-sm text-gray-400">Google Drive exposed as S3-compatible object storage</p>
          </div>
        </div>
        <button onClick={loadBuckets} className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2 hover:bg-gray-700">
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-900/30 p-3 text-red-200">{error}</div>
      )}

      {!selectedBucket ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Buckets</h2>
            <button
              onClick={() => setShowNewBucket(true)}
              className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500"
            >
              <Plus size={16} /> New bucket
            </button>
          </div>

          {showNewBucket && (
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
                placeholder="bucket-name"
                className="flex-1 rounded border border-gray-700 bg-gray-950 px-3 py-2"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateBucket()}
              />
              <button onClick={handleCreateBucket} className="rounded bg-blue-600 px-4 py-2 hover:bg-blue-500">Create</button>
              <button onClick={() => setShowNewBucket(false)} className="rounded bg-gray-800 px-4 py-2 hover:bg-gray-700">Cancel</button>
            </div>
          )}

          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : buckets.length === 0 ? (
            <p className="text-gray-400">No buckets yet. Create one to get started.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {buckets.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBucket(b.name)}
                  className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 p-4 text-left hover:border-blue-600"
                >
                  <Folder className="text-yellow-500" />
                  <div>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-gray-500">{b.createdTime ? new Date(b.createdTime).toLocaleDateString() : '—'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <button onClick={() => { setSelectedBucket(null); setPrefix('') }} className="text-sm text-blue-400 hover:underline">← Back to buckets</button>
              <h2 className="mt-1 text-lg font-semibold">{selectedBucket}</h2>
              <Breadcrumb prefix={prefix} onNavigate={setPrefix} />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500">
                <Upload size={16} /> Upload
                <input type="file" multiple className="hidden" onChange={handleUpload} />
              </label>
              <button onClick={() => loadObjects(selectedBucket, prefix)} className="rounded bg-gray-800 p-2 hover:bg-gray-700">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-950">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Size</th>
                    <th className="px-4 py-3">Modified</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {prefixes.map((p) => (
                    <tr key={p} className="hover:bg-gray-900">
                      <td className="px-4 py-3">
                        <button onClick={() => setPrefix(p)} className="flex items-center gap-2 text-blue-400 hover:underline">
                          <Folder size={16} className="text-yellow-500" /> {p.slice(prefix.length).replace(/\/$/, '')}
                        </button>
                      </td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3 text-right">—</td>
                    </tr>
                  ))}
                  {objects.map((o) => (
                    <tr key={o.key} className="hover:bg-gray-900">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <File size={16} className="text-gray-500" />
                          <span>{o.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatBytes(o.size)}</td>
                      <td className="px-4 py-3">{o.lastModified ? new Date(o.lastModified).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <a
                            href={getObjectUrl(selectedBucket, o.key)}
                            className="rounded bg-gray-800 p-2 hover:bg-gray-700"
                            title="Download"
                          >
                            <Download size={16} />
                          </a>
                          <button onClick={() => handleDelete(o.key)} className="rounded bg-red-900/40 p-2 text-red-300 hover:bg-red-900/60" title="Delete">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {prefixes.length === 0 && objects.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">This bucket is empty.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
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
