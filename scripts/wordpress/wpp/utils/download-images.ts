#!/usr/bin/env ts-node
/**
 * Download Images Utility
 * Downloads all images from an export file without importing
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import readline from "readline";
import fetch from "node-fetch";
import { execSync } from "child_process";
import { DEFAULT_PATHS } from "../utils/constants";
import { getExportSite } from "./config-utils";
import { getFlagEmoji } from "./language";
import { decodeSlug } from "./formatting";

// Get export site to determine site-specific directory
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

// Create site-specific directories only
if (!fs.existsSync(siteOutputDir)) {
  fs.mkdirSync(siteOutputDir, { recursive: true });
}

if (!fs.existsSync(siteTempImagesDir)) {
  fs.mkdirSync(siteTempImagesDir, { recursive: true });
}

// Command line options
const forceDownload = process.argv.includes("--force");
const categoryMode = process.argv.includes("--categories") || !process.argv.includes("--products");
const productMode = process.argv.includes("--products");

interface ExportData {
  meta: {
    exported_at: string;
    main_language: string;
    other_languages: string[];
    source_site?: string;
  };
  data: Record<string, any[]>;
}

interface ProductImage {
  id: number;
  src: string;
  name?: string;
  alt?: string;
}

/**
 * Download an image from a URL and save it with the specified filename
 * @param imageUrl URL of the image to download
 * @param fileName The filename to save the image as (should already be renamed appropriately)
 */
async function downloadImage(imageUrl: string, fileName: string): Promise<string | null> {
  try {
    // Create a file path in the site-specific temp_images directory
    const siteFilePath = path.join(siteTempImagesDir, fileName);
    const legacyFilePath = path.join(legacyTempImagesDir, fileName);
    
    // Check if image already exists in site-specific directory first
    if (fs.existsSync(siteFilePath) && !forceDownload) {
      console.log(`  ${chalk.yellow('SKIPPED')} Image already exists in site-specific directory: ${fileName}`);
      return siteFilePath;
    }
    
    // Check if image exists in legacy directory (for backward compatibility)
    if (fs.existsSync(legacyFilePath) && !forceDownload) {
      console.log(`  ${chalk.yellow('SKIPPED')} Image found in legacy directory: ${fileName}`);
      return legacyFilePath;
    }
    
    console.log(`  ${chalk.blue('DOWNLOADING')} ${fileName}`);
    
    // Try to download the image
    const response = await fetch(imageUrl, { timeout: 30000 });
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    // Get the image data
    const imageBuffer = await response.buffer();
    
    // Save the image to site-specific directory with the renamed filename
    fs.writeFileSync(siteFilePath, imageBuffer);
    
    console.log(`  ${chalk.green('SUCCESS')} Saved as: ${fileName} in ${siteTempImagesDir}`);
    
    // Automatically convert to WebP if it's a supported image format
    const fileExtension = path.extname(fileName).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif'].includes(fileExtension)) {
      try {
        // Use the exact same filename (without extension) for the WebP version
        const nameWithoutExt = path.basename(fileName, fileExtension);
        const webpOutputPath = path.join(siteWebpImagesDir, `${nameWithoutExt}.webp`);
        
        // Create WebP directory if it doesn't exist
        if (!fs.existsSync(siteWebpImagesDir)) {
          fs.mkdirSync(siteWebpImagesDir, { recursive: true });
        }
        
        // Check if cwebp is installed
        try {
          execSync("which cwebp", { stdio: 'ignore' });
        } catch (error) {
          console.log("  WebP conversion skipped: cwebp not installed");
          return siteFilePath;
        }
        
        // Convert to WebP using cwebp
        console.log(`  Converting to WebP: ${fileName} → ${nameWithoutExt}.webp`);
        execSync(`cwebp -q 80 "${siteFilePath}" -o "${webpOutputPath}"`, { stdio: 'ignore' });
        
        if (fs.existsSync(webpOutputPath)) {
          console.log(`  WebP conversion successful: ${nameWithoutExt}.webp saved in ${siteWebpImagesDir}`);
        }
      } catch (conversionError) {
        console.log(`  WebP conversion failed: ${conversionError instanceof Error ? conversionError.message : String(conversionError)}`);
      }
    }
    
    return siteFilePath;
  } catch (error) {
    console.error(`  ${chalk.red('ERROR')} Downloading image ${fileName}:`, error);
    return null;
  }
}

