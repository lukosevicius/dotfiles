import fs from "fs";
import path from "path";
import chalk from "chalk";
import fetch from "node-fetch";
import FormData from "form-data";
import readline from "readline";
import { execSync } from "child_process";
import { DEFAULT_PATHS } from "../utils/constants";
import { getImportSite, getExportSite } from "../utils/config-utils";
import { getFlagEmoji } from "../utils/language";
import { fetchJSON as apiFetchJSON, getSiteName as apiGetSiteName } from "../utils/api";
import { limitImportData } from "../utils/limit-imports";

// Type for the export data structure
interface ExportData {
  meta: {
    exported_at: string;
    main_language: string;
    other_languages: string[];
    source_site?: string;
  };
  translations: {
    wpml: Record<string, Record<string, number>>;
  };
  data: Record<string, any[]>;
}

// Type for tracking import statistics
interface ImportStats {
  categories: {
    total: number;
    created: number;
    skipped: number;
    failed: number;
  };
  translations: {
    total: number;
    created: number;
    skipped: number;
    failed: number;
  };
  byLanguage: Record<
    string,
    {
      total: number;
      created: number;
      skipped: number;
      failed: number;
    }
  >;
  images: {
    downloaded: number;
    uploaded: number;
    skipped: number;
    failed: number;
  };
}

// WordPress API error response type
interface WPErrorResponse {
  code?: string;
  message?: string;
  data?: {
    status?: number;
  };
}

// Wrapper around the imported fetchJSON to maintain compatibility with existing code
async function fetchJSON(url: string, options: any = {}): Promise<any> {
  return apiFetchJSON(url, options);
}

// Wrapper around the imported getSiteName to maintain compatibility with existing code
async function getSiteName(baseUrl: string): Promise<string> {
  return apiGetSiteName(baseUrl);
}

// Type for the import data structure
interface ImportData {
  name: string;
  slug: string;
  parent: number;
  description: string;
  image: { id: number } | null;
}

// Keep track of ID mappings between original and imported categories
const idMap: Record<string, Record<number, number>> = {};

// Track image ID mappings
const imageMapping: Record<number, number> = {};

// Command line options
const forceImport = process.argv.includes("--force-import");
const autoConfirm = process.argv.includes("--yes");
const forceImageUpload = process.argv.includes("--force-image-upload");
const skipImageDownload = process.argv.includes("--skip-image-download");

// Display help if requested
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Category Import Tool - Help

Options:
  --force-import         Force import even if categories already exist
  --yes                  Auto-confirm import without prompting
  --force-image-upload   Force upload images to WordPress even if they exist
  --skip-image-download  Skip downloading images
  --lang=xx              Import only specific language (e.g., --lang=en)
  --limit=N              Limit import to N categories per language
  --help, -h             Show this help message
