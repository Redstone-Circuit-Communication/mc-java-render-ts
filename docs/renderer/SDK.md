# 给站点的 SDK 构建（1.1.0）

站点（`redstone-web`）不把渲染库编进自己：它在服务器上有一个独立的 SDK 目录（`/srv/redstone/sdk/`，同源的 `/sdk/`），按 `manifest.json` 取当前版本，
用户打开 3D 视图时在浏览器里 `import()`。修渲染器的 bug，只要构建一个新版本目录放上去、改清单，站点不用重新构建。站点那边的说明在 `redstone-web/docs/RENDER-SDK.md`。

## 构建

```bash
pnpm install --frozen-lockfile
pnpm build:sdk                     # → sdk/mc-java-render/1.1.0/
SDK_OUT=/tmp/out pnpm build:sdk    # 换输出的根目录
```

产物：

```
sdk/mc-java-render/1.1.0/
  index.js          入口（站点 import 的就是它）
  chunks/*.js       按需加载的分块（nucleation 是 runtime.ts 里的动态 import，单独一块，第一次加载结构时才下载）
  release.json      { edition, name, version, api, entry }：照着它填站点的 manifest.json
  *.map             source map
```

`vite.sdk.config.mjs` 和 npm 包的 `vite.config.mjs` 的区别只有一处：**什么都不外置**（npm 包把 three、nucleation 留给使用者的打包工具，SDK 要能自己跑）。
库模式、ES 格式、wasm 内联成 `data:` 地址、Worker 是 `?worker&inline`（`blob:` 地址）这些和 npm 包一样。版本号以 package.json 为准，`src/sdk.ts` 的 `SDK_VERSION` 对不上时构建直接失败。

## 约定版本 `SDK_API`

`src/sdk.ts` 的 `SDK_API`（现在是 1）是站点和两个渲染库之间约定的版本：站点调用的成员（`createWorkshop`、`Workshop.load` 和它的三个回调、`camera.fit / setMode / getView / setView`、
`renderer.setBackgroundColor`、`screenshot`、`dispose`、`applyRenderSettings`、`isAbortError`、渲染器选项 `chunkLoading`）。
修 bug、加可选的成员不改它；这些成员的名字、参数、返回值变了，才把两个库和站点的版本一起加 1，否则站点会提示「渲染组件和网站的版本对不上」，不会半路出错。

## 构建之后先看这几样（这一版没有在写的环境里构建过）

1. `pnpm typecheck`、`pnpm test`：`chunkLoading`、`BlueprintLoader` 的回调和取消、`getView / setView` 都是新写的。
2. `ls sdk/mc-java-render/1.1.0/`：有 `index.js`，`chunks/` 里有一个明显大的（nucleation 和它的 wasm）。
3. 找一个静态服务器把 `sdk/` 发出来，在浏览器控制台里：
   ```js
   const m = await import("/sdk/mc-java-render/1.1.0/index.js");
   [m.SDK_API, m.SDK_EDITION, m.SDK_VERSION, typeof m.createWorkshop]   // [1, "java", "1.1.0", "function"]
   ```
4. 站点 `pnpm dev`，`DEV_SDK_DIR` 指向放了这个版本和资源包的目录，打开一件 Java 作品的 3D 视图：看到区块一块一块出来、进度从 1 走到总数。

## 如果 nucleation 打不进去

写构建配置时看不到 nucleation 包的内部结构（它的 wasm 是怎么加载的）。万一 `pnpm build:sdk` 报错，或者浏览器里加载结构时报 nucleation 初始化失败：

- 先看报错是不是 wasm 的地址：库模式会把 `new URL("x.wasm", import.meta.url)` 内联成 `data:` 地址；如果 nucleation 用的是 `import x from "./x.wasm"`（打包器的 wasm 集成），
  要加 `vite-plugin-wasm` 这类插件，或者让 `inlineWasm` 只处理本仓库自己的 wasm（`src/renderer/wasm/`）。
- 退路：nucleation 带浏览器用的 UMD 版本，`src/renderer/nucleation/runtime.ts` 先认 `globalThis.Nucleation`。可以把它单独拷进版本目录，
  在 `index.js` 最前面加一句加载它的代码（或者让站点先加载它），构建配置里再把 `nucleation` 设回外置。

## 1.2.0：2026-11-18 和基岩包一起加的（站点的取景、第一人称、光影）

都是新增的可选成员，`SDK_API` 不变（还是 1）：站点先判断有没有，再用；旧版渲染组件照旧能用，只是没有这些功能。

| 成员 | 作用 |
| --- | --- |
| `camera.setFrame({ yaw, pitch, distance?, fov?, halfHeight? })` | 宿主自己算好的取景：目标点不变（`fit()` 之后就是结构中心），透视设视野（弧度）和距离，正交设画面半高（方块）。投稿页的简易模型、真实材质渲染和后台出图都用它摆同一台相机（以前各自 fit，60° 和 40° 视野、外框和外接球，同一个「远近倍数」摆出来不一样） |
| `camera.getFrame()` | 现在的取景（加上 `ortho`），和 `setFrame` 互逆 |
| `camera.setMode('first', { input: 'host' })` | 第一人称由宿主移动相机：不开自带的飞行控制（指针锁定、WASD），旋转的拖动也关掉 |
| `camera.setPose({ x, y, z, yaw, pitch })` / `getPose()` | 第一人称的眼睛：世界坐标，看的方向（yaw 0 朝 +z、往 +x 增加，pitch 大于 0 往上看）。轨道控制器的目标点放在眼睛前面一格，它更新时也不会把视线拧走 |
| `workshop.solids()` | 结构的碰撞格子 `{ origin, min, max, height(i, j, k) }`：格 (i, j, k) 占 `origin + [i, i+1]×[j, j+1]×[k, k+1]`，高度是 0（能穿过）、0.5（下半格：台阶、楼梯、床）或 1（整格）。方块分类在 `src/collision.ts`，两个包同一份规则，认 Java 的 `[props]` 和基岩的状态 |
| `postProcessingOptions.enableSMAA` / `multisampling` | 抗锯齿：SMAA（默认开）；多重采样的样本数（0 关，4 是「高」） |
| `applyRenderSettings(renderer, { shading, shadingQuality })` | 轻量光影：暖色的太阳光加软阴影（阴影框按结构对准）、天空和地面的半球光代替大部分平的环境光。`shadingQuality: 'high'` 用 4096 的阴影图，否则 2048。结构变了再调一次（基岩包会自己重新对准） |

同一次还改了：透视的最近距离从 1 格放到 0.05 格（可以贴到方块跟前）；环境光遮蔽加强到半径 2 格（正交 1.2 格），以前几乎看不出来——
Java 包建遮蔽效果时还把参数写死成了旧值，没用预设。

另外：

- nucleation 的 wasm 加载只看全局有没有 `process` 来判断是不是 Node。宿主在浏览器里放了 `process` 的替身（Nuxt 的开发服务器、webpack 的 polyfill）时会走 Node 那条路，
  `fs.readFileSync is not a function`，渲染器起不来。`src/renderer/nucleation/runtime.ts` 现在加载时先把这种没有 `versions.node` 的替身藏起来，加载完放回去。
- 画布按它的**父元素**的大小定画面（RenderManager 读 `parentElement.clientWidth / clientHeight`）。离屏出图时画布要套一个定好尺寸的盒子，
  直接挂在 `body` 上就是整页的大小（后台出图的尺寸问题就是这样来的）。
