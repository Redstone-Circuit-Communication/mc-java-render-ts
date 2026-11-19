/** Language of the text this package produces: block and entity names, container titles, redstone readouts. */
export type Locale = "en" | "zh-CN";

let current: Locale = "en";

/** Sets the language of the text this package produces. English by default. */
export function setLocale(locale: Locale): void {
	current = locale;
}

export function getLocale(): Locale {
	return current;
}

/** The English or the Chinese text, whichever matches the current locale. */
export const L = (en: string, zh: string): string => (current === "zh-CN" ? zh : en);

/** `smooth_stone` → `Smooth Stone`: an id's English display name, as the game spells most of them. */
export function englishName(id: string): string {
	return id
		.replace(/^minecraft:/, "")
		.split("_")
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}