`);
  process.exit(0);
}

// Import limit option
let importLimit: number | null = null;
const limitIndex = process.argv.indexOf("--limit");
if (limitIndex !== -1 && limitIndex < process.argv.length - 1) {
  const limitValue = parseInt(process.argv[limitIndex + 1]);
  if (!isNaN(limitValue) && limitValue > 0) {
    importLimit = limitValue;
  }
}

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
const legacyWebpImagesDir = path.join(DEFAULT_PATHS.outputDir, DEFAULT_PATHS.webpImagesDir);

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

/**
 * Decodes URL-encoded strings for display in terminal
 */
function decodeSlug(slug: string): string {
  try {
    // First try to decode as URI component
    const decoded = decodeURIComponent(slug);
    // Replace hyphens with spaces for better readability
    return decoded.replace(/-/g, ' ');
  } catch (error) {
    // If decoding fails, return the original string
    return slug;
  }
}

/**
 * Download an image from a URL and save it to disk
 * If the main image fails, try to download cropped versions
 */
async function downloadImage(
  imageUrl: string,
  imageName: string
): Promise<string> {
  // If --skip-image-download is set, don't download images
  if (skipImageDownload) {
    console.log(`  Skipping image download (--skip-image-download): ${imageName}`);
    return "";
  }

  // Check if image exists in site-specific temp_images directory first
  const siteLocalImagePath = path.join(siteTempImagesDir, imageName);
  if (fs.existsSync(siteLocalImagePath)) {
    console.log(`  Image already exists in site-specific directory: ${imageName}`);
    return siteLocalImagePath;
  }

  // Check if image exists in legacy temp_images directory as fallback
  const legacyLocalImagePath = path.join(legacyTempImagesDir, imageName);
  if (fs.existsSync(legacyLocalImagePath)) {
    console.log(`  Image found in legacy directory: ${imageName}`);
    return legacyLocalImagePath;
  }

  // List of potential image URLs to try (original + cropped versions)
  const imageUrls = [
    imageUrl,
    // Common WordPress thumbnail sizes
    imageUrl.replace(/\.([^.]+)$/, "-1152x1536.$1"), // Large thumbnail
    imageUrl.replace(/\.([^.]+)$/, "-768x1024.$1"), // Medium thumbnail
    imageUrl.replace(/\.([^.]+)$/, "-300x300.$1"), // Small thumbnail
  ];

  // Try each URL in sequence until one works
  for (const url of imageUrls) {
    try {
      console.log(`  Trying: ${path.basename(url)}`);
      const response = await fetch(url);

      if (!response.ok) {
        console.log(`  Failed (${response.status} ${response.statusText})`);
        continue; // Try next URL
      }

      const buffer = await response.buffer();

      // Check if the buffer is empty or too small
      if (!buffer || buffer.length < 100) {
        console.log(
          `  Failed (file too small: ${buffer ? buffer.length : 0} bytes)`
        );
        continue; // Try next URL
      }

      // We found a working image, save it
      fs.writeFileSync(siteLocalImagePath, buffer);
      console.log(`  Image downloaded successfully to site-specific directory: ${imageName}`);
      
      // Automatically convert to WebP if it's a supported image format
      const fileExtension = path.extname(imageName).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif'].includes(fileExtension)) {
        try {
          const nameWithoutExt = path.basename(imageName, fileExtension);
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
            return siteLocalImagePath;
          }
          
          // Convert to WebP using cwebp
          console.log(`  Converting to WebP: ${imageName}`);
          execSync(`cwebp -q 80 "${siteLocalImagePath}" -o "${webpOutputPath}"`, { stdio: 'ignore' });
          
          if (fs.existsSync(webpOutputPath)) {
            console.log(`  WebP conversion successful: ${nameWithoutExt}.webp`);
          }
        } catch (conversionError) {
          console.log(`  WebP conversion failed: ${conversionError instanceof Error ? conversionError.message : String(conversionError)}`);
        }
      }
      
      return siteLocalImagePath;
    } catch (error) {
      console.log(
        `  Failed (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  console.log(`  ${chalk.red('FAILED')} Could not download image after trying ${imageUrls.length} variations`);
  throw new Error(`Failed to download image`);
}

/**
 * Check if an image with the same filename already exists in WordPress
 * and verify that it's actually accessible
 */
async function checkImageExists(filename: string, forceUpload: boolean = false): Promise<number | null> {
  const importSite = getImportSite();
  try {
    // Get the file extension and base name
    const fileExt = path.extname(filename).toLowerCase();
    const filenameWithoutExt = path.basename(filename, fileExt);
    
    // Search for media with the exact filename
    const searchUrl = `${importSite.baseUrl}/wp-json/wp/v2/media?search=${encodeURIComponent(filenameWithoutExt)}`;
    console.log(`  Checking if image exists in WordPress with search: ${filenameWithoutExt}`);
    
    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${importSite.username}:${importSite.password}`
        ).toString("base64")}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to search for image: ${response.statusText}`);
    }

    const data = await response.json();
    
    // No results means no matching image
    if (!data || data.length === 0) {
      console.log(`  No matching images found in WordPress for: ${filenameWithoutExt}`);
      return null;
    }
    
    console.log(`  Found ${data.length} potential matches for: ${filenameWithoutExt}`);
    
    // First try exact filename match (including extension)
    for (const item of data) {
      if (!item.source_url) continue;
      
      const itemFilename = path.basename(item.source_url);
      if (itemFilename === filename) {
        console.log(`  Found exact match: ${itemFilename}`);
        // Exact match found - verify it's accessible
        const verifiedId = await verifyImageExists(item.id, filename, importSite);
        if (verifiedId) return verifiedId;
      }
    }
    
    // If no exact match, try matching by filename without extension
    // This is important because WordPress might store the same image with different extensions
    // (e.g., .jpg vs .jpeg or .webp)
    for (const item of data) {
      if (!item.source_url) continue;
      
      const itemFilename = path.basename(item.source_url);
      const itemWithoutExt = path.basename(itemFilename, path.extname(itemFilename));
      
      // If the filenames match (ignoring extension), consider it a match only if we're uploading the same image
      if (itemWithoutExt === filenameWithoutExt) {
        console.log(`  Found filename match with different extension: ${itemFilename}`);
        // Don't automatically use this - we need to verify it's the same image
        // Only return this if we're specifically looking for this image
        if (forceUpload) {
          console.log(`  Skipping due to force upload flag`);
          continue;
        }
        
        const verifiedId = await verifyImageExists(item.id, itemFilename, importSite);
        if (verifiedId) return verifiedId;
      }
    }
    
    return null; // No matching image found or all matches were inaccessible
  } catch (error) {
    console.error("Error checking if image exists:", error);
    return null;
  }
}

