/**
 * Cleanup media items for a specific product
 * This script will find and delete all media items in the WordPress database
 * and filesystem that match a given product slug
 * 
 * Enhanced with:
 * - Thorough cleanup option for more comprehensive media removal
 * - Retry logic for API calls to handle transient errors
 * - Improved logging and error handling
 */
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { fetchJSON } from "../utils/api";
import { getImportBaseUrl } from "../utils/config-utils";
import * as readline from 'readline';

// Parse command line arguments
const args = process.argv.slice(2);
const firstArg = args[0];
const confirmFlag = args.includes("--confirm");
const thoroughFlag = args.includes("--thorough");
const mediaIdsFlag = args.includes("--media-ids");

// Get max retries parameter
let maxRetries = 3; // Default value
if (args.includes("--retries")) {
  const retryIndex = args.indexOf("--retries");
  if (args[retryIndex + 1]) {
    const retryValue = parseInt(args[retryIndex + 1], 10);
    if (!isNaN(retryValue) && retryValue > 0) {
      maxRetries = retryValue;
    }
  }
}

// Main script execution
(async () => {
  try {
    // Check if we're in media IDs mode
    if (mediaIdsFlag) {
      // Extract media IDs from arguments
      const mediaIds = args
        .filter(arg => !arg.startsWith("--"))
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id));
      
      if (mediaIds.length === 0) {
        console.log(chalk.red(`\nError: Please provide at least one media ID when using --media-ids flag.`));
        console.log(`Usage: yarn ts-node products/cleanup-media.ts --media-ids <id1> <id2> ... [--confirm]`);
        process.exit(1);
      }
      
      // Confirm deletion
      if (!confirmFlag) {
        console.log(chalk.yellow(`\n⚠️ WARNING: This will delete ${mediaIds.length} media items from all languages!`));
        console.log(chalk.yellow(`Run with --confirm flag to skip this confirmation.`));
        
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        rl.question(chalk.yellow(`Are you sure you want to delete these media items? (y/n): `), async (answer) => {
          rl.close();
          if (answer.toLowerCase() !== 'y') {
            console.log(chalk.blue(`Operation cancelled.`));
            process.exit(0);
          } else {
            // Process media IDs
            await cleanupMediaByIds(mediaIds);
          }
        });
      } else {
        // Skip confirmation
        await cleanupMediaByIds(mediaIds);
      }
    } else {
      // Original slug-based cleanup
      const productSlug = firstArg;
      
      if (!productSlug) {
        console.log(chalk.red(`\nError: Please provide a product slug as the first argument.`));
        console.log(`Usage: yarn ts-node products/cleanup-media.ts <product-slug> [--confirm] [--thorough]`);
        console.log(`       yarn ts-node products/cleanup-media.ts --media-ids <id1> <id2> ... [--confirm]`);
        process.exit(1);
      }
      
      // Confirm deletion if not using --confirm flag
      if (!confirmFlag) {
        console.log(chalk.yellow(`\n⚠️ WARNING: This will delete all media for product: ${productSlug}`));
        console.log(chalk.yellow(`Run with --confirm flag to skip this confirmation.`));
        
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        rl.question(chalk.yellow(`Are you sure you want to delete all media for ${productSlug}? (y/n): `), async (answer) => {
          rl.close();
          if (answer.toLowerCase() !== 'y') {
            console.log(chalk.blue(`Operation cancelled.`));
            process.exit(0);
          } else {
            // Continue with deletion
            await deleteAllMediaForProduct(productSlug);
          }
        });
      } else {
        // Skip confirmation
        await deleteAllMediaForProduct(productSlug);
      }
    }
  } catch (error) {
    console.error(chalk.red.bold("✗ Fatal error:"), error);
    process.exit(1);
  }
})();

/**
 * Clean up media items by their IDs directly
 * @param mediaIds - Array of media IDs to delete
 */