/**
 * Process an image - download from source
 */
async function processImage(image: any, slug: string, stats: DownloadStats): Promise<void> {
  try {
    if (!image || !image.src) {
      console.log("  No image source provided");
      return;
    }

    // Get original filename and extension
    let originalName = path.basename(image.src);
    const fileExtension = path.extname(originalName).toLowerCase();
    
    // Use the slug as the filename for consistency
    const decodedSlug = decodeSlug(slug);
    // Create a sanitized slug-based filename to avoid special characters issues
    const sanitizedSlug = slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    const imageName = `${sanitizedSlug}${fileExtension}`;
    console.log(`\nProcessing image for: ${chalk.cyan(decodedSlug)} → ${chalk.green(imageName)}`);
    
    // Try alternative image URLs if the main one fails
    const imageUrls = [
      image.src,
      // Common WordPress thumbnail sizes
      image.src.replace(/\.([^.]+)$/, "-1152x1536.$1"), // Large thumbnail
      image.src.replace(/\.([^.]+)$/, "-768x1024.$1"), // Medium thumbnail
      image.src.replace(/\.([^.]+)$/, "-300x300.$1"), // Small thumbnail
    ];
    
    // Try each URL in sequence until one works
    for (const url of imageUrls) {
      try {
        const result = await downloadImage(url, imageName);
        if (result) {
          stats.downloaded++;
          return;
        }
      } catch (error) {
        // Continue to next URL
      }
    }
    
    console.log(`  ${chalk.red('FAILED')} Could not download any version of the image`);
    stats.failed++;
  } catch (error) {
    console.error(`  ${chalk.red('ERROR')} Processing image:`, error);
    stats.failed++;
  }
}

interface DownloadStats {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  byLanguage: Record<string, { total: number; downloaded: number; skipped: number; failed: number }>;
}

/**
 * Download all category images
 */