/**
 * Interface for import site configuration
 */
interface ImportSite {
  baseUrl: string;
  username: string;
  password: string;
}

/**
 * Verify that an image with the given ID exists and is accessible in WordPress
 */
async function verifyImageExists(
  imageId: number, 
  filename: string, 
  importSite: ImportSite
): Promise<number | null> {
  try {
    // Try to fetch the image details to confirm it exists
    const imageUrl = `${importSite.baseUrl}/wp-json/wp/v2/media/${imageId}`;
    const imageResponse = await fetch(imageUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${importSite.username}:${importSite.password}`
        ).toString("base64")}`,
      },
    });
    
    if (imageResponse.ok) {
      const imageData = await imageResponse.json();
      
      // Verify the image has a valid URL and media_details
      if (imageData.source_url && imageData.media_details) {
        console.log(`  Found existing image: ${filename} (ID: ${imageId})`);
        return imageId;
      } else {
        console.log(`  Found image record for ${filename} (ID: ${imageId}) but it appears to be incomplete`);
      }
    } else {
      console.log(`  Found image record for ${filename} (ID: ${imageId}) but it appears to be inaccessible`);
    }
    return null;
  } catch (err) {
    console.log(`  Error verifying image ${filename} (ID: ${imageId}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Upload an image to WordPress and return the media ID
 */
async function uploadImage(
  filePath: string,
  fileName: string,
  forceUpload: boolean = false
): Promise<number> {
  try {
    console.log(`Uploading image: ${fileName}`);
    
    // Check if we should force upload or check for existing images
    if (!forceUpload) {
      // First check if an image with this name already exists in WordPress
      const existingImageId = await checkImageExists(fileName, forceUpload);
      if (existingImageId) {
        console.log(`  Image with name ${fileName} already exists in WordPress (ID: ${existingImageId}), using existing image`);
        return existingImageId;
      }
    } else {
      console.log(`  Force uploading image to WordPress regardless of existing images`);
    }
    
    console.log(`  Uploading new image to WordPress...`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Check file size
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    console.log(`  Image size: ${fileSizeMB.toFixed(2)} MB`);
    
    // Get file extension and ensure it's valid
    const fileExt = path.extname(filePath).toLowerCase();
    const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    
    let newFilePath = filePath;
    if (!validExtensions.includes(fileExt)) {
      console.log(`  Warning: File extension ${fileExt} might not be allowed. Renaming to .jpg`);
      // Create a copy with .jpg extension
      newFilePath = filePath.replace(/\.[^.]+$/, ".jpg");
      fs.copyFileSync(filePath, newFilePath);
    }
    
    // Determine mime type based on extension
    let mimeType = "image/jpeg"; // Default
    if (fileExt === ".png") mimeType = "image/png";
    if (fileExt === ".gif") mimeType = "image/gif";
    if (fileExt === ".webp") mimeType = "image/webp";
    
    // Create form data
    const form = new FormData();
    // Use the provided filename or fallback to the path basename
    const uploadFilename = fileName || path.basename(newFilePath);
    form.append("file", fs.createReadStream(newFilePath), {
      filename: uploadFilename,
      contentType: mimeType
    });
    
    // Try to upload with a longer timeout
    const response = await fetch(
      `${getImportSite().baseUrl}/wp-json/wp/v2/media`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${getImportSite().username}:${getImportSite().password}`
            ).toString("base64"),
          // Don't set Content-Type header - FormData will set it with the boundary
        },
        body: form,
        timeout: 60000, // 60 second timeout for larger files
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails: string | WPErrorResponse = "";
      
      try {
        errorDetails = JSON.parse(errorText) as WPErrorResponse;
      } catch (e) {
        errorDetails = errorText;
      }
      
      throw new Error(
        `Failed to upload image: ${response.status} ${response.statusText}\nDetails: ${JSON.stringify(errorDetails)}`
      );
    }
    
    const data = await response.json();
    console.log(`  Success! Uploaded as ID: ${data.id}`);
    return data.id;
  } catch (error) {
    console.error(`Error uploading image ${fileName}:`, error);
    throw error;
  }
}

/**
 * Alternative upload method using WP REST API with different endpoint
 */