async function cleanupMediaByIds(mediaIds: number[]): Promise<void> {
  console.log(chalk.cyan(`🔍 Cleaning up ${mediaIds.length} media items by ID...`));
  
  let successCount = 0;
  let failCount = 0;
  
  for (const mediaId of mediaIds) {
    try {
      const success = await deleteMediaItemInAllLanguages(mediaId);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (error) {
      console.log(chalk.red(`Error processing media ID ${mediaId}: ${error}`));
      failCount++;
    }
  }
  
  // Print summary
  console.log(chalk.green(`\n✓ Media cleanup completed`));
  console.log(chalk.green(`  Successfully deleted: ${successCount} items`));
  if (failCount > 0) {
    console.log(chalk.yellow(`  Failed to delete: ${failCount} items`));
  }
}

/**
 * Retry a function multiple times with exponential backoff
 * @param fn - The function to retry
 * @param maxRetries - Maximum number of retries
 * @param description - Description of the operation for logging
 * @returns The result of the function
 */
async function retryOperation<T>(fn: () => Promise<T>, maxRetries: number, description: string): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff with max 10s
        console.log(chalk.yellow(`Retrying ${description} (attempt ${attempt + 1}/${maxRetries + 1}) in ${delay/1000}s...`));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.log(chalk.yellow(`⚠️ ${description} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error}`));
    }
  }
  
  throw new Error(`Failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Get the physical file path from a WordPress media URL
 * @param sourceUrl - The URL of the media file
 * @returns The physical file path on the server
 */
function getPhysicalFilePath(sourceUrl: string, thorough: boolean = false): string[] {
  try {
    // Parse the URL to get the path
    const urlObj = new URL(sourceUrl);
    const urlPath = urlObj.pathname;
    
    // Extract the path after /wp-content/uploads/
    const uploadsIndex = urlPath.indexOf('/wp-content/uploads/');
    if (uploadsIndex === -1) {
      return [];
    }
    
    const relativePath = urlPath.substring(uploadsIndex);
    
    // Base directory for the local development environment
    const baseDirs = [
      '/Users/mantas/sites/wpml-woo-mnt-blocksy/app/public',
    ];
    
    // If thorough cleanup is enabled, check additional possible locations
    if (thorough) {
      // Add additional possible base directories for thorough cleanup
      baseDirs.push(
        '/Users/mantas/sites/wpml-woo-mnt-blocksy/app/public/old-uploads',
        '/Users/mantas/sites/wpml-woo-mnt-blocksy/app/public/wp-content/uploads-old',
        '/Users/mantas/sites/wpml-woo-mnt-blocksy/app/public/wp-content/uploads-backup'
      );
      
      // Also check for different year/month folder structures
      // This handles cases where the same image might have been uploaded in different months
      if (relativePath.match(/\/wp-content\/uploads\/\d{4}\/\d{2}\//)) {
        const parts = relativePath.split('/');
        if (parts.length >= 6) { // /wp-content/uploads/YYYY/MM/filename.ext
          const filename = parts[parts.length - 1];
          const baseUploadPath = '/wp-content/uploads/';
          
          // Add paths for checking other year/month folders
          const date = new Date();
          const currentYear = date.getFullYear();
          const currentMonth = date.getMonth() + 1;
          
          // Check the last 2 years of uploads folders
          for (let year = currentYear; year >= currentYear - 2; year--) {
            for (let month = 1; month <= 12; month++) {
              // Skip future months in current year
              if (year === currentYear && month > currentMonth) continue;
              
              const monthStr = month.toString().padStart(2, '0');
              const altPath = `${baseUploadPath}${year}/${monthStr}/${filename}`;
              
              // Add all base directories with this alternative path
              for (const baseDir of baseDirs) {
                baseDirs.push(baseDir);
              }
            }
          }
        }
      }
    }
    
    // Generate all possible physical paths
    const physicalPaths = baseDirs.map(baseDir => path.join(baseDir, relativePath));
    
    // Filter to only include paths that might exist
    return physicalPaths.filter((p, index, self) => 
      // Remove duplicates
      self.indexOf(p) === index
    );
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Error parsing URL: ${error}`));
    return [];
  }
}

/**
 * Delete a physical file from the filesystem
 * @param filePath - Path to the file to delete
 * @returns True if the file was deleted, false otherwise
 */
function deletePhysicalFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Error deleting file ${filePath}: ${error}`));
    return false;
  }
}

/**
 * Delete multiple physical files from the filesystem
 * @param filePaths - Array of paths to files to delete
 * @returns Number of files successfully deleted
 */
function deletePhysicalFiles(filePaths: string[]): number {
  let deletedCount = 0;
  
  for (const filePath of filePaths) {
    if (deletePhysicalFile(filePath)) {
      deletedCount++;
    }
  }
  
  return deletedCount;
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
      
      for (const file of files) {
        if (deletePhysicalFile(file)) {
          console.log(chalk.green(`✓ Deleted physical file: ${path.basename(file)}`));
        }
      }
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Error searching for files with pattern ${pattern}: ${error}`));
  }
}

/**
 * Delete a media item from WordPress database
 * @param mediaId - The ID of the media item to delete
 * @param lang - Optional language code to use for the deletion
 * @returns True if deletion was successful, false otherwise
 */
async function deleteMediaItem(mediaId: number, lang?: string): Promise<boolean> {
  try {
    const baseUrl = getImportBaseUrl();
    let deleteUrl = `${baseUrl}/wp-json/wp/v2/media/${mediaId}?force=true`;
    
    // Add language parameter if provided
    if (lang) {
      deleteUrl += `&lang=${lang}`;
    }
    
    await retryOperation(
      async () => await fetchJSON(deleteUrl, { method: "DELETE" }),
      maxRetries,
      `delete media item ${mediaId}${lang ? ` in ${lang}` : ''}`
    );
    
    return true;
  } catch (error: any) {
    // Check if it's a 404 error (item not found)
    if (error.status === 404) {
      console.log(chalk.dim(`Media item ${mediaId} not found${lang ? ` in ${lang}` : ''}`));
      return false;
    }
    
    // For other errors, log and return false
    console.log(chalk.yellow(`⚠️ Error deleting media item ${mediaId}${lang ? ` in ${lang}` : ''}: ${error.message || error}`));
    return false;
  }
}

/**
 * Delete a media item across all languages
 * This is especially useful for media items that appear in the admin Files section
 * for languages where the product has no translation
 * 
 * @param mediaId - The ID of the media item to delete
 * @returns True if deletion was successful in at least one language, false otherwise
 */
async function deleteMediaItemInAllLanguages(mediaId: number): Promise<boolean> {
  try {
    console.log(chalk.blue(`Attempting to delete media item ID ${mediaId} across all languages...`));
    
    // First try direct deletion without language parameter
    const directResult = await deleteMediaItem(mediaId);
    if (directResult) {
      console.log(chalk.green(`✓ Successfully deleted media item ${mediaId} directly`));
      return true;
    }
    
    // If direct deletion fails, try with specific languages
    const languages = ['en', 'lt', 'lv', 'ru', 'de', 'fr', 'es', 'it', 'pl'];
    let successInAnyLanguage = false;
    
    for (const lang of languages) {
      try {
        const langResult = await deleteMediaItem(mediaId, lang);
        if (langResult) {
          console.log(chalk.green(`✓ Successfully deleted media item ${mediaId} in ${lang} language`));
          successInAnyLanguage = true;
        }
      } catch (langError) {
        // Skip language-specific errors and continue with next language
        console.log(chalk.yellow(`⚠️ Error deleting media item ${mediaId} in ${lang} language: ${langError}`));
      }
    }
    
    if (successInAnyLanguage) {
      return true;
    } else {
      console.log(chalk.yellow(`⚠️ Could not delete media item ${mediaId} in any language`));
      return false;
    }
  } catch (error) {
    console.log(chalk.red(`❌ Error in deleteMediaItemInAllLanguages for ID ${mediaId}: ${error}`));
    return false;
  }
}

/**
 * Search for remaining media items in the database across all languages
 * @param slug - The slug to search for
 */
