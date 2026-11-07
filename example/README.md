# 方块工坊示例

在项目根目录运行 `pnpm install --frozen-lockfile` 和 `pnpm run dev:example`。首页展示完整工作台，`/minimal.html` 展示 SDK 的最小接入方式。

`pnpm run build && pnpm run build:example` 生成 `example/dist/`。使用 HTTP 服务提供整个目录，保留相对路径。开发源码、示例资源包与蓝图分别位于 `example/src/`、`example/public/packs/` 和 `example/public/schematics/`。

蓝图下拉里的“全方块”和“全实体”用于逐个排查渲染，说明见根目录 README。