async function uploadImageAlternative(
  filePath: string,
  fileName: string
): Promise<number> {
  try {
    console.log(`  Using alternative upload method for: ${fileName}`);
    
    // Convert image to base64
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Get file extension and ensure it's valid
    const fileExt = path.extname(filePath).toLowerCase();
    
    // Determine mime type based on extension
    let mimeType = "image/jpeg"; // Default
    if (fileExt === ".png") mimeType = "image/png";
    if (fileExt === ".gif") mimeType = "image/gif";
    if (fileExt === ".webp") mimeType = "image/webp";
    
    // Try to upload using WP REST API media endpoint with JSON payload
    const response = await fetch(
      `${getImportSite().baseUrl}/wp-json/wp/v2/media`,
      {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          Authorization:
            "Basic " +
            Buffer.from(
              `${getImportSite().username}:${getImportSite().password}`
            ).toString("base64"),
        },
        body: JSON.stringify({
          file: {
            filename: fileName || path.basename(filePath),
            data: base64Image,
            mime_type: mimeType
          },
          title: fileName,
          alt_text: fileName
        }),
        timeout: 60000, // 60 second timeout
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails: string | WPErrorResponse = "";
      
      try {
        errorDetails = JSON.parse(errorText) as WPErrorResponse;
      } catch (e) {
        errorDetails = errorText;
      }
      
      throw new Error(
        `Failed to upload image (alternative method): ${response.status} ${response.statusText}\nDetails: ${JSON.stringify(
          errorDetails
        )}`
      );
    }
    
    const data = await response.json();
    console.log(`  Success! Uploaded as ID: ${data.id} (alternative method)`);
    return data.id;
  } catch (error) {
    console.error(`Error uploading image ${fileName} (alternative method):`, error);
    throw error;
  }
}

/**
 * Process an image - download from source and upload to target
 */
async function processImage(
  image: any,
  stats: ImportStats,
  categorySlug?: string,
  forceUpload: boolean = false
): Promise<number | null> {
  try {
    if (!image || !image.src) {
      console.log("  No image source provided");
      return null;
    }

    // Check if we already processed this image ID
    if (image.id && imageMapping[image.id]) {
      console.log(
        `  Image already processed (ID: ${image.id} → ${imageMapping[image.id]})`
      );
      stats.images.skipped++;
      return imageMapping[image.id];
    }

    // Use category slug as the filename if provided, otherwise extract from URL
    let imageName = path.basename(image.src);
    const fileExtension = path.extname(imageName).toLowerCase();
    
    // Properly sanitize the slug for use as a filename
    let sanitizedSlug = "";
    if (categorySlug) {
      // Create a sanitized slug-based filename to avoid special characters issues
      sanitizedSlug = categorySlug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    }
    
    // Define the final image name with proper sanitization
    const regularImageName = categorySlug ? 
      `${sanitizedSlug}${fileExtension}` : 
      imageName;
      
    // For WebP conversion, use the same base name
    const nameWithoutExt = categorySlug ? 
      sanitizedSlug : 
      path.basename(imageName, fileExtension);
    
    // Check for WebP version first
    // Check for WebP version in site-specific directory first
    const siteWebpImagePath = path.join(siteWebpImagesDir, `${nameWithoutExt}.webp`);
    
    // Check for WebP version in legacy directory as fallback
    const legacyWebpImagePath = path.join(legacyWebpImagesDir, `${nameWithoutExt}.webp`);
    
    // Check for regular version in site-specific directory first
    const siteRegularImagePath = path.join(siteTempImagesDir, regularImageName);
    
    // Check for regular version in legacy directory as fallback
    const legacyRegularImagePath = path.join(legacyTempImagesDir, regularImageName);
    
    let imageToUpload: string | null = null;
    let finalImageName = "";
    
    // First priority: Check if WebP version exists in site-specific directory
    if (fs.existsSync(siteWebpImagePath)) {
      console.log(`  Using site-specific WebP version: ${path.basename(siteWebpImagePath)}`);
      imageToUpload = siteWebpImagePath;
      finalImageName = path.basename(siteWebpImagePath);
    }
    // Second priority: Check if WebP version exists in legacy directory
    else if (fs.existsSync(legacyWebpImagePath)) {
      console.log(`  Using legacy WebP version: ${path.basename(legacyWebpImagePath)}`);
      imageToUpload = legacyWebpImagePath;
      finalImageName = path.basename(legacyWebpImagePath);
    }
    // Third priority: Check if regular version exists in site-specific directory
    else if (fs.existsSync(siteRegularImagePath)) {
      console.log(`  Using site-specific regular version: ${regularImageName}`);
      imageToUpload = siteRegularImagePath;
      finalImageName = regularImageName;
    }
    // Fourth priority: Check if regular version exists in legacy directory
    else if (fs.existsSync(legacyRegularImagePath)) {
      console.log(`  Using legacy regular version: ${regularImageName}`);
      imageToUpload = legacyRegularImagePath;
      finalImageName = regularImageName;
    }
    // Fifth priority: Download if allowed
    else if (!skipImageDownload) {
      if (categorySlug) {
        const decodedSlug = decodeSlug(categorySlug);
        console.log(`  Downloading image for category: ${decodedSlug} as ${regularImageName}`);
      } else {
        console.log(`  Downloading image as: ${regularImageName}`);
      }
      
      try {
        // Download the image with the proper renamed filename
        imageToUpload = await downloadImage(image.src, regularImageName);
        finalImageName = regularImageName;
        stats.images.downloaded++;
      } catch (downloadError) {
        console.log(`  ${chalk.yellow('WARNING')} Image download failed, continuing with category import`);
        stats.images.failed++;
        // Continue with null imageToUpload
        imageToUpload = null;
      }
    }
    // Skip if no image available and downloads not allowed
    else {
      console.log(`  Skipping image processing (--skip-image-download): ${imageName}`);
      stats.images.skipped++;
      return null;
    }

    // Upload the image
    if (imageToUpload) {
      // Force upload the image to WordPress
      const newImageId = await uploadImage(imageToUpload, finalImageName, forceUpload);
      stats.images.uploaded++;

      // Store the mapping
      if (image.id) {
        imageMapping[image.id] = newImageId;
      }

      return newImageId;
    }
    
    return null;
  } catch (error) {
    console.error("Error processing image:", error);
    stats.images.failed++;
    return null;
  }
}