async function downloadCategoryImages(): Promise<void> {
  try {
    // Load the export data
    // Try site-specific file first, then fall back to legacy location
    const siteInputFile = path.join(siteOutputDir, DEFAULT_PATHS.categoriesFile);
    const legacyInputFile = path.join(DEFAULT_PATHS.outputDir, DEFAULT_PATHS.categoriesFile);
    let inputFile = siteInputFile;
    
    if (!fs.existsSync(siteInputFile) && fs.existsSync(legacyInputFile)) {
      console.log(chalk.yellow(`Site-specific export file not found, using legacy file: ${legacyInputFile}`));
      inputFile = legacyInputFile;
    }
    
    if (!fs.existsSync(inputFile)) {
      console.error(chalk.red(`Error: Category export file not found at ${inputFile}`));
      console.log(chalk.yellow("Please run the category export first."));
      process.exit(1);
    }
    
    console.log(chalk.cyan(`📂 Loading category data from: ${inputFile}`));
    
    const exportData: ExportData = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
    const { meta, data } = exportData;
    
    // Get source site name
    const sourceSiteName = exportData.meta.source_site || "Unknown source site";
    
    console.log(chalk.cyan(`📊 Found ${Object.values(data).flat().length} categories in ${Object.keys(data).length} languages`));
    
    // Show clear download information and ask for confirmation
    console.log(chalk.yellow.bold(`\n⚠️ DOWNLOAD CONFIRMATION`));
    console.log(chalk.yellow(`You are about to download category images:`));
    console.log(chalk.yellow(`- FROM: ${chalk.white(sourceSiteName)} (export file)`));
    console.log(chalk.yellow(`- TO:   ${chalk.white(`temp_images directory`)}`));
    
    if (forceDownload) {
      console.log(chalk.yellow(`- MODE: ${chalk.white('Force download all images')} (using --force)`));
    } else {
      console.log(chalk.yellow(`- MODE: ${chalk.white('Skip existing images')}`));
    }
    
    // Skip confirmation if force flag is set
    if (!process.argv.includes("--force")) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow.bold('\nProceed with download? (y/n): '), resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== "y") {
        console.log(chalk.blue("Download cancelled."));
        return;
      }
    } else {
      console.log(chalk.dim("Skipping confirmation due to --force flag."));
    }
    
    // Initialize stats
    const stats: DownloadStats = {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      byLanguage: {}
    };
    
    // Initialize stats for each language
    const allLanguages = [meta.main_language, ...meta.other_languages];
    for (const lang of allLanguages) {
      stats.byLanguage[lang] = { total: 0, downloaded: 0, skipped: 0, failed: 0 };
    }
    
    // Process main language first to get the correct slugs
    const mainLang = meta.main_language;
    if (data[mainLang] && data[mainLang].length > 0) {
      console.log(chalk.cyan(`\n🌎 Processing ${data[mainLang].length} categories in main language: ${mainLang} ${getFlagEmoji(mainLang)}`));
      
      for (const category of data[mainLang]) {
        stats.total++;
        stats.byLanguage[mainLang].total++;
        
        if (category.image) {
          await processImage(category.image, category.slug, stats);
        }
      }
    }
    
    // Then process other languages
    for (const lang of meta.other_languages) {
      if (data[lang] && data[lang].length > 0) {
        console.log(chalk.cyan(`\n🌎 Processing ${data[lang].length} categories in language: ${lang} ${getFlagEmoji(lang)}`));
        
        for (const category of data[lang]) {
          stats.total++;
          stats.byLanguage[lang].total++;
          
          // Find the main language version for the slug if available
          let slugToUse = category.slug;
          
          if (category.translations) {
            const mainLangId = category.translations[mainLang];
            if (mainLangId) {
              const mainLangCategory = data[mainLang]?.find(c => c.id === mainLangId);
              if (mainLangCategory) {
                slugToUse = mainLangCategory.slug;
              }
            }
          }
          
          if (category.image) {
            await processImage(category.image, slugToUse, stats);
          }
        }
      }
    }
    
    // Print download statistics
    console.log(chalk.green.bold(`\n✓ Download complete!`));
    console.log(chalk.cyan(`Total categories processed: ${stats.total}`));
    console.log(chalk.green(`Successfully downloaded: ${stats.downloaded}`));
    console.log(chalk.yellow(`Skipped (already exist): ${stats.skipped}`));
    
    if (stats.failed > 0) {
      console.log(chalk.red(`Failed to download: ${stats.failed}`));
    }
    
    console.log(chalk.cyan(`\nBy language:`));
    for (const [lang, langStats] of Object.entries(stats.byLanguage)) {
      if (langStats.total > 0) {
        const flag = getFlagEmoji(lang);
        console.log(`${flag} ${lang}: ${langStats.downloaded} downloaded, ${langStats.skipped} skipped, ${langStats.failed} failed (Total: ${langStats.total})`);
      }
    }
    
    console.log(chalk.green.bold(`\nImages saved to: ${siteTempImagesDir}`));
    console.log(chalk.green.bold(`WebP images saved to: ${siteWebpImagesDir}`));
  } catch (error) {
    console.error(chalk.red.bold("✗ Error during image download:"), error);
    process.exit(1);
  }
}

/**
 * Download all product images
 */
