#!/usr/bin/env ts-node
/**
 * Convert Images to WebP Utility
 * Converts downloaded images to WebP format for better compression
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execSync } from "child_process";
import { DEFAULT_PATHS } from "./constants";
import { getExportSite } from "./config-utils";

// Get the export site URL to determine the site-specific directory
const exportSite = getExportSite();
const exportBaseUrl = exportSite.baseUrl;
const siteDomain = exportBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

// Create site-specific image directories
const siteOutputDir = path.join(DEFAULT_PATHS.outputDir, siteDomain);
const siteTempImagesDir = path.join(siteOutputDir, DEFAULT_PATHS.tempImagesDir);
const siteWebpImagesDir = path.join(siteOutputDir, DEFAULT_PATHS.webpImagesDir);

// Legacy image directories (for backward compatibility - only for reading, not writing)
const tempImagesDir = path.join(DEFAULT_PATHS.outputDir, DEFAULT_PATHS.tempImagesDir);
const legacyTempImagesDir = tempImagesDir; // Alias for clarity
const webpImagesDir = path.join(DEFAULT_PATHS.outputDir, DEFAULT_PATHS.webpImagesDir);
const legacyWebpImagesDir = webpImagesDir; // Alias for clarity

// Create site-specific directories only
if (!fs.existsSync(siteOutputDir)) {
  fs.mkdirSync(siteOutputDir, { recursive: true });
}

if (!fs.existsSync(siteTempImagesDir)) {
  fs.mkdirSync(siteTempImagesDir, { recursive: true });
}

if (!fs.existsSync(siteWebpImagesDir)) {
  fs.mkdirSync(siteWebpImagesDir, { recursive: true });
}

// Legacy directories are only for reading, not creating

// Command line options
const forceConversion = process.argv.includes("--force");
const categoryMode = process.argv.includes("--categories") || !process.argv.includes("--products");
const quality = process.argv.includes("--quality") 
  ? parseInt(process.argv[process.argv.indexOf("--quality") + 1]) 
  : 80;

// Statistics tracking
interface ConversionStats {
  total: number;
  converted: number;
  skipped: number;
  failed: number;
}

/**
 * Convert an image to WebP format
 */
async function convertToWebP(imagePath: string, stats: ConversionStats): Promise<void> {
  try {
    const filename = path.basename(imagePath);
    const nameWithoutExt = path.basename(filename, path.extname(filename));
    
    // Determine if the image is from a site-specific or legacy directory
    const isSiteSpecific = imagePath.includes(siteDomain);
    
    // Use site-specific or legacy output path accordingly
    const outputPath = isSiteSpecific
      ? path.join(siteWebpImagesDir, `${nameWithoutExt}.webp`)
      : path.join(legacyWebpImagesDir, `${nameWithoutExt}.webp`);
    
    // Skip if already exists and not forcing conversion
    if (fs.existsSync(outputPath) && !forceConversion) {
      console.log(`  ${chalk.yellow("Skipped")}: ${filename} (already exists as WebP)`);
      stats.skipped++;
      return;
    }
    
    // Check if cwebp is installed
    try {
      execSync("which cwebp", { stdio: 'ignore' });
    } catch (error) {
      console.error(chalk.red("Error: cwebp is not installed. Please install it with:"));
      console.error(chalk.yellow("  brew install webp"));
      process.exit(1);
    }
    
    // Convert to WebP using cwebp
    console.log(`  Converting: ${chalk.cyan(filename)} to WebP (quality: ${quality})`);
    execSync(`cwebp -q ${quality} "${imagePath}" -o "${outputPath}"`, { stdio: 'ignore' });
    
    // Get file sizes for comparison
    const originalSize = fs.statSync(imagePath).size;
    const webpSize = fs.statSync(outputPath).size;
    
    // Calculate size difference
    let sizeChange;
    if (webpSize < originalSize) {
      // WebP is smaller (good)
      const savings = ((1 - webpSize / originalSize) * 100).toFixed(1);
      sizeChange = `${chalk.green(savings + "% smaller")}`;
    } else {
      // WebP is larger (not good)
      const increase = ((webpSize / originalSize - 1) * 100).toFixed(1);
      sizeChange = `${chalk.red(increase + "% larger")}`;
    }
    
    // Show original and new sizes in KB
    const originalKB = (originalSize / 1024).toFixed(1);
    const webpKB = (webpSize / 1024).toFixed(1);
    
    console.log(`  ${chalk.green("Success")}: ${filename} → ${nameWithoutExt}.webp (${sizeChange})`); 
    console.log(`    Original: ${originalKB} KB, WebP: ${webpKB} KB`);
    stats.converted++;
  } catch (error) {
    console.error(`  ${chalk.red("Failed")}: Error converting ${path.basename(imagePath)}:`, error);
    stats.failed++;
  }
}

