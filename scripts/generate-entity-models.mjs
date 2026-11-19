// Adds the entity models that the bundled catalog lacks.
//
// Java Edition keeps entity geometry in code, never in assets/ (the pack's models/ folder holds just block/ and item/). The
// models here come from two sources:
//
//   re-skinned  the geometry of an existing catalog entry with another texture of the official client jar (identical UV
//               mask, checked against the PNG alpha):
//                 poplar_boat, poplar_chest_boat   <- oak_boat, oak_chest_boat
//                 camel_husk                       <- camel
//                 happy_ghast, happy_ghast_baby    <- ghast (same UV mask, texture is twice as tall)
//                 tropical_fish_pattern_{a,b}_1..6 <- tropical_fish_pattern_{a,b} (shared UVs)
//   Bedrock     the mob's geometry as Mojang publishes it for Bedrock Edition (github.com/Mojang/bedrock-samples, pinned
//               release), converted with scripts/lib/bedrock-geometry.mjs and textured with the Java texture: nautilus,
//               zombie_nautilus, parched, copper_golem, cushion. Both editions use the same boxes and texture layouts for
//               these mobs; converted catalog mobs that exist in both match the catalog's own models to within a pixel.
//   sulfur_cube is built from the sizes in its texture; its placement matches the official Bedrock geometry.
//
// Textures come from the official client jar, downloaded from Mojang into .cache/ on first use (scripts/lib/minecraft-assets.mjs).
//
// Run: node scripts/generate-entity-models.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BEDROCK_SAMPLES_TAG, fetchOfficial, geometryNodes, parseGeometries } from "./lib/bedrock-geometry.mjs";
import { box, boxGlb, dataUri, glbBytes, openZip, pngSize, readGlb as readCatalogGlb } from "./lib/box-model.mjs";
import { MINECRAFT_VERSION, clientJar } from "./lib/minecraft-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = resolve(root, "src/renderer/cubane/entity-models");
const TEXTURES = "assets/minecraft/textures/entity/";

const pack = openZip(await clientJar());
const texture = (path) => pack.bytes(`${TEXTURES}${path}.png`);