/**
 * Check if a category already exists by slug and language
 */
async function categoryExists(
  slug: string,
  lang: string
): Promise<number | null> {
  try {
    const response = await fetchJSON(
      `${getImportSite().baseUrl}/wp-json/wc/v3/products/categories?slug=${slug}&lang=${lang}`
    );

    if (response && response.length > 0) {
      return response[0].id;
    }

    return null;
  } catch (error) {
    console.error(`Error checking if category exists (${slug}, ${lang}):`, error);
    return null;
  }
}

/**
 * Create a translation relationship between categories
 */
async function createTranslationRelationship(
  translationData: Record<string, number>,
  mainLanguage: string
): Promise<boolean> {
  const importSite = getImportSite();
  
  try {
    // Log which categories are being connected
    console.log(chalk.cyan("Connecting translations:"));
    for (const [lang, id] of Object.entries(translationData)) {
      console.log(chalk.cyan(`  - ${getFlagEmoji(lang)} ${lang}: ID ${id}`));
    }
    
    // Only use the primary WPML REST API endpoint for product_cat
    console.log(chalk.dim("Using WPML product_cat translations endpoint..."));
    
    // Make sure we have the main language ID
    if (!translationData[mainLanguage]) {
      console.log(chalk.yellow(`⚠️ Main language ${mainLanguage} ID not found in translation data. Cannot connect translations.`));
      return false;
    }
    
    const mainLangId = translationData[mainLanguage];
    
    // Log translation connections in a more readable format - connect non-main languages to main language
    for (const [lang, id] of Object.entries(translationData)) {
      if (lang !== mainLanguage) {
        console.log(chalk.dim(`Connecting id ${id} (${lang}) to ${mainLangId} (${mainLanguage})`));
      }
    }
    
    const response = await fetchJSON(
      `${importSite.baseUrl}/wp-json/wpml/v1/product_cat/translations`,
      {
        method: "POST",
        body: JSON.stringify(translationData),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log(chalk.green("✓ Successfully created translation relationships"));
    return true;
  } catch (error) {
    console.error(chalk.red("✗ Error creating translation relationship:"), 
      error instanceof Error ? error.message : String(error));
    console.log(chalk.yellow("⚠️ Translation endpoint failed. Translations will need to be set up manually."));
    return false; // Failed but we'll continue with import
  }
}

/**
 * Import categories for a specific language
 */
async function importCategoriesForLanguage(
  categories: any[],
  lang: string,
  idMap: Record<string, Record<string, number>>,
  stats: ImportStats,
  mainLanguage: string,
  translations: {
    wpml: Record<string, Record<string, number>>
  },
  skipExisting: boolean = true
): Promise<void> {
  // Sort categories so that parents come before children
  // This ensures parent categories are created first and their IDs are available
  const sortedCategories = [...categories].sort((a, b) => {
    // Categories with no parent (top-level) come first
    if (!a.parent && b.parent) return -1;
    if (a.parent && !b.parent) return 1;
    // If both have parents, sort by parent ID (lower parent IDs first)
    if (a.parent && b.parent) return a.parent - b.parent;
    return 0;
  });
  
  console.log(chalk.blue(`Sorted categories by parent hierarchy for ${lang} - processing parents first`));
  // Language import message is now handled by the parent function

  // Initialize language stats if not already present
  if (!stats.byLanguage[lang]) {
    stats.byLanguage[lang] = {
      total: categories.length,
      created: 0,
      skipped: 0,
      failed: 0,
    };
  }

  // Apply import limit if specified
  const categoriesToImport = importLimit ? sortedCategories.slice(0, importLimit) : sortedCategories;
  
  if (importLimit) {
    console.log(chalk.yellow(`Limiting import to ${importLimit} categories (out of ${sortedCategories.length} total)`));
  }
  
  for (const category of categoriesToImport) {
    // Fix for Russian slug encoding issues - ensure slug is properly decoded
    // This prevents URL-encoded slugs from being used as-is in the database
    let slug = category.slug;
    try {
      // Check if the slug appears to be URL-encoded (contains % followed by hex digits)
      if (/%[0-9A-Fa-f]{2}/.test(slug)) {
        const decodedSlug = decodeURIComponent(slug);
        console.log(`Processing "${category.name}" (${decodedSlug})...`);
        slug = decodedSlug;
      } else {
        console.log(`Processing "${category.name}" (${slug})...`);
      }
    } catch (error) {
      console.log(`Processing "${category.name}" (${slug})...`);
      console.log(chalk.yellow(`  Warning: Could not decode slug "${slug}", using as-is`));
    }

    // Check if category already exists
    const existingId = await categoryExists(slug, lang);
    if (existingId && skipExisting) {
      console.log(`  SKIPPED (already exists with ID: ${existingId})`);
      stats.categories.skipped++;
      stats.byLanguage[lang].skipped++;

      // Store the mapping
      if (!idMap[lang]) idMap[lang] = {};
      idMap[lang][category.id] = existingId;
      
      // For existing categories, we don't need to update the translation_of parameter
      // WPML should handle this through its own database tables, and trying to update
      // an existing category's translation relationship may cause issues
      continue;
    }

    try {
      // Process image if present
      let newImageId: number | null = null;
      if (category.image) {
        // Only download images for the main language
        if (lang === mainLanguage) {
          // Process image if available
          newImageId = await processImage(category.image, stats, slug, forceImageUpload);
        } else {
          // For translations, check if the image ID is already mapped (processed in main language)
          if (category.image.id && imageMapping[category.image.id]) {
            console.log(`  Image already processed in main language (ID: ${category.image.id} → ${imageMapping[category.image.id]})`);
            newImageId = imageMapping[category.image.id];
            stats.images.skipped++;
          }
          // If not mapped, don't try to download for non-main languages
        }
      }

      // Check if this is a translation and get the main language category ID
      // For translations, we need to find the corresponding main language category's new ID
      let mainLangId = null;
      if (lang !== mainLanguage) {
        // Find the original ID of the main language category that this is a translation of
        let mainLangOriginalId = null;
        
        // First check if the category has explicit translations in its data
        if (category.translations && category.translations[mainLanguage]) {
          mainLangOriginalId = category.translations[mainLanguage];
        }
        // Then try to find by slug in the translations object
        else if (translations.wpml[slug] && translations.wpml[slug][mainLanguage]) {
          mainLangOriginalId = translations.wpml[slug][mainLanguage];
        }
        
        // If we found an original ID, look up its new ID in our mapping
        if (mainLangOriginalId && idMap[mainLanguage] && idMap[mainLanguage][mainLangOriginalId]) {
          mainLangId = idMap[mainLanguage][mainLangOriginalId];
          console.log(chalk.green(`Found translation relationship: ${category.name} (${lang}) -> main language ID ${mainLangId}`));
        } else {
          console.log(chalk.yellow(`Could not find main language category for ${category.name} (${lang})`));
        }
      }
      
      // Create category with translation_of parameter if applicable
      // This is the correct way to establish translation relationships in WPML
      
      // Create the request URL and body
      const requestUrl = `${getImportSite().baseUrl}/wp-json/wc/v3/products/categories?lang=${lang}`;
      // Check if this category has a parent and if that parent has already been imported
      let parentId = 0;
      if (category.parent && category.parent > 0) {
        // Try to find the parent's new ID in our mapping
        if (idMap[lang] && idMap[lang][category.parent]) {
          parentId = idMap[lang][category.parent];
          console.log(chalk.blue(`Setting parent ID for ${category.name}: ${parentId}`));
        } else {
          // Parent category not found, will set as top-level
          // No message needed
        }
      } else {
        // This is intentionally a top-level category
        // No need to log anything for top-level categories
      }
      
      const requestBody = {
        name: category.name,
        slug: slug, // Use the potentially decoded slug
        parent: parentId, // Set the parent ID if we found it
        description: category.description || "",
        image: newImageId ? { id: newImageId } : null,
        // Set translation_of parameter if this is a translation
        ...(mainLangId ? { translation_of: mainLangId } : {}),
      };
      
      
      const response = await fetchJSON(
        requestUrl,
        {
          method: "POST",
          body: JSON.stringify(requestBody),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      

      if (!response || !response.id) {
        throw new Error(`Failed to create category: ${JSON.stringify(response)}`);
      }

      console.log(`  CREATED (ID: ${response.id})`);
      stats.categories.created++;
      stats.byLanguage[lang].created++;

      // Store the mapping
      if (!idMap[lang]) idMap[lang] = {};
      idMap[lang][category.id] = response.id;
      console.log(); // Add a new line after each category import
    } catch (error) {
      console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
      stats.categories.failed++;
      stats.byLanguage[lang].failed++;
      console.log(); // Add a new line even after failed imports
    }
  }
}

async function importCategories(): Promise<void> {
  try {
    // Get the export site URL to determine the site-specific directory
    const exportSite = getExportSite();
    const exportBaseUrl = exportSite.baseUrl;
    const siteDomain = exportBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const siteInputDir = path.join(DEFAULT_PATHS.outputDir, siteDomain);
    const siteInputFile = path.join(siteInputDir, DEFAULT_PATHS.categoriesFile);
    const defaultInputFile = path.join(DEFAULT_PATHS.outputDir, DEFAULT_PATHS.categoriesFile);
    
    if (fs.existsSync(siteInputFile)) {
      console.log(chalk.cyan(`📂 Loading category data from site-specific folder: ${siteInputFile}`));
      var exportData: ExportData = JSON.parse(fs.readFileSync(siteInputFile, "utf-8"));
    } 
    else if (fs.existsSync(defaultInputFile)) {
      // Fallback to default location
      console.log(chalk.yellow(`⚠️ Site-specific export not found, using default location`));
      console.log(chalk.cyan(`📂 Loading category data from default location: ${defaultInputFile}`));
      var exportData: ExportData = JSON.parse(fs.readFileSync(defaultInputFile, "utf-8"));
    }
    else {
      console.error(chalk.red(`Error: Category export file not found at ${siteInputFile} or ${defaultInputFile}`));
      console.log(chalk.yellow("Please run the category export first."));
      process.exit(1);
    }
    const { meta, translations, data } = exportData;
    const { main_language: mainLanguage, other_languages: otherLanguages } = meta;
    
    // Get source and target site names
    let sourceSiteName = exportData.meta.source_site || "Unknown source site";
    let sourceDomain = "Unknown domain";
    
    // Extract domain from the file path if available
    if (fs.existsSync(siteInputFile)) {
      sourceDomain = siteDomain;
      // If source site name is unknown, use the domain
      if (sourceSiteName === "Unknown source site") {
        sourceSiteName = siteDomain;
      }
    }
    
    // Get export date
    const exportDate = exportData.meta.exported_at ? 
      new Date(exportData.meta.exported_at).toLocaleString() : 
      "Unknown date";
    
    const importSite = getImportSite();
    const targetSiteName = await apiGetSiteName(importSite.baseUrl);
    
    // Initialize stats
    const stats: ImportStats = {
      categories: {
        total: Object.values(data).flat().length,
        created: 0,
        skipped: 0,
        failed: 0,
      },
      translations: {
        total: Object.keys(translations.wpml).length,
        created: 0,
        skipped: 0,
        failed: 0,
      },
      byLanguage: {},
      images: {
        downloaded: 0,
        uploaded: 0,
        skipped: 0,
        failed: 0,
      },
    };
    
    // Initialize language stats
    for (const lang of [mainLanguage, ...otherLanguages]) {
      stats.byLanguage[lang] = { total: 0, created: 0, skipped: 0, failed: 0 };
    }

    console.log(chalk.cyan(`📊 Found ${Object.values(data).flat().length} categories in ${Object.keys(data).length} languages`));
    
    // Apply import limit if specified
    let filteredData = data;
    if (importLimit && importLimit > 0) {
      filteredData = limitImportData(data, translations, mainLanguage, otherLanguages, importLimit);
    }

    console.log(
      chalk.cyan(`📊 Found ${Object.values(filteredData).flat().length} categories in ${Object.keys(filteredData).length} languages`)
    );
    
    // If import limit is set, prepare the list of slugs to import
    let slugsToImport: Set<string> | null = null;
    if (importLimit && importLimit > 0 && filteredData[mainLanguage]) {
      slugsToImport = new Set<string>();
      for (const item of filteredData[mainLanguage]) {
        if (item && item.slug) {
          slugsToImport.add(item.slug);
        }
      }
      
      console.log(chalk.yellow(`Limiting import to ${filteredData[mainLanguage].length} items from main language and their translations`));
    }

    // Show clear import information and ask for confirmation
    console.log(chalk.yellow.bold(`\n⚠️ IMPORT CONFIRMATION`));
    console.log(chalk.yellow(`You are about to import categories:`));
    console.log(chalk.yellow(`- FROM: ${chalk.white(sourceSiteName)} (${sourceDomain})`));
    console.log(chalk.yellow(`- EXPORTED: ${chalk.white(exportDate)}`));
    console.log(chalk.yellow(`- TO:   ${chalk.white.bgBlue(` ${targetSiteName} (${importSite.baseUrl}) `)}`));
    console.log(chalk.yellow(`- IMPORT DATE: ${chalk.white(new Date().toLocaleString())}`));

    // Show image download settings
    if (skipImageDownload) {
      console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will NOT download images')} (using --skip-image-download)`));
    } else if (forceImageUpload) {
      console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will FORCE UPLOAD all images to WordPress')} (using --force-image-upload)`));
    } else {
      console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will download only if not found locally')}`));
    }

    // Skip confirmation if force-import or yes flag is set
    if (!forceImport && !autoConfirm) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow.bold('\nProceed with import? (y/n): '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log(chalk.blue("Import cancelled."));
        return;
      }
    } else {
      if (forceImport) {
        console.log(chalk.dim("Skipping confirmation due to --force-import flag."));
      } else if (autoConfirm) {
        console.log(chalk.dim("Skipping confirmation due to --yes flag."));
      }
    }

    console.log(chalk.cyan(`🔄 Importing to: ${importSite.baseUrl} (${targetSiteName})`));

    // Initialize stats for each language
    const allLanguages = [meta.main_language, ...meta.other_languages];
    for (const lang of allLanguages) {
      stats.byLanguage[lang] = { total: 0, created: 0, skipped: 0, failed: 0 };
    }

    // First pass: Import categories for each language
    console.log(chalk.cyan("\n🔄 First pass: Importing categories..."));

    // Import main language first
    if (filteredData[mainLanguage] && filteredData[mainLanguage].length > 0) {
      console.log(
        chalk.cyan(`\n🌎 Importing ${filteredData[mainLanguage].length} categories in main language: ${mainLanguage} ${getFlagEmoji(mainLanguage)}`)
      );
      await importCategoriesForLanguage(filteredData[mainLanguage], mainLanguage, idMap, stats, mainLanguage, translations);
    }

    // Then import other languages
    for (const lang of otherLanguages) {
      if (filteredData[lang] && filteredData[lang].length > 0) {
        console.log(
          chalk.cyan(`\n🌎 Importing ${filteredData[lang].length} categories in language: ${lang} ${getFlagEmoji(lang)}`)
        );
        await importCategoriesForLanguage(filteredData[lang], lang, idMap, stats, mainLanguage, translations);
      }
    }

    // No second pass needed - translation relationships are established during category creation
    // via the translation_of parameter in the POST request

    // Clean up temp directory - commented out to prevent deleting legacy directories
    // We no longer create or clean up legacy directories
    /* 
    if (fs.existsSync(tempImagesDir)) {
      fs.rmSync(tempImagesDir, { recursive: true, force: true });
    }
    */

    // Print statistics
    console.log("\n📊 Import Statistics:");

    console.log("\nCategories:");
    for (const [lang, counts] of Object.entries(stats.byLanguage)) {
      const flag = getFlagEmoji(lang);
      console.log(
        `- ${flag} ${lang}: ${counts.created} created, ${counts.skipped} skipped, ${counts.failed} failed`
      );
    }

    console.log("\nTranslations:");
    console.log(
      `- Translation relationships established via translation_of parameter during category creation`
    );

    // Only show image stats if any images were processed
    if (stats.images.downloaded > 0 || stats.images.uploaded > 0 || 
        stats.images.skipped > 0 || stats.images.failed > 0) {
      console.log("\nImages:");
      console.log(`- ${stats.images.downloaded} downloaded`);
      console.log(`- ${stats.images.uploaded} uploaded`);
      console.log(`- ${stats.images.skipped} skipped`);
      console.log(`- ${stats.images.failed} failed`);
    }
  } catch (error) {
    console.error(chalk.red.bold("✗ Fatal error:"), error);
    process.exit(1);
  }
}

// Run the script
importCategories().catch((error) => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
