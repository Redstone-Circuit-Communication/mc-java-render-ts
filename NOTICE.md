# 许可与来源

- 本库 fork 自 [CoastlineCreations/schematic-renderer](https://github.com/CoastlineCreations/schematic-renderer)，按上游的 **AGPL-3.0-only** 授权（见 `docs/renderer/CONTRIBUTING.md`）。
  上游的版权声明保留不动；本仓库的改动见 `docs/renderer/CHANGELOG.md`（站点 SDK、逐块加载、原版结构 `.nbt` 读取、视角接口等）。
- **开源之前还要做的**（架构评审 L1、L4）：
  - ~~从上游仓库原样拷入 `LICENSE`~~：2026-11-18 复审之后已拷入（上游 master 的 LICENSE 原样，和 gnu.org 的 AGPL-3.0 原文只差末尾一个换行）；
  - 说明 `src/renderer/wasm/` 下预编译 wasm 和 `wasm.zip` 的来源，保证能从源码重新构建；
  - 核实 `cubane/entity-models/` 下实体模型 JSON 和 `minecraft_day.hdr` 的来源与许可；
  - 用 gitleaks 扫一遍完整的提交历史。
- 2026-11-18：删除了 `src/renderer/managers/the_one_you_want_to_talk_to`。这是一个没有扩展名、base64 加混淆的脚本，解码后是打开一个视频网址，没有任何代码引用它。来历不明，开源前要查清是上游带来的还是后来加进来的。
- 依赖：Nucleation（`@coastlinecreations/nucleation`，MIT）、three、postprocessing、n8ao 等，各自的许可见各自的包。

## 和基岩渲染库共用的代码（2026-11-18 复审之后比对）

基岩库（CC BY-NC-SA 4.0）里有一些文件写着从本库拷来。两种许可的代码不能合进同一个包，所以和上游 schematic-renderer 的 master 逐个比过（比法、结果在基岩库的 `NOTICE.md`）：

- 本库的 `mesh_builder_wasm/src/lib.rs` 和上游同名文件逐行相似 0.978，是上游的代码（本库是 fork，按 AGPL 用它没有问题）。基岩库 1.6.0 已经不再内嵌编出来的 wasm；
- 本库 `src/renderer/effects/GammaCorrectionEffect.ts` 来自上游（上游 `src/effects/GammaCorrectionEffect.ts`），基岩库 1.6.0 已经换成自己写的；
- `src/mesh/core/`、`src/mesh/worker/`、`src/frame-stats.ts`、`src/material-export.ts`、`src/names.ts` 在上游 master 里找不到对应，看起来是 fork 之后写的。
  如果查实是红石阁团队写的（著作权在你们），可以同时按别的许可给基岩库用，在两边写明；**要从提交历史确认**。