async function downloadProductImages(): Promise<void> {
  try {
    // Load the export data
    // Try site-specific file first, then fall back to legacy location
    const siteInputFile = path.join(siteOutputDir, DEFAULT_PATHS.productsFile);
    const legacyInputFile = path.join(DEFAULT_PATHS.outputDir, DEFAULT_PATHS.productsFile);
    let inputFile = siteInputFile;
    
    if (!fs.existsSync(siteInputFile) && fs.existsSync(legacyInputFile)) {
      console.log(chalk.yellow(`Site-specific export file not found, using legacy file: ${legacyInputFile}`));
      inputFile = legacyInputFile;
    }
    
    if (!fs.existsSync(inputFile)) {
      console.error(chalk.red(`Error: Product export file not found at ${inputFile}`));
      console.log(chalk.yellow("Please run the product export first."));
      process.exit(1);
    }
    
    console.log(chalk.cyan(`📂 Loading product data from: ${inputFile}`));
    
    const exportData: ExportData = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
    const { meta, data } = exportData;
    
    // Get source site name
    const sourceSiteName = exportData.meta.source_site || "Unknown source site";
    
    console.log(chalk.cyan(`📊 Found ${Object.values(data).flat().length} products in ${Object.keys(data).length} languages`));
    
    // Show clear download information and ask for confirmation
    console.log(chalk.yellow.bold(`\n⚠️ DOWNLOAD CONFIRMATION`));
    console.log(chalk.yellow(`You are about to download product images:`));
    console.log(chalk.yellow(`- FROM: ${chalk.white(sourceSiteName)} (export file)`));
    console.log(chalk.yellow(`- TO:   ${chalk.white(`temp_images directory`)}`));
    
    if (forceDownload) {
      console.log(chalk.yellow(`- MODE: ${chalk.white('Force download all images')} (using --force)`));
    } else {
      console.log(chalk.yellow(`- MODE: ${chalk.white('Skip existing images')}`));
    }
    
    // Skip confirmation if force flag is set
    if (!process.argv.includes("--force")) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow.bold('\nProceed with download? (y/n): '), resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== "y") {
        console.log(chalk.blue("Download cancelled."));
        return;
      }
    } else {
      console.log(chalk.dim("Skipping confirmation due to --force flag."));
    }
    
    // Initialize stats
    const stats: DownloadStats = {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      byLanguage: {}
    };
    
    // Initialize stats for each language
    const allLanguages = [meta.main_language, ...meta.other_languages];
    for (const lang of allLanguages) {
      stats.byLanguage[lang] = { total: 0, downloaded: 0, skipped: 0, failed: 0 };
    }
    
    // Process main language first to get the correct slugs
    const mainLang = meta.main_language;
    if (data[mainLang] && data[mainLang].length > 0) {
      console.log(chalk.cyan(`\n🌎 Processing ${data[mainLang].length} products in main language: ${mainLang} ${getFlagEmoji(mainLang)}`));
      
      for (const product of data[mainLang]) {
        stats.total++;
        stats.byLanguage[mainLang].total++;
        
        if (product.images && Array.isArray(product.images)) {
          for (const image of product.images) {
            await processImage(image, product.slug, stats);
          }
        }
      }
    }
    
    // Then process other languages
    for (const lang of meta.other_languages) {
      if (data[lang] && data[lang].length > 0) {
        console.log(chalk.cyan(`\n🌎 Processing ${data[lang].length} products in language: ${lang} ${getFlagEmoji(lang)}`));
        
        for (const product of data[lang]) {
          stats.total++;
          stats.byLanguage[lang].total++;
          
          // Find the main language version for the slug if available
          let slugToUse = product.slug;
          
          if (product.translations) {
            const mainLangId = product.translations[mainLang];
            if (mainLangId) {
              const mainLangProduct = data[mainLang]?.find(p => p.id === mainLangId);
              if (mainLangProduct) {
                slugToUse = mainLangProduct.slug;
              }
            }
          }
          
          if (product.images && Array.isArray(product.images)) {
            for (const image of product.images) {
              await processImage(image, slugToUse, stats);
            }
          }
        }
      }
    }
    
    // Print download statistics
    console.log(chalk.green.bold(`\n✓ Download complete!`));
    console.log(chalk.cyan(`Total products processed: ${stats.total}`));
    console.log(chalk.green(`Successfully downloaded: ${stats.downloaded}`));
    console.log(chalk.yellow(`Skipped (already exist): ${stats.skipped}`));
    
    if (stats.failed > 0) {
      console.log(chalk.red(`Failed to download: ${stats.failed}`));
    }
    
    console.log(chalk.cyan(`\nBy language:`));
    for (const [lang, langStats] of Object.entries(stats.byLanguage)) {
      if (langStats.total > 0) {
        const flag = getFlagEmoji(lang);
        console.log(`${flag} ${lang}: ${langStats.downloaded} downloaded, ${langStats.skipped} skipped, ${langStats.failed} failed (Total: ${langStats.total})`);
      }
    }
    
    console.log(chalk.green.bold(`\nImages saved to: ${siteTempImagesDir}`));
    console.log(chalk.green.bold(`WebP images saved to: ${siteWebpImagesDir}`));
  } catch (error) {
    console.error(chalk.red.bold("✗ Error during image download:"), error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold.cyan("WordPress Image Downloader"));
  console.log(chalk.cyan("This utility downloads images from export files without importing"));
  
  if (categoryMode && productMode) {
    // Both modes specified, download both
    await downloadCategoryImages();
    await downloadProductImages();
  } else if (productMode) {
    // Only product mode
    await downloadProductImages();
  } else {
    // Default to category mode
    await downloadCategoryImages();
  }
}

// Run the script
main().catch(error => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
