#!/usr/bin/env node
/** Validate local character assets; Cubism Core remains the runtime authority. */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const defaults = {
  manifest: path.resolve(toolsDir, "../static/characters.json"),
  staticRoot: path.resolve(toolsDir, "../static"),
};

function parseArgs(args) {
  const options = { ...defaults, report: null, requireLive2d: false };
  const flags = { "--manifest": "manifest", "--static-root": "staticRoot", "--report": "report" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--require-live2d") options.requireLive2d = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (flags[argument]) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing path for ${argument}`);
      options[flags[argument]] = path.resolve(value);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function validate(options) {
  const report = {
    version: 1,
    checkedAt: new Date().toISOString(),
    manifest: options.manifest,
    staticRoot: options.staticRoot,
    requireLive2d: options.requireLive2d,
    status: "failed",
    counts: { characters: 0, portraitReferences: 0, live2dModels: 0, checkedFiles: 0 },
    errors: [],
    warnings: [],
    limitations: ["Static validation cannot prove MOC3 consistency, parameter bindings, animation quality, or Cubism Core runtime compatibility."],
  };
  const error = (code, context, message) => report.errors.push({ code, context, message });
  const warning = (code, context, message) => report.warnings.push({ code, context, message });
  let staticRoot;
  try {
    staticRoot = await fs.realpath(options.staticRoot);
    if (!(await fs.stat(staticRoot)).isDirectory()) throw new Error("Not a directory");
  } catch (cause) {
    error("STATIC_ROOT_INVALID", "staticRoot", cause.message);
    return report;
  }

  const checkedFiles = new Set();
  async function resolveFile(reference, context, modelDirectory = null) {
    if (typeof reference !== "string" || !reference.trim()) {
      error("REFERENCE_INVALID", context, "File reference must be a nonempty string.");
      return null;
    }
    let decoded;
    try { decoded = decodeURIComponent(reference); }
    catch { error("REFERENCE_INVALID", context, "Malformed URL encoding."); return null; }
    if (/[\\\u0000-\u001f?#]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) {
      error("REFERENCE_UNSAFE", context, "Backslashes, controls, query strings, fragments, and nested URL encoding are not accepted.");
      return null;
    }
    let candidate;
    if (modelDirectory) {
      if (decoded.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.includes(":")) {
        error("REFERENCE_UNSAFE", context, "Model file references must be relative local paths.");
        return null;
      }
      candidate = path.resolve(modelDirectory, decoded);
    } else {
      if (!decoded.startsWith("/static/") || decoded.includes(":")) {
        error("REFERENCE_UNSAFE", context, "Character URLs must start with /static/ and use local files.");
        return null;
      }
      candidate = path.resolve(options.staticRoot, decoded.slice("/static/".length));
    }
    if (!isWithin(path.resolve(options.staticRoot), candidate)) {
      error("REFERENCE_ESCAPES_ROOT", context, "Reference escapes the static asset directory.");
      return null;
    }
    try {
      const real = await fs.realpath(candidate);
      if (!isWithin(staticRoot, real)) {
        error("REFERENCE_ESCAPES_ROOT", context, "Symlink or junction resolves outside the static asset directory.");
        return null;
      }
      const stat = await fs.stat(real);
      if (!stat.isFile() || stat.size === 0) {
        error("FILE_INVALID", context, "Reference must resolve to a nonempty regular file.");
        return null;
      }
      checkedFiles.add(real);
      return real;
    } catch (cause) {
      error("FILE_MISSING", context, `Cannot read ${reference}: ${cause.code || cause.message}`);
      return null;
    }
  }

  async function readJson(filename, context) {
    try { return JSON.parse((await fs.readFile(filename, "utf8")).replace(/^\uFEFF/, "")); }
    catch (cause) { error("JSON_INVALID", context, cause.message); return null; }
  }

  const manifest = await readJson(options.manifest, "manifest");
  if (!isObject(manifest)) {
    if (report.errors.length === 0) error("MANIFEST_INVALID", "manifest", "Manifest must be a JSON object.");
    return report;
  }
  if (manifest.version !== 1) error("MANIFEST_VERSION", "manifest.version", "Expected version 1.");
  if (!isObject(manifest.characters) || Object.keys(manifest.characters).length === 0) {
    error("CHARACTERS_MISSING", "manifest.characters", "At least one character is required.");
    return report;
  }

  const metadataKeys = new Set(["Name", "Group", "Id", "ID", "Description"]);
  async function visitReferences(value, context, directory) {
    if (typeof value === "string") {
      const file = await resolveFile(value, context, directory);
      if (file && path.extname(file).toLowerCase() === ".json") await readJson(file, context);
    } else if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) await visitReferences(value[index], `${context}[${index}]`, directory);
    } else if (isObject(value)) {
      for (const [key, nested] of Object.entries(value)) {
        if (!metadataKeys.has(key)) await visitReferences(nested, `${context}.${key}`, directory);
      }
    }
  }

  for (const [id, character] of Object.entries(manifest.characters)) {
    const context = `characters.${id}`;
    report.counts.characters += 1;
    if (!isObject(character)) { error("CHARACTER_INVALID", context, "Character must be an object."); continue; }
    if (!["portrait", "live2d"].includes(character.renderer)) error("RENDERER_INVALID", `${context}.renderer`, "Expected portrait or live2d.");
    if (!isObject(character.portraits) || !character.portraits.calm) {
      error("PORTRAITS_INVALID", `${context}.portraits`, "Portrait fallback requires a calm entry.");
    }
    for (const [state, reference] of Object.entries(isObject(character.portraits) ? character.portraits : {})) {
      report.counts.portraitReferences += 1;
      await resolveFile(reference, `${context}.portraits.${state}`);
    }
    if (!character.fallback) error("FALLBACK_MISSING", `${context}.fallback`, "A local fallback portrait is required.");
    else await resolveFile(character.fallback, `${context}.fallback`);

    if (!character.live2d) {
      if ((options.requireLive2d && id === "player") || character.renderer === "live2d") error("LIVE2D_MISSING", `${context}.live2d`, "This character has no Live2D model package.");
      continue;
    }
    if (!isObject(character.live2d)) { error("LIVE2D_INVALID", `${context}.live2d`, "Expected a model package object."); continue; }
    if (character.live2d.contract !== "debate-humanoid-v1") error("CONTRACT_INVALID", `${context}.live2d.contract`, "Expected debate-humanoid-v1.");
    const modelFile = await resolveFile(character.live2d.model, `${context}.live2d.model`);
    if (!modelFile) continue;
    if (!modelFile.toLowerCase().endsWith(".model3.json")) error("MODEL_EXTENSION", `${context}.live2d.model`, "Expected a .model3.json file.");
    const model = await readJson(modelFile, `${context}.live2d.model`);
    if (!isObject(model)) continue;
    report.counts.live2dModels += 1;
    if (model.Version !== 3) error("MODEL_VERSION", `${context}.live2d.model`, "Expected model3 Version 3.");
    const references = model.FileReferences;
    if (!isObject(references)) { error("MODEL_REFERENCES_MISSING", context, "model3 must contain FileReferences."); continue; }
    if (typeof references.Moc !== "string" || !references.Moc.toLowerCase().endsWith(".moc3")) error("MOC_REFERENCE_INVALID", context, "FileReferences.Moc must name a .moc3 file.");
    if (!Array.isArray(references.Textures) || references.Textures.length === 0 || references.Textures.some((texture) => typeof texture !== "string" || !texture)) {
      error("TEXTURES_MISSING", context, "FileReferences.Textures must contain nonempty texture paths.");
    }
    for (const key of ["Physics", "Pose", "DisplayInfo", "UserData", "MotionSync", "ParameterControl"]) {
      if (key in references && (typeof references[key] !== "string" || !references[key])) error("REFERENCE_INVALID", `${context}.live2d.FileReferences.${key}`, "Declared file reference must be a nonempty string.");
    }
    function checkEntries(entries, entryContext) {
      if (!Array.isArray(entries)) { error("REFERENCE_STRUCTURE", entryContext, "Expected an array of file entries."); return; }
      for (let index = 0; index < entries.length; index += 1) {
        if (!isObject(entries[index]) || typeof entries[index].File !== "string" || !entries[index].File) error("REFERENCE_STRUCTURE", `${entryContext}[${index}]`, "Each entry must contain a nonempty File reference.");
      }
    }
    if ("Expressions" in references) checkEntries(references.Expressions, `${context}.live2d.FileReferences.Expressions`);
    if ("Motions" in references) {
      if (!isObject(references.Motions)) error("REFERENCE_STRUCTURE", `${context}.live2d.FileReferences.Motions`, "Expected motion groups.");
      else for (const [group, entries] of Object.entries(references.Motions)) checkEntries(entries, `${context}.live2d.FileReferences.Motions.${group}`);
    }
    await visitReferences(references, `${context}.live2d.FileReferences`, path.dirname(modelFile));
    if (typeof references.Moc === "string") {
      const mocFile = await resolveFile(references.Moc, `${context}.live2d.Moc`, path.dirname(modelFile));
      if (mocFile) {
        const moc = await fs.readFile(mocFile);
        const plausible = moc.length >= 64 && moc.subarray(0, 4).toString("ascii") === "MOC3" && moc.subarray(4).includes(0);
        if (!plausible) error("MOC_NOT_BINARY", `${context}.live2d.Moc`, "Expected a nontrivial binary MOC3 header; text and placeholder models are not accepted.");
        else warning("MOC_RUNTIME_CHECK_REQUIRED", `${context}.live2d.Moc`, "Header passed only; load with matching Cubism Core and run its consistency check.");
      }
    }
  }
  if (report.counts.live2dModels === 0) warning("PORTRAIT_ONLY", "characters", "No actual Live2D model package was found; portrait validation is not Live2D completion.");
  report.counts.checkedFiles = checkedFiles.size;
  report.status = report.errors.length ? "failed" : "passed";
  return report;
}

let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (cause) { process.stdout.write(`${JSON.stringify({ status: "failed", errors: [{ code: "ARGUMENT_ERROR", message: cause.message }] }, null, 2)}\n`); process.exitCode = 2; }
if (options?.help) {
  process.stdout.write("Usage: node demo/tools/validate_character_assets.mjs [--manifest PATH] [--static-root PATH] [--report PATH] [--require-live2d]\nDefault: validate local portrait and declared Live2D assets; print JSON. --require-live2d requires a model for every character.\n");
} else if (options) {
  try {
    const report = await validate(options);
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.report) {
      if (options.report === options.manifest || isWithin(options.staticRoot, options.report)) throw new Error("Report must not overwrite the manifest or be stored inside static assets.");
      await fs.mkdir(path.dirname(options.report), { recursive: true });
      await fs.writeFile(options.report, output, "utf8");
    }
    process.stdout.write(output);
    process.exitCode = report.status === "passed" ? 0 : 1;
  } catch (cause) {
    process.stdout.write(`${JSON.stringify({ status: "failed", errors: [{ code: "VALIDATION_ERROR", message: cause.message }] }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
