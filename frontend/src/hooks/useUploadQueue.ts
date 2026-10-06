import { useCallback, useRef, useState } from 'react'
import { uploadObject } from '../api'
import type { PendingFile } from '../lib/fileTraversal'
import type { UploadTask } from '../types'

/** Bulk folder uploads can easily be hundreds of files — firing them all at
 * once saturates the browser's connection pool and the Drive API alike.
 * A small worker pool keeps throughput high without doing that. */
const MAX_CONCURRENT_UPLOADS = 4

let nextId = 0

export function useUploadQueue(onSettled: () => void) {
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const queueRef = useRef<UploadTask[]>([])
  const activeRef = useRef(0)

  const patchTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const pump = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length > 0) {
      const task = queueRef.current.shift()!
      activeRef.current++
      patchTask(task.id, { status: 'uploading' })

      uploadObject(task.bucket, task.key, task.file, {
        signal: task.controller.signal,
        onProgress: (loaded) => patchTask(task.id, { loaded }),
      })
        .then(() => patchTask(task.id, { status: 'done', loaded: task.size }))
        .catch((err) => {
          const canceled = err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED'
          patchTask(task.id, {
            status: canceled ? 'canceled' : 'error',
            error: canceled ? undefined : err?.response?.data?.message || err?.message || 'Upload failed',
          })
        })
        .finally(() => {
          activeRef.current--
          onSettled()
          pump()
        })
    }
  }, [patchTask, onSettled])

  const enqueue = useCallback(
    (bucket: string, prefix: string, files: PendingFile[]) => {
      const newTasks: UploadTask[] = files.map(({ file, relativePath }) => ({
        id: String(nextId++),
        bucket,
        key: prefix ? `${prefix}${relativePath}` : relativePath,
        relativePath,
        size: file.size,
        loaded: 0,
        status: 'queued' as const,
        file,
        controller: new AbortController(),
      }))
      setTasks((prev) => [...prev, ...newTasks])
      queueRef.current.push(...newTasks)
      pump()
    },
    [pump]
  )

  const cancelTask = useCallback(
    (id: string) => {
      const inQueue = queueRef.current.findIndex((t) => t.id === id)
      if (inQueue !== -1) {
        queueRef.current.splice(inQueue, 1)
        patchTask(id, { status: 'canceled' })
        return
      }
      setTasks((prev) => {
        const t = prev.find((x) => x.id === id)
        t?.controller.abort()
        return prev
      })
    },
    [patchTask]
  )

  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === 'queued' || t.status === 'uploading'))
  }, [])

  const dismissAll = useCallback(() => {
    queueRef.current = []
    setTasks((prev) => {
      prev.forEach((t) => t.status === 'uploading' && t.controller.abort())
      return []
    })
  }, [])

  return { tasks, enqueue, cancelTask, clearFinished, dismissAll }
}
