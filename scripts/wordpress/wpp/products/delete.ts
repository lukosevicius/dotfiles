import fetch from "node-fetch";
import config from "../config";
import { getImportBaseUrl, getImportCredentials, getImportSite } from "../utils/config-utils";
import chalk from "chalk";
import { fetchJSON, getSiteName } from "../utils/api";
import readline from "readline";
import path from "path";
import fs from "fs";
import { execSync, spawn } from "child_process";
import { URL } from "url";

// Check if --confirm flag is provided
const shouldConfirm = !process.argv.includes("--confirm");

// Check if --delete-images flag is provided
const shouldDeleteImages = process.argv.includes("--delete-images");
let deleteImagesConfirmed = false;

// Check if --thorough-cleanup flag is provided for enhanced media cleanup
const thoroughCleanup = process.argv.includes("--thorough-cleanup");
let thoroughCleanupConfirmed = false;

// Keep track of already deleted product IDs to avoid duplicate deletions
const deletedProductIds = new Set<number>();

async function deleteAllProducts(): Promise<void> {
  // Get site name first
  console.log(chalk.cyan(`🔄 Connecting to: ${getImportBaseUrl()}`));
  
  try {
    const siteName = await getSiteName(getImportBaseUrl());
    
    if (shouldConfirm) {
      console.log(chalk.red.bold(`⚠️ WARNING: This will delete ALL products from: ${chalk.white.bgRed(` ${siteName} (${getImportBaseUrl()}) `)}!`));
      console.log(chalk.yellow("Run with --confirm flag to skip this confirmation."));
      
      // Ask for explicit confirmation
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.red.bold('\nAre you sure you want to delete all products? (y/n): '), resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== "y") {
        console.log(chalk.blue("Deletion cancelled."));
        return;
      }
    }
    
    // Ask about deleting images if --delete-images flag is provided and not already confirmed
    if (shouldDeleteImages && !deleteImagesConfirmed) {
      // If --confirm flag is provided, assume image deletion is also confirmed
      if (!shouldConfirm) {
        deleteImagesConfirmed = true;
        console.log(chalk.yellow("Product images will be deleted along with products (--confirm flag used)."));
      } else {
        console.log(chalk.yellow.bold(`\n⚠️ WARNING: The --delete-images flag is set. This will also delete all product images!`));
        
        // Ask for explicit confirmation for image deletion
        const rlImages = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const imageAnswer = await new Promise<string>((resolve) => {
          rlImages.question(chalk.yellow.bold('\nAre you sure you want to delete all product images? (y/n): '), resolve);
        });
        rlImages.close();
        
        // Accept both 'y' and 'yes' as confirmation
        const answer = imageAnswer.toLowerCase();
        if (answer === "y" || answer === "yes") {
          deleteImagesConfirmed = true;
          console.log(chalk.yellow("Product images will be deleted along with products."));
        } else {
          console.log(chalk.blue("Image deletion will be skipped. Products will still be deleted."));
          deleteImagesConfirmed = false;
        }
      }
    }
    
    // Ask about thorough cleanup if --thorough-cleanup flag is provided and not already confirmed
    if (thoroughCleanup && !thoroughCleanupConfirmed) {
      // If --confirm flag is provided, assume thorough cleanup is also confirmed
      if (!shouldConfirm) {
        thoroughCleanupConfirmed = true;
        console.log(chalk.yellow("Thorough media cleanup will be performed after product deletion (--confirm flag used)."));
      } else {
        console.log(chalk.yellow.bold(`\n⚠️ WARNING: The --thorough-cleanup flag is set. This will perform an extensive cleanup of all product media!`));
        console.log(chalk.yellow("This includes database entries and physical files that might be missed by standard cleanup."));
        
        // Ask for explicit confirmation for thorough cleanup
        const rlCleanup = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const cleanupAnswer = await new Promise<string>((resolve) => {
          rlCleanup.question(chalk.yellow.bold('\nAre you sure you want to perform thorough media cleanup? (y/n): '), resolve);
        });
        rlCleanup.close();
        
        // Accept both 'y' and 'yes' as confirmation
        const answer = cleanupAnswer.toLowerCase();
        if (answer === "y" || answer === "yes") {
          thoroughCleanupConfirmed = true;
          console.log(chalk.yellow("Thorough media cleanup will be performed after product deletion."));
        } else {
          console.log(chalk.blue("Thorough cleanup will be skipped. Standard image deletion will still be performed if enabled."));
          thoroughCleanupConfirmed = false;
        }
      }
    }
    
    // Delete all products
    console.log(chalk.blue(`\n🔄 Fetching all products from ${chalk.bold(siteName)}...`));
    const products = await fetchAllProducts();
    
    if (products.length === 0) {
      console.log(chalk.yellow("No products found."));
      return;
    }
    
    console.log(chalk.green(`Found ${products.length} products.`));
    
    // Delete each product
    for (const product of products) {
      try {
        // Skip if this product ID has already been deleted
        if (deletedProductIds.has(product.id)) {
          console.log(chalk.yellow(`Skipping product ID ${product.id} (${product.name || 'Unknown'}) as it was already deleted`));
          continue;
        }
        
        await deleteProduct(product.id, product.slug, deleteImagesConfirmed, thoroughCleanupConfirmed);
        
        // Mark this product as deleted
        deletedProductIds.add(product.id);
      } catch (error: any) {
        console.log(chalk.red(`✗ Failed to delete product: ${product.name || product.id} Error: ${error.message || error}`));
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(chalk.green.bold(`\n✓ Deletion complete!`));
    console.log(chalk.cyan(`Total products processed: ${products.length}`));
    
    // Print summary
    console.log(chalk.green(`\n✓ Deletion process completed.`));
    console.log(chalk.green(`  Total products processed: ${deletedProductIds.size}`));
    
    if (shouldDeleteImages && deleteImagesConfirmed) {
      console.log(chalk.yellow(`\nImage deletion was enabled. Product images have been deleted.`));
      
      // Final cleanup - scan the uploads directory for any remaining product images
      // This will catch any files that might have been missed by the individual product deletion
      try {
        console.log(chalk.blue(`\nPerforming final cleanup of physical image files...`));
        
        // Get the uploads directory path
        const testUrl = `${getImportBaseUrl()}/wp-content/uploads/placeholder.jpg`;
        const testPath = getPhysicalFilePath(testUrl);
        if (testPath) {
          const uploadsDir = path.dirname(path.dirname(path.dirname(testPath))); // Get the uploads directory
          
          // Get the current year and month for the most likely location of recent uploads
          const now = new Date();
          const year = now.getFullYear().toString();
          const month = (now.getMonth() + 1).toString().padStart(2, '0');
          
          // Delete any remaining files in the current year/month directory
          const currentYearMonthDir = path.join(uploadsDir, year, month);
          if (fs.existsSync(currentYearMonthDir)) {
            console.log(chalk.blue(`Cleaning up files in ${currentYearMonthDir}`));
            deletePhysicalFilesMatchingPattern(currentYearMonthDir, `*.webp`);
            deletePhysicalFilesMatchingPattern(currentYearMonthDir, `*.jpg`);
            deletePhysicalFilesMatchingPattern(currentYearMonthDir, `*.jpeg`);
            deletePhysicalFilesMatchingPattern(currentYearMonthDir, `*.png`);
          }
        }
        
        // Final database cleanup - delete any remaining media items for the products we processed
        console.log(chalk.blue(`\nPerforming final cleanup of database media entries...`));
        for (const product of products) {
          await deleteAllMediaForProduct(product.slug);
        }
      } catch (error: any) {
        console.log(chalk.yellow(`⚠️ Error during final cleanup: ${error.message || error}`));
      }
    }
  } catch (error) {
    console.error(chalk.red.bold("✗ Error during product deletion:"), error);
    process.exit(1);
  }
}

/**
 * Fetch all products from all available languages
 */
async function fetchAllProducts(): Promise<any[]> {
  let allProducts: any[] = [];
  let page = 1;
  let hasMorePages = true;
  
  console.log(chalk.cyan(`Fetching products from all languages using lang=all parameter...`));
  
  // Use lang=all parameter to get products in all languages at once
  while (hasMorePages) {
    const url = `${getImportBaseUrl()}/wp-json/wc/v3/products?per_page=100&page=${page}&lang=all`;
    
    try {
      const products = await fetchJSON(url);
      
      if (products.length === 0) {
        hasMorePages = false;
      } else {
        // Check for duplicates before adding
        const newProducts = products.filter((newProduct: any) => 
          !allProducts.some(existingProduct => existingProduct.id === newProduct.id)
        );
        
        if (newProducts.length > 0) {
          allProducts = [...allProducts, ...newProducts];
          console.log(chalk.dim(`Fetched page ${page} (${newProducts.length} unique products)`));
        } else {
          console.log(chalk.dim(`Fetched page ${page} (0 unique products, all were duplicates)`));
        }
        page++;
      }
    } catch (error) {
      console.error(chalk.red(`Error fetching products with lang=all, page ${page}:`), error);
      hasMorePages = false;
      
      // Fallback to fetching by individual languages if lang=all fails
      console.log(chalk.yellow(`Falling back to fetching products by individual languages...`));
      return fetchProductsByLanguage();
    }
  }
  
  console.log(chalk.green(`✓ Found a total of ${allProducts.length} unique products across all languages`));
  
  return allProducts;
}

/**
 * Fallback function to fetch products by individual languages
 */
async function fetchProductsByLanguage(): Promise<any[]> {
  // Array of language codes to fetch products from - make sure to include ALL languages used in your site
  const languages = ['', 'en', 'lt', 'de', 'fr', 'es', 'it', 'ru', 'pl', 'lv', 'et'];
  let allProducts: any[] = [];
  
  console.log(chalk.cyan(`Fetching products from each language individually...`));
  
  // Fetch products from each language
  for (const lang of languages) {
    let page = 1;
    let hasMorePages = true;
    const langDisplay = lang || 'default';
    
    while (hasMorePages) {
      // Add lang parameter only if it's not empty
      const langParam = lang ? `&lang=${lang}` : '';
      const url = `${getImportBaseUrl()}/wp-json/wc/v3/products?per_page=100&page=${page}${langParam}`;
      
      try {
        const products = await fetchJSON(url);
        
        if (products.length === 0) {
          hasMorePages = false;
        } else {
          // Check for duplicates before adding
          const newProducts = products.filter((newProduct: any) => 
            !allProducts.some(existingProduct => existingProduct.id === newProduct.id)
          );
          
          if (newProducts.length > 0) {
            allProducts = [...allProducts, ...newProducts];
            console.log(chalk.dim(`Fetched page ${page} (${newProducts.length} unique products in ${langDisplay} language)`));
          } else {
            console.log(chalk.dim(`Fetched page ${page} (0 unique products in ${langDisplay} language, all were duplicates)`));
          }
          page++;
        }
      } catch (error) {
        console.error(chalk.red(`Error fetching products in ${langDisplay} language, page ${page}:`), error);
        hasMorePages = false;
      }
    }
  }
  
  console.log(chalk.green(`✓ Found a total of ${allProducts.length} unique products across all languages`));
  
  return allProducts;
}

/**
 * Get the physical file path from a WordPress media URL
 * @param sourceUrl - The URL of the media file
 * @returns The physical file path on the server
 */
function getPhysicalFilePath(sourceUrl: string): string | null {
  try {
    // Parse the URL to get the pathname
    const urlObj = new URL(sourceUrl);
    const pathname = urlObj.pathname;
    
    // Extract the uploads path (typically /wp-content/uploads/...)
    const uploadsPath = pathname.match(/(\/wp-content\/uploads\/.+)/);
    if (!uploadsPath || !uploadsPath[1]) {
      return null;
    }
    
    // Construct the physical file path
    // For local development, we need to map to the actual filesystem path
    const baseDir = '/Users/mantas/sites/wpml-woo-mnt-blocksy/app/public';
    const physicalPath = `${baseDir}${uploadsPath[1]}`;
    
    return physicalPath;
  } catch (error) {
    console.log(chalk.yellow(`\u26a0\ufe0f Error parsing URL: ${sourceUrl}`));
    return null;
  }
}

/**
 * Delete a physical file from the filesystem
 * @param filePath - Path to the file to delete
 */
function deletePhysicalFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error: any) {
    console.log(chalk.yellow(`\u26a0\ufe0f Error deleting file ${filePath}: ${error.message || error}`));
    return false;
  }
}

