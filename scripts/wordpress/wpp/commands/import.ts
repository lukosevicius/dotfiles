import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import FormData from "form-data";
import config from "../config";
import {
  getImportSite,
  getExportSite,
  getImportBaseUrl,
  getImportCredentials,
  getExportCredentials
} from "../utils/config-utils";
import { getFlagEmoji } from "../utils/language";
import { limitImportData } from "../utils/limit-imports";

// Type for the export data structure
interface ExportData {
  meta: {
    exported_at: string;
    main_language: string;
    other_languages: string[];
  };
  translations: {
    wpml: Record<string, Record<string, number>>;
  };
  data: Record<string, any[]>;
}

interface ImportStats {
  categories: Record<
    string,
    {
      created: number;
      skipped: number;
      failed: number;
    }
  >;
  translationConnections: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
  images: {
    downloaded: number;
    uploaded: number;
    failed: number;
    skipped: number;
  };
}

// Keep track of ID mappings between original and imported categories
const idMapping: Record<string, Record<number, number>> = {};

// Keep track of image mappings between original and imported images
const imageMapping: Record<number, number> = {};

// Temporary directory for downloaded images
const tempImageDir = path.join(config.outputDir, "temp_images");

async function fetchJSON(url: string, options: any = {}): Promise<any> {
  // Determine which credentials to use based on the URL
  const importBaseUrl = getImportBaseUrl();
  const exportBaseUrl = getExportSite().baseUrl;
  const importCreds = getImportCredentials();
  const exportCreds = getExportCredentials();
  
  const isImportUrl = url.includes(importBaseUrl);
  const username = isImportUrl ? importCreds.username : exportCreds.username;
  const password = isImportUrl ? importCreds.password : exportCreds.password;

  const res = await fetch(url, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} - ${await res.text()}`);
  }

  return await res.json();
}

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
      `${getImportBaseUrl()}/wp-json/wp/v2/media`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${getImportCredentials().username}:${getImportCredentials().password}`
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
    const url = `${getImportBaseUrl()}/wp-json/wc/v3/products/categories?slug=${slug}&lang=${lang}`;
    const response = await fetchJSON(url);

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
 * Get the site name from WordPress
 */
async function getSiteName(baseUrl: string): Promise<string> {
  try {
    const response = await fetchJSON(`${baseUrl}/wp-json`);
    return response.name || "Unknown Site";
  } catch (error) {
    console.error("Error fetching site information:", error);
    return "Unknown Site";
  }
}

// ... (rest of the code remains the same)

async function importCategories(): Promise<void> {
  // Initialize statistics
  const stats: ImportStats = {
    categories: {},
    translationConnections: {
      attempted: 0,
      succeeded: 0,
      failed: 0,
    },
    images: {
      downloaded: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
    },
  };

  // Read the export file
  console.log(`Reading export file: ${config.inputFile}`);
  const raw = fs.readFileSync(config.inputFile, "utf-8");
  const exportData: ExportData = JSON.parse(raw);

  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;

  // Get site name
  const siteName = await getSiteName(getImportBaseUrl());

  console.log(`🔄 Importing to: ${getImportBaseUrl()} (${siteName})`);
  console.log(
    `Main language: ${mainLanguage}, Other languages: ${otherLanguages.join(
      ", "
    )}`
  );

  // Initialize ID mapping for each language
  idMapping[mainLanguage] = {};
  for (const lang of otherLanguages) {
    idMapping[lang] = {};
    stats.categories[lang] = { created: 0, skipped: 0, failed: 0 };
  }
  stats.categories[mainLanguage] = { created: 0, skipped: 0, failed: 0 };

  // 1. Import main language categories first
  console.log(`\nImporting main language categories (${mainLanguage})...`);
  for (const category of data[mainLanguage]) {
    process.stdout.write(
      `Processing "${category.name}" (${decodeSlug(category.slug)})... `
    );

    // Check if category already exists
    const existingId = await categoryExists(category.slug, mainLanguage);
    if (existingId && config.skipExisting) {
      // Update statistics
      stats.categories[mainLanguage].skipped++;

      // Store ID mapping for later use
      idMapping[mainLanguage][category.id] = existingId;
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
        `${getImportBaseUrl()}/wp-json/wc/v3/products/categories?lang=${mainLanguage}`,
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
      idMapping[mainLanguage][category.id] = response.id;

      // Update statistics
      stats.categories[mainLanguage].created++;

      console.log(`CREATED (ID: ${response.id})`);
    } catch (error) {
      console.log(
        `FAILED (${error instanceof Error ? error.message : String(error)})`
      );

      // Update statistics
      stats.categories[mainLanguage].failed++;
    }
  }

  // 2. Import translations for other languages
  for (const lang of otherLanguages) {
    if (!data[lang] || data[lang].length === 0) {
      console.log(`No categories found for ${lang}`);
      continue;
    }

    console.log(`\nImporting translations for ${lang}...`);

    for (const category of data[lang]) {
      process.stdout.write(
        `Processing "${category.name}" (${decodeSlug(category.slug)})... `
      );

      // Check if category already exists
      const existingId = await categoryExists(category.slug, lang);
      if (existingId && config.skipExisting) {
        // Update statistics
        stats.categories[lang].skipped++;

        // Store ID mapping for later use
        idMapping[lang][category.id] = existingId;
        console.log(`SKIPPED (ID: ${existingId})`);
        continue;
      }

      // Find if this category has a translation relationship
      let mainCategoryId = null;
      let translationGroup = null;

      // Look through translation relationships to find main language counterpart
      if (translations.wpml) {
        for (const [slug, langMap] of Object.entries(translations.wpml)) {
          if (langMap[lang] === category.id && langMap[mainLanguage]) {
            mainCategoryId = langMap[mainLanguage];
            translationGroup = slug;
            break;
          }
        }
      }

      try {
        // Process image if present
        let newImageId = null;
        if (category.image) {
          newImageId = await processImage(category.image, stats);
        }

        // If no translation relationship found, create as standalone
        if (!mainCategoryId) {
          const response = await fetchJSON(
            `${getImportBaseUrl()}/wp-json/wc/v3/products/categories?lang=${lang}`,
            {
              method: "POST",
              body: JSON.stringify({
                name: category.name,
                slug: category.slug,
                parent: 0,
                description: category.description || "",
                image: newImageId ? { id: newImageId } : null,
              }),
            }
          );

          // Store ID mapping for later use
          idMapping[lang][category.id] = response.id;

          // Update statistics
          stats.categories[lang].created++;

          console.log(`CREATED (ID: ${response.id})`);
        } else {
          // This is a translation of a main language category
          const mainNewId = idMapping[mainLanguage]?.[mainCategoryId];

          if (!mainNewId) {
            console.log(`FAILED (Main language category not found)`);
            stats.categories[lang].failed++;
            continue;
          }

          const response = await fetchJSON(
            `${getImportBaseUrl()}/wp-json/wc/v3/products/categories?lang=${lang}`,
            {
              method: "POST",
              body: JSON.stringify({
                name: category.name,
                slug: category.slug,
                parent: 0, // We'll update parent relationships later
                description: category.description || "",
                translation_of: mainNewId,
                image: newImageId ? { id: newImageId } : null,
              }),
            }
          );

          // Store ID mapping for later use
          idMapping[lang][category.id] = response.id;

          // Update statistics
          stats.categories[lang].created++;

          console.log(`CREATED as translation (ID: ${response.id})`);
        }
      } catch (error) {
        console.log(
          `FAILED (${error instanceof Error ? error.message : String(error)})`
        );

        // Update statistics
        stats.categories[lang].failed++;
      }
    }
  }

  // 3. Update parent relationships
  console.log("\nUpdating parent relationships...");

  // First for main language
  for (const category of data[mainLanguage]) {
    if (category.parent > 0) {
      const newId = idMapping[mainLanguage][category.id];
      const newParentId = idMapping[mainLanguage][category.parent];

      if (newId && newParentId) {
        try {
          await fetchJSON(
            `${getImportBaseUrl()}/wp-json/wc/v3/products/categories/${newId}?lang=${mainLanguage}`,
            {
              method: "PUT",
              body: JSON.stringify({
                parent: newParentId,
              }),
            }
          );

          console.log(
            `Updated parent for ${mainLanguage} category "${category.name}" (ID: ${newId}, Parent: ${newParentId})`
          );
        } catch (error) {
          console.error(
            `Failed to update parent for ${mainLanguage} category "${category.name}":`,
            error
          );
        }
      }
    }
  }

  // Then for other languages
  for (const lang of otherLanguages) {
    if (!data[lang] || data[lang].length === 0) {
      continue;
    }

    for (const category of data[lang]) {
      if (category.parent > 0) {
        const newId = idMapping[lang][category.id];
        const newParentId = idMapping[lang][category.parent];

        if (newId && newParentId) {
          try {
            await fetchJSON(
              `${getImportBaseUrl()}/wp-json/wc/v3/products/categories/${newId}?lang=${lang}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  parent: newParentId,
                }),
              }
            );

            console.log(
              `Updated parent for ${lang} category "${category.name}" (ID: ${newId}, Parent: ${newParentId})`
            );
          } catch (error) {
            console.error(
              `Failed to update parent for ${lang} category "${category.name}":`,
              error
            );
          }
        }
      }
    }
  }

  // 4. Verify translation connections
  console.log("\nVerifying translation connections...");

  // For each translation group, count the successful connections
  let translationConnectionsCount = 0;

  if (translations.wpml) {
    for (const [slug, langMap] of Object.entries(translations.wpml)) {
      // Create a map of new IDs for this translation group
      const newLangMap: Record<string, number> = {};
      let hasAllTranslations = true;

      for (const [lang, id] of Object.entries(langMap)) {
        const newId = idMapping[lang]?.[id as number];

        if (newId) {
          newLangMap[lang] = newId;
        } else {
          hasAllTranslations = false;
          break;
        }
      }

      // If we have at least two languages in this group, count it as a successful connection
      if (hasAllTranslations && Object.keys(newLangMap).length >= 2) {
        translationConnectionsCount++;
        console.log(
          `  Translation group "${slug}" successfully connected via translation_of parameter`
        );
      }
    }
  }

  console.log(`  Total translation groups: ${translationConnectionsCount}`);

  // Clean up temp directory
  if (fs.existsSync(tempImageDir)) {
    fs.rmSync(tempImageDir, { recursive: true, force: true });
  }

  // Print statistics
  console.log("\n📊 Import Statistics:");

  console.log("\nCategories:");
  for (const [lang, counts] of Object.entries(stats.categories)) {
    const flag = getFlagEmoji(lang);
    console.log(
      `- ${flag} ${lang}: ${counts.created} created, ${counts.skipped} skipped, ${counts.failed} failed`
    );
  }

  console.log("\nTranslation Connections:");
  console.log(
    `- ${translationConnectionsCount} successfully connected via translation_of parameter`
  );

  console.log("\nImages:");
  console.log(`- ${stats.images.downloaded} downloaded`);
  console.log(`- ${stats.images.uploaded} uploaded`);
  console.log(`- ${stats.images.skipped} skipped`);
  console.log(`- ${stats.images.failed} failed`);
}

importCategories().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
