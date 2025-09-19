#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------- CLI -------------------------
const [, , mode, inputPath] = process.argv;

if (!mode || !inputPath) {
  console.error(`Usage:
  node ${path.basename(__filename)} image-download ./your-file.csv
  node ${path.basename(__filename)} convert-webp ./your-folder
  `);
  process.exit(1);
}

// ------------------------- Helpers -------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFolderSize(folderPath) {
  let total = 0;
  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const stats = await fs.promises.stat(fullPath);
        total += stats.size;
      }
    }
  }
  await walk(folderPath);
  return total;
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

function stripDiacritics(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function sanitizeFilename(name) {
  const cleaned = stripDiacritics(
    String(name || "untitled")
      .trim()
      .toLowerCase()
  )
    .replace(/&/g, "and")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "untitled";
}

function extFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    const ext = path.extname(p);
    if (/\.(jpe?g|png|gif|webp|avif|svg)$/i.test(ext)) return ext.toLowerCase();
    return "";
  } catch {
    return "";
  }
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const arrBuf = await res.arrayBuffer();
  await fs.promises.writeFile(destPath, Buffer.from(arrBuf));
}

function ensureUniqueName(baseName, usedSet, ext) {
  let candidate = baseName + ext;
  let i = 2;
  while (usedSet.has(candidate)) {
    candidate = `${baseName}-${i}${ext}`;
    i++;
  }
  usedSet.add(candidate);
  return candidate;
}

// ------------------------- Modes -------------------------
async function runImageDownload(csvPath) {
  const csvRaw = await fs.promises.readFile(csvPath, "utf8");
  const records = parse(csvRaw, { columns: true, skip_empty_lines: true });

  const csvAbs = path.resolve(csvPath);
  const csvDir = path.dirname(csvAbs);
  const csvBase = path.basename(csvAbs, path.extname(csvAbs));

  const imagesDir = path.join(csvDir, csvBase);
  await fs.promises.mkdir(imagesDir, { recursive: true });

  const outCsvPath = path.join(csvDir, `${csvBase}-local.csv`);

  const headers = Object.keys(records[0] || {});
  const usedFilenames = new Set();
  let processed = 0;
  let failed = 0;

  for (const row of records) {
    const term = row.name || row.slug || row.term_id || "untitled";
    const url = row.thumbnail?.toString().trim();

    if (!url) continue;

    let ext = extFromUrl(url) || ".jpg";
    const baseName = sanitizeFilename(term);
    const finalName = ensureUniqueName(baseName, usedFilenames, ext);
    const destPath = path.join(imagesDir, finalName);

    try {
      await downloadImage(url, destPath);
      row.thumbnail = `./${csvBase}/${finalName}`;
      processed++;
      await sleep(100);
    } catch (err) {
      console.warn(
        `Failed to download for term "${term}": ${url}\n  → ${err.message}`
      );
      failed++;
    }
  }

  const output = stringify(records, { header: true, columns: headers });
  await fs.promises.writeFile(outCsvPath, output, "utf8");

  const folderSize = await getFolderSize(imagesDir);

  console.log(`\n✅ Image download done:`);
  console.log(`- Images folder:  ${imagesDir}`);
  console.log(`- Folder size:    ${formatSize(folderSize)}`);
  console.log(`- New CSV:        ${outCsvPath}`);
  console.log(`- Downloaded:     ${processed}`);
  console.log(`- Failed:         ${failed}\n`);
}

async function runConvertWebp(folderPath) {
  const absFolder = path.resolve(folderPath);
  if (!fs.existsSync(absFolder) || !fs.lstatSync(absFolder).isDirectory()) {
    console.error(`Error: ${folderPath} is not a folder`);
    process.exit(1);
  }

  const parentDir = path.dirname(absFolder);
  const folderBase = path.basename(absFolder);
  const outFolder = path.join(parentDir, `${folderBase}-webp`);

  await fs.promises.mkdir(outFolder, { recursive: true });

  const files = await fs.promises.readdir(absFolder);
  const imageFiles = files.filter((f) => /\.(jpe?g|png|gif)$/i.test(f));

  let converted = 0;
  for (const file of imageFiles) {
    const inputFile = path.join(absFolder, file);
    const baseName = file.replace(/\.[^.]+$/, ""); // remove extension
    const outFile = path.join(outFolder, `${baseName}.webp`);

    try {
      await exec(`cwebp -q 90 "${inputFile}" -o "${outFile}"`);
      console.log(`Converted: ${file} → ${path.basename(outFile)}`);
      converted++;
    } catch (err) {
      console.warn(`Failed to convert ${file}: ${err.message}`);
    }
  }

  const origSize = await getFolderSize(absFolder);
  const newSize = await getFolderSize(outFolder);

  console.log(`\n✅ WebP conversion done:`);
  console.log(`- Original folder: ${absFolder} → ${formatSize(origSize)}`);
  console.log(`- New folder:      ${outFolder} → ${formatSize(newSize)}`);
  console.log(`- Converted:       ${converted} file(s)\n`);
}

// ------------------------- Run -------------------------
(async () => {
  if (mode === "image-download") {
    await runImageDownload(inputPath);
  } else if (mode === "convert-webp") {
    await runConvertWebp(inputPath);
  } else {
    console.error(
      `Unknown mode "${mode}". Use "image-download" or "convert-webp".`
    );
    process.exit(1);
  }
})();