/**
 * Delete all physical files in a directory matching a pattern
 * @param directory - Directory to search in
 * @param pattern - Filename pattern to match
 */
function deletePhysicalFilesMatchingPattern(directory: string, pattern: string): void {
  try {
    // Use find command to locate files matching the pattern
    const command = `find "${directory}" -type f -name "${pattern}" -print`;
    const files = execSync(command).toString().trim().split('\n').filter(Boolean);
    
    if (files.length > 0) {
      console.log(chalk.blue(`Found ${files.length} physical files matching pattern: ${pattern}`));
      
      // Delete each file
      for (const file of files) {
        if (deletePhysicalFile(file)) {
          console.log(chalk.green(`\u2713 Deleted physical file: ${path.basename(file)}`));
        }
      }
    }
  } catch (error: any) {
    console.log(chalk.yellow(`\u26a0\ufe0f Error searching for files with pattern ${pattern}: ${error.message || error}`));
  }
}

/**
 * Delete an image and its thumbnails if its filename matches the product slug
 * @param imageId - The ID of the image to check and delete
 * @param productSlug - The slug of the product
 * @param baseUrl - The base URL of the WordPress site
 */
async function deleteImageIfMatchingSlug(imageId: number, productSlug: string, baseUrl: string): Promise<void> {
  try {
    // Get image details
    const imageUrl = `${baseUrl}/wp-json/wp/v2/media/${imageId}`;
    try {
      const imageDetails = await fetchJSON(imageUrl);
      
      // Check if the image filename matches the product slug
      const sourceUrl = imageDetails.source_url || '';
      const filename = path.basename(sourceUrl);
      const fileExt = path.extname(filename);
      const filenameWithoutExt = path.basename(filename, fileExt);
      
      // Sanitize the product slug in the same way as during upload
      const sanitizedSlug = productSlug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      
      // Check if the filename (without extension) matches the sanitized product slug
      // or starts with the sanitized slug (for backward compatibility with ID-based names)
      if (filenameWithoutExt === sanitizedSlug || filenameWithoutExt.startsWith(`${sanitizedSlug}-`)) {
        console.log(chalk.blue(`Found matching image: ${filename} for product: ${productSlug}`));
        
        // Get the physical file path
        const physicalPath = getPhysicalFilePath(sourceUrl);
        
        // First, check for and delete any related thumbnail images
        await deleteRelatedThumbnails(baseUrl, filenameWithoutExt, fileExt);
        
        // Delete the main image from WordPress database
        const deleteUrl = `${baseUrl}/wp-json/wp/v2/media/${imageId}?force=true`;
        await fetchJSON(deleteUrl, { method: "DELETE" });
        console.log(chalk.green(`\u2713 Deleted main image from database: ${filename} (ID: ${imageId})`));
        
        // Delete the physical file
        if (physicalPath && deletePhysicalFile(physicalPath)) {
          console.log(chalk.green(`\u2713 Deleted physical file: ${filename}`));
        }
        
        // Also look for WordPress auto-numbered duplicates (e.g., medaus-rinkinys-v2-1.webp)
        await deleteNumberedDuplicates(filenameWithoutExt, fileExt, sanitizedSlug, baseUrl);
        
        // Delete any remaining physical files with this pattern
        // This will catch any files that might not be in the WordPress database
        if (physicalPath) {
          const uploadsDir = path.dirname(physicalPath);
          deletePhysicalFilesMatchingPattern(uploadsDir, `${filenameWithoutExt}*${fileExt}`);
          deletePhysicalFilesMatchingPattern(uploadsDir, `${filenameWithoutExt}-*${fileExt}`);
        }
      } else {
        console.log(chalk.dim(`Image filename ${filenameWithoutExt} doesn't match product slug ${productSlug}, skipping`));
      }
    } catch (detailsError: any) {
      // Handle 404 errors gracefully
      if (detailsError.message && detailsError.message.includes('404')) {
        console.log(chalk.yellow(`\u26a0\ufe0f Image ID ${imageId} not found - it may have been already deleted`));
      } else {
        console.log(chalk.yellow(`\u26a0\ufe0f Could not get details for image ID ${imageId}: ${detailsError.message || detailsError}`));
      }
    }
  } catch (error: any) {
    // This outer catch is for unexpected errors
    console.log(chalk.yellow(`\u26a0\ufe0f Unexpected error processing image ID ${imageId}: ${error.message || error}`));
  }
}

