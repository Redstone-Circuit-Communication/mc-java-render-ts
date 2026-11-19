# mc-java-render-ts

[English](README.md) | 简体中文

在浏览器里渲染 Minecraft **Java 版**结构的库：支持 Litematica `.litematic`、Sponge `.schem`、MCEdit `.schematic`
和原版结构 `.nbt`，用 three.js 按标准资源包绘制。[红石阁](https://redstonearchive.top)的 3D 视图就是用它渲染的。
本库是 [schematic-renderer](https://github.com/CoastlineCreations/schematic-renderer) 的分支。

**在线示例：** <https://redstone-circuit-communication.github.io/mc-java-render-ts/>（默认英文，可切换中文）

基岩版的对应库 [mc-bedrock-render-ts](https://github.com/Redstone-Circuit-Communication/mc-bedrock-render-ts)
用同一套接口渲染 `.mcstructure` 文件。

## 功能

- 在 Web Worker 里构建网格，大结构可以逐个区块加载
- 支持任意 Java 资源包，也可以多个叠加
- 环绕、正交和第一人称相机，以及由宿主驱动的相机接口（取景、姿态），方便自己做操作方式
- 点选方块和实体、读取容器内容、红石状态、材料清单
- 物品栏样式的物品图标；方块名、实体名和各种说明可以用英文或简体中文（`setLocale`）
- 和原版平滑光照一样的环境光遮蔽，可选的屏幕空间环境光遮蔽，SMAA / 多重采样抗锯齿，可选的太阳光阴影
- 自带全部依赖的 ES 模块构建（`pnpm build:sdk`），网站可以在运行时加载

## 用法

```ts
import { createWorkshop } from "@rsw/mc-java-render-ts";

const workshop = await createWorkshop({
	canvas,
	// 一个资源包，或按顺序叠加的多个：后面的覆盖前面的
	resourcePackUrl: ["/packs/vanilla.zip", "/packs/my-textures.zip"],
});
const result = await workshop.load(buffer, "door.litematic"); // 或者 loadFile(file)
await workshop.camera.fit();
console.log(result.dimensions, result.totalBlocks);
workshop.camera.setMode("ortho"); // "orbit" | "first" | "ortho"
const png = await workshop.screenshot();
await workshop.dispose();
```

大结构可以一次一个 16³ 区块地显示出来：

```ts
const workshop = await createWorkshop({ canvas, resourcePackUrl, rendererOptions: { chunkLoading: { minIntervalMs: 50 } } });
await workshop.load(buffer, "base.litematic", {
	onStart: () => workshop.camera.fit(), // 第一个区块之前：尺寸已经知道了
	onChunk: (done, total) => progress(done, total),
	signal, // 在两个区块之间中止
});
```

运行时加载的 SDK 构建，以及相机、第一人称和光影的接口，见 `docs/renderer/SDK.md`（英文）。

### 文字和图标

库输出的文字（方块和实体的名字、容器标题、红石说明、CSV 表头）默认是英文：

```ts
import { setLocale, nameFor, ItemAssets } from "@rsw/mc-java-render-ts";

setLocale("zh-CN");              // 或者 "en"
nameFor("minecraft:chest");      // "箱子"

// 图标以对象 URL 的形式给出；传了 renderer 时，方块物品按物品栏里的样子画成立体的
const assets = new ItemAssets(workshop.renderer.cubane.getAssetLoader(), { renderer: workshop.renderer });
assets.decorate(element, "minecraft:furnace");
```

## 资源包

库里不带任何游戏资源。它需要一个包含方块状态、模型和贴图的 Java 资源包，实际上就是游戏自己的资源，
上面可以再叠一个材质包。Minecraft 的客户端 jar 本身就能当资源包用：它的 `assets/` 目录结构和资源包相同。

Java 版的实体几何写在游戏代码里，不在资源包里，所以库里带了一份实体模型目录（`src/renderer/cubane/entity-models/`，
来自上游项目）。目录里缺的模型由 `scripts/generate-entity-models.mjs` 从 Mojang 官方发布的基岩版几何转换而来；
仍然没有模型的生物，会画一个碰撞箱大小的占位框。

示例里不带任何 Minecraft 的文件。访问者的浏览器会从 Mojang 的服务器（`piston-data.mojang.com`）下载 Minecraft 26.3
的官方客户端 jar（约 41 MB，第一次访问后会缓存），和启动器下载的是同一个文件。要换别的版本，从 Mojang 的
[版本清单](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)里取那个版本的 `downloads.client.url`。

## 开发

```bash
pnpm install
pnpm build              # dist/（ES 模块和类型声明）
pnpm test               # 构建、消费者类型检查、Node 测试和 Vitest
pnpm lint
pnpm dev:example        # 示例，http://localhost:5173
pnpm build:example      # example/dist，和部署到 GitHub Pages 的相同
pnpm build:sdk          # sdk/mc-java-render/<版本>/，供运行时加载
pnpm schematics:coverage   # 重新生成「全方块」「全实体」两个示例蓝图
```

开发脚本读取官方客户端 jar：第一次需要时从 Mojang 下载到 `.cache/`（不进仓库）。示例页面默认英文，
浏览器语言是中文时显示中文；页面文字在 `example/src/i18n.js`。

用 Rust 写的网格构建器在 `mesh_builder_wasm/`，预先编译好的产物放在 `src/renderer/wasm/`。

## 许可

[AGPL-3.0-only](LICENSE)，继承自上游项目。如果你把修改过的本库用在网络服务上，AGPL 要求你向这个服务的用户提供源代码。

本分支所做的修改记录在 [docs/renderer/CHANGELOG.md](docs/renderer/CHANGELOG.md)，第三方声明见 [NOTICE.md](NOTICE.md)。

## 致谢

- CoastlineCreations 的 [schematic-renderer](https://github.com/CoastlineCreations/schematic-renderer) 及其资源处理部分
  Cubane（AGPL-3.0-only）：本库分支自的上游项目。
- CoastlineCreations 的 [Nucleation](https://github.com/CoastlineCreations/nucleation)（MIT）：蓝图解析。
- [three.js](https://github.com/mrdoob/three.js)（MIT）、[postprocessing](https://github.com/pmndrs/postprocessing)（Zlib）
  和 [N8AO](https://github.com/N8python/n8ao)（ISC）：渲染和后期处理。
- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)（MIT）、[JSZip](https://github.com/Stuk/jszip)（MIT）和
  [lil-gui](https://github.com/georgealways/lil-gui)（MIT）。

Minecraft 是 Mojang AB 的商标。本项目不是 Minecraft 官方产品，与 Mojang 和 Microsoft 没有关联。
