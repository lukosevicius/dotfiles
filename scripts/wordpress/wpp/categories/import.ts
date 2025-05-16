import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import FormData from "form-data";
import readline from "readline";
import chalk from "chalk";
import config from "../shared/config";
import { getFlagEmoji } from "../shared/utils/language";
import { fetchJSON as apiFetchJSON, getSiteName as apiGetSiteName } from "../shared/utils/api";

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

// Keep track of image mappings between original and imported images
const imageMapping: Record<number, number> = {};

// Temporary directory for downloaded images
const tempImageDir = path.join(config.outputDir, "temp_images");

/**
 * Decodes URL-encoded strings for display in terminal
 */
function decodeSlug(slug: string): string {
  try {
    // First try to decode as URI component
    const decoded = decodeURIComponent(slug);
    return decoded;
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
  // Ensure temp directory exists
  if (!fs.existsSync(tempImageDir)) {
    fs.mkdirSync(tempImageDir, { recursive: true });
  }

  const filePath = path.join(tempImageDir, imageName);

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
      fs.writeFileSync(filePath, buffer);
      console.log(`  Success! Downloaded: ${path.basename(url)}`);
      return filePath;
    } catch (error) {
      console.log(
        `  Failed (${error instanceof Error ? error.message : String(error)})`
      );
      // Continue to next URL
    }
  }

  // If we get here, all URLs failed
  throw new Error(
    `All image versions failed to download. The image may be corrupted or doesn't exist.`
  );
}

/**
 * Upload an image to WordPress and return the media ID
 */
async function uploadImage(
  filePath: string,
  fileName: string
): Promise<number> {
  try {
    // Check if file exists and has content
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file does not exist: ${filePath}`);
    }

    const fileStats = fs.statSync(filePath);
    if (fileStats.size === 0) {
      throw new Error(`Image file is empty: ${filePath}`);
    }

    if (fileStats.size < 100) {
      // 100 bytes is too small for a valid image
      throw new Error(
        `Image file is too small (${fileStats.size} bytes): ${filePath}`
      );
    }

    // Read the file as a buffer
    const fileBuffer = fs.readFileSync(filePath);

    // Get file size in MB
    const fileSizeMB = fileBuffer.length / (1024 * 1024);
    console.log(`  Image size: ${fileSizeMB.toFixed(2)} MB`);

    // Create a Node.js compatible FormData object
    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: fileName,
      contentType: "application/octet-stream",
    });

    // Try to upload with a longer timeout
    const response = await fetch(
      `${config.importBaseUrl}/wp-json/wp/v2/media`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${config.importUsername}:${config.importPassword}`
            ).toString("base64"),
          // Don't set Content-Type header - FormData will set it with the boundary
        },
        body: formData,
        // Add a longer timeout for large files
        timeout: 60000, // 60 seconds
      }
    );

    if (!response.ok) {
      // Try to get more detailed error information
      let errorDetail = "";
      try {
        const errorResponse = await response.text();
        errorDetail = errorResponse.substring(0, 200); // Limit to first 200 chars
      } catch (e) {
        errorDetail = "Could not get error details";
      }

      throw new Error(
        `Failed to upload image: ${response.status} ${response.statusText}\nDetails: ${errorDetail}`
      );
    }

    const data = await response.json();
    return data.id;
  } catch (error) {
    console.error(`Error uploading image ${fileName}:`, error);
    throw error;
  }
}

/**
 * Process an image - download from source and upload to target
 */
