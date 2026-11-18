/**
 * What the site checks after it imports this package from its SDK directory (docs/renderer/SDK.md).
 *
 * `SDK_API` is the version of the contract between the site and the two renderer packages: the members the site calls
 * (`createWorkshop`, `Workshop.load` with its hooks, `camera`, `screenshot`, `dispose`, the `chunkLoading` option …).
 * Bug fixes and new optional members do not change it. Change it only when the site has to change with the package;
 * a site that does not know the new number shows "this viewer needs a newer site" instead of breaking.
 */
export const SDK_API = 1;
export const SDK_EDITION = "java" as const;
/** Kept equal to package.json by `vite.sdk.config.mjs` (the build stops when they differ). */
export const SDK_VERSION = "1.2.1";
