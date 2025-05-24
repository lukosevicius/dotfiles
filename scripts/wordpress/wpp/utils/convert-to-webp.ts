#!/usr/bin/env ts-node
/**
 * Convert Images to WebP Utility
 * Converts downloaded images to WebP format for better compression
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execSync } from "child_process";
import config from "../config";

// Create directories if they don't exist
const tempImagesDir = path.join(config.outputDir, "temp_images");
const webpImagesDir = path.join(config.outputDir, "webp_images");

if (!fs.existsSync(tempImagesDir)) {
  fs.mkdirSync(tempImagesDir, { recursive: true });
}

if (!fs.existsSync(webpImagesDir)) {
  fs.mkdirSync(webpImagesDir, { recursive: true });
}

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
    const outputPath = path.join(webpImagesDir, `${nameWithoutExt}.webp`);
    
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
  console.log(`Source directory: ${chalk.cyan(tempImagesDir)}`);
  console.log(`Target directory: ${chalk.cyan(webpImagesDir)}`);
  console.log(`Quality setting: ${chalk.cyan(quality)}%`);
  
  // Get all images in the temp_images directory
  const files = fs.readdirSync(tempImagesDir);
  const imageFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
  });
  
  if (imageFiles.length === 0) {
    console.log(chalk.yellow("\nNo images found in the temp_images directory."));
    return;
  }
  
  console.log(chalk.blue(`\nFound ${imageFiles.length} images to process...\n`));
  
  // Statistics tracking
  const stats: ConversionStats = {
    total: imageFiles.length,
    converted: 0,
    skipped: 0,
    failed: 0
  };
  
  // Process each image
  for (const file of imageFiles) {
    const imagePath = path.join(tempImagesDir, file);
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
    console.log(chalk.cyan(webpImagesDir));
  }
}

// Run the main function
convertAllImages().catch(error => {
  console.error(chalk.red("Error during conversion:"), error);
  process.exit(1);
});
