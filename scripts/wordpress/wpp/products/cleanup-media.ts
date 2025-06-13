/**
 * Cleanup media items for a specific product
 * This script will find and delete all media items in the WordPress database
 * and filesystem that match a given product slug
 * 
 * Enhanced with:
 * - Thorough cleanup option for more comprehensive media removal
 * - Retry logic for API calls to handle transient errors
 * - Improved logging and error handling
 * - Language-specific media cleanup with --language flag
 * - Media count checking with --check-count flag
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
const allMediaFlag = args.includes("--all-media");
const checkCountFlag = args.includes("--check-count");

// Get language parameter if specified
let languageFlag = "";
if (args.includes("--language")) {
  const langIndex = args.indexOf("--language");
  if (args[langIndex + 1] && !args[langIndex + 1].startsWith("--")) {
    languageFlag = args[langIndex + 1];
  }
}

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
    // Check if we're just checking media count
    if (checkCountFlag) {
      await checkMediaCount();
      return;
    }
    
    // Check if we're in all media mode
    if (allMediaFlag) {
      // Confirm deletion
      if (!confirmFlag) {
        console.log(chalk.yellow(`\n⚠️ WARNING: This will delete ALL media items from all languages!`));
        console.log(chalk.yellow(`This is a destructive operation that cannot be undone.`));
        console.log(chalk.yellow(`Run with --confirm flag to skip this confirmation.`));
        
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        rl.question(chalk.yellow(`Are you sure you want to delete ALL media items? (y/n): `), async (answer) => {
          rl.close();
          if (answer.toLowerCase() !== 'y') {
            console.log(chalk.blue(`Operation cancelled.`));
            process.exit(0);
          } else {
            // Process all media
            await cleanupAllMedia();
          }
        });
      } else {
        // Skip confirmation
        await cleanupAllMedia();
      }
    }
    // Check if we're in media IDs mode
    else if (mediaIdsFlag) {
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
        console.log(`       yarn ts-node products/cleanup-media.ts --all-media [--confirm] [--thorough]`);
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
 * Clean up all media items across all languages or a specific language
 */
async function cleanupAllMedia(): Promise<void> {
  // Determine target language
  const targetLanguage = languageFlag || 'all';
  console.log(chalk.cyan(`🔍 Fetching media items${targetLanguage !== 'all' ? ` for language: ${targetLanguage.toUpperCase()}` : ' across all languages'}...`));
  
  const baseUrl = getImportBaseUrl();
  const perPage = 100; // Maximum allowed by WordPress API
  
  // First, check if we need to handle languages individually
  if (targetLanguage === 'all') {
    try {
      // Try to get media with lang=all first
      const checkUrl = `${baseUrl}/wp-json/wp/v2/media?per_page=1&lang=all`;
      const checkResponse = await fetchJSON(checkUrl);
      
      // If we got results, we can process all languages at once
      if (checkResponse && Array.isArray(checkResponse) && checkResponse.length > 0) {
        await processMediaByLanguage('all', baseUrl, perPage);
        return;
      } else {
        console.log(chalk.yellow(`⚠️ No media found with lang=all, will process each language individually...`));
        // Process each language individually
        const languages = ['en', 'lt', 'lv', 'ru', 'de'];
        
        // Track overall progress
        let totalProcessedCount = 0;
        let totalDeletedCount = 0;
        let totalFailedCount = 0;
        
        for (const lang of languages) {
          try {
            const langStats = await processMediaByLanguage(lang, baseUrl, perPage);
            totalProcessedCount += langStats.processed;
            totalDeletedCount += langStats.deleted;
            totalFailedCount += langStats.failed;
          } catch (error) {
            console.log(chalk.red(`\n❌ Error processing ${lang.toUpperCase()}: ${error}`));
          }
        }
        
        console.log(chalk.green(`\n✅ Overall: ${totalDeletedCount}/${totalProcessedCount} media items deleted across all languages`));
        if (totalFailedCount > 0) console.log(chalk.red(`  Failed to delete ${totalFailedCount} media items`));
      }
    } catch (error) {
      console.log(chalk.red(`Error checking media availability: ${error}`));
    }
  } else {
    // Process the specific language
    await processMediaByLanguage(targetLanguage, baseUrl, perPage);
  }
}

