// Build, validate and link the sibling fork without changing the published dependency.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localDir = resolve(root, ".nucleation-local"); // 持久目录，不能放进 mkdtemp
const linkedPackage = resolve(localDir, "package"); // npm pack 的 tarball 顶层目录名
const args = process.argv.slice(2);
const isWindows = process.platform === "win32";
const bin = (name) => (isWindows ? `${name}.cmd` : name);
const run = (command, arguments_, options = {}) =>
	execFileSync(command, arguments_, {
		cwd: root,
		stdio: "inherit",
		shell: isWindows, // Windows 下 .cmd 需要 shell 才能被 execFileSync 执行
		...options,
	});

// 一键还原：移除 pnpm-workspace.yaml 中的 link override 并重装 registry 版本
if (args.includes("--restore")) {
	run(bin("pnpm"), ["unlink", "nucleation"]);
	await rm(localDir, { recursive: true, force: true });
	console.log("Restored the registry nucleation dependency.");
	process.exit(0);
}

if (args.some((arg) => arg !== "--skip-build")) {
	throw new Error(
		"Usage: pnpm run nucleation:local -- [--skip-build]; " +
			"use --restore to switch back; set NUCLEATION_PATH for another checkout"
	);
}

const fork = resolve(root, process.env.NUCLEATION_PATH ?? "../nucleation");
const temporary = await mkdtemp(resolve(tmpdir(), "renderer-nucleation-local-"));

try {
	if (!args.includes("--skip-build")) {
		run("bash", ["tools/package-npm.sh", "dist/npm"], {
			cwd: fork,
			env: { ...process.env, RUSTC_WRAPPER: process.env.RUSTC_WRAPPER ?? "" },
		});
		run("bash", ["tools/package-npm.sh", "dist/npm-renderer"], {
			cwd: fork,
			env: {
				...process.env,
				RUSTC_WRAPPER: process.env.RUSTC_WRAPPER ?? "",
				NUCLEATION_WASM_FEATURES: "bridge",
			},
		});
	}
	const staged = resolve(temporary, "package");
	await cp(resolve(fork, "dist/npm"), staged, { recursive: true });
	const rendererEntry = resolve(staged, "renderer");
	await rm(rendererEntry, { recursive: true, force: true });
	await cp(resolve(fork, "dist/npm-renderer"), rendererEntry, { recursive: true });
	await rm(resolve(rendererEntry, "package.json"), { force: true });
	await rm(resolve(rendererEntry, ".build-stamp"), { force: true });
	const cargo = await readFile(resolve(fork, "Cargo.toml"), "utf8");
	const version = cargo.match(/^$$package$$[\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
	if (!version) throw new Error("Cannot read the fork's Cargo package version");
	const commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
		cwd: fork,
		encoding: "utf8",
	}).trim();
	const manifestPath = resolve(staged, "package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	// Renderer imports use this alias even when the fork's release package is scoped.
	manifest.name = "nucleation";
	manifest.version = `${version}-local.${commit}`;
	manifest.private = true;
	await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

	// npm pack 只负责打 tarball，与项目用哪个包管理器无关，且 --ignore-scripts 只有它保证
	const output = execFileSync(
		bin("npm"),
		[
			"pack",
			staged,
			"--json",
			"--ignore-scripts",
			"--pack-destination",
			temporary,
			"--cache",
			resolve(temporary, "npm-cache"),
		],
		{
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
			shell: isWindows,
		}
	);
	const [packed] = JSON.parse(output);
	if (!packed?.filename || basename(packed.filename) !== packed.filename) {
		throw new Error("Unexpected npm pack filename");
	}
	const archive = resolve(temporary, packed.filename);
	run(process.execPath, [resolve(fork, "tools/test-npm-package.mjs"), archive, "--with-renderer"]);

	// 把「已验证的 tarball」解包到持久目录：pnpm link 是符号链接，目标不能在临时目录里
	await mkdir(localDir, { recursive: true });
	run("tar", ["-xzf", archive, "-C", localDir]); // tarball 顶层为 package/
	run(bin("pnpm"), ["link", linkedPackage]);

	console.log(`Local Nucleation ${manifest.version} linked from ${fork}.`);
	console.log(
		"package.json and pnpm-lock.yaml are untouched; the link lives in pnpm-workspace.yaml overrides."
	);
	console.log("Verify:  pnpm run test:renderer");
	console.log("Restore: pnpm run nucleation:local -- --restore");
} finally {
	await rm(temporary, { recursive: true, force: true });
}
