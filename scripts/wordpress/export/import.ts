import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import FormData from "form-data";
import config from "./config";

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
  categories: Record<string, {
    created: number;
    skipped: number;
    failed: number;
  }>;
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
  const isImportUrl = url.includes(config.importBaseUrl);
  const username = isImportUrl ? config.importUsername : config.exportUsername;
  const password = isImportUrl ? config.importPassword : config.exportPassword;

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
 */
async function downloadImage(imageUrl: string, imageName: string): Promise<string> {
  // Ensure temp directory exists
  if (!fs.existsSync(tempImageDir)) {
    fs.mkdirSync(tempImageDir, { recursive: true });
  }
  
  const filePath = path.join(tempImageDir, imageName);
  
  try {
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.buffer();
    fs.writeFileSync(filePath, buffer);
    
    return filePath;
  } catch (error) {
    console.error(`Error downloading image ${imageUrl}:`, error);
    throw error;
  }
}

/**
 * Upload an image to WordPress and return the media ID
 */
async function uploadImage(filePath: string, fileName: string): Promise<number> {
  try {
    // Read the file as a buffer
    const fileBuffer = fs.readFileSync(filePath);
    
    // Create a Node.js compatible FormData object
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'application/octet-stream'
    });
    
    const response = await fetch(`${config.importBaseUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        Authorization: "Basic " + Buffer.from(`${config.importUsername}:${config.importPassword}`).toString("base64"),
        // Don't set Content-Type header - FormData will set it with the boundary
      },
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`Failed to upload image: ${response.status} ${response.statusText}`);
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
async function processImage(image: any, stats: ImportStats): Promise<number | null> {
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
    
    // Download the image
    console.log(`Downloading image: ${fileName}`);
    const filePath = await downloadImage(image.src, fileName);
    stats.images.downloaded++;
    
    // Upload the image to the target site
    console.log(`Uploading image: ${fileName}`);
    const newImageId = await uploadImage(filePath, fileName);
    stats.images.uploaded++;
    
    // Store the mapping
    imageMapping[image.id] = newImageId;
    
    return newImageId;
  } catch (error) {
    console.error(`Failed to process image:`, error);
    stats.images.failed++;
    return null;
  }
}

async function categoryExists(slug: string, lang: string): Promise<number | null> {
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
    }
  };

  // Read the export file
  console.log(`Reading export file: ${config.inputFile}`);
  const raw = fs.readFileSync(config.inputFile, "utf-8");
  const exportData: ExportData = JSON.parse(raw);

  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;

  // Get site name
  const siteName = await getSiteName(config.importBaseUrl);

  console.log(`🔄 Importing to: ${config.importBaseUrl} (${siteName})`);
  console.log(`Main language: ${mainLanguage}, Other languages: ${otherLanguages.join(", ")}`);

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
    process.stdout.write(`Processing "${category.name}" (${decodeSlug(category.slug)})... `);
    
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
        `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=${mainLanguage}`,
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
      console.log(`FAILED (${error instanceof Error ? error.message : String(error)})`);
      
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
      process.stdout.write(`Processing "${category.name}" (${decodeSlug(category.slug)})... `);
      
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
            `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=${lang}`,
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
            `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=${lang}`,
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
        console.log(`FAILED (${error instanceof Error ? error.message : String(error)})`);
        
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
            `${config.importBaseUrl}/wp-json/wc/v3/products/categories/${newId}?lang=${mainLanguage}`,
            {
              method: "PUT",
              body: JSON.stringify({
                parent: newParentId,
              }),
            }
          );
          
          console.log(`Updated parent for ${mainLanguage} category "${category.name}" (ID: ${newId}, Parent: ${newParentId})`);
        } catch (error) {
          console.error(`Failed to update parent for ${mainLanguage} category "${category.name}":`, error);
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
              `${config.importBaseUrl}/wp-json/wc/v3/products/categories/${newId}?lang=${lang}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  parent: newParentId,
                }),
              }
            );
            
            console.log(`Updated parent for ${lang} category "${category.name}" (ID: ${newId}, Parent: ${newParentId})`);
          } catch (error) {
            console.error(`Failed to update parent for ${lang} category "${category.name}":`, error);
          }
        }
      }
    }
  }

  // 4. Verify translation connections
  console.log("\nVerifying translation connections...");
  
  // For each translation group, ensure all translations are connected
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
      
      // If we have at least two languages in this group, connect them
      if (hasAllTranslations && Object.keys(newLangMap).length >= 2) {
        stats.translationConnections.attempted++;
        
        try {
          const tridResponse = await fetchJSON(
            `${config.importBaseUrl}/wp-json/wpml/v1/translate/set_translation`,
            {
              method: "POST",
              body: JSON.stringify({ translations: newLangMap }),
            }
          );
          console.log(`  Linked translation group ${slug} (TRID: ${tridResponse.trid})`);
          
          // Update statistics
          stats.translationConnections.succeeded++;
        } catch (error) {
          // Don't show anything for already connected translations
          
          // Update statistics
          stats.translationConnections.failed++;
        }
      }
    }
  }

  // Clean up temp directory
  if (fs.existsSync(tempImageDir)) {
    fs.rmSync(tempImageDir, { recursive: true, force: true });
  }

  // Print statistics
  console.log("\n📊 Import Statistics:");
  
  console.log("\nCategories:");
  for (const [lang, counts] of Object.entries(stats.categories)) {
    console.log(`- ${lang}: ${counts.created} created, ${counts.skipped} skipped, ${counts.failed} failed`);
  }
  
  console.log("\nTranslation Connections:");
  console.log(`- ${stats.translationConnections.attempted} attempted`);
  console.log(`- ${stats.translationConnections.succeeded} succeeded`);
  console.log(`- ${stats.translationConnections.failed} failed`);
  
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
