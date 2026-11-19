// The official Minecraft: Java Edition client jar, downloaded from Mojang the first time a script needs it and cached in
// .cache/ (not committed). Its assets/ folder has the layout of a resource pack. Nothing from Minecraft is kept in the
// repository.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MINECRAFT_VERSION = "26.3";
/** Content-addressed URL of the 26.3 client jar (from Mojang's version manifest); it never changes. */
export const CLIENT_JAR_URL = "https://piston-data.mojang.com/v1/objects/e877b6a07acd633fb3bb475002175cec036e7b87/client.jar";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Path of the cached client jar, downloading it first if needed. */
export async function clientJar() {
	const path = resolve(root, `.cache/minecraft/client-${MINECRAFT_VERSION}.jar`);
	if (existsSync(path)) return path;
	console.error(`downloading the Minecraft ${MINECRAFT_VERSION} client jar from Mojang (about 41 MB)…`);
	const response = await fetch(CLIENT_JAR_URL);
	if (!response.ok) throw new Error(`client jar download failed: HTTP ${response.status}`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, Buffer.from(await response.arrayBuffer()));
	return path;
}
