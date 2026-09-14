import { FilePlus2, FolderPlus, FolderSearch, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useIndexStore } from '@renderer/store/useIndexStore'

/** 扫描来源管理：用户可添加目录或单个数据库文件，并查看内置默认目录 */
export function ScanSourcesSection() {
  const config = useIndexStore((state) => state.config)
  const defaultDirs = useIndexStore((state) => state.defaultDirs)
  const loadingSources = useIndexStore((state) => state.loadingSources)
  const addDataDir = useIndexStore((state) => state.addDataDir)
  const addDataFile = useIndexStore((state) => state.addDataFile)
  const removeDataDir = useIndexStore((state) => state.removeDataDir)
  const removeDataFile = useIndexStore((state) => state.removeDataFile)
  const refreshSources = useIndexStore((state) => state.refreshSources)

  const dataDirs = config?.dataDirs ?? []
  const dataFiles = config?.dataFiles ?? []

  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-micro text-ink-600">扫描来源</h3>
        <button
          type="button"
          className="btn"
          onClick={() => void addDataFile()}
          title="添加单个 .db 文件"
        >
          <FilePlus2 size={11} />
          添加文件
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void addDataDir()}
          title="添加一个目录（递归扫描子目录）"
        >
          <FolderPlus size={11} />
          添加目录
        </button>
        <button
          type="button"
          className={cn('btn', loadingSources && 'opacity-70')}
          onClick={() => void refreshSources()}
          disabled={loadingSources}
          title="重新扫描"
        >
          <RefreshCw size={11} className={cn(loadingSources && 'animate-spin')} />
          重扫
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {dataFiles.length === 0 && dataDirs.length === 0 && (
          <p className="rounded-xl border border-line/10 bg-surface-900/50 p-3 text-micro leading-5 text-ink-600">
            未添加自定义来源。程序会自动扫描下方「内置默认目录」，其中包含猿通讯的默认
            存放位置。若你的聊天记录在其他位置，点击「添加文件」或「添加目录」即可。
          </p>
        )}

        {dataFiles.map((file) => (
          <div
            key={file}
            className="flex items-center gap-2 rounded-xl border border-brand-indigo/35 bg-brand-indigo/10 px-3 py-2"
          >
            <FilePlus2 size={12} className="shrink-0 text-brand-indigo" />
            <span className="min-w-0 flex-1 truncate text-micro text-ink-100" title={file}>
              {file}
            </span>
            <span className="shrink-0 rounded-full bg-brand-indigo/25 px-1.5 text-micro text-ink-100">
              文件
            </span>
            <button
              type="button"
              className="btn shrink-0"
              onClick={() => void removeDataFile(file)}
              title="移除"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}

        {dataDirs.map((dir) => (
          <div
            key={dir}
            className="flex items-center gap-2 rounded-xl border border-brand-cyan/30 bg-brand-cyan/8 px-3 py-2"
          >
            <FolderSearch size={12} className="shrink-0 text-brand-cyan" />
            <span className="min-w-0 flex-1 truncate text-micro text-ink-100" title={dir}>
              {dir}
            </span>
            <span className="shrink-0 rounded-full bg-brand-cyan/20 px-1.5 text-micro text-ink-100">
              目录
            </span>
            <button
              type="button"
              className="btn shrink-0"
              onClick={() => void removeDataDir(dir)}
              title="移除"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}

        <div className="mt-1 rounded-xl border border-line/10 bg-surface-900/45 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-micro text-ink-600">
            <FolderSearch size={11} />
            内置默认目录（只读，按此顺序扫描）
          </p>
          <ul className="flex flex-col gap-1">
            {defaultDirs.map((dir) => {
              const isBoctx = /[\\/]boctx$/i.test(dir)
              return (
                <li key={dir} className="flex items-center gap-2 text-micro">
                  <span className="min-w-0 flex-1 truncate text-ink-400" title={dir}>
                    {dir}
                  </span>
                  {isBoctx && (
                    <span className="shrink-0 rounded-full bg-state-ok/20 px-1.5 text-state-ok">
                      猿通讯默认
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-micro leading-5 text-ink-600">
            可通过环境变量 <code className="text-ink-400">CHATLOG_DATA_DIR</code> 追加目录
            （分号分隔）。
          </p>
        </div>
      </div>
    </section>
  )
}
