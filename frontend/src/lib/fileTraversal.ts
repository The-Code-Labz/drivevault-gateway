/** A file paired with the relative path it should be uploaded as — for a
 * plain file picker selection this is just the file name, for a folder
 * picker or a dropped directory it includes the folder structure. */
export interface PendingFile {
  file: File
  relativePath: string
}

/** Flattens a `FileList` from either a plain `<input type="file" multiple>`
 * or a `<input type="file" webkitdirectory>` selection. The latter populates
 * `file.webkitRelativePath` (e.g. "myFolder/sub/file.txt") on every file;
 * the former leaves it empty, so we fall back to just `file.name`. */
export function flattenFileList(files: FileList | File[]): PendingFile[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: (file as any).webkitRelativePath || file.name,
  }))
}

/** Recursively walks a dropped `DataTransferItemList`, resolving both plain
 * files and directories (via the non-standard but universally-supported
 * `webkitGetAsEntry` / `FileSystemEntry` APIs) into a flat list of
 * `{ file, relativePath }`. This is the only way to detect "a folder was
 * dropped" at all — a dropped directory never appears in `dataTransfer.files`
 * as a readable File, only as a traversable `FileSystemDirectoryEntry`. */
export async function flattenDataTransferItems(items: DataTransferItemList): Promise<PendingFile[]> {
  const entries: FileSystemEntry[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const entry = (item as any).webkitGetAsEntry?.() as FileSystemEntry | null
    if (entry) entries.push(entry)
  }

  const results: PendingFile[] = []
  await Promise.all(entries.map((entry) => walkEntry(entry, '', results)))
  return results
}

function walkEntry(entry: FileSystemEntry, pathPrefix: string, out: PendingFile[]): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      ;(entry as FileSystemFileEntry).file(
        (file) => {
          out.push({ file, relativePath: `${pathPrefix}${entry.name}` })
          resolve()
        },
        (err) => reject(err)
      )
    })
  }
  if (entry.isDirectory) {
    return readDirectoryEntries(entry as FileSystemDirectoryEntry).then(async (children) => {
      for (const child of children) {
        await walkEntry(child, `${pathPrefix}${entry.name}/`, out)
      }
    })
  }
  return Promise.resolve()
}

/** `readEntries()` only returns up to 100 entries per call and must be
 * called repeatedly until it returns an empty array to get the full
 * directory listing — a quirk of the File and Directory Entries API. */
function readDirectoryEntries(dirEntry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dirEntry.createReader()
  const all: FileSystemEntry[] = []
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject))

  return (async () => {
    let batch = await readBatch()
    while (batch.length > 0) {
      all.push(...batch)
      batch = await readBatch()
    }
    return all
  })()
}
