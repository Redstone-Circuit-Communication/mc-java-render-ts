import engineConfig from "./engine/eslint.config.mjs";

const GLOBALS = Object.fromEntries(
    [
        "AbortController", "Blob", "Event", "EventTarget", "MessageEvent", "Response",
        "ResizeObserver", "URL", "URLSearchParams", "cancelAnimationFrame",
        "clearInterval", "clearTimeout", "console", "document", "fetch", "history",
        "indexedDB", "innerHeight", "innerWidth", "localStorage", "location",
        "navigator", "performance", "requestAnimationFrame", "setInterval",
        "setTimeout", "structuredClone", "window", "Option",
    ].map((name) => [name, "readonly"])
);

export default [
    { ignores: ["engine/**", "dist/**", "example/dist/**", "node_modules/**"] },
    ...engineConfig,
    {
        files: ["src/**/*.ts", "example/src/**/*.js", "tests/**/*.mjs"],
        languageOptions: { globals: GLOBALS },
    },
];
