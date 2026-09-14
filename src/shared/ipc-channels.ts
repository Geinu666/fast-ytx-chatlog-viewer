/** 主进程与渲染进程之间的 IPC 通道常量 */
export const IPC = {
  dbListSources: 'db:listSources',
  dbSelectSource: 'db:selectSource',
  indexStatus: 'index:status',
  indexEnsure: 'index:ensure',
  indexRebuild: 'index:rebuild',
  indexProgress: 'index:progress',
  configGet: 'config:get',
  configSave: 'config:save',
  configDefaults: 'config:defaults',
  configPickDir: 'config:pickDir',
  configPickFile: 'config:pickFile',
  chatList: 'chat:list',
  chatMeta: 'chat:meta',
  messagePage: 'message:page',
  messageContext: 'message:context',
  searchGlobal: 'search:global',
  filterFacets: 'filter:facets',
  clipWrite: 'clip:write',
  winMinimize: 'win:minimize',
  winToggleMaximize: 'win:toggleMaximize',
  winClose: 'win:close',
  winIsMaximized: 'win:isMaximized',
  winMaximizeChange: 'win:maximizeChange'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
