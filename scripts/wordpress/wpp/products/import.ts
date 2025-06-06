import fs from "fs";
import path from "path";
import chalk from "chalk";
import readline from "readline";
import fetch from "node-fetch";
import FormData from "form-data";
import config from "../config";
import { getImportSite, getExportSite } from "../utils/config-utils";
import { fetchJSON, getSiteName } from "../utils/api";
import { getFlagEmoji } from "../utils/language";
import { decodeSlug } from "../utils/formatting";
import { limitImportData } from "../utils/limit-imports";

// Create temp directories for images if they don't exist
const tempDir = path.join(__dirname, "../temp");
const tempImagesDir = path.join(config.outputDir, "temp_images");

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

if (!fs.existsSync(tempImagesDir)) {
  fs.mkdirSync(tempImagesDir, { recursive: true });
}

// Track image ID mappings
const imageMapping: Record<number, number> = {};

// Command line options
const forceImport = process.argv.includes("--force-import");
const downloadImages = process.argv.includes("--download-images");
const skipImageDownload = process.argv.includes("--skip-image-download");

// Import limit option
let importLimit: number | null = null;
const limitIndex = process.argv.indexOf("--limit");
if (limitIndex !== -1 && limitIndex < process.argv.length - 1) {
  const limitValue = parseInt(process.argv[limitIndex + 1]);
  if (!isNaN(limitValue) && limitValue > 0) {
    importLimit = limitValue;
  }
}

interface ExportData {
  meta: {
    exported_at: string;
    main_language: string;
    other_languages: string[];
    source_site?: string; // Optional source site name
  };
  translations: {
    wpml: Record<string, Record<string, number>>;
  };
  data: Record<string, any[]>;
}

interface ProductImage {
  id: number;
  src: string;
  name?: string;
  alt?: string;
}

interface WPErrorResponse {
  code?: string;
  message?: string;
  data?: any;
}

// Track imported products for reporting
const importStats = {
  total: 0,
  created: 0,
  skipped: 0,
  failed: 0,
  byLanguage: {} as Record<string, { total: number; created: number; skipped: number; failed: number }>,
  images: {
    downloaded: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0
  }
};

// Map of original IDs to new IDs for translation linking
const idMap: Record<string, Record<string, number>> = {};

