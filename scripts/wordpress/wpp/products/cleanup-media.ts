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
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fetchJSON } from "../utils/api";
import { getImportBaseUrl } from "../utils/config-utils";

// Parse command line arguments
const args = process.argv.slice(2);
const productSlug = args[0];

// Extract flags
const shouldConfirm = !args.includes("--confirm");
const thoroughCleanup = args.includes("--thorough");

// Get max retries parameter
let maxRetries = 3; // Default value
const maxRetriesIndex = args.indexOf("--max-retries");
if (maxRetriesIndex !== -1 && args[maxRetriesIndex + 1]) {
  const parsedValue = parseInt(args[maxRetriesIndex + 1]);
  if (!isNaN(parsedValue) && parsedValue > 0) {
    maxRetries = parsedValue;
  }
}

// Check if a product slug is provided
if (!productSlug) {
  console.error(chalk.red("❌ Error: Product slug is required"));
  console.log(chalk.yellow("Usage: ts-node cleanup-media.ts <product-slug> [--confirm] [--thorough] [--max-retries <number>]"));
  console.log(chalk.blue("Options:"));
  console.log(chalk.blue("  --confirm       Skip confirmation prompts"));
  console.log(chalk.blue("  --thorough      Perform thorough cleanup of all related files"));
  console.log(chalk.blue("  --max-retries   Maximum number of API call retries (default: 3)"));
  process.exit(1);
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
    if (shouldConfirm) {
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
      const mediaItems = await retryOperation(
        async () => await fetchJSON(searchUrl),
        maxRetries,
        `search for media items matching ${sanitizedSlug}`
      );
      
      if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
        console.log(chalk.yellow(`No media items found in database for ${sanitizedSlug}`));
      } else {
        console.log(chalk.green(`Found ${mediaItems.length} media items for ${sanitizedSlug}`));
        
        // Delete each media item
        for (const item of mediaItems) {
          try {
            const itemUrl = item.source_url || '';
            const filename = path.basename(itemUrl);
            
            // Get the physical file paths (with thorough option if enabled)
            const physicalPaths = getPhysicalFilePath(itemUrl, thoroughCleanup);
            
            // Only delete if the filename contains the product slug
            // This is to avoid deleting unrelated media that might have been returned in the search
            if (filename.includes(sanitizedSlug)) {
              console.log(chalk.yellow(`Deleting media item: ${filename} (ID: ${item.id})`));
              
              // Delete from WordPress database
              const deleteUrl = `${baseUrl}/wp-json/wp/v2/media/${item.id}?force=true`;
              await retryOperation(
                async () => await fetchJSON(deleteUrl, { method: "DELETE" }),
                maxRetries,
                `delete media item ${item.id}`
              );
              console.log(chalk.green(`✓ Deleted media item from database: ${filename} (ID: ${item.id})`));
              
              // Delete the physical files if they exist
              if (physicalPaths.length > 0) {
                try {
                  const deletedCount = deletePhysicalFiles(physicalPaths);
                  if (deletedCount > 0) {
                    console.log(chalk.green(`✓ Deleted physical file: ${filename}`));
                  }
                } catch (error) {
                  console.log(chalk.yellow(`⚠️ Error deleting physical files for media item ${item.id}: ${error}`));
                }
              }
            }
          } catch (itemError: any) {
            console.log(chalk.yellow(`⚠️ Error deleting media item ID ${item.id}: ${itemError.message || itemError}`));
          }
        }
      }
      // Now clean up physical files
      console.log(chalk.blue(`\nSearching for physical files matching: ${sanitizedSlug}`));
      
      // Get the uploads directory path
      const testUrl = `${baseUrl}/wp-content/uploads/placeholder.jpg`;
      const testPaths = getPhysicalFilePath(testUrl, thoroughCleanup);
      if (testPaths.length > 0) {
        const uploadsDir = path.dirname(path.dirname(path.dirname(testPaths[0]))); // Get the uploads directory
        
        // Get the current year and month for the most likely location of recent uploads
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        
        // Define directories to clean up
        const directoriesToClean = [
          // Current year/month directory (most likely location)
          path.join(uploadsDir, year, month)
        ];
        
        // If thorough cleanup is enabled, check additional directories
        if (thoroughCleanup) {
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
        
        // Previous month directory is already handled in the thorough cleanup section if enabled
      }
      
      console.log(chalk.green(`\n✓ Media cleanup complete for product: ${productSlug}`));
    } catch (searchError: any) {
      console.log(chalk.red(`❌ Error searching for media items: ${searchError.message || searchError}`));
    }
  } catch (error: any) {
    console.log(chalk.red(`❌ Error in deleteAllMediaForProduct: ${error.message || error}`));
  }
}

// Run the cleanup
deleteAllMediaForProduct(productSlug).catch(error => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