/**
 * Process media items for a specific language
 * @param language - The language code to process
 * @param baseUrl - The base URL for the WordPress API
 * @param perPage - Number of items per page
 * @returns Statistics about the processed media items
 */
async function processMediaByLanguage(language: string, baseUrl: string, perPage: number): Promise<{processed: number, deleted: number, failed: number}> {
  console.log(chalk.blue(`\nProcessing media items for language: ${language.toUpperCase()}`));
  
  let page = 1;
  let hasMore = true;
  let processedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  const processedIds = new Set<number>();
  
  // Try to get the total count first
  try {
    const countUrl = `${baseUrl}/wp-json/wp/v2/media?per_page=1&lang=${language}`;
    const countResponse = await fetchJSON(countUrl, { method: 'HEAD' });
    const totalCount = parseInt(countResponse.headers?.get('X-WP-Total') || '0', 10);
    
    if (totalCount === 0) {
      console.log(chalk.yellow(`  No media items found for language: ${language.toUpperCase()}`));
      return { processed: 0, deleted: 0, failed: 0 };
    }
    
    console.log(chalk.blue(`  Found ${totalCount} media items to process`));
    const totalPages = Math.ceil(totalCount / perPage);
    console.log(chalk.blue(`  Will process ${totalPages} page(s) with ${perPage} items per page`));
  } catch (error) {
    console.log(chalk.yellow(`  Could not determine total count: ${error}`));
    // Continue anyway, we'll stop when we get no more results
  }
  
  while (hasMore) {
    try {
      console.log(chalk.dim(`  Processing page ${page}...`));
      
      // Fetch media items for this page
      const url = `${baseUrl}/wp-json/wp/v2/media?per_page=${perPage}&page=${page}&lang=${language}`;
      const mediaItems = await retryOperation(
        async () => await fetchJSON(url),
        maxRetries,
        `fetch media items page ${page}`
      );
      
      // If we got no items, we're done
      if (!mediaItems || !Array.isArray(mediaItems) || mediaItems.length === 0) {
        console.log(chalk.dim(`  No more media items found on page ${page}`));
        hasMore = false;
        break;
      }
      
      // Process each media item
      for (const item of mediaItems) {
        // Skip if we've already processed this ID
        if (processedIds.has(item.id)) {
          console.log(chalk.dim(`    Skipping already processed media ID ${item.id}`));
          continue;
        }
        
        processedIds.add(item.id);
        processedCount++;
        
        // Delete the media item
        console.log(chalk.dim(`    Deleting media ID ${item.id} (${item.title?.rendered || 'No title'})...`));
        
        try {
          // Delete across all languages
          const deleted = await deleteMediaItemInAllLanguages(item.id);
          
          if (deleted) {
            deletedCount++;
            
            // Delete physical files if they exist
            if (item.source_url) {
              const filePaths = getPhysicalFilePath(item.source_url, thoroughFlag);
              if (filePaths.length > 0) {
                const deletedFiles = deletePhysicalFiles(filePaths);
                console.log(chalk.dim(`      Deleted ${deletedFiles} physical file(s)`));
              }
            }
          } else {
            failedCount++;
            console.log(chalk.yellow(`    ⚠️ Failed to delete media item ID ${item.id}`));
          }
        } catch (error) {
          failedCount++;
          console.log(chalk.yellow(`    ⚠️ Error deleting media item ${item.id}: ${error}`));
        }
      }
      
      // Move to next page
      page++;
      
      // If we got fewer items than perPage, we've reached the end
      if (mediaItems.length < perPage) {
        hasMore = false;
      }
    } catch (error) {
      console.log(chalk.red(`  ❌ Error fetching media items page ${page}: ${error}`));
      hasMore = false;
    }
  }
  
  console.log(chalk.green(`  ✅ Completed processing ${language.toUpperCase()}: ${deletedCount}/${processedCount} media items deleted`));
  if (failedCount > 0) console.log(chalk.red(`    Failed to delete ${failedCount} media items`));
  
  return {
    processed: processedCount,
    deleted: deletedCount,
    failed: failedCount
  };
}

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
  
  // Third approach: Search for language-specific variations with numbered suffixes
  // WPML often adds -2, -3, etc. to translated media items
  const suffixSearchUrl = `${baseUrl}/wp-json/wp/v2/media?search=${slug}-&per_page=100&orderby=id&media_type=image`;
  
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
  
  // Third approach: Search for language-specific variations with numbered suffixes
  try {
    const suffixMediaItems = await retryOperation(
      async () => await fetchJSON(suffixSearchUrl),
      maxRetries,
      `search for media items with language-specific suffixes`
    );
    
    if (Array.isArray(suffixMediaItems) && suffixMediaItems.length > 0) {
      // Filter items to only include those with filenames containing the slug with a suffix
      // This will match patterns like slug-2, slug-3, etc. which WPML commonly uses
      const suffixPattern = new RegExp(`${slug}-\\d+`, 'i');
      const matchingItems = suffixMediaItems.filter(item => 
        item.source_url && 
        (suffixPattern.test(item.source_url) || 
         // Also match language-specific paths like /en/slug/ or /de/slug/
         /\/[a-z]{2}\/.*?\//i.test(item.source_url) && 
         item.source_url.toLowerCase().includes(slug.toLowerCase())) &&
        !processedMediaIds.has(item.id)
      );
      
      if (matchingItems.length > 0) {
        console.log(chalk.yellow(`Found ${matchingItems.length} media items with language-specific variations of ${slug}`));
        
        // Group by filename
        const suffixByFilename = new Map<string, Array<any>>();
        
        for (const item of matchingItems) {
          if (!item.source_url) continue;
          
          const filename = path.basename(item.source_url);
          if (!suffixByFilename.has(filename)) {
            suffixByFilename.set(filename, []);
          }
          suffixByFilename.get(filename)!.push(item);
        }
        
        // Process each unique filename
        for (const [filename, items] of suffixByFilename.entries()) {
          console.log(chalk.blue(`Processing ${items.length} language-specific instances of file: ${filename}`));
          
          for (const item of items) {
            if (item.id && !processedMediaIds.has(item.id)) {
              processedMediaIds.add(item.id);
              totalFound++;
              
              try {
                // Delete directly across all languages at once
                const deleted = await deleteMediaItemInAllLanguages(item.id);
                
                if (deleted) {
                  console.log(chalk.green(`✓ Deleted language-specific media item: ${item.title?.rendered || filename} (ID: ${item.id})`));
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
                  console.log(chalk.yellow(`⚠️ Failed to delete language-specific media item ID ${item.id}`));
                }
              } catch (error) {
                console.log(chalk.yellow(`⚠️ Error deleting language-specific media item ${item.id}: ${error}`));
              }
            }
          }
        }
      } else {
        console.log(chalk.dim(`No language-specific media items found with variations of ${slug}`));
      }
    } else {
      console.log(chalk.dim(`No media items found with language-specific suffixes for ${slug}`));
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Error searching for media items with language-specific suffixes: ${error}`));
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
              // Delete across all languages
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

/**
 * Check the count of media items in WordPress
 * This will query the WordPress REST API to get the total count of media items
 * across all languages and display the results without deleting anything
 * 
 * Enhanced to check specific media items and language variations
 * 
 * @returns {Promise<void>}
 */
async function checkMediaCount(): Promise<void> {
  // Check if we're targeting a specific language
  const targetLanguage: string = languageFlag || 'all';

  console.log(chalk.blue(`\nFetching media items${targetLanguage !== 'all' ? ` for language: ${targetLanguage.toUpperCase()}` : ''}...`));
  
  try {
    // Get the base URL for the WordPress site
    const baseUrl = getImportBaseUrl();
    
    // Use curl to get reliable header information
    const curlCommand = `curl -s -I -u "${process.env.WP_USERNAME || 'mantas'}:${process.env.WP_PASSWORD || '3AMD VxIA FKiY p9Su LVpr 4hUo'}" "${baseUrl}/wp-json/wp/v2/media?per_page=1&lang=${targetLanguage}" | grep -i x-wp-total`;
    
    try {
      const result = execSync(curlCommand, { encoding: 'utf8' });
      
      // Extract the count from the header
      const match = result.match(/X-WP-Total:\s*(\d+)/i);
      const totalCount = match ? parseInt(match[1], 10) : 0;
      
      console.log(chalk.green(`\n✓ Total media items for ${targetLanguage === 'all' ? 'all languages' : `language ${targetLanguage.toUpperCase()}`}: ${chalk.bold(totalCount.toString())}`));
      
      // If we're checking all languages but got 0, check individual languages
      // This is to work around a potential WPML bug where lang=all returns 0 even when items exist
      if (targetLanguage === 'all') {
        // Check for media items in specific languages
        const languages = ['en', 'lt', 'lv', 'ru', 'de'];
        console.log(chalk.blue(`\nChecking media count in each language...`));
        
        let totalAcrossLanguages = 0;
        let foundItems = false;
        
        for (const lang of languages) {
          try {
            const langCommand = `curl -s -I -u "${process.env.WP_USERNAME || 'mantas'}:${process.env.WP_PASSWORD || '3AMD VxIA FKiY p9Su LVpr 4hUo'}" "${baseUrl}/wp-json/wp/v2/media?per_page=1&lang=${lang}" | grep -i x-wp-total`;
            const langResult = execSync(langCommand, { encoding: 'utf8' });
            
            // Extract the count from the header
            const langMatch = langResult.match(/X-WP-Total:\s*(\d+)/i);
            const langCount = langMatch ? parseInt(langMatch[1], 10) : 0;
            
            console.log(chalk.cyan(`  - ${lang.toUpperCase()}: ${langCount} media items`));
            
            if (langCount > 0) {
              totalAcrossLanguages += langCount;
              foundItems = true;
            }
          } catch (error) {
            console.log(chalk.yellow(`  - ${lang.toUpperCase()}: Error checking count`));
          }
        }
        
        if (foundItems) {
          console.log(chalk.green(`\n✓ Total across all languages: ${chalk.bold(totalAcrossLanguages.toString())} media items`));
          
          if (totalCount === 0 && totalAcrossLanguages > 0) {
            console.log(chalk.yellow(`\n⚠️ INCONSISTENCY DETECTED: API reports 0 items with lang=all, but ${totalAcrossLanguages} items found across individual languages.`));
            console.log(chalk.yellow(`This is likely a WPML REST API issue. When deleting media, use the --language flag to target specific languages.`));
          }
        } else if (totalCount === 0) {
          console.log(chalk.green(`\n✓ No media items found in any language. Nothing to delete.`));
          return;
        }
      } else if (totalCount === 0) {
        console.log(chalk.green(`\n✓ No media items found for language ${targetLanguage.toUpperCase()}. Nothing to delete.`));
        return;
      }
      
      // Check for specific media items we know exist
      console.log(chalk.blue(`\nChecking for specific media items...`));
      const specificMediaChecks = [
        { name: 'medaus-rinkinys-v9', search: 'medaus-rinkinys-v9' },
        { name: 'rinkinys', search: 'rinkinys' },
        { name: 'medaus', search: 'medaus' }
      ];
      
      for (const check of specificMediaChecks) {
        try {
          const searchCommand = `curl -s -u "${process.env.WP_USERNAME || 'mantas'}:${process.env.WP_PASSWORD || '3AMD VxIA FKiY p9Su LVpr 4hUo'}" "${baseUrl}/wp-json/wp/v2/media?search=${check.search}&per_page=5"`;
          const searchResult = execSync(searchCommand, { encoding: 'utf8' });
          const searchItems = JSON.parse(searchResult);
          
          if (searchItems && searchItems.length > 0) {
            console.log(chalk.green(`  ✓ Found ${searchItems.length} items matching '${check.name}':`));
            searchItems.forEach((item: any, idx: number) => {
              console.log(chalk.cyan(`    - ID: ${item.id}, Title: ${item.title?.rendered || 'No title'}`));
            });
          } else {
            console.log(chalk.yellow(`  ✗ No items found matching '${check.name}'`));
          }
        } catch (error) {
          console.log(chalk.yellow(`  ✗ Error searching for '${check.name}': ${error}`));
        }
      }
      
      // If there are media items, fetch the first page to show some examples
      if (totalCount > 0) {
        try {
          // Use curl to get the actual media items
          const curlMediaCommand = `curl -s -u "${process.env.WP_USERNAME || 'mantas'}:${process.env.WP_PASSWORD || '3AMD VxIA FKiY p9Su LVpr 4hUo'}" "${baseUrl}/wp-json/wp/v2/media?per_page=5&lang=${targetLanguage}"`;
          const mediaResult = execSync(curlMediaCommand, { encoding: 'utf8' });
          const mediaItems = JSON.parse(mediaResult);
          
          console.log(chalk.blue(`\nShowing first ${Math.min(5, mediaItems.length)} media items:`));
          mediaItems.forEach((item: any, index: number) => {
            console.log(chalk.cyan(`\n${index + 1}. Media ID: ${item.id}`));
            console.log(`   Title: ${item.title?.rendered || 'No title'}`); 
            console.log(`   URL: ${item.source_url || 'No URL'}`); 
            console.log(`   Date: ${item.date || 'No date'}`); 
            console.log(`   Media Type: ${item.media_type || 'Unknown'}`); 
            console.log(`   MIME Type: ${item.mime_type || 'Unknown'}`); 
          });
          
          // Check if there are more pages
          if (totalCount > 5) {
            console.log(chalk.yellow(`\n...and ${totalCount - 5} more media items.`));
          }
        } catch (error) {
          console.log(chalk.yellow(`\n⚠️ Could not fetch media items: ${error}`));
        }
        
        // Provide instructions for cleanup
        console.log(chalk.blue(`\nTo delete all media items, run:`));
        console.log(`yarn ts-node products/cleanup-media.ts --all-media`); 
        console.log(chalk.blue(`\nTo delete specific media items by ID, run:`));
        console.log(`yarn ts-node products/cleanup-media.ts --media-ids <id1,id2,...>`); 
      } else {
        console.log(chalk.green(`\n✓ No media items found in WordPress.`));
      }
      
      // Check if there are physical files on the server
      console.log(chalk.blue(`\nChecking for physical media files on the server...`));
      
      // Get the uploads directory - try both local and remote paths
      const possibleUploadDirs = [
        '/var/www/html/wp-content/uploads',  // Standard WordPress path
        '/Users/mantas/Sites/wpml-woo-mnt-blocksy/wp-content/uploads', // Local development path
        path.join(process.cwd(), '..', 'wpml-woo-mnt-blocksy', 'wp-content', 'uploads') // Relative path
      ];
      
      let uploadsDir = '';
      for (const dir of possibleUploadDirs) {
        if (fs.existsSync(dir)) {
          uploadsDir = dir;
          break;
        }
      }
      
      if (uploadsDir) {
        console.log(chalk.dim(`Found uploads directory at: ${uploadsDir}`));
        
        // Count files in the uploads directory recursively
        try {
          const result = execSync(`find "${uploadsDir}" -type f -not -path "*/\.*" | wc -l`, { encoding: 'utf8' });
          const fileCount = parseInt(result.trim(), 10);
          
          console.log(chalk.green(`✓ Total files in uploads directory: ${chalk.bold(fileCount.toString())}`));
          
          // Show file types breakdown
          const fileTypesResult = execSync(
            `find "${uploadsDir}" -type f -not -path "*/\.*" | grep -o '\\.[^.]*$' | sort | uniq -c | sort -nr`, 
            { encoding: 'utf8' }
          );
          
          console.log(chalk.blue(`\nFile types breakdown:`));
          console.log(fileTypesResult);
        } catch (error) {
          console.log(chalk.yellow(`⚠️ Could not count files in uploads directory: ${error}`));
        }
      } else {
        console.log(chalk.yellow(`⚠️ Could not find WordPress uploads directory. Tried paths:\n${possibleUploadDirs.join('\n')}`));
      }
    } catch (error: any) {
      console.error(chalk.red(`❌ Error getting media count: ${error.message || error}`));
      console.log(chalk.yellow(`\nTrying alternative method to check media count...`));
      
      try {
        // Try using wp-cli if available
        const wpCliCommand = `wp media list --format=count --allow-root --path=/var/www/html`;
        console.log(chalk.dim(`Running: ${wpCliCommand}`));
        const wpResult = execSync(wpCliCommand, { encoding: 'utf8' });
        console.log(chalk.green(`\n✓ WP-CLI reports ${chalk.bold(wpResult.trim())} media items`));
      } catch (wpError) {
        console.log(chalk.yellow(`\n⚠️ Could not run WP-CLI: ${wpError}`));
        
        // Try direct database query as last resort
        try {
          console.log(chalk.yellow(`\nAttempting direct database query...`));
          const dbCommand = `mysql -u root -e "SELECT COUNT(*) FROM wp_posts WHERE post_type='attachment'" wordpress`;
          const dbResult = execSync(dbCommand, { encoding: 'utf8' });
          console.log(chalk.green(`\n✓ Database query reports media items:\n${dbResult}`));
        } catch (dbError) {
          console.log(chalk.yellow(`\n⚠️ Could not fetch media items: ${dbError}`));
        }
      }
      
      // Check if there are physical files on the server
      console.log(chalk.blue(`\nChecking for physical media files on the server...`));
      
      // Check uploads directory
      try {
        const uploadsDir = '/var/www/html/wp-content/uploads';
        console.log(chalk.blue(`Checking files in ${uploadsDir}...`));
        
        // Count files by type
        const findCommand = `find ${uploadsDir} -type f | grep -E '\.(jpg|jpeg|png|gif|webp|svg|pdf)$' | wc -l`;
        const fileCount = execSync(findCommand, { encoding: 'utf8' });
        console.log(chalk.cyan(`Found ${fileCount.trim()} media files on disk`));
        
        // Count by file type
        const fileTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf'];
        fileTypes.forEach(type => {
          try {
            const typeCommand = `find ${uploadsDir} -type f -name "*.${type}" | wc -l`;
            const typeCount = execSync(typeCommand, { encoding: 'utf8' });
            console.log(chalk.cyan(`  - ${type}: ${typeCount.trim()} files`));
          } catch (e) {
            console.log(chalk.yellow(`  - ${type}: Could not count`));
          }
        });
      } catch (error) {
        console.log(chalk.yellow(`⚠️ Error checking physical files: ${error}`));
      }
    }
  } catch (error) {
    console.error(chalk.red(`❌ Error checking media count: ${error}`));
  }
}

// Try a direct check for a specific media item
async function checkSpecificMediaItem(slug: string): Promise<void> {
  try {
    const baseUrl = getImportBaseUrl();
    console.log(chalk.blue(`\nDirectly checking for '${slug}' media item...`));
    const directCommand = `curl -s -u "${process.env.WP_USERNAME || 'mantas'}:${process.env.WP_PASSWORD || '3AMD VxIA FKiY p9Su LVpr 4hUo'}" "${baseUrl}/wp-json/wp/v2/media?slug=${slug}"`;
    const directResult = execSync(directCommand, { encoding: 'utf8' });
    const directItems = JSON.parse(directResult);
    
    if (directItems && directItems.length > 0) {
      console.log(chalk.green(`✓ Found the specific media item '${slug}'!`));
      console.log(chalk.cyan(`  - ID: ${directItems[0].id}`));
      console.log(chalk.cyan(`  - Title: ${directItems[0].title?.rendered || 'No title'}`));
      console.log(chalk.cyan(`  - URL: ${directItems[0].source_url || 'No URL'}`));
      console.log(chalk.cyan(`  - Status: ${directItems[0].status || 'Unknown'}`));
      
      // Provide command to delete this specific item
      console.log(chalk.blue(`
To delete this specific item, run:`));
      console.log(`yarn ts-node products/cleanup-media.ts --media-ids ${directItems[0].id} --confirm`);
    } else {
      console.log(chalk.yellow(`✗ Could not find the specific media item '${slug}'`));
    }
  } catch (directError) {
    console.log(chalk.yellow(`⚠️ Error checking for specific media item: ${directError}`));
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