async function importProducts(): Promise<void> {
  // Load the export data
  const inputFile = config.inputFile.replace("exported-categories.json", "exported-products.json");
  
  if (!fs.existsSync(inputFile)) {
    console.error(chalk.red(`Error: Product export file not found at ${inputFile}`));
    console.log(chalk.yellow("Please run the product export first."));
    process.exit(1);
  }
  
  console.log(chalk.cyan(`📂 Loading product data from: ${inputFile}`));
  
  const exportData: ExportData = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
  const { meta, translations, data } = exportData;
  
  // Get source and target site names
  const sourceSiteName = exportData.meta.source_site || "Unknown source site";
  const importSite = getImportSite();
  const targetSiteName = await getSiteName(importSite.baseUrl);
  
  console.log(chalk.cyan(`📊 Found ${Object.values(data).flat().length} products in ${Object.keys(data).length} languages`));
  
  // Apply import limit if specified
  let filteredData = data;
  if (importLimit && importLimit > 0) {
    filteredData = limitImportData(data, translations, meta.main_language, meta.other_languages, importLimit);
  }
  
  // Show clear import information and ask for confirmation
  console.log(chalk.yellow.bold(`\n⚠️ IMPORT CONFIRMATION`));
  console.log(chalk.yellow(`You are about to import products:`));
  console.log(chalk.yellow(`- FROM: ${chalk.white(sourceSiteName)} (export file)`));
  console.log(chalk.yellow(`- TO:   ${chalk.white.bgBlue(` ${targetSiteName} (${importSite.baseUrl}) `)}`));
  
  // Show image download settings
  if (skipImageDownload) {
    console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will NOT download images')} (using --skip-image-download)`));
  } else if (downloadImages) {
    console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will download ALL images')} (using --download-images)`));
  } else {
    console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will download only if not found locally')}`));
  }
  
  // Skip confirmation if force-import flag is set
  if (!process.argv.includes("--force-import")) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
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
  
  console.log(chalk.cyan(`🔄 Importing to: ${importSite.baseUrl} (${targetSiteName})`));
  
  // Get all languages
  const allLanguages = Object.keys(exportData.data);

  // Initialize stats for all languages
  for (const lang of allLanguages) {
    importStats.byLanguage[lang] = { total: 0, created: 0, skipped: 0, failed: 0 };
  }
  
  // First pass: Import all products without setting translations
  console.log(chalk.cyan("\n🔄 First pass: Importing products..."));
  
  // Import main language first
  const mainLang = meta.main_language;
  if (filteredData[mainLang] && filteredData[mainLang].length > 0) {
    console.log(chalk.cyan(`\n🌎 Importing ${filteredData[mainLang].length} products in main language: ${mainLang} ${getFlagEmoji(mainLang)}`));
    await importProductsForLanguage(filteredData[mainLang], mainLang, exportData);
  }
  
  // Then import other languages
  for (const lang of meta.other_languages) {
    if (filteredData[lang] && filteredData[lang].length > 0) {
      console.log(chalk.cyan(`\n🌎 Importing ${filteredData[lang].length} products in language: ${lang} ${getFlagEmoji(lang)}`));
      await importProductsForLanguage(filteredData[lang], lang, exportData);
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
  
  for (const [slug, langMap] of Object.entries(translations.wpml) as [string, Record<string, number>][]) {
    try {
      // Check if we have mapped IDs for at least two languages in this group
      const mappedLangs = Object.keys(langMap).filter(lang => 
        idMap[lang] && idMap[lang][langMap[lang]]
      );
      
      if (mappedLangs.length < 2) {
        // Not enough products were imported to create a translation relationship
        continue;
      }
      
      // Create a translation relationship
      const translationData: Record<string, number> = {};
      
      for (const lang of mappedLangs) {
        if (typeof lang === 'string' && langMap[lang] !== undefined) {
          const originalId = langMap[lang];
          if (idMap[lang] && idMap[lang][originalId] !== undefined) {
            const newId = idMap[lang][originalId];
            
            if (newId) {
              translationData[lang] = newId;
            }
          }
        }
      }
      
      if (Object.keys(translationData).length >= 2) {
        await createTranslationRelationship(translationData);
        translationsSucceeded++;
      }
      
      translationsProcessed++;
      
      // Show progress every 10 translation groups
      if (translationsProcessed % 10 === 0) {
        console.log(chalk.dim(`Processed ${translationsProcessed}/${translationGroups} translation groups...`));
      }
    } catch (error) {
      console.error(chalk.red(`Error setting up translation for group ${slug}:`), error);
      translationsFailed++;
    }
  }
  
  // Show final stats
  console.log(chalk.green.bold("\n✓ Import completed!"));
  console.log(chalk.cyan(`\n📊 Import Statistics:`));
  console.log(chalk.cyan(`Total products processed: ${importStats.total}`));
  console.log(chalk.green(`Products created: ${importStats.created}`));
  console.log(chalk.yellow(`Products skipped: ${importStats.skipped}`));
  
  if (importStats.failed > 0) {
    console.log(chalk.red(`Products failed: ${importStats.failed}`));
  }
  
  console.log(chalk.cyan(`\nBy language:`));
  for (const lang of allLanguages) {
    const stats = importStats.byLanguage[lang];
    if (stats.total > 0) {
      const flag = getFlagEmoji(lang);
      console.log(`${flag} ${lang}: ${stats.created} created, ${stats.skipped} skipped, ${stats.failed} failed (Total: ${stats.total})`);
    }
  }
  
  console.log(chalk.cyan(`\nTranslations:`));
  console.log(chalk.cyan(`Processed: ${translationsProcessed}`));
  console.log(chalk.green(`Succeeded: ${translationsSucceeded}`));
  
  if (translationsFailed > 0) {
    console.log(chalk.red(`Failed: ${translationsFailed}`));
  }
}

async function importProductsForLanguage(products: any[], lang: string, exportData: ExportData): Promise<void> {
  // Apply import limit if specified
  const productsToImport = importLimit ? products.slice(0, importLimit) : products;
  
  if (importLimit) {
    console.log(chalk.yellow(`Limiting import to ${importLimit} products (out of ${products.length} total)`));
  }
  
  let count = 0;
  
  for (const product of productsToImport) {
    try {
      count++;
      importStats.total++;
      importStats.byLanguage[lang].total++;
      
      // Show progress
      if (count % 10 === 0 || count === 1 || count === products.length) {
        console.log(chalk.dim(`Processing product ${count}/${products.length}...`));
      }
      
      // Check if product already exists by SKU or slug
      let existingProduct = null;
      
      if (product.sku) {
        existingProduct = await findProductBySku(product.sku, lang);
      }
      
      if (!existingProduct) {
        existingProduct = await findProductBySlug(product.slug, lang);
      }
      
      if (existingProduct && config.skipExisting) {
        // Skip this product
        console.log(chalk.yellow(`⏩ Skipping existing product: ${product.name} (ID: ${product.id})`));
        
        // Store the ID mapping for translation linking
        if (!idMap[lang]) idMap[lang] = {};
        idMap[lang][product.id] = existingProduct.id;
        
        importStats.skipped++;
        importStats.byLanguage[lang].skipped++;
        continue;
      }
      
      // Get the main language slug for image naming if this is a translation
      let mainLanguageSlug = product.slug;
      
      // If this is a translation, try to find the original product in the main language
      if (lang !== exportData.meta.main_language && product.translations) {
        const mainLangId = product.translations[exportData.meta.main_language];
        if (mainLangId) {
          // Find the main language product by ID
          const mainLangProduct = exportData.data[exportData.meta.main_language]?.find(
            (p) => p.id === mainLangId
          );
          if (mainLangProduct) {
            mainLanguageSlug = mainLangProduct.slug;
          }
        }
      }
      
      // Prepare product data for import
      const productData = await prepareProductData(product, lang, mainLanguageSlug);
      
      // Create or update the product
      const importedProduct = await createProduct(productData, lang);
      
      // Store the ID mapping for translation linking
      if (!idMap[lang]) idMap[lang] = {};
      idMap[lang][product.id] = importedProduct.id;
      
      console.log(chalk.green(`✓ Imported product: ${product.name} (ID: ${importedProduct.id})`));
      importStats.created++;
      importStats.byLanguage[lang].created++;
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(chalk.red(`✗ Failed to import product: ${product.name} (ID: ${product.id})`), error);
      importStats.failed++;
      importStats.byLanguage[lang].failed++;
    }
  }
}

async function prepareProductData(product: any, lang: string, mainLanguageSlug?: string): Promise<any> {
  // Create a clean copy of the product data
  const cleanProduct = { ...product };
  
  // Remove fields that shouldn't be sent to the API
  delete cleanProduct.id;
  delete cleanProduct._links;
  delete cleanProduct.lang;
  delete cleanProduct.translations;
  
  // Add language information
  cleanProduct.lang = lang;
  
  // Process images if present
  if (cleanProduct.images && Array.isArray(cleanProduct.images) && cleanProduct.images.length > 0) {
    const processedImages: {id: number}[] = [];
    
    for (const image of cleanProduct.images as ProductImage[]) {
      try {
        // Use product slug for image filename (from main language if available)
        const slugToUse = mainLanguageSlug || product.slug;
        const newImageId = await processImage(image, slugToUse);
        
        if (newImageId) {
          processedImages.push({ id: newImageId });
        }
      } catch (error) {
        console.error(`Error processing image for product ${product.name}:`, error);
      }
    }
    
    if (processedImages.length > 0) {
      cleanProduct.images = processedImages;
    }
  }
  
  return cleanProduct;
}

async function findProductBySku(sku: string, lang: string): Promise<any | null> {
  try {
    const importSite = getImportSite();
    const url = `${importSite.baseUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&lang=${lang}`;
    const products = await fetchJSON(url);
    
    return products.length > 0 ? products[0] : null;
  } catch (error) {
    return null;
  }
}

async function findProductBySlug(slug: string, lang: string): Promise<any | null> {
  try {
    const importSite = getImportSite();
    const url = `${importSite.baseUrl}/wp-json/wc/v3/products?slug=${encodeURIComponent(slug)}&lang=${lang}`;
    const products = await fetchJSON(url);
    
    return products.length > 0 ? products[0] : null;
  } catch (error) {
    return null;
  }
}

async function createProduct(productData: any, lang: string): Promise<any> {
  const importSite = getImportSite();
  const url = `${importSite.baseUrl}/wp-json/wc/v3/products?lang=${lang}`;
  
  return await fetchJSON(url, {
    method: "POST",
    body: JSON.stringify(productData)
  });
}

async function createTranslationRelationship(translationData: Record<string, number>): Promise<void> {
  const importSite = getImportSite();
  const url = `${importSite.baseUrl}/wp-json/wpml/v1/products/connect`;
  
  await fetchJSON(url, {
    method: "POST",
    body: JSON.stringify(translationData)
  });
}

/**
 * Download an image from a URL
 */
async function downloadImage(imageUrl: string, fileName: string): Promise<string> {
  try {
    // If --skip-image-download is set, don't download images
    if (skipImageDownload) {
      console.log(`  Skipping image download (--skip-image-download): ${fileName}`);
      return "";
    }
    
    // First check if the image already exists in temp_images directory
    const tempImagesPath = path.join(tempImagesDir, fileName);
    if (fs.existsSync(tempImagesPath)) {
      console.log(`  Image already exists in temp_images: ${fileName}`);
      return tempImagesPath;
    }
    
    // If not in temp_images and not using --download-images, skip download unless forced
    if (!downloadImages && !fs.existsSync(tempImagesPath)) {
      // Only download if explicitly requested or if no local copy exists
      console.log(`  Image not found locally, downloading: ${fileName}`);
    }
    
    // Create a file path in the temp directory
    const filePath = path.join(tempDir, fileName);
    
    // Try to download the image
    const response = await fetch(imageUrl, { timeout: 30000 });
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    // Get the image data
    const imageBuffer = await response.buffer();
    
    // Save the image to disk
    fs.writeFileSync(filePath, imageBuffer);
    
    return filePath;
  } catch (error) {
    console.error(`Error downloading image ${fileName}:`, error);
    throw error;
  }
}

/**
 * Upload an image to WordPress
 */
async function uploadImage(filePath: string, fileName: string): Promise<number> {
  try {
    console.log(`Uploading image: ${fileName}`);
    
    // Check if file exists and has content
    const stats = fs.statSync(filePath);
    if (stats.size < 100) { // Minimum reasonable size for an image
      throw new Error(`File is too small (${stats.size} bytes), likely not a valid image`);
    }
    
    // Get file extension and ensure it's valid
    let fileExt = path.extname(filePath).toLowerCase();
    
    // If extension is not valid, create a copy with .jpg extension
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(fileExt)) {
      const newFilePath = `${filePath}.jpg`;
      fs.copyFileSync(filePath, newFilePath);
      filePath = newFilePath;
      fileExt = '.jpg';
      console.log(`  Converted to .jpg format: ${path.basename(newFilePath)}`);
    }
    
    // Determine mime type based on extension
    let mimeType = "image/jpeg"; // Default
    if (fileExt === ".png") mimeType = "image/png";
    if (fileExt === ".gif") mimeType = "image/gif";
    if (fileExt === ".webp") mimeType = "image/webp";
    
    // Create form data
    const form = new FormData();
    // Use the provided filename or fallback to the path basename
    const uploadFilename = fileName || path.basename(filePath);
    form.append("file", fs.createReadStream(filePath), {
      filename: uploadFilename,
      contentType: mimeType
    });
    
    // Try to upload with a longer timeout
    const importSite = getImportSite();
    const response = await fetch(
      `${importSite.baseUrl}/wp-json/wp/v2/media`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${importSite.username}:${importSite.password}`
            ).toString("base64"),
          // Don't set Content-Type header - FormData will set it with the boundary
        },
        body: form,
        timeout: 60000, // 60 second timeout for larger files
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails: string | any = "";
      
      try {
        errorDetails = JSON.parse(errorText);
      } catch (e) {
        errorDetails = errorText;
      }
      
      // If we get a 500 error about file types, try alternative upload method
      if (response.status === 500 && 
          typeof errorDetails === 'object' && 
          errorDetails.message && 
          (errorDetails.message.includes("negalite įkelti tokio tipo failų") || 
           errorDetails.message.includes("cannot upload this file type"))) {
        console.log("  Trying alternative upload method...");
        return await uploadImageAlternative(filePath, fileName);
      }
      
      throw new Error(
        `Failed to upload image: ${response.status} ${response.statusText}\nDetails: ${JSON.stringify(
          errorDetails
        )}`
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
    const importSite = getImportSite();
    const response = await fetch(
      `${importSite.baseUrl}/wp-json/wp/v2/media`,
      {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          Authorization:
            "Basic " +
            Buffer.from(
              `${importSite.username}:${importSite.password}`
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
      let errorDetails: string | any = "";
      
      try {
        errorDetails = JSON.parse(errorText);
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
async function processImage(image: any, productSlug?: string): Promise<number | null> {
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
      importStats.images.skipped++;
      return imageMapping[image.id];
    }

    // Use product slug as the filename if provided, otherwise extract from URL
    let imageName = path.basename(image.src);
    const fileExtension = path.extname(imageName).toLowerCase();
    const nameWithoutExt = productSlug || path.basename(imageName, fileExtension);
    
    // Check for WebP version first
    const webpImagesDir = path.join(config.outputDir, "webp_images");
    const webpImagePath = path.join(webpImagesDir, `${nameWithoutExt}.webp`);
    
    // Check for regular version
    const regularImageName = productSlug ? `${productSlug}${fileExtension}` : imageName;
    const regularImagePath = path.join(tempImagesDir, regularImageName);
    
    let imageToUpload: string | null = null;
    let finalImageName = "";
    
    // First priority: Use WebP if available
    if (fs.existsSync(webpImagePath)) {
      console.log(`  Using WebP image: ${nameWithoutExt}.webp`);
      imageToUpload = webpImagePath;
      finalImageName = `${nameWithoutExt}.webp`;
    }
    // Second priority: Use regular image if available
    else if (fs.existsSync(regularImagePath)) {
      console.log(`  Using existing image: ${regularImageName}`);
      imageToUpload = regularImagePath;
      finalImageName = regularImageName;
    }
    // Third priority: Download if allowed
    else if (!skipImageDownload) {
      if (productSlug) {
        const decodedSlug = decodeSlug(productSlug);
        console.log(`  Downloading image for product: ${decodedSlug}`);
      } else {
        console.log(`  Downloading image: ${imageName}`);
      }
      
      // Download the image
      imageToUpload = await downloadImage(image.src, regularImageName);
      finalImageName = regularImageName;
      importStats.images.downloaded++;
    }
    // Skip if no image available and downloads not allowed
    else {
      console.log(`  Skipping image processing (--skip-image-download): ${regularImageName}`);
      importStats.images.skipped++;
      return null;
    }

    // Upload the image
    if (imageToUpload) {
      const newImageId = await uploadImage(imageToUpload, finalImageName);
      importStats.images.uploaded++;

      // Store the mapping
      if (image.id) {
        imageMapping[image.id] = newImageId;
      }

      return newImageId;
    }
    
    return null;
  } catch (error) {
    console.error("Error processing image:", error);
    importStats.images.failed++;
    return null;
  }
}

// Run the script
importProducts().catch(error => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
