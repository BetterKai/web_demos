import type { DownloadProgressSnapshot } from './downloadManager'

type AppRefs = {
  urls: HTMLTextAreaElement
  concurrency: HTMLInputElement
  retries: HTMLInputElement
  delay: HTMLInputElement
  pickDir: HTMLButtonElement
  dirLabel: HTMLSpanElement
  startTask: HTMLButtonElement
  retryFailed: HTMLButtonElement
  progressText: HTMLSpanElement
  statusBadge: HTMLDivElement
  successCount: HTMLElement
  failureCount: HTMLElement
  fileList: HTMLUListElement
  message: HTMLParagraphElement
}

export type UiConfig = {
  concurrency: number
  maxRetries: number
  retryDelayMs: number
}

/**
 * 负责 UI 渲染与 DOM 交互的薄层，业务逻辑由 DownloadApp 驱动。
 */
export class DownloadAppView {
  private refs: AppRefs

  constructor(private readonly root: HTMLDivElement) {
    this.renderLayout()
    this.refs = this.cacheRefs()
  }

  onPickDirectory(handler: () => void) {
    this.refs.pickDir.addEventListener('click', handler)
  }

  onStart(handler: () => void) {
    this.refs.startTask.addEventListener('click', handler)
  }

  onRetryFailed(handler: () => void) {
    this.refs.retryFailed.addEventListener('click', handler)
  }

  readUrls(): string[] {
    return this.refs.urls.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  readConfig(): UiConfig {
    return {
      concurrency: Number(this.refs.concurrency.value) || 3,
      maxRetries: Number(this.refs.retries.value) || 0,
      retryDelayMs: Number(this.refs.delay.value) || 500
    }
  }

  updateDirectoryLabel(label: string) {
    this.refs.dirLabel.textContent = label
  }

  renderMessage(message: string) {
    this.refs.message.textContent = message
  }

  renderProgress(snapshot: DownloadProgressSnapshot | null) {
    if (!snapshot) {
      this.refs.progressText.textContent = '0 / 0'
      this.refs.successCount.textContent = '0'
      this.refs.failureCount.textContent = '0'
      this.refs.statusBadge.textContent = '待开始'
      this.refs.statusBadge.className = 'badge badge-idle'
      this.refs.fileList.innerHTML = ''
      return
    }

    this.refs.progressText.textContent = `${snapshot.completed} / ${snapshot.total}`
    this.refs.successCount.textContent = String(snapshot.successes)
    this.refs.failureCount.textContent = String(snapshot.failures)

    const badgeMap: Record<DownloadProgressSnapshot['status'], string> = {
      idle: 'badge badge-idle',
      running: 'badge badge-running',
      completed: 'badge badge-completed'
    }
    const badgeTextMap: Record<DownloadProgressSnapshot['status'], string> = {
      idle: '待开始',
      running: '下载中',
      completed: '已完成'
    }
    this.refs.statusBadge.className = badgeMap[snapshot.status]
    this.refs.statusBadge.textContent = badgeTextMap[snapshot.status]

    this.refs.fileList.innerHTML = snapshot.entries
      .map(
        (entry) => `
        <li>
          <div>
            <span class="filename">${entry.filename}</span>
            <small>${entry.url}</small>
          </div>
          <span class="status ${entry.status}">
            ${entry.status === 'failed' ? `失败（${entry.error ?? '未知错误'}）` : entry.status}
          </span>
        </li>
      `
      )
      .join('')
  }

  setRunningState(running: boolean, hasRetryableFiles: boolean) {
    this.refs.startTask.disabled = running
    this.refs.retryFailed.disabled = running || !hasRetryableFiles
  }

  private renderLayout() {
    this.root.innerHTML = `
      <main class="download-app">
        <section class="panel">
          <h1>图片批量下载任务</h1>
          <div class="field">
            <label for="urls">图片 URL 列表（每行一个）</label>
            <textarea id="urls" placeholder="https://example.com/a.jpg&#10;https://example.com/b.png"></textarea>
          </div>
          <div class="field grid">
            <label>
              并发数
              <input type="number" id="concurrency" min="1" max="10" value="3" />
            </label>
            <label>
              最大重试次数
              <input type="number" id="retries" min="0" max="5" value="2" />
            </label>
            <label>
              初始重试间隔(ms)
              <input type="number" id="delay" min="100" step="100" value="500" />
            </label>
          </div>
          <div class="field actions">
            <button id="pickDir" type="button">选择下载目录</button>
            <span id="dirLabel">当前：浏览器默认下载目录</span>
          </div>
          <div class="field">
            <button id="startTask" type="button" class="primary">开始下载</button>
            <button id="retryFailed" type="button" class="ghost" disabled>重试失败文件</button>
          </div>
          <p class="message" id="statusMessage"></p>
        </section>
        <section class="panel">
          <h2>任务进度</h2>
          <div class="progress">
            <span id="progressText">0 / 0</span>
            <div id="statusBadge" class="badge badge-idle">待开始</div>
          </div>
          <div class="summary">
            <div>
              <strong id="successCount">0</strong>
              <p>成功</p>
            </div>
            <div>
              <strong id="failureCount">0</strong>
              <p>失败</p>
            </div>
          </div>
          <ul id="fileList" class="file-list"></ul>
        </section>
      </main>
    `
  }

  private cacheRefs(): AppRefs {
    return {
      urls: this.root.querySelector<HTMLTextAreaElement>('#urls')!,
      concurrency: this.root.querySelector<HTMLInputElement>('#concurrency')!,
      retries: this.root.querySelector<HTMLInputElement>('#retries')!,
      delay: this.root.querySelector<HTMLInputElement>('#delay')!,
      pickDir: this.root.querySelector<HTMLButtonElement>('#pickDir')!,
      dirLabel: this.root.querySelector<HTMLSpanElement>('#dirLabel')!,
      startTask: this.root.querySelector<HTMLButtonElement>('#startTask')!,
      retryFailed: this.root.querySelector<HTMLButtonElement>('#retryFailed')!,
      progressText: this.root.querySelector<HTMLSpanElement>('#progressText')!,
      statusBadge: this.root.querySelector<HTMLDivElement>('#statusBadge')!,
      successCount: this.root.querySelector<HTMLElement>('#successCount')!,
      failureCount: this.root.querySelector<HTMLElement>('#failureCount')!,
      fileList: this.root.querySelector<HTMLUListElement>('#fileList')!,
      message: this.root.querySelector<HTMLParagraphElement>('#statusMessage')!
    }
  }
}