/**
 * Find and delete thumbnail images related to the main image
 * @param baseUrl - The base URL of the WordPress site
 * @param filenameWithoutExt - The filename without extension
 * @param fileExt - The file extension
 */
async function deleteRelatedThumbnails(baseUrl: string, filenameWithoutExt: string, fileExt: string): Promise<void> {
  try {
    // WordPress creates various thumbnail sizes with dimensions in the filename
    // e.g., image-150x150.jpg, image-300x200.jpg, etc.
    // We'll search for media items that might be thumbnails of this image
    
    // First, search for media items containing the base filename
    const searchUrl = `${baseUrl}/wp-json/wp/v2/media?search=${filenameWithoutExt}&per_page=50`;
    const mediaItems = await fetchJSON(searchUrl);
    
    if (!Array.isArray(mediaItems)) {
      return;
    }
    
    // Regular expression to match WordPress thumbnail naming pattern
    // e.g., my-image-150x150.jpg from my-image.jpg
    const thumbnailRegex = new RegExp(`^${filenameWithoutExt}-\d+x\d+${fileExt}$`);
    
    // Filter for items that match the thumbnail pattern
    const thumbnails = mediaItems.filter(item => {
      const itemUrl = item.source_url || '';
      const itemFilename = path.basename(itemUrl);
      return thumbnailRegex.test(itemFilename);
    });
    
    if (thumbnails.length > 0) {
      console.log(chalk.blue(`Found ${thumbnails.length} thumbnail images for ${filenameWithoutExt}${fileExt}`));
      
      // Delete each thumbnail
      for (const thumbnail of thumbnails) {
        const thumbnailUrl = thumbnail.source_url;
        const thumbnailFilename = path.basename(thumbnailUrl);
        console.log(chalk.yellow(`Deleting thumbnail: ${thumbnailFilename} (ID: ${thumbnail.id})`));
        
        // Get the physical file path
        const physicalPath = getPhysicalFilePath(thumbnailUrl);
        
        // Delete from WordPress database
        const deleteUrl = `${baseUrl}/wp-json/wp/v2/media/${thumbnail.id}?force=true`;
        await fetchJSON(deleteUrl, { method: "DELETE" });
        console.log(chalk.green(`✓ Deleted thumbnail from database: ${thumbnailFilename}`));
        
        // Delete the physical file
        if (physicalPath && deletePhysicalFile(physicalPath)) {
          console.log(chalk.green(`✓ Deleted physical thumbnail file: ${thumbnailFilename}`));
        }
      }
    } else {
      console.log(chalk.dim(`No thumbnails found in database for ${filenameWithoutExt}${fileExt}`));
    }
    
    // Also search for physical thumbnail files that might not be in the database
    // This is a fallback to make sure we clean up all files
    const testUrl = `${baseUrl}/wp-content/uploads/placeholder.jpg`;
    const testPath = getPhysicalFilePath(testUrl);
    if (testPath) {
      const uploadsDir = path.dirname(path.dirname(path.dirname(testPath))); // Get the uploads directory
      const pattern = `${filenameWithoutExt}-*x*${fileExt}`;
      deletePhysicalFilesMatchingPattern(uploadsDir, pattern);
    }
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️ Error searching for thumbnails: ${error.message || error}`));
  }
}

/**
 * Delete all media items in WordPress database that match a product slug
 * @param productSlug - The slug of the product to delete media for
 */
async function deleteAllMediaForProduct(productSlug: string): Promise<void> {
  try {
    const baseUrl = getImportBaseUrl();
    const sanitizedSlug = productSlug.replace(/[^a-zA-Z0-9-]/g, '');
    
    // Search for all media items containing the product slug
    // We'll use a higher per_page value to get more results at once
    const searchUrl = `${baseUrl}/wp-json/wp/v2/media?search=${sanitizedSlug}&per_page=100`;
    
    console.log(chalk.blue(`Searching for remaining media items matching: ${sanitizedSlug}`));
    
    try {
      const mediaItems = await fetchJSON(searchUrl);
      
      if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
        console.log(chalk.dim(`No remaining media items found for ${sanitizedSlug}`));
        return;
      }
      
      console.log(chalk.yellow(`Found ${mediaItems.length} remaining media items for ${sanitizedSlug}`));
      
      // Delete each media item
      for (const item of mediaItems) {
        try {
          const itemUrl = item.source_url || '';
          const filename = path.basename(itemUrl);
          
          // Get the physical file path
          const physicalPath = getPhysicalFilePath(itemUrl);
          
          // Only delete if the filename contains the product slug
          // This is to avoid deleting unrelated media that might have been returned in the search
          if (filename.includes(sanitizedSlug)) {
            console.log(chalk.yellow(`Deleting remaining media item: ${filename} (ID: ${item.id})`));
            
            // Delete from WordPress database
            const deleteUrl = `${baseUrl}/wp-json/wp/v2/media/${item.id}?force=true`;
            await fetchJSON(deleteUrl, { method: "DELETE" });
            console.log(chalk.green(`✓ Deleted media item from database: ${filename} (ID: ${item.id})`));
            
            // Delete the physical file if it exists
            if (physicalPath && deletePhysicalFile(physicalPath)) {
              console.log(chalk.green(`✓ Deleted physical file: ${filename}`));
            }
          }
        } catch (itemError: any) {
          console.log(chalk.yellow(`⚠️ Error deleting media item ID ${item.id}: ${itemError.message || itemError}`));
        }
      }
    } catch (searchError: any) {
      console.log(chalk.yellow(`⚠️ Error searching for media items: ${searchError.message || searchError}`));
    }
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️ Error in deleteAllMediaForProduct: ${error.message || error}`));
  }
}

