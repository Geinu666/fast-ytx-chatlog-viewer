/** Vite 静态资源导入声明（tsconfig 仅引入了 node 类型，这里手动声明） */
declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}