const written = [];
function save(name, glb, note) {
	writeFileSync(resolve(catalog, `${name}.json`), JSON.stringify(glbBytes(glb).toString("base64")) + "\n");
	written.push(name);
	console.log(`${name.padEnd(28)} ${note}`);
}
const embeddedSize = (json) => {
	const uri = json.images[0].uri;
	return pngSize(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64"));
};

/**
 * Same geometry as `source`, new texture. The PNG must have the source's size unless `size` says
 * otherwise; `vScale` rescales v when the layout fills only the top part of a taller PNG.
 */
function reskin(source, png, { vScale = 1, size } = {}) {
	const glb = readCatalogGlb(catalog, source);
	const [w, h] = size ?? embeddedSize(glb.json);
	const [nw, nh] = pngSize(png);
	if (nw !== w || nh !== h)
		throw new Error(`${source}: expected a ${w}x${h} texture, got ${nw}x${nh}`);
	glb.json.images[0] = { uri: dataUri(png), mimeType: "image/png" };
	if (vScale !== 1) {
		const done = new Set();
		for (const mesh of glb.json.meshes)
			for (const primitive of mesh.primitives) {
				const index = primitive.attributes.TEXCOORD_0;
				const accessor = glb.json.accessors[index];
				const view = glb.json.bufferViews[accessor.bufferView];
				if (accessor.componentType !== 5126 || accessor.type !== "VEC2")
					throw new Error(`${source}: unexpected TEXCOORD_0 layout`);
				const first = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
				if (done.has(first)) continue;
				done.add(first);
				let lo = Infinity;
				let hi = -Infinity;
				for (let i = 0; i < accessor.count; i++) {
					const at = first + i * (view.byteStride ?? 8) + 4;
					const v = glb.bin.readFloatLE(at) * vScale;
					glb.bin.writeFloatLE(v, at);
					lo = Math.min(lo, v);
					hi = Math.max(hi, v);
				}
				accessor.min[1] = lo;
				accessor.max[1] = hi;
			}
	}
	return glb;
}

// ---- re-skinned models ----------------------------------------------------
save("poplar_boat", reskin("oak_boat", texture("boat/poplar")), "oak_boat geometry, boat/poplar.png (UV mask identical)");
save("poplar_chest_boat", reskin("oak_chest_boat", texture("chest_boat/poplar")), "oak_chest_boat geometry, chest_boat/poplar.png (UV mask identical)");
save("camel_husk", reskin("camel", texture("camel/camel_husk")), "camel geometry, camel/camel_husk.png (UV mask 97.9% identical)");
// The catalog's ghast texture is 64x32; the pack's is the same layout at twice the resolution, and
// happy_ghast.png (128x128) keeps it in the top half, so u is unchanged and v halves.
save("happy_ghast", reskin("ghast", texture("ghast/happy_ghast"), { vScale: 0.5, size: [128, 128] }), "ghast geometry, ghast/happy_ghast.png (top half = ghast mask x2)");
// The ghastling (a baby happy ghast) uses the same layout at half the resolution.
save("happy_ghast_baby", reskin("ghast", texture("ghast/happy_ghast_baby"), { vScale: 0.5, size: [64, 64] }), "ghast geometry, ghast/happy_ghast_baby.png (top half = ghast mask)");
for (const shape of ["a", "b"])
	for (let pattern = 1; pattern <= 6; pattern++)
		save(
			`tropical_fish_pattern_${shape}_${pattern}`,
			reskin(`tropical_fish_pattern_${shape}`, texture(`fish/tropical_${shape}_pattern_${pattern}`)),
			`tropical_fish_pattern_${shape} geometry, fish/tropical_${shape}_pattern_${pattern}.png`
		);

// ---- boxes recovered from texture layouts -----------------------------------
// sulfur_cube: inner 16^3 @ (0,36), outer 18^3 @ (0,0); outer on the ground, inner one pixel above it, same centre, which is
// exactly where the official Bedrock geometry puts them.
save(
	"sulfur_cube",
	boxGlb(
		[
			{ png: texture("sulfur_cube/sulfur_cube_outer"), name: "sulfur_cube_outer", blend: true },
			{ png: texture("sulfur_cube/sulfur_cube_inner"), name: "sulfur_cube_inner" },
		],
		[
			box("inner", [-8, 1, -8], [16, 16, 16], [0, 36], 1),
			box("outer", [-9, 0, -9], [18, 18, 18], [0, 0], 0),
		]
	),
	"inner 16^3 + outer 18^3 (translucent); sizes from the texture, placement as in the Bedrock geometry"
);

// ---- converted from the official Bedrock geometry -----------------------------
const geometries = new Map();
for (const file of ["nautilus", "zombie_nautilus_coral", "parched", "copper_golem", "cushion"])
	for (const [id, geometry] of parseGeometries(await fetchOfficial(`models/entity/${file}.geo.json`))) geometries.set(id, geometry);
const bedrock = (id, options) => {
	const geometry = geometries.get(id);
	if (!geometry) throw new Error(`${id} is missing from bedrock-samples ${BEDROCK_SAMPLES_TAG}`);
	return geometryNodes(geometry, options);
};
const from = (ids) => `Bedrock ${ids} (bedrock-samples ${BEDROCK_SAMPLES_TAG})`;
save(
	"nautilus",
	boxGlb([{ png: texture("nautilus/nautilus"), name: "nautilus" }], bedrock("geometry.nautilus")),
	`${from("geometry.nautilus")}, nautilus/nautilus.png`
);
save(
	"zombie_nautilus",
	boxGlb(
		[
			{ png: texture("nautilus/zombie_nautilus"), name: "zombie_nautilus" },
			{ png: texture("nautilus/zombie_nautilus_coral"), name: "zombie_nautilus_coral" },
		],
		[...bedrock("geometry.nautilus"), ...bedrock("geometry.zombie_nautilus_coral", { texture: 1 })]
	),
	`${from("geometry.nautilus + geometry.zombie_nautilus_coral")}, nautilus/zombie_nautilus{,_coral}.png`
);
save("parched", boxGlb([{ png: texture("skeleton/parched"), name: "parched" }], bedrock("geometry.parched")), `${from("geometry.parched")}, skeleton/parched.png`);
save(
	"copper_golem",
	boxGlb([{ png: texture("copper_golem/copper_golem"), name: "copper_golem" }], bedrock("geometry.copper_golem", { skip: ["rightItem"] })),
	`${from("geometry.copper_golem")}, copper_golem/copper_golem.png`
);
save(
	"cushion",
	boxGlb([{ png: texture("cushion/white_cushion"), name: "cushion" }], bedrock("geometry.cushion")),
	`${from("geometry.cushion")}, cushion/white_cushion.png`
);

// ---- register the loaders -------------------------------------------------------
const indexPath = resolve(catalog, "index.ts");
const lines = readFileSync(indexPath, "utf8").split("\n");
const entry = /^\t"?([^":]+)"?: \(\) => import\(/;
const have = new Set(lines.map((line) => entry.exec(line)?.[1]).filter(Boolean));
let added = 0;
for (const name of written.sort()) {
	if (have.has(name)) continue;
	const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
	const line = `\t${key}: () => import("./${name}.json"),`;
	let at = lines.findIndex((l) => {
		const existing = entry.exec(l)?.[1];
		return existing !== undefined && existing > name;
	});
	if (at < 0) at = lines.lastIndexOf("};");
	lines.splice(at, 0, line);
	added++;
}
writeFileSync(indexPath, lines.join("\n"));
console.log(`\n${written.length} models written, ${added} loader entries added to entity-models/index.ts`);