async function cleanupRemainingMediaItems(slug: string): Promise<void> {
  console.log(chalk.blue(`\nPerforming final cleanup of database media entries...`));
  
  const baseUrl = getImportBaseUrl();
  
  console.log(chalk.cyan(`Searching for remaining media items matching: ${slug} (across all languages)`));
  
  // Try different search approaches to find all possible media items
  // First approach: Using lang=all parameter to search across all languages at once
  const allLangMediaUrl = `${baseUrl}/wp-json/wp/v2/media?search=${slug}&per_page=100&lang=all`;
  
  // Second approach: Direct filename search which can be more accurate
  const filenameSearchUrl = `${baseUrl}/wp-json/wp/v2/media?search=${slug}&per_page=100&orderby=id&media_type=image`;
  
  // Track all media items found to avoid duplicates
  const processedMediaIds = new Set<number>();
  let totalFound = 0;
  let totalDeleted = 0;
  
  // First approach: Using lang=all parameter
  try {
    const allLangMediaItems = await retryOperation(
      async () => await fetchJSON(allLangMediaUrl),
      maxRetries,
      `search for media items with lang=all`
    );
    
    if (Array.isArray(allLangMediaItems) && allLangMediaItems.length > 0) {
      console.log(chalk.yellow(`Found ${allLangMediaItems.length} remaining media items for ${slug} across all languages`));
      
      // Group media items by filename to identify duplicates across languages
      const mediaByFilename = new Map<string, Array<any>>();
      
      for (const item of allLangMediaItems) {
        if (!item.source_url) continue;
        
        const filename = path.basename(item.source_url);
        if (!mediaByFilename.has(filename)) {
          mediaByFilename.set(filename, []);
        }
        mediaByFilename.get(filename)!.push(item);
      }
      
      console.log(chalk.blue(`Found ${mediaByFilename.size} unique media filenames to process`));
      
      // Process each unique filename
      for (const [filename, items] of mediaByFilename.entries()) {
        if (!filename.includes(slug)) continue;
        
        console.log(chalk.blue(`Processing ${items.length} instances of file: ${filename}`));
        
        // Process all instances of this file (across different languages)
        for (const item of items) {
          if (item.id && !processedMediaIds.has(item.id)) {
            processedMediaIds.add(item.id);
            totalFound++;
            
            try {
              // Delete directly across all languages at once
              const deleted = await deleteMediaItemInAllLanguages(item.id);
              
              if (deleted) {
                console.log(chalk.green(`✓ Deleted media item across all languages: ${item.title?.rendered || filename} (ID: ${item.id})`));
                totalDeleted++;
                
                // Delete physical files if they exist
                if (item.source_url) {
                  const filePaths = getPhysicalFilePath(item.source_url, thoroughFlag);
                  if (filePaths.length > 0) {
                    const deletedCount = deletePhysicalFiles(filePaths);
                    console.log(chalk.green(`✓ Deleted ${deletedCount} physical files for: ${filename}`));
                  }
                }
              } else {
                console.log(chalk.yellow(`⚠️ Failed to delete media item ID ${item.id}`));
              }
            } catch (error) {
              console.log(chalk.yellow(`⚠️ Error deleting media item ${item.id}: ${error}`));
            }
          }
        }
      }
    } else {
      console.log(chalk.dim(`No remaining media items found for ${slug} with lang=all parameter`));
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Error searching for media items with lang=all: ${error}`));
  }
  
  // Second approach: Direct filename search
  try {
    const filenameMediaItems = await retryOperation(
      async () => await fetchJSON(filenameSearchUrl),
      maxRetries,
      `search for media items by filename`
    );
    
    if (Array.isArray(filenameMediaItems) && filenameMediaItems.length > 0) {
      // Filter items to only include those with filenames containing the slug
      const matchingItems = filenameMediaItems.filter(item => 
        item.source_url && 
        item.source_url.toLowerCase().includes(slug.toLowerCase()) &&
        !processedMediaIds.has(item.id)
      );
      
      if (matchingItems.length > 0) {
        console.log(chalk.yellow(`Found ${matchingItems.length} additional media items with filenames matching ${slug}`));
        
        // Group by filename
        const additionalByFilename = new Map<string, Array<any>>();
        
        for (const item of matchingItems) {
          if (!item.source_url) continue;
          
          const filename = path.basename(item.source_url);
          if (!additionalByFilename.has(filename)) {
            additionalByFilename.set(filename, []);
          }
          additionalByFilename.get(filename)!.push(item);
        }
        
        // Process each unique filename
        for (const [filename, items] of additionalByFilename.entries()) {
          console.log(chalk.blue(`Processing ${items.length} additional instances of file: ${filename}`));
          
          for (const item of items) {
            if (item.id && !processedMediaIds.has(item.id)) {
              processedMediaIds.add(item.id);
              totalFound++;
              
              try {
                // Delete directly across all languages at once
                const deleted = await deleteMediaItemInAllLanguages(item.id);
                
                if (deleted) {
                  console.log(chalk.green(`✓ Deleted additional media item: ${item.title?.rendered || filename} (ID: ${item.id})`));
                  totalDeleted++;
                  
                  // Delete physical files if they exist
                  if (item.source_url) {
                    const filePaths = getPhysicalFilePath(item.source_url, thoroughFlag);
                    if (filePaths.length > 0) {
                      const deletedCount = deletePhysicalFiles(filePaths);
                      console.log(chalk.green(`✓ Deleted ${deletedCount} physical files for: ${filename}`));
                    }
                  }
                } else {
                  console.log(chalk.yellow(`⚠️ Failed to delete additional media item ID ${item.id}`));
                }
              } catch (error) {
                console.log(chalk.yellow(`⚠️ Error deleting additional media item ${item.id}: ${error}`));
              }
            }
          }
        }
      } else {
        console.log(chalk.dim(`No additional media items found with filenames matching ${slug}`));
      }
    } else {
      console.log(chalk.dim(`No media items found by filename search for ${slug}`));
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Error searching for media items by filename: ${error}`));
  }
  
  // Print summary of cleanup results
  console.log(chalk.cyan(`\nMedia cleanup summary for ${slug}:`));
  console.log(chalk.green(`✓ Total media items found: ${totalFound}`));
  console.log(chalk.green(`✓ Successfully deleted: ${totalDeleted} items`));
  
  if (totalFound > totalDeleted) {
    console.log(chalk.yellow(`⚠️ Failed to delete: ${totalFound - totalDeleted} items`));
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
    
    console.log(chalk.cyan(`🔍 Cleaning up media for product: ${chalk.bold(productSlug)}`));
    console.log(chalk.cyan(`🔗 Using WordPress site: ${chalk.bold(baseUrl)}`));
    
    // If confirmation is required, ask for it
    if (!confirmFlag) {
      console.log(chalk.red.bold(`⚠️ WARNING: This will delete ALL media items matching "${productSlug}" from the database and filesystem!`));
      console.log(chalk.yellow("Run with --confirm flag to skip this confirmation."));
      
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        readline.question(chalk.red.bold('\nAre you sure you want to proceed? (y/n): '), resolve);
      });
      readline.close();
      
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log(chalk.blue("Cleanup cancelled."));
        return;
      }
    }
    
    // Search for all media items containing the product slug
    // We'll use a higher per_page value to get more results at once
    const searchUrl = `${baseUrl}/wp-json/wp/v2/media?search=${sanitizedSlug}&per_page=100`;
    
    console.log(chalk.blue(`Searching for media items matching: ${sanitizedSlug}`));
    
    try {
      // Get all media items matching the slug
      const mediaItems = await retryOperation(
        async () => await fetchJSON(searchUrl),
        maxRetries,
        `search for media items matching ${sanitizedSlug}`
      );
      
      if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
        console.log(chalk.yellow(`No media items found in database for ${sanitizedSlug}`));
      } else {
        console.log(chalk.green(`Found ${mediaItems.length} media items for ${sanitizedSlug}`));
        
        // Create a map to track media items by filename to avoid duplicates
        const mediaByFilename = new Map();
        
        // First pass: collect all media items by filename
        for (const item of mediaItems) {
          const mediaUrl = item.source_url || '';
          const filename = path.basename(mediaUrl);
          
          // Only process if the filename contains the product slug
          if (filename.includes(sanitizedSlug)) {
            // Store by filename to handle duplicates across languages
            if (!mediaByFilename.has(filename)) {
              mediaByFilename.set(filename, []);
            }
            mediaByFilename.get(filename).push(item);
          }
        }
        
        console.log(chalk.blue(`Found ${mediaByFilename.size} unique media filenames to process`));
        
        // Process each unique filename
        for (const [filename, items] of mediaByFilename.entries()) {
          console.log(chalk.blue(`Processing ${items.length} instances of file: ${filename}`));
          
          // Delete each instance of this file across all languages
          for (const item of items) {
            const mediaId = item.id;
            const mediaTitle = item.title?.rendered || 'Untitled';
            
            try {
              // Delete across all languages at once
              const deleted = await deleteMediaItemInAllLanguages(mediaId);
              
              if (deleted) {
                console.log(chalk.green(`✓ Successfully deleted media item from all languages: ${mediaTitle} (ID: ${mediaId})`));
                
                // Delete physical files if they exist
                if (item.source_url) {
                  const filePaths = getPhysicalFilePath(item.source_url, thoroughFlag);
                  if (filePaths.length > 0) {
                    const deletedCount = deletePhysicalFiles(filePaths);
                    console.log(chalk.green(`✓ Deleted ${deletedCount} physical files for media item: ${mediaTitle}`));
                  } else {
                    console.log(chalk.yellow(`⚠️ Could not determine physical file path for media item: ${mediaTitle}`));
                  }
                }
              } else {
                console.log(chalk.red(`❌ Failed to delete media item from WordPress: ${mediaTitle} (ID: ${mediaId})`));
              }
            } catch (itemError) {
              console.log(chalk.yellow(`⚠️ Error processing media item ${mediaId}: ${itemError}`));
            }
          }
        }
      }
    } catch (searchError: any) {
      console.log(chalk.red(`❌ Error searching for media items: ${searchError.message || searchError}`));
    }
      
    // Check if we need to clean up physical files
    // This is useful for files that might not be properly linked in WordPress
    console.log(chalk.blue(`
Checking for physical files matching: ${sanitizedSlug}`));
    
    // Get WordPress uploads directory
    const uploadsDir = path.resolve(process.cwd(), '../app/public/wp-content/uploads');
    
    if (fs.existsSync(uploadsDir)) {
      // Get current year/month
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      
      // Define directories to clean up
      const directoriesToClean = [
        // Current year/month directory (most likely location)
        path.join(uploadsDir, year, month)
      ];
      
      // If thorough cleanup is enabled, check additional directories
      if (thoroughFlag) {
        console.log(chalk.blue(`Performing thorough cleanup of all possible upload directories...`));
        
        // Check previous months in current year
        for (let m = 1; m <= 12; m++) {
          const monthStr = m.toString().padStart(2, '0');
          // Skip current month as it's already included
          if (year === now.getFullYear().toString() && monthStr === month) continue;
          directoriesToClean.push(path.join(uploadsDir, year, monthStr));
        }
        
        // Check previous year
        const prevYear = (now.getFullYear() - 1).toString();
        for (let m = 1; m <= 12; m++) {
          const monthStr = m.toString().padStart(2, '0');
          directoriesToClean.push(path.join(uploadsDir, prevYear, monthStr));
        }
        
        // Check alternative upload directories
        const altUploadDirs = [
          path.join(path.dirname(uploadsDir), 'old-uploads'),
          path.join(path.dirname(uploadsDir), 'wp-content', 'uploads-old'),
          path.join(path.dirname(uploadsDir), 'wp-content', 'uploads-backup')
        ];
        
        for (const altDir of altUploadDirs) {
          if (fs.existsSync(altDir)) {
            directoriesToClean.push(altDir);
            // Also check year/month subdirectories in alternative upload directories
            for (let y = now.getFullYear() - 1; y <= now.getFullYear(); y++) {
              for (let m = 1; m <= 12; m++) {
                const monthStr = m.toString().padStart(2, '0');
                directoriesToClean.push(path.join(altDir, y.toString(), monthStr));
              }
            }
          }
        }
      }
      
      // Clean up each directory
      for (const dir of directoriesToClean) {
        if (fs.existsSync(dir)) {
          try {
            console.log(chalk.blue(`Cleaning up files in ${dir}`));
            
            // Delete main files
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*.webp`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*.jpg`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*.jpeg`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*.png`);
            
            // Delete thumbnails
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-*x*.webp`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-*x*.jpg`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-*x*.jpeg`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-*x*.png`);
            
            // Delete scaled versions
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-scaled.webp`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-scaled.jpg`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-scaled.jpeg`);
            deletePhysicalFilesMatchingPattern(dir, `${sanitizedSlug}*-scaled.png`);
          } catch (error) {
            console.log(chalk.yellow(`⚠️ Error cleaning up directory ${dir}: ${error}`));
          }
        }
      }
    }
    
    // Final step: Perform a thorough cleanup of any remaining media items across all languages
    await cleanupRemainingMediaItems(sanitizedSlug);
    
    console.log(chalk.green(`
✓ Media cleanup complete for product: ${productSlug}`));
  } catch (error: any) {
    console.log(chalk.red(`❌ Error during media cleanup: ${error.message || error}`));
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
