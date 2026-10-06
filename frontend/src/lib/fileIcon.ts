import {
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
} from 'lucide-react'

const EXT_MAP: Record<string, { icon: typeof FileIcon; className: string }> = {
  png: { icon: FileImage, className: 'text-purple-400' },
  jpg: { icon: FileImage, className: 'text-purple-400' },
  jpeg: { icon: FileImage, className: 'text-purple-400' },
  gif: { icon: FileImage, className: 'text-purple-400' },
  webp: { icon: FileImage, className: 'text-purple-400' },
  svg: { icon: FileImage, className: 'text-purple-400' },
  mp4: { icon: FileVideo, className: 'text-pink-400' },
  mov: { icon: FileVideo, className: 'text-pink-400' },
  webm: { icon: FileVideo, className: 'text-pink-400' },
  mkv: { icon: FileVideo, className: 'text-pink-400' },
  mp3: { icon: FileAudio, className: 'text-orange-400' },
  wav: { icon: FileAudio, className: 'text-orange-400' },
  flac: { icon: FileAudio, className: 'text-orange-400' },
  m4a: { icon: FileAudio, className: 'text-orange-400' },
  zip: { icon: FileArchive, className: 'text-yellow-600' },
  tar: { icon: FileArchive, className: 'text-yellow-600' },
  gz: { icon: FileArchive, className: 'text-yellow-600' },
  rar: { icon: FileArchive, className: 'text-yellow-600' },
  '7z': { icon: FileArchive, className: 'text-yellow-600' },
  csv: { icon: FileSpreadsheet, className: 'text-green-500' },
  xlsx: { icon: FileSpreadsheet, className: 'text-green-500' },
  xls: { icon: FileSpreadsheet, className: 'text-green-500' },
  txt: { icon: FileText, className: 'text-gray-400' },
  md: { icon: FileText, className: 'text-gray-400' },
  pdf: { icon: FileText, className: 'text-red-400' },
  js: { icon: FileCode, className: 'text-yellow-400' },
  ts: { icon: FileCode, className: 'text-blue-400' },
  tsx: { icon: FileCode, className: 'text-blue-400' },
  jsx: { icon: FileCode, className: 'text-blue-400' },
  json: { icon: FileCode, className: 'text-yellow-400' },
  py: { icon: FileCode, className: 'text-blue-300' },
  html: { icon: FileCode, className: 'text-orange-500' },
  css: { icon: FileCode, className: 'text-blue-500' },
}

/** Picks a Lucide icon + color for a file name based on its extension,
 * falling back to a plain generic file icon — mirrors the at-a-glance
 * file-type coloring Google Drive uses in its own list view. */
export function getFileIcon(name: string): { icon: typeof FileIcon; className: string } {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXT_MAP[ext] || { icon: FileIcon, className: 'text-gray-500' }
}
