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
import config from "../config";
import { getExportSite } from "./config-utils";
import { getFlagEmoji } from "./language";
import { decodeSlug } from "./formatting";

// Create temp_images directory in the export folder if it doesn't exist
const tempImagesDir = path.join(config.outputDir, "temp_images");

if (!fs.existsSync(tempImagesDir)) {
  fs.mkdirSync(tempImagesDir, { recursive: true });
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
 * Download an image from a URL
 */
async function downloadImage(imageUrl: string, fileName: string): Promise<string | null> {
  try {
    // Create a file path in the temp_images directory
    const filePath = path.join(tempImagesDir, fileName);
    
    // Check if image already exists and we're not forcing download
    if (fs.existsSync(filePath) && !forceDownload) {
      console.log(`  ${chalk.yellow('SKIPPED')} Image already exists: ${fileName}`);
      return filePath;
    }
    
    console.log(`  ${chalk.blue('DOWNLOADING')} ${fileName}`);
    
    // Try to download the image
    const response = await fetch(imageUrl, { timeout: 30000 });
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    // Get the image data
    const imageBuffer = await response.buffer();
    
    // Save the image to disk
    fs.writeFileSync(filePath, imageBuffer);
    
    console.log(`  ${chalk.green('SUCCESS')} Saved to: ${filePath}`);
    return filePath;
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

    // Use slug as the filename
    let imageName = path.basename(image.src);
    const fileExtension = path.extname(imageName).toLowerCase();
    
    // Use the slug as the filename
    const decodedSlug = decodeSlug(slug);
    imageName = `${slug}${fileExtension}`;
    console.log(`\nProcessing image for: ${chalk.cyan(decodedSlug)}`);
    
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
    const inputFile = path.join(config.outputDir, "exported-categories.json");
    
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
    
    console.log(chalk.green.bold(`\nImages saved to: ${tempImagesDir}`));
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
    const inputFile = path.join(config.outputDir, "exported-products.json");
    
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
    
    console.log(chalk.green.bold(`\nImages saved to: ${tempImagesDir}`));
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
