# @rsw/mc-java-render-ts

红石阁 前端java方块实体渲染和结构解析组件

## 1.1.0：给站点的 SDK、逐块加载

- `pnpm build:sdk` → `sdk/mc-java-render/<版本>/`：自带 three、nucleation 的 ES 模块目录，放进站点的 SDK 目录、改清单，站点运行时 `import()`（`docs/renderer/SDK.md`）。
- 渲染器选项 `chunkLoading: { minIntervalMs }`：一次一个 16³ 区块，每块至少这么久；`workshop.load(buffer, name, { onStart, onChunk, signal })`。
- `camera.getView()` / `setView()`。
- **这一版的改动没有在写的环境里构建、测试过**，先跑 `pnpm typecheck && pnpm test && pnpm build:sdk`。