async function processImage(
  image: any,
  stats: ImportStats
): Promise<number | null> {
  if (!image || !image.src) {
    return null;
  }

  // Check if we've already processed this image
  if (imageMapping[image.id]) {
    stats.images.skipped++;
    return imageMapping[image.id];
  }

  try {
    // Extract filename from URL
    const fileName = image.name || path.basename(image.src);

    // Check if URL is valid
    if (!image.src.startsWith("http")) {
      console.warn(`  Warning: Invalid image URL: ${image.src}`);
      stats.images.failed++;
      return null;
    }

    // Download the image (will try alternative sizes if main image fails)
    console.log(`Downloading image: ${fileName}`);
    let filePath: string;
    try {
      filePath = await downloadImage(image.src, fileName);
      stats.images.downloaded++;
    } catch (downloadError) {
      console.error(
        `Failed to download image: ${
          downloadError instanceof Error
            ? downloadError.message
            : String(downloadError)
        }`
      );
      stats.images.failed++;
      return null;
    }

    // Check if file is too large (WordPress default max is 8MB)
    const fileStats = fs.statSync(filePath);
    const fileSizeMB = fileStats.size / (1024 * 1024);

    if (fileSizeMB > 8) {
      console.warn(
        `  Warning: Image is ${fileSizeMB.toFixed(
          2
        )}MB, which may exceed WordPress upload limits`
      );
    }

    // Upload the image to the target site
    console.log(`Uploading image: ${fileName}`);
    try {
      const newImageId = await uploadImage(filePath, fileName);
      stats.images.uploaded++;

      // Store the mapping
      imageMapping[image.id] = newImageId;

      return newImageId;
    } catch (uploadError) {
      // If upload fails, continue without the image
      console.error(
        `Failed to upload image. Category will be created without an image.`
      );
      stats.images.failed++;
      return null;
    }
  } catch (error) {
    console.error(
      `Failed to process image:`,
      error instanceof Error ? error.message : String(error)
    );
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
      `${config.importBaseUrl}/wp-json/wc/v3/products/categories?slug=${slug}&lang=${lang}`
    );

    if (response && response.length > 0) {
      return response[0].id;
    }

    return null;
  } catch (error) {
    console.error(`Error checking if category exists:`, error);
    return null;
  }
}

/**
 * Create a translation relationship between categories
 */
async function createTranslationRelationship(
  translationData: Record<string, number>
): Promise<void> {
  try {
    // Create a translation relationship
    const response = await fetchJSON(
      `${config.importBaseUrl}/wp-json/wp/v2/posts/translate`,
      {
        method: "POST",
        body: JSON.stringify(translationData),
      }
    );

    console.log(`Created translation relationship: ${response.id}`);
  } catch (error) {
    console.error(`Error creating translation relationship:`, error);
  }
}

/**
 * Import categories for a specific language
 */
async function importCategoriesForLanguage(
  categories: any[],
  lang: string,
  idMap: Record<string, Record<number, number>>,
  stats: ImportStats
): Promise<void> {
  for (const category of categories) {
    process.stdout.write(
      `Processing "${category.name}" (${decodeSlug(category.slug)})... `
    );

    // Check if category already exists
    const existingId = await categoryExists(category.slug, lang);
    if (existingId && config.skipExisting) {
      // Update statistics
      stats.byLanguage[lang].skipped++;

      // Store ID mapping for later use
      idMap[lang][category.id] = existingId;
      console.log(`SKIPPED (ID: ${existingId})`);
      continue;
    }

    try {
      // Process image if present
      let newImageId = null;
      if (category.image) {
        newImageId = await processImage(category.image, stats);
      }

      // Create category
      const response = await fetchJSON(
        `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=${lang}`,
        {
          method: "POST",
          body: JSON.stringify({
            name: category.name,
            slug: category.slug,
            parent: 0, // We'll update parent relationships later
            description: category.description || "",
            image: newImageId ? { id: newImageId } : null,
          }),
        }
      );

      // Store ID mapping for later use
      idMap[lang][category.id] = response.id;

      // Update statistics
      stats.byLanguage[lang].created++;

      console.log(`CREATED (ID: ${response.id})`);
    } catch (error) {
      console.log(
        `FAILED (${error instanceof Error ? error.message : String(error)})`
      );

      // Update statistics
      stats.byLanguage[lang].failed++;
    }
  }
}

