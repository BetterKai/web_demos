/**
 * 单个文件的当前状态：等待、下载中、成功或失败。
 */
export type FileStatus = 'pending' | 'downloading' | 'success' | 'failed'

/**
 * 描述某个下载条目的元数据与当前状态。
 */
export interface DownloadRequest {
  id: string
  url: string
  filename: string
  status: FileStatus
  attempts: number
  error?: string
}

/**
 * 外部可配置的任务参数，主要控制并发、重试与落盘方式。
 */
export interface DownloadTaskOptions {
  concurrency?: number
  maxRetries?: number
  retryDelayMs?: number
  directory?: FileSystemDirectoryHandle | null
  onProgress?: (progress: DownloadProgressSnapshot) => void
}

/**
 * 供 UI 订阅的进度快照，包括整体进度与每个条目的状态。
 */
export interface DownloadProgressSnapshot {
  total: number
  completed: number
  successes: number
  failures: number
  entries: DownloadRequest[]
  status: 'idle' | 'running' | 'completed'
}

/**
 * runDownloadTask 最终返回的结果，供调用方做统计或重试。
 */
export interface DownloadResult {
  successes: DownloadRequest[]
  failures: DownloadRequest[]
}

/**
 * 内部使用的参数结构，所有可选项都会落到明确的默认值。
 */
type NormalizedOptions = {
  concurrency: number
  maxRetries: number
  retryDelayMs: number
  directory?: FileSystemDirectoryHandle | null
  onProgress?: (progress: DownloadProgressSnapshot) => void
}

/**
 * 默认配置：3 并发、3 次重试、初始间隔 500ms。
 */
const defaultOptions: NormalizedOptions = {
  concurrency: 3,
  maxRetries: 3,
  retryDelayMs: 500
}

/**
 * Promise 版延迟，用于重试退避。
 */
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * 生成任务 ID，优先使用 crypto.randomUUID，兜底使用随机串。
 */
const createTaskId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `task-${Math.random().toString(36).slice(2)}`

/**
 * 根据 URL 推断文件名，如果失败则按序号生成占位名。
 */
const inferFilename = (url: string, index: number) => {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname.split('/').filter(Boolean)
    const last = pathname.at(-1)
    if (last && last.includes('.')) {
      return last
    }
  } catch {
    // fall back if invalid URL
  }
  return `download-${index + 1}.jpg`
}

/**
 * File System Access API 写文件：创建句柄、写入并关闭。
 */
const saveBlobToDirectory = async (
  directory: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob
) => {
  const fileHandle = await directory.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

/**
 * 未选择目录时走浏览器下载逻辑：创建链接并自动点击。
 */
const triggerBrowserSave = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * 执行一次实际的下载与落盘。目录存在则写入目录，否则触发浏览器下载。
 */
const downloadFile = async (
  url: string,
  filename: string,
  directory?: FileSystemDirectoryHandle | null
) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const blob = await response.blob()
  if (directory) {
    await saveBlobToDirectory(directory, filename, blob)
  } else {
    triggerBrowserSave(filename, blob)
  }
}

/**
 * 更新外部订阅者的进度信息；为了避免引用共享，entries 做浅拷贝。
 */
const updateProgress = (
  requests: DownloadRequest[],
  status: DownloadProgressSnapshot['status'],
  onProgress?: (progress: DownloadProgressSnapshot) => void
) => {
  if (!onProgress) return
  const successes = requests.filter((entry) => entry.status === 'success').length
  const failures = requests.filter((entry) => entry.status === 'failed').length
  onProgress({
    total: requests.length,
    completed: successes + failures,
    successes,
    failures,
    entries: requests.map((entry) => ({ ...entry })),
    status
  })
}

/**
 * 执行一组下载请求，内部实现有界并发 + 指数退避重试。
 */
export async function runDownloadTask(
  urls: string[],
  options: DownloadTaskOptions = {}
): Promise<DownloadResult> {
  if (!urls.length) {
    return { successes: [], failures: [] }
  }

  const mergedOptions: NormalizedOptions = { ...defaultOptions, ...options }
  const requests: DownloadRequest[] = urls.map((url, index) => ({
    id: createTaskId(),
    url,
    filename: inferFilename(url, index),
    status: 'pending',
    attempts: 0
  }))

  updateProgress(requests, 'idle', mergedOptions.onProgress)

  const queue = [...requests]
  let active = 0

  /**
   * 单个 worker：从队列取任务，执行下载，完成后递归触发下一项。
   */
  const processNext = async (): Promise<void> => {
    if (!queue.length) {
      return
    }
    const item = queue.shift()
    if (!item) return

    active += 1
    item.status = 'downloading'
    updateProgress(requests, 'running', mergedOptions.onProgress)

    try {
      await downloadWithRetry(item, mergedOptions)
      updateProgress(requests, 'running', mergedOptions.onProgress)
    } finally {
      active -= 1
      if (queue.length) {
        await processNext()
      }
    }
  }

  const workers = Array.from({ length: mergedOptions.concurrency }, () => processNext())
  await Promise.all(workers)

  updateProgress(requests, 'completed', mergedOptions.onProgress)

  return {
    successes: requests.filter((entry) => entry.status === 'success'),
    failures: requests.filter((entry) => entry.status === 'failed')
  }
}

/**
 * 针对单个文件的下载与重试逻辑，失败会逐步放大等待时间。
 */
const downloadWithRetry = async (request: DownloadRequest, options: NormalizedOptions) => {
  const { maxRetries, retryDelayMs, directory } = options
  let attempt = 0
  let lastError: unknown = null

  while (attempt <= maxRetries) {
    try {
      request.attempts += 1
      await downloadFile(request.url, request.filename, directory)
      request.status = 'success'
      request.error = undefined
      return
    } catch (error) {
      lastError = error
      request.error = error instanceof Error ? error.message : String(error)
      attempt += 1
      if (attempt > maxRetries) {
        break
      }
      const backoff = retryDelayMs * Math.pow(2, attempt - 1)
      await sleep(backoff)
    }
  }

  request.status = 'failed'
  request.error =
    request.error ??
    (lastError instanceof Error ? lastError.message : 'Unknown download error')
}

