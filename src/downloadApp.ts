import { runDownloadTask, type DownloadProgressSnapshot } from './downloadManager'
import { DownloadAppView, type UiConfig } from './downloadAppView'

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
  }
}

/**
 * 组件内部需要维护的状态集合。
 */
type AppState = {
  directoryHandle: FileSystemDirectoryHandle | null
  progress: DownloadProgressSnapshot | null
  failedUrls: string[]
  isRunning: boolean
  message: string
}

/**
 * DownloadApp 负责协调视图与下载任务。
 */
export class DownloadApp {
  private readonly rootSelector: string

  private readonly state: AppState = {
    directoryHandle: null,
    progress: null,
    failedUrls: [],
    isRunning: false,
    message: ''
  }

  private view?: DownloadAppView

  constructor(rootSelector: string) {
    this.rootSelector = rootSelector
  }

  init() {
    const root = document.querySelector<HTMLDivElement>(this.rootSelector) ?? undefined
    if (!root) {
      throw new Error(`未找到 ${this.rootSelector} 容器`)
    }
    this.view = new DownloadAppView(root)
    this.bindEvents()
    this.renderProgress()
  }

  /**
   * 绑定 UI 事件至业务逻辑。
   */
  private bindEvents() {
    if (!this.view) return
    this.view.onPickDirectory(() => {
      void this.pickDirectory()
    })
    this.view.onStart(() => {
      const urls = this.parseUrls()
      void this.startTask(urls)
    })
    this.view.onRetryFailed(() => {
      if (!this.state.failedUrls.length) return
      void this.startTask(this.state.failedUrls)
    })
  }

  /**
   * 调起目录选择器，兼容不支持 File System Access 的浏览器。
   */
  private async pickDirectory() {
    if (!this.view) return
    if (!window.showDirectoryPicker) {
      this.state.message = '当前浏览器不支持目录访问 API，将使用默认下载目录。'
      this.renderMessage()
      return
    }
    try {
      const handle = await window.showDirectoryPicker()
      this.state.directoryHandle = handle
      this.view.updateDirectoryLabel(`当前：${handle.name}`)
      this.state.message = `已选择目录：${handle.name}`
      this.renderMessage()
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') {
        return
      }
      this.state.message = '选择目录失败'
      this.renderMessage()
    }
  }

  /**
   * 将文本域中的 url 按行解析并过滤空行。
   */
  private parseUrls() {
    return this.view?.readUrls() ?? []
  }

  private readConfig(): UiConfig {
    return this.view?.readConfig() ?? {
      concurrency: 3,
      maxRetries: 0,
      retryDelayMs: 500
    }
  }

  /**
   * 渲染提示文案，集中管理消息来源。
   */
  private renderMessage() {
    this.view?.renderMessage(this.state.message)
  }

  /**
   * 根据进度快照更新顶层 summary 和列表。
   */
  private renderProgress(snapshot: DownloadProgressSnapshot | null = this.state.progress) {
    this.view?.renderProgress(snapshot)
  }

  /**
   * 根据运行状态控制按钮禁用与重试可见性。
   */
  private setRunningState(running: boolean) {
    this.state.isRunning = running
    this.view?.setRunningState(running, this.state.failedUrls.length > 0)
  }

  /**
   * 下载任务入口：读取配置、调用 runDownloadTask 并处理结果。
   */
  private async startTask(urls: string[]) {
    if (!urls.length) {
      this.state.message = '请至少输入一个有效的 URL'
      this.renderMessage()
      return
    }
    this.setRunningState(true)
    this.state.message = '正在下载...'
    this.renderMessage()
    this.state.failedUrls = []
    this.state.progress = null
    this.renderProgress(null)

    const uiConfig = this.readConfig()

    try {
      const result = await runDownloadTask(urls, {
        ...uiConfig,
        directory: this.state.directoryHandle,
        onProgress: (snap) => {
          this.state.progress = snap
          this.renderProgress(snap)
        }
      })

      this.state.failedUrls = result.failures.map((item) => item.url)
      this.state.message = `下载完成：成功 ${result.successes.length} 个，失败 ${result.failures.length} 个`
      this.renderMessage()
    } catch (error) {
      this.state.message =
        error instanceof Error ? `任务失败：${error.message}` : '任务执行失败'
      this.renderMessage()
    } finally {
      this.setRunningState(false)
    }
  }
}