async function importCategories(): Promise<void> {
  try {
    // Load the export data
    if (!fs.existsSync(config.inputFile)) {
      console.error(chalk.red(`Error: Category export file not found at ${config.inputFile}`));
      console.log(chalk.yellow("Please run the category export first."));
      process.exit(1);
    }

    console.log(chalk.cyan(`📂 Loading category data from: ${config.inputFile}`));

    const raw = fs.readFileSync(config.inputFile, "utf-8");
    const exportData: ExportData = JSON.parse(raw);
    const { meta, translations, data } = exportData;

    // Extract metadata
    const mainLanguage = meta.main_language;
    const otherLanguages = meta.other_languages;
    const sourceSiteName = meta.source_site || "Unknown source site";
    const targetSiteName = await getSiteName(config.importBaseUrl);

    console.log(chalk.cyan(`📊 Found ${Object.values(data).flat().length} categories in ${Object.keys(data).length} languages`));

    // Show clear import information and ask for confirmation
    console.log(chalk.yellow.bold(`\n⚠️ IMPORT CONFIRMATION`));
    console.log(chalk.yellow(`You are about to import categories:`));
    console.log(chalk.yellow(`- FROM: ${chalk.white(sourceSiteName)} (export file)`));
    console.log(chalk.yellow(`- TO:   ${chalk.white.bgBlue(` ${targetSiteName} (${config.importBaseUrl}) `)}`));

    // Skip confirmation if force-import flag is set
    if (!process.argv.includes("--force-import")) {
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
      console.log(chalk.dim("Skipping confirmation due to --force-import flag."));
    }

    console.log(chalk.cyan(`🔄 Importing to: ${config.importBaseUrl} (${targetSiteName})`));

    // Initialize statistics
    const stats: ImportStats = {
      categories: {
        total: 0,
        created: 0,
        skipped: 0,
        failed: 0,
      },
      translations: {
        total: 0,
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

    // Initialize ID mapping for each language
    for (const lang of [mainLanguage, ...otherLanguages]) {
      idMap[lang] = {};
      stats.byLanguage[lang] = {
        total: 0,
        created: 0,
        skipped: 0,
        failed: 0,
      };
    }

    // First pass: Import all categories without setting translations
    console.log(chalk.cyan("\n🔄 First pass: Importing categories..."));

    // Import main language first
    if (data[mainLanguage] && data[mainLanguage].length > 0) {
      console.log(
        chalk.cyan(`\n🌎 Importing ${data[mainLanguage].length} categories in main language: ${mainLanguage} ${getFlagEmoji(
          mainLanguage
        )}`)
      );
      await importCategoriesForLanguage(data[mainLanguage], mainLanguage, idMap, stats);
    }

    // Then import other languages
    for (const lang of otherLanguages) {
      if (data[lang] && data[lang].length > 0) {
        console.log(
          chalk.cyan(`\n🌎 Importing ${data[lang].length} categories in language: ${lang} ${getFlagEmoji(
            lang
          )}`)
        );
        await importCategoriesForLanguage(data[lang], lang, idMap, stats);
      }
    }

    // Second pass: Set up translations
    console.log(chalk.cyan("\n🔄 Second pass: Setting up translations..."));

    // Count how many translation groups we have
    const translationGroups = Object.keys(translations.wpml).length;
    console.log(chalk.cyan(`Found ${translationGroups} translation groups to process`));

    let translationsProcessed = 0;
    let translationsSucceeded = 0;
    let translationsFailed = 0;

    for (const [slug, langMap] of Object.entries(translations.wpml)) {
      try {
        // Check if we have mapped IDs for at least two languages in this group
        const mappedLangs = Object.entries(langMap).filter(([lang, id]) => {
          return idMap[lang] && idMap[lang][id] !== undefined;
        });

        if (mappedLangs.length < 2) {
          // Not enough categories were imported to create a translation relationship
          continue;
        }

        // Create a translation relationship
        const translationData: Record<string, number> = {};

        // Start with the main language category as the "original"
        let originalId: number | undefined = undefined;
        if (langMap[mainLanguage] && idMap[mainLanguage][langMap[mainLanguage]]) {
          originalId = idMap[mainLanguage][langMap[mainLanguage]];
          translationData[mainLanguage] = originalId;
        }

        // If no main language category, use the first available language
        if (originalId === undefined) {
          const firstLang = mappedLangs[0][0];
          const firstId = mappedLangs[0][1] as number;
          originalId = idMap[firstLang][firstId];
          translationData[firstLang] = originalId;
        }

        // Add translations for other languages
        for (const [lang, id] of Object.entries(langMap)) {
          if (
            lang !== mainLanguage &&
            idMap[lang] &&
            idMap[lang][id] !== undefined &&
            idMap[lang][id] !== originalId
          ) {
            translationData[lang] = idMap[lang][id];
          }
        }

        // If we have at least two languages in this group, count it as a successful connection
        if (Object.keys(translationData).length >= 2) {
          await createTranslationRelationship(translationData);
          translationsSucceeded++;
        }

        translationsProcessed++;

        // Show progress every 10 translation groups
        if (translationsProcessed % 10 === 0) {
          console.log(
            chalk.dim(`Processed ${translationsProcessed}/${translationGroups} translation groups...`)
          );
        }
      } catch (error) {
        console.error(chalk.red(`Error setting up translation for group ${slug}:`), error);
        translationsFailed++;
      }
    }

    // Clean up temp directory
    if (fs.existsSync(tempImageDir)) {
      fs.rmSync(tempImageDir, { recursive: true, force: true });
    }

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
      `- ${translationsSucceeded} successfully connected via translation_of parameter`
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