/**
 * Delete WordPress auto-numbered duplicate images
 * @param filenameWithoutExt - The original filename without extension
 * @param fileExt - The file extension
 * @param productSlug - The product slug
 * @param baseUrl - The base URL of the WordPress site
 */
async function deleteNumberedDuplicates(filenameWithoutExt: string, fileExt: string, productSlug: string, baseUrl: string): Promise<void> {
  try {
    // WordPress adds -1, -2, etc. to filenames when duplicates are uploaded
    // For example: medaus-rinkinys-v2.webp → medaus-rinkinys-v2-1.webp
    
    // We'll check for numbered variants (-1 through -5 which should cover most cases)
    for (let i = 1; i <= 5; i++) {
      const numberedVariant = `${filenameWithoutExt}-${i}`;
      
      // Search for media items with this filename pattern
      const searchUrl = `${baseUrl}/wp-json/wp/v2/media?search=${numberedVariant}&per_page=10`;
      
      try {
        const mediaItems = await fetchJSON(searchUrl);
        
        if (mediaItems && Array.isArray(mediaItems) && mediaItems.length > 0) {
          // Filter for exact matches to the numbered variant
          const exactMatches = mediaItems.filter(item => {
            const itemUrl = item.source_url || '';
            const itemFilename = path.basename(itemUrl);
            const itemFilenameWithoutExt = path.basename(itemFilename, path.extname(itemFilename));
            return itemFilenameWithoutExt === numberedVariant;
          });
          
          if (exactMatches.length > 0) {
            console.log(chalk.blue(`Found ${exactMatches.length} numbered duplicate(s) with pattern ${numberedVariant}${fileExt}`));
            
            // Delete each numbered duplicate
            for (const duplicate of exactMatches) {
              const duplicateUrl = duplicate.source_url;
              const duplicateFilename = path.basename(duplicateUrl);
              console.log(chalk.yellow(`Deleting numbered duplicate: ${duplicateFilename} (ID: ${duplicate.id})`));
              
              // Get the physical file path
              const physicalPath = getPhysicalFilePath(duplicateUrl);
              
              // Delete from WordPress database
              const deleteUrl = `${baseUrl}/wp-json/wp/v2/media/${duplicate.id}?force=true`;
              await fetchJSON(deleteUrl, { method: "DELETE" });
              console.log(chalk.green(`✓ Deleted numbered duplicate from database: ${duplicateFilename} (ID: ${duplicate.id})`));
              
              // Delete the physical file
              if (physicalPath && deletePhysicalFile(physicalPath)) {
                console.log(chalk.green(`✓ Deleted physical numbered duplicate file: ${duplicateFilename}`));
              }
              
              // Also delete thumbnails of the duplicate
              const duplicateFilenameWithoutExt = path.basename(duplicateFilename, path.extname(duplicateFilename));
              await deleteRelatedThumbnails(baseUrl, duplicateFilenameWithoutExt, fileExt);
            }
          }
        }
      } catch (searchError) {
        // Just continue if search fails for a specific variant
        console.log(chalk.dim(`No numbered variant found for ${numberedVariant}${fileExt}`));
      }
    }
    
    // Also search for physical numbered duplicate files that might not be in the database
    // This is a fallback to make sure we clean up all files
    const testUrl = `${baseUrl}/wp-content/uploads/placeholder.jpg`;
    const testPath = getPhysicalFilePath(testUrl);
    if (testPath) {
      const uploadsDir = path.dirname(path.dirname(path.dirname(testPath))); // Get the uploads directory
      for (let i = 1; i <= 5; i++) {
        const pattern = `${filenameWithoutExt}-${i}*${fileExt}`;
        deletePhysicalFilesMatchingPattern(uploadsDir, pattern);
      }
    }
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️ Error searching for numbered duplicates: ${error.message || error}`));
  }
}

/**
 * Get all translations of a product
 * @param productId - The ID of the product to find translations for
 * @returns Array of product IDs that are translations of the given product
 */
async function getProductTranslations(productId: number): Promise<number[]> {
  const translationIds: number[] = [];
  let translationsFound = false;
  
  try {
    // Method 1: Try the WPML v1 translations API
    const wpmlUrl = `${getImportBaseUrl()}/wp-json/wpml/v1/get_element_translations?element_type=product&element_id=${productId}`;
    try {
      const translations = await fetchJSON(wpmlUrl);
      
      if (translations && Array.isArray(translations)) {
        for (const translation of translations) {
          if (translation.element_id && translation.element_id !== productId) {
            const translationId = parseInt(translation.element_id);
            if (!isNaN(translationId) && !translationIds.includes(translationId)) {
              translationIds.push(translationId);
            }
          }
        }
        if (translationIds.length > 0) {
          console.log(chalk.blue(`Found ${translationIds.length} translations via WPML API v1 for product ID ${productId}`));
          translationsFound = true;
        }
      }
    } catch (wpmlError) {
      // WPML API v1 failed, continue to next method
      console.log(chalk.dim(`WPML translation API v1 not available, trying alternative methods`));
    }
    
    // Method 2: Try the WPML product translations API
    if (!translationsFound) {
      const wpmlProductUrl = `${getImportBaseUrl()}/wp-json/wpml/v1/product/${productId}/translations`;
      try {
        const productTranslations = await fetchJSON(wpmlProductUrl);
        
        if (productTranslations && typeof productTranslations === 'object') {
          for (const langCode in productTranslations) {
            if (productTranslations[langCode] && 
                productTranslations[langCode].id && 
                productTranslations[langCode].id !== productId) {
              const translationId = parseInt(productTranslations[langCode].id);
              if (!isNaN(translationId) && !translationIds.includes(translationId)) {
                translationIds.push(translationId);
              }
            }
          }
          if (translationIds.length > 0) {
            console.log(chalk.blue(`Found ${translationIds.length} translations via WPML product API for product ID ${productId}`));
            translationsFound = true;
          }
        }
      } catch (wpmlProductError) {
        // WPML product API failed, continue to next method
        console.log(chalk.dim(`WPML product translation API not available, trying next method`));
      }
    }
    
    // Method 3: Try to get translations via product metadata
    if (!translationsFound) {
      const productUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products/${productId}?lang=all`;
      try {
        const product = await fetchJSON(productUrl);
        
        // Check if product has translation metadata
        if (product.meta_data) {
          for (const meta of product.meta_data) {
            if (meta.key === '_icl_translations_json') {
              try {
                const translationsData = JSON.parse(meta.value);
                for (const langCode in translationsData) {
                  if (translationsData[langCode] && 
                      translationsData[langCode].id && 
                      translationsData[langCode].id !== productId) {
                    const translationId = parseInt(translationsData[langCode].id);
                    if (!isNaN(translationId) && !translationIds.includes(translationId)) {
                      translationIds.push(translationId);
                    }
                  }
                }
                if (translationIds.length > 0) {
                  console.log(chalk.blue(`Found ${translationIds.length} translations via product metadata for product ID ${productId}`));
                  translationsFound = true;
                }
              } catch (parseError) {
                console.log(chalk.yellow(`Error parsing translation metadata: ${parseError}`));
              }
            }
          }
        }
        
        // Method 4: Check for translations field in the product
        if (!translationsFound && product.translations) {
          for (const langCode in product.translations) {
            if (product.translations[langCode] && 
                product.translations[langCode] !== productId) {
              const translationId = parseInt(product.translations[langCode]);
              if (!isNaN(translationId) && !translationIds.includes(translationId)) {
                translationIds.push(translationId);
              }
            }
          }
          if (translationIds.length > 0) {
            console.log(chalk.blue(`Found ${translationIds.length} translations via product translations field for product ID ${productId}`));
            translationsFound = true;
          }
        }
      } catch (productError) {
        console.log(chalk.yellow(`Error fetching product data: ${productError}`));
      }
    }
    
    // Method 5: Try to find translations by slug matching
    if (!translationsFound) {
      try {
        // Get the current product to find its slug
        const productUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products/${productId}`;
        const product = await fetchJSON(productUrl);
        
        if (product && product.slug) {
          const productSlug = product.slug;
          console.log(chalk.dim(`Searching for products with matching slug: ${productSlug}`));
          
          // Search for products with the same slug in other languages
          const searchUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products?slug=${productSlug}&lang=all`;
          const matchingProducts = await fetchJSON(searchUrl);
          
          if (Array.isArray(matchingProducts)) {
            for (const matchingProduct of matchingProducts) {
              if (matchingProduct.id && matchingProduct.id !== productId) {
                const matchId = parseInt(matchingProduct.id);
                if (!isNaN(matchId) && !translationIds.includes(matchId)) {
                  translationIds.push(matchId);
                }
              }
            }
            if (translationIds.length > 0) {
              console.log(chalk.blue(`Found ${translationIds.length} translations via slug matching for product ID ${productId}`));
              translationsFound = true;
            }
          }
        }
      } catch (slugError) {
        console.log(chalk.yellow(`Error searching by slug: ${slugError}`));
      }
    }
    
    if (translationIds.length === 0) {
      console.log(chalk.yellow(`No translations found for product ID ${productId} using any method`));
    }
    
    return translationIds;
  } catch (error: any) {
    console.log(chalk.yellow(`Error getting translations for product ID ${productId}: ${error.message || error}`));
    return [];
  }
}

