# 方块工坊 · 独立 HTML 示例

此包是 SDK 的使用方，功能从 `@rsw/mc-java-render-ts` 导入，页面内只保留界面、交互绑定和文件下载等浏览器操作。

- `index.html` + `src/main.js`：原项目完整界面（材料、容器、实体、红石、画质、性能 HUD、相机、截图）。
- `minimal.html` + `src/minimal.js`：最小接入示例，适合复制到自己的项目。
- `public/`：原项目修正资源包、测试蓝图和容器图标。
- `dist/`：两个示例的预构建版本，已包含运行所需的库代码、Worker、WASM 与资源。

## 直接运行，不用 npm

在本包目录执行：

```bash
python3 -m http.server 8080 --directory dist
```

打开：

- 完整界面：`http://localhost:8080/`
- 最小示例：`http://localhost:8080/minimal.html`

此方法只需要本示例包。请使用 HTTP 服务，不能直接双击 HTML；WebGL2、ES modules、Worker、fetch 都需要现代浏览器支持。
示例不会把用户选择的本地蓝图上传到服务器。

## 开发与重新构建

两份 ZIP 解压后保持同级：

```text
work/
  block-workshop-ts/
  block-workshop-example/
```

要求 Node.js 22.12+。在同级目录执行：

```bash
cd block-workshop-ts
npm ci
npm run build
cd ../block-workshop-example
npm ci
npm run dev
```

Vite 输出本地地址；完整界面使用首页，最小示例使用 `/minimal.html`。

```bash
npm test
npm run build
npm run preview
```

依赖通过 `"@rsw/mc-java-render-ts": "file:../block-workshop-ts"` 连接。如果移动目录，请修改 package.json 的路径并重新 npm install。
项目使用同一份 Three.js（Vite `resolve.dedupe`），避免跨包对象出现不同 Three 实例。

库中没有硬编码本例的 DOM ID，也不会在 import 时自动启动界面。
资源包路径和示例路径都使用相对地址，`dist/` 可以部署到网站子目录，保留整个目录结构即可。

## 与原项目的对应

`src/block-inspector.js` 负责面板与高亮，拾取、容器索引、NBT 与红石读取调用库。
`src/view-controls.js` 只扩展库的 CameraControls 来绑定按钮与绘制坐标轴。
`src/render-settings.js` 使用库的设置归一化与应用方法；`src/performance-hud.js` 使用库的 FrameStats。
`src/main.js` 使用 BlueprintLoader 负责安全替换蓝图，并使用库完成材料搜索、CSV/TSV 和截图。
`minimal.html` 展示没有这些完整 UI 时的接入方式。

基础工作流与验证记录见 `VALIDATION.md`。许可证沿用库中的 AGPL-3.0-only，原贴图与蓝图归各自权利人所有。