/**
 * Main function to convert all images in the temp_images directory
 */
async function convertAllImages(): Promise<void> {
  console.log(chalk.blue.bold("\n=== Converting Images to WebP ==="));
  console.log(`Site domain: ${chalk.cyan(siteDomain)}`);
  console.log(`Site-specific source directory: ${chalk.cyan(siteTempImagesDir)}`);
  console.log(`Site-specific target directory: ${chalk.cyan(siteWebpImagesDir)}`);
  console.log(`Legacy source directory: ${chalk.cyan(legacyTempImagesDir)}`);
  console.log(`Legacy target directory: ${chalk.cyan(legacyWebpImagesDir)}`);
  console.log(`Quality setting: ${chalk.cyan(quality)}%`);
  
  // Get all images from both site-specific and legacy directories
  let siteFiles: string[] = [];
  let legacyFiles: string[] = [];
  
  // Read site-specific directory if it exists
  if (fs.existsSync(siteTempImagesDir)) {
    siteFiles = fs.readdirSync(siteTempImagesDir).filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
    });
  }
  
  // Read legacy directory if it exists
  if (fs.existsSync(legacyTempImagesDir)) {
    legacyFiles = fs.readdirSync(legacyTempImagesDir).filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
    });
  }
  
  // Combine files, removing duplicates (prefer site-specific)
  const siteFilesSet = new Set(siteFiles);
  const uniqueLegacyFiles = legacyFiles.filter(file => !siteFilesSet.has(file));
  
  // Create full paths for all files
  const imageFilePaths: string[] = [
    ...siteFiles.map(file => path.join(siteTempImagesDir, file)),
    ...uniqueLegacyFiles.map(file => path.join(legacyTempImagesDir, file))
  ];
  
  if (imageFilePaths.length === 0) {
    console.log(chalk.yellow("\nNo images found in either site-specific or legacy directories."));
    return;
  }
  
  console.log(chalk.blue(`\nFound ${imageFilePaths.length} images to process...\n`));
  console.log(`Site-specific images: ${siteFiles.length}`);
  console.log(`Unique legacy images: ${uniqueLegacyFiles.length}`);
  
  // Statistics tracking
  const stats: ConversionStats = {
    total: imageFilePaths.length,
    converted: 0,
    skipped: 0,
    failed: 0
  };
  
  // Process each image
  for (const imagePath of imageFilePaths) {
    await convertToWebP(imagePath, stats);
  }
  
  // Print summary
  console.log(chalk.blue.bold("\n=== Conversion Summary ==="));
  console.log(`Total images: ${chalk.white(stats.total)}`);
  console.log(`Converted: ${chalk.green(stats.converted)}`);
  console.log(`Skipped: ${chalk.yellow(stats.skipped)}`);
  console.log(`Failed: ${chalk.red(stats.failed)}`);
  
  if (stats.converted > 0) {
    console.log(chalk.green.bold("\nWebP images are available in:"));
    
    // Show site-specific directory if any images were converted there
    if (siteFiles.length > 0) {
      console.log(chalk.cyan(`Site-specific directory: ${siteWebpImagesDir}`));
    }
    
    // Show legacy directory if any legacy images were converted
    if (uniqueLegacyFiles.length > 0) {
      console.log(chalk.cyan(`Legacy directory: ${legacyWebpImagesDir}`));
    }
  }
}

// Run the main function
convertAllImages().catch(error => {
  console.error(chalk.red("Error during conversion:"), error);
  process.exit(1);
});