/**
 * Delete a product by ID
 * @param id - The ID of the product to delete
 * @param slug - The slug of the product (for image deletion)
 * @param deleteImages - Whether to delete associated images
 * @param thoroughCleanup - Whether to perform thorough media cleanup after deletion
 */
async function deleteProduct(id: number, slug: string, deleteImages: boolean = false, thoroughCleanup: boolean = false): Promise<void> {
  const productUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products/${id}`;
  
  try {
    // First get the product to display its name
    const product = await fetchJSON(productUrl);
    const productName = product.name || `Product ID ${id}`;
    
    console.log(chalk.blue(`Deleting product: ${productName} (ID: ${id})...`));
    
    // Get all translations BEFORE deleting the product
    const translationIds = await getProductTranslations(id);
    
    if (translationIds.length > 0) {
      console.log(chalk.blue(`Found ${translationIds.length} translations for product ID ${id}`));
    }
    
    // If deleteImages is true, delete the product images first
    if (deleteImages) {
      try {
        console.log(chalk.blue(`Deleting images for product: ${productName} (ID: ${id})...`));
        
        // Process images from the main product
        if (product.images && Array.isArray(product.images)) {
          console.log(chalk.blue(`Found ${product.images.length} images for product: ${productName} (ID: ${id})`));
          
          // Delete each image
          for (const image of product.images) {
            if (image.id) {
              await deleteImageIfMatchingSlug(image.id, slug, getImportBaseUrl());
            }
          }
        }
        
        // Process images from translated versions
        if (translationIds.length > 0) {
          console.log(chalk.blue(`Processing images from ${translationIds.length} translated versions of product ID ${id}`));
          
          for (const translationId of translationIds) {
            try {
              const translationUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products/${translationId}`;
              const translatedProduct = await fetchJSON(translationUrl);
              const translatedSlug = translatedProduct.slug || slug;
              const translatedName = translatedProduct.name || `Translation ID ${translationId}`;
              
              console.log(chalk.blue(`Processing translated product: ${translatedName} (ID: ${translationId})`));
              
              if (translatedProduct.images && Array.isArray(translatedProduct.images)) {
                console.log(chalk.blue(`Found ${translatedProduct.images.length} images for translated product: ${translatedName}`));
                
                for (const image of translatedProduct.images) {
                  if (image.id) {
                    await deleteImageIfMatchingSlug(image.id, translatedSlug, getImportBaseUrl());
                  }
                }
              }
            } catch (translationError: any) {
              console.log(chalk.yellow(`Error processing images for translated product ID ${translationId}: ${translationError.message || translationError}`));
            }
          }
        }
      } catch (error: any) {
        console.log(chalk.yellow(`⚠️ Error fetching product images for ID ${id}: ${error.message || error}`));
      }
    }
    
    // Delete the main product
    const url = `${getImportBaseUrl()}/wp-json/wc/v3/products/${id}?force=true`;
    
    await fetchJSON(url, {
      method: "DELETE"
    });
    
    // Mark this product as deleted
    deletedProductIds.add(id);
    
    console.log(chalk.green(`✓ Deleted main product: ${productName} (ID: ${id})`));
    
    // Delete all translations
    if (translationIds.length > 0) {
      console.log(chalk.blue(`Deleting ${translationIds.length} translations of product ID ${id}...`));
      
      for (const translationId of translationIds) {
        try {
          // Skip if this translation ID has already been deleted
          if (deletedProductIds.has(translationId)) {
            console.log(chalk.yellow(`Skipping translation ID ${translationId} as it was already deleted`));
            continue;
          }
          
          // Get translation info before deleting
          let translatedName = `Translation ID ${translationId}`;
          try {
            const translationUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products/${translationId}`;
            const translatedProduct = await fetchJSON(translationUrl);
            translatedName = translatedProduct.name || translatedName;
          } catch (infoError) {
            // Continue with default name if we can't get the product info
          }
          
          // Delete the translation
          const deleteUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products/${translationId}?force=true`;
          await fetchJSON(deleteUrl, {
            method: "DELETE"
          });
          
          // Mark this translation as deleted
          deletedProductIds.add(translationId);
          
          console.log(chalk.green(`✓ Deleted translated product: ${translatedName} (ID: ${translationId})`));
        } catch (translationError: any) {
          console.log(chalk.yellow(`⚠️ Error deleting translated product ID ${translationId}: ${translationError.message || translationError}`));
        }
      }
    }
    
    // If thoroughCleanup is enabled, run the dedicated cleanup-media script for more thorough cleanup
    if (thoroughCleanup) {
      console.log(chalk.blue(`🧹 Performing thorough media cleanup for product and its translations`));
      
      // Path to the cleanup-media script
      const cleanupMediaScript = path.join(__dirname, "cleanup-media.ts");
      
      if (!fs.existsSync(cleanupMediaScript)) {
        console.log(chalk.yellow(`⚠️ Cleanup media script not found at: ${cleanupMediaScript}`));
        return;
      }
      
      // Collect all slugs from translations
      const allSlugs = new Set<string>([slug]); // Start with the main product slug
      
      // Get slugs from all translations
      if (translationIds.length > 0) {
        console.log(chalk.blue(`Collecting slugs from ${translationIds.length} translations for thorough cleanup...`));
        
        for (const translationId of translationIds) {
          try {
            const translationUrl = `${getImportBaseUrl()}/wp-json/wc/v3/products/${translationId}`;
            try {
              const translatedProduct = await fetchJSON(translationUrl);
              if (translatedProduct.slug) {
                allSlugs.add(translatedProduct.slug);
                console.log(chalk.blue(`Added translation slug for cleanup: ${translatedProduct.slug} (${translatedProduct.name || 'Unknown'})`));
              }
            } catch (error: any) {
              // If we can't get the product info, just continue
              console.log(chalk.yellow(`Couldn't fetch translation ID ${translationId} for slug collection: ${error.message || error}`));
            }
          } catch (error: any) {
            console.log(chalk.yellow(`Error processing translation ID ${translationId} for slug collection: ${error.message || error}`));
          }
        }
      }
      
      // Run the cleanup-media script for each unique slug
      const cleanupPromises = Array.from(allSlugs).map(productSlug => {
        return new Promise<void>((resolve) => {
          console.log(chalk.blue(`Running cleanup script for slug: ${productSlug}...`));
          
          const args = [productSlug, "--confirm", "--thorough"]; // Always skip confirmation since we already confirmed
          
          const childProcess = spawn("yarn", ["ts-node", cleanupMediaScript, ...args], {
            stdio: "inherit",
            cwd: process.cwd()
          });
          
          childProcess.on("close", (code) => {
            if (code === 0) {
              console.log(chalk.green(`✓ Thorough media cleanup completed for: ${productSlug}`));
            } else {
              console.log(chalk.yellow(`⚠️ Cleanup script exited with code ${code} for: ${productSlug}`));
            }
            resolve(); // Always resolve to continue with other slugs
          });
          
          childProcess.on("error", (err) => {
            console.log(chalk.yellow(`⚠️ Error running cleanup script for ${productSlug}: ${err.message}`));
            resolve(); // Always resolve to continue with other slugs
          });
        });
      });
      
      // Wait for all cleanup processes to complete
      return Promise.all(cleanupPromises).then(() => {
        console.log(chalk.green(`✓ Completed media cleanup for all ${allSlugs.size} product slugs`));
      });
    }
  } catch (error: any) {
    console.log(chalk.red(`✗ Failed to delete product ID ${id}: ${error.message || error}`));
    throw error;
  }
}

// Run the script
deleteAllProducts().catch(error => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
