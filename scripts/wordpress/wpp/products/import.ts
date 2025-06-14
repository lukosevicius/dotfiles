import fs from "fs";
import path from "path";
import chalk from "chalk";
import readline from "readline";
import fetch from "node-fetch";
import FormData from "form-data";
import { execSync } from "child_process";
import { DEFAULT_PATHS } from "../utils/constants";
import { getImportSite, getExportSite } from "../utils/config-utils";
import { fetchJSON, fetchAllPages, getSiteName } from "../utils/api";
import { getFlagEmoji } from "../utils/language";
import { decodeSlug } from "../utils/formatting";
import { limitImportData } from "../utils/limit-imports";

// Create temp directories for images if they don't exist
const tempDir = path.join(__dirname, "../temp");

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

// Legacy directories are only for reading, not creating

// Track image ID mappings
const imageMapping: Record<number, number> = {};

// Track category mappings (slug to ID)
const categoryMapping: Record<string, number> = {};
const categoryLanguageMapping: Record<string, Record<string, number>> = {}; // lang -> slug -> id

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

// Global translation statistics
let translationsSucceeded = 0;
let translationsFailed = 0;

// Map of original IDs to new IDs for translation linking
const idMap: Record<string, Record<number, number>> = {};

/**
 * Create a translation relationship between products using WPML's dedicated endpoint
 */
async function createProductTranslationRelationship(
  translationData: Record<string, number>,
  mainLanguage: string
): Promise<void> {
  try {
    const importSite = getImportSite();
    
    console.log(chalk.cyan("Connecting product translations:"));
    for (const [lang, id] of Object.entries(translationData)) {
      console.log(`  ${lang}: ${id}`);
    }
    
    console.log(chalk.dim("Using WPML product translations endpoint..."));
    
    if (!translationData[mainLanguage]) {
      console.log(chalk.yellow(`⚠️ Main language ${mainLanguage} ID not found in translation data. Cannot connect translations.`));
      return;
    }
    
    const mainLangId = translationData[mainLanguage];
    
    // Log translation connections in a more readable format - connect non-main languages to main language
    for (const [lang, id] of Object.entries(translationData)) {
      if (lang !== mainLanguage) {
        console.log(`  ${lang} (${id}) → ${mainLanguage} (${mainLangId})`);
      }
    }
    
    // Use WPML's translation endpoint for products
    console.log(chalk.dim(`Sending data to ${importSite.baseUrl}/wp-json/wpml/v1/product/translations`));
    console.log(chalk.dim(`Request body: ${JSON.stringify(translationData, null, 2)}`));
    
    try {
      const response = await fetchJSON(
        `${importSite.baseUrl}/wp-json/wpml/v1/product/translations`,
        {
          method: "POST",
          body: JSON.stringify(translationData),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      
      console.log(chalk.dim(`Response: ${JSON.stringify(response, null, 2)}`));
    } catch (apiError) {
      throw new Error(`WPML API error: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
    }
    
    console.log(chalk.green("✓ Successfully created product translation relationships"));
  } catch (error) {
    console.error(chalk.red("✗ Error creating product translation relationship:"), 
      error instanceof Error ? error.message : String(error));
    console.log(chalk.yellow("⚠️ Translation endpoint failed. Product translations will need to be set up manually."));
  }
}

async function importProducts(): Promise<void> {
  // Fetch all categories from the target site first to create the slug-to-ID mapping
  await fetchAllCategories();
  // Reset translation statistics
  translationsSucceeded = 0;
  translationsFailed = 0;
  
  // Command line options
  const forceImport = process.argv.includes("--force-import");
  const autoConfirm = process.argv.includes("--yes");
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
  
  // Import specific product by ID option
  let productId: string | null = null;
  const productIdIndex = process.argv.indexOf("--product-id");
  if (productIdIndex !== -1 && productIdIndex < process.argv.length - 1) {
    productId = process.argv[productIdIndex + 1];
    console.log(chalk.cyan(`🔍 Importing specific product with ID: ${productId}`));
  }
  
  // Options object for passing to functions
  const options = {
    forceImport,
    downloadImages,
    skipImageDownload,
    importLimit: importLimit || undefined,
    productId
  };
  // Get the export site URL to determine the site-specific directory
  const exportSite = getExportSite();
  const exportBaseUrl = exportSite.baseUrl;
  const siteDomain = exportBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const siteInputDir = path.join(DEFAULT_PATHS.outputDir, siteDomain);
  const siteInputFile = path.join(siteInputDir, DEFAULT_PATHS.productsFile);
  
  // Default input file path
  const defaultInputFile = path.join(DEFAULT_PATHS.outputDir, DEFAULT_PATHS.productsFile);

  // First check if the file exists in the site-specific directory
  if (fs.existsSync(siteInputFile)) {
    console.log(chalk.cyan(`📂 Loading product data from site-specific directory: ${siteInputFile}`));
    var exportData: ExportData = JSON.parse(fs.readFileSync(siteInputFile, "utf-8"));
  } 
  // Fall back to the default location if site-specific file doesn't exist
  else if (fs.existsSync(defaultInputFile)) {
    console.log(chalk.yellow(`⚠️ Site-specific export not found at ${siteInputFile}`));
    console.log(chalk.cyan(`📂 Loading product data from default location: ${defaultInputFile}`));
    var exportData: ExportData = JSON.parse(fs.readFileSync(defaultInputFile, "utf-8"));
  } 
  // If neither exists, exit with an error
  else {
    console.error(chalk.red(`Error: Product export file not found at ${siteInputFile} or ${defaultInputFile}`));
    console.log(chalk.yellow("Please run the product export first."));
    process.exit(1);
  }
  const { meta, translations, data } = exportData;
  
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
  const targetSiteName = await getSiteName(importSite.baseUrl);
  
  console.log(chalk.cyan(`📊 Found ${Object.values(data).flat().length} products in ${Object.keys(data).length} languages`));
  
  // Apply import limit or filter by product ID if specified
  let filteredData = data;
  
  if (options.productId) {
    // Filter data to only include the specified product ID and its translations
    filteredData = filterProductById(data, translations, options.productId);
    if (Object.values(filteredData).flat().length === 0) {
      console.error(chalk.red(`Error: Product with ID ${options.productId} not found in the export data`));
      process.exit(1);
    }
    console.log(chalk.cyan(`📊 Found ${Object.values(filteredData).flat().length} products (including translations) for ID: ${options.productId}`));
  } else if (importLimit && importLimit > 0) {
    filteredData = limitImportData(data, translations, meta.main_language, meta.other_languages, importLimit);
  }
  
  // Show clear import information and ask for confirmation
  console.log(chalk.yellow.bold(`\n⚠️ IMPORT CONFIRMATION`));
  console.log(chalk.yellow(`You are about to import products:`));
  console.log(chalk.yellow(`- FROM: ${chalk.white(sourceSiteName)} (${sourceDomain})`));
  console.log(chalk.yellow(`- EXPORTED: ${chalk.white(exportDate)}`));
  console.log(chalk.yellow(`- TO:   ${chalk.white.bgBlue(` ${targetSiteName} (${importSite.baseUrl}) `)}`));
  console.log(chalk.yellow(`- IMPORT DATE: ${chalk.white(new Date().toLocaleString())}`));
  
  // Show image download settings
  if (options.skipImageDownload) {
    console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will NOT download images')} (using --skip-image-download)`));
  } else if (options.downloadImages) {
    console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will download ALL images')} (using --download-images)`));
  } else {
    console.log(chalk.yellow(`- IMAGES: ${chalk.white('Will download only if not found locally')}`));
  }
  
  // Skip confirmation if force-import or yes flag is set
  if (!options.forceImport && !autoConfirm) {
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
    if (options.forceImport) {
      console.log(chalk.dim("Skipping confirmation due to --force-import flag."));
    } else if (autoConfirm) {
      console.log(chalk.dim("Skipping confirmation due to --yes flag."));
    }
  }
  
  console.log(chalk.cyan(`🔄 Importing to: ${importSite.baseUrl} (${targetSiteName})`));
  
  // Get all languages
  const allLanguages = Object.keys(exportData.data);

  // Initialize stats for all languages
  for (const lang of allLanguages) {
    importStats.byLanguage[lang] = { total: 0, created: 0, skipped: 0, failed: 0 };
  }

  // Import products in a single pass with translations
  console.log(chalk.cyan("\n🔄 Importing products with translations..."));

  // Import main language first to ensure translations can reference it
  const mainLang = meta.main_language;
  if (filteredData[mainLang] && filteredData[mainLang].length > 0) {
    console.log(chalk.cyan(`\n🌎 Importing ${filteredData[mainLang].length} products in main language: ${mainLang} ${getFlagEmoji(mainLang)}`));
    await importProductsForLanguage(filteredData[mainLang], mainLang, exportData, mainLang, options);
  }

  // Then import other languages with translation links
  for (const lang of meta.other_languages) {
    if (filteredData[lang] && filteredData[lang].length > 0) {
      console.log(chalk.cyan(`\n🌎 Importing ${filteredData[lang].length} products in language: ${lang} ${getFlagEmoji(lang)}`));
      await importProductsForLanguage(filteredData[lang], lang, exportData, mainLang, options);
    }
  }

  // Print translation statistics
  console.log(chalk.bold("\nTranslation Statistics:"));
  console.log(chalk.cyan(`- Products with translations assigned: ${translationsSucceeded}`));
  if (translationsFailed > 0) {
    console.log(chalk.red(`- Failed translation assignments: ${translationsFailed}`));
  }
  console.log(chalk.cyan(`\nTranslation method used:`));
  console.log(chalk.dim(`- Direct translation_of parameter during product creation`));
}

/**
 * Filter the import data to only include a specific product ID and its translations
 */
function filterProductById(
  data: Record<string, any[]>,
  translations: any,
  productId: string
): Record<string, any[]> {
  const result: Record<string, any[]> = {};
  let foundProduct: any = null;
  let foundLanguage: string | null = null;
  
  // First, find the product with the specified ID in any language
  for (const [lang, products] of Object.entries(data)) {
    const product = products.find(p => p.id.toString() === productId);
    if (product) {
      foundProduct = product;
      foundLanguage = lang;
      // Initialize the result with an empty array for this language
      result[lang] = [product];
      break;
    }
  }
  
  // If product not found, return empty result
  if (!foundProduct || !foundLanguage) {
    return result;
  }
  
  // Now find all translations of this product
  if (foundProduct.translations) {
    for (const [lang, translatedIdValue] of Object.entries(foundProduct.translations)) {
      if (lang !== foundLanguage && data[lang]) {
        // Ensure translatedId is converted to string for comparison
        const translatedId = String(translatedIdValue);
        const translatedProduct = data[lang].find(p => p.id.toString() === translatedId);
        if (translatedProduct) {
          // Initialize the result array for this language if it doesn't exist
          if (!result[lang]) {
            result[lang] = [];
          }
          result[lang].push(translatedProduct);
        }
      }
    }
  }
  
  return result;
}

/**
 * Import products for a specific language
 */
async function importProductsForLanguage(
  products: any[], 
  lang: string, 
  exportData: ExportData, 
  mainLanguage?: string,
  options?: {
    forceImport?: boolean;
    downloadImages?: boolean;
    skipImageDownload?: boolean;
    importLimit?: number | null;
    productId?: string | null;
  }
): Promise<void> {
  for (const product of products) {
    try {
      importStats.total++;
      importStats.byLanguage[lang].total++;
      console.log(chalk.cyan(`\nProcessing product: ${product.name} (ID: ${product.id})...`));
      
      // Check if product already exists by SKU or slug
      let existingProduct = null;
      
      if (product.sku) {
        existingProduct = await findProductBySku(product.sku, lang);
        if (existingProduct) {
          console.log(`  Found existing product with SKU: ${product.sku} (ID: ${existingProduct.id})`);
        }
      }
      
      if (!existingProduct && product.slug) {
        existingProduct = await findProductBySlug(product.slug, lang);
        if (existingProduct) {
          console.log(`  Found existing product with slug: ${product.slug} (ID: ${existingProduct.id})`);
        }
      }
      
      // Skip if product exists and skipExisting is true
      const skipExisting = true;
      if (existingProduct && skipExisting && !options?.forceImport) {
        // Check if this is a translation with the same slug as another language product
        let isTranslation = false;
        
        if (mainLanguage && lang !== mainLanguage && product.translations) {
          // This is a translation product, check if it's actually a different product than the one we found
          const mainLangId = product.translations[mainLanguage];
          if (mainLangId && idMap[mainLanguage] && idMap[mainLanguage][mainLangId]) {
            // This is a valid translation, don't skip it even if slug matches
            isTranslation = true;
            console.log(chalk.blue(`  Found product with same slug but in different language. Will create as translation.`));
          }
        }
        
        if (!isTranslation) {
          console.log(chalk.yellow(`  Skipping existing product: ${product.name} (ID: ${existingProduct.id})`));
          importStats.skipped++;
          importStats.byLanguage[lang].skipped++;
          
          // Store the ID mapping even for skipped products to ensure translations work
          if (!idMap[lang]) idMap[lang] = {};
          idMap[lang][product.id] = existingProduct.id;
          continue;
        }
      }
      
      // Get the main language slug for image naming if this is a translation
      let mainLanguageSlug = product.slug;
      let mainLangProductId = null;
      
      // If this is a translation, try to find the original product in the main language
      if (lang !== exportData.meta.main_language && product.translations) {
        const mainLangId = product.translations[exportData.meta.main_language];
        if (mainLangId) {
          // Find the main language product by ID
          const mainLangProduct = exportData.data[exportData.meta.main_language]?.find(
            (p: any) => p.id === mainLangId
          );
          if (mainLangProduct) {
            mainLanguageSlug = mainLangProduct.slug;
            mainLangProductId = mainLangId;
            console.log(chalk.cyan(`  Found main language product: ${mainLangProduct.name} (ID: ${mainLangId})`));
          }
        }
      }
      
      // Prepare product data for import
      const productData = await prepareProductData(product, lang, mainLanguageSlug, options);
      
      // If this is a translation and we have the main language ID mapping, set translation_of
      if (mainLanguage && lang !== mainLanguage && product.translations) {
        // Get the ID of the main language product from the translations field
        const mainLangId = product.translations[mainLanguage];
        
        if (mainLangId) {
          // Check if we have already imported this main language product
          if (idMap[mainLanguage] && idMap[mainLanguage][mainLangId]) {
            productData.translation_of = idMap[mainLanguage][mainLangId];
            console.log(chalk.cyan(`  Setting translation_of: ${productData.translation_of} (original ID: ${mainLangId})`));
            translationsSucceeded++;
          } else {
            console.log(chalk.yellow(`  ⚠️ Main language product ID ${mainLangId} not yet imported, cannot set translation_of`));
            translationsFailed++;
          }
        }
      }
      
      // Create or update the product
      const importedProduct = await createProduct(productData, lang);
      
      // Store the ID mapping for translation linking
      if (!idMap[lang]) idMap[lang] = {};
      idMap[lang][product.id] = importedProduct.id;
      
      // Log translation relationship if applicable
      if (productData.translation_of) {
        console.log(chalk.green(`  ✓ Set as translation of product ID: ${productData.translation_of}`));
      }
      
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

/**
 * Fetch all categories from the target site and create a mapping of slugs to IDs
 */
async function fetchAllCategories(): Promise<void> {
  const importSite = getImportSite();
  const languages = [importSite.mainLanguage, ...importSite.otherLanguages];
  
  console.log(chalk.cyan('Fetching all categories from target site to create slug-to-ID mapping...'));
  
  // Fetch categories for each language
  for (const lang of languages) {
    try {
      console.log(chalk.dim(`Fetching categories for language: ${lang}`));
      const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories?per_page=100&lang=${lang}`;
      const categories = await fetchAllPages(url);
      
      console.log(chalk.green(`✓ Found ${categories.length} categories for language: ${lang}`));
      
      // Initialize language mapping if not exists
      if (!categoryLanguageMapping[lang]) {
        categoryLanguageMapping[lang] = {};
      }
      
      // Store mapping of slug to ID for this language
      for (const category of categories) {
        categoryLanguageMapping[lang][category.slug] = category.id;
        
        // For main language, also store in the main mapping
        if (lang === importSite.mainLanguage) {
          categoryMapping[category.slug] = category.id;
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error fetching categories for language ${lang}:`), 
        error instanceof Error ? error.message : String(error));
    }
  }
  
  console.log(chalk.green(`✓ Created category mapping with ${Object.keys(categoryMapping).length} main language categories`));
}

/**
 * Map category IDs from export data to target site IDs using slugs
 */
function mapCategoriesBySlug(categories: any[], lang: string): any[] {
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return categories;
  }
  
  const mappedCategories = [];
  const langMapping = categoryLanguageMapping[lang] || {};
  
  // For each category in the product
  for (const category of categories) {
    // If we have the category slug
    if (category.slug) {
      // Try to find the category ID in the target site using the slug
      if (langMapping[category.slug]) {
        // Found a match by slug in the current language
        mappedCategories.push({
          id: langMapping[category.slug]
        });
        console.log(chalk.dim(`  Mapped category '${category.name || category.slug}' to ID: ${langMapping[category.slug]} (by slug)`));
      } else if (categoryMapping[category.slug]) {
        // Found a match in the main language
        mappedCategories.push({
          id: categoryMapping[category.slug]
        });
        console.log(chalk.dim(`  Mapped category '${category.name || category.slug}' to main language ID: ${categoryMapping[category.slug]} (by slug)`));
      } else {
        // No match found, log a warning and keep the original category
        console.log(chalk.yellow(`  ⚠️ Could not find matching category for '${category.name || category.slug}' in target site`));
        // Keep the original category data but remove the ID to avoid conflicts
        const cleanCategory = { ...category };
        delete cleanCategory.id;
        mappedCategories.push(cleanCategory);
      }
    } else if (category.id) {
      // No slug available, log a warning and keep the original category without ID
      console.log(chalk.yellow(`  ⚠️ Category with ID ${category.id} has no slug, cannot map properly`));
      // Keep the original category data but remove the ID to avoid conflicts
      const cleanCategory = { ...category };
      delete cleanCategory.id;
      mappedCategories.push(cleanCategory);
    }
  }
  
  return mappedCategories;
}

/**
 * Prepare product data for import by downloading images and formatting data
 */
async function prepareProductData(
  product: any, 
  lang: string, 
  mainLanguageSlug?: string,
  options?: {
    downloadImages?: boolean;
    skipImageDownload?: boolean;
  }
): Promise<any> {
  // Create a clean copy of the product data
  const cleanProduct = { ...product };
  
  // Remove fields that shouldn't be sent to the API
  delete cleanProduct.id;
  delete cleanProduct._links;
  delete cleanProduct.lang;
  delete cleanProduct.translations;
  
  // Add language information
  cleanProduct.lang = lang;
  
  // Map categories by slug instead of ID
  if (cleanProduct.categories && Array.isArray(cleanProduct.categories) && cleanProduct.categories.length > 0) {
    console.log(chalk.cyan(`Mapping ${cleanProduct.categories.length} categories for product '${cleanProduct.name}'`));
    cleanProduct.categories = mapCategoriesBySlug(cleanProduct.categories, lang);
  }
  
  // Process images if present
  if (cleanProduct.images && Array.isArray(cleanProduct.images) && cleanProduct.images.length > 0) {
    const processedImages: {id: number}[] = [];
    const mainLang = getExportSite().mainLanguage;
    
    // For non-default languages, check if we should reuse images from the default language
    if (lang !== mainLang && mainLanguageSlug && product.translations && product.translations[mainLang]) {
      // Try to find the main language product's images that have already been imported
      const mainLangId = product.translations[mainLang];
      if (mainLangId && idMap[mainLang] && idMap[mainLang][mainLangId]) {
        const importedMainLangId = idMap[mainLang][mainLangId];
        
        // Try to get the imported main language product to reuse its images
        try {
          const importedMainProduct = await fetchProduct(importedMainLangId, mainLang);
          if (importedMainProduct && importedMainProduct.images && importedMainProduct.images.length > 0) {
            console.log(chalk.cyan(`Reusing ${importedMainProduct.images.length} images from main language product ID: ${importedMainLangId}`));
            cleanProduct.images = importedMainProduct.images;
            return cleanProduct;
          }
        } catch (error) {
          console.log(chalk.yellow(`⚠️ Could not fetch main language product for image reuse: ${error instanceof Error ? error.message : String(error)}`));
          // Continue with normal image processing if we can't reuse
        }
      }
    }
    
    // Process images normally for main language or if reusing failed
    for (let i = 0; i < cleanProduct.images.length; i++) {
      try {
        const image = cleanProduct.images[i];
        // Use product slug for image filename (from main language if available)
        const slugToUse = mainLanguageSlug || product.slug;
        // Pass the image index for sequential numbering
        const newImageId = await processImage(image, slugToUse, i, options);
        
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
  const importSite = getImportSite();
  try {
    const response = await fetchJSON(`${importSite.baseUrl}/wp-json/wc/v3/products?slug=${slug}&lang=${lang}`);
    if (Array.isArray(response) && response.length > 0) {
      return response[0];
    }
    return null;
  } catch (error) {
    console.error(`Error finding product by slug ${slug}:`, error);
    return null;
  }
}

/**
 * Fetch a product by its ID
 */
async function fetchProduct(id: number, lang: string): Promise<any | null> {
  const importSite = getImportSite();
  try {
    return await fetchJSON(`${importSite.baseUrl}/wp-json/wc/v3/products/${id}?lang=${lang}`);
  } catch (error) {
    console.error(`Error fetching product ID ${id}:`, error);
    return null;
  }
}

async function createProduct(productData: any, lang: string): Promise<any> {
  const importSite = getImportSite();
  
  // IMPORTANT: For WPML, we need to specify the language in the URL query string only,
  // not in the request body. This is the same issue we fixed for categories.
  const url = `${importSite.baseUrl}/wp-json/wc/v3/products?lang=${lang}`;
  
  // Remove the lang parameter from the request body to avoid conflicts
  const cleanProductData = { ...productData };
  delete cleanProductData.lang;
  
  // Log translation relationship if applicable
  if (cleanProductData.translation_of) {
    console.log(chalk.cyan(`Setting translation_of: ${cleanProductData.translation_of} for product in ${lang}`));
  }
  
  console.log(`Creating product in language: ${lang}`);
  
  // Only log a portion of the product data to avoid console clutter
  const productDataPreview = { 
    ...cleanProductData,
    description: cleanProductData.description ? '(truncated)' : undefined,
    short_description: cleanProductData.short_description ? '(truncated)' : undefined
  };
  console.log(`Product data: ${JSON.stringify(productDataPreview, null, 2).substring(0, 300)}...`);
  
  try {
    const response = await fetchJSON(url, {
      method: "POST",
      body: JSON.stringify(cleanProductData),
      headers: {
        "Content-Type": "application/json"
      }
    });
    
    // Check if the response contains the expected translation data
    if (cleanProductData.translation_of && response.id) {
      console.log(chalk.green(`✓ Product created with ID ${response.id} as translation of ${cleanProductData.translation_of}`));
      
      // Verify translation relationship was set
      if (response.translations) {
        console.log(chalk.green(`✓ Translation data in response: ${JSON.stringify(response.translations)}`));
      } else {
        console.log(chalk.yellow(`⚠️ No translation data in response. May need second pass to link.`));
      }
    }
    
    return response;
  } catch (error) {
    console.error(chalk.red(`✗ Error creating product: ${error instanceof Error ? error.message : String(error)}`));
    throw error;
  }
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
async function downloadImage(imageUrl: string, fileName: string, options?: {
  downloadImages?: boolean;
  skipImageDownload?: boolean;
}): Promise<string> {
  try {
    // If --skip-image-download is set, don't download images
    if (options?.skipImageDownload) {
      console.log(`  Skipping image download (--skip-image-download): ${fileName}`);
      return "";
    }
    
    // First check if the image exists in site-specific temp_images directory
    const siteLocalImagePath = path.join(siteTempImagesDir, fileName);
    if (fs.existsSync(siteLocalImagePath)) {
      console.log(`  Image already exists in site-specific directory: ${fileName}`);
      return siteLocalImagePath;
    }

    // Check if image exists in legacy temp_images directory as fallback
    const legacyLocalImagePath = path.join(legacyTempImagesDir, fileName);
    if (fs.existsSync(legacyLocalImagePath)) {
      console.log(`  Image found in legacy directory: ${fileName}`);
      return legacyLocalImagePath;
    }
    
    // If not found in either directory and not using --download-images, skip download unless forced
    if (!options?.downloadImages) {
      // Only download if explicitly requested or if no local copy exists
      console.log(`  Image not found locally, downloading: ${fileName}`);
    }
    
    // Create a file path in the site-specific temp_images directory
    const filePath = path.join(siteTempImagesDir, fileName);
    
    // Try to download the image
    const response = await fetch(imageUrl, { timeout: 30000 });
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    // Get the image data
    const imageBuffer = await response.buffer();
    
    // Save the image to the site-specific directory
    fs.writeFileSync(filePath, imageBuffer);
    console.log(`  Image downloaded successfully to site-specific directory: ${fileName}`);
    
    // Automatically convert to WebP if it's a supported image format
    const fileExtension = path.extname(fileName).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif'].includes(fileExtension)) {
      try {
        const nameWithoutExt = path.basename(fileName, fileExtension);
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
          return filePath;
        }
        
        // Convert to WebP using cwebp
        console.log(`  Converting to WebP: ${fileName}`);
        execSync(`cwebp -q 80 "${filePath}" -o "${webpOutputPath}"`, { stdio: 'ignore' });
        
        if (fs.existsSync(webpOutputPath)) {
          console.log(`  WebP conversion successful: ${nameWithoutExt}.webp`);
        }
      } catch (conversionError) {
        console.log(`  WebP conversion failed: ${conversionError instanceof Error ? conversionError.message : String(conversionError)}`);
      }
    }
    
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
 * @param image - The image object to process
 * @param productSlug - The slug of the product
 * @param imageIndex - The index of the image in the product's image array (for numbering)
 * @param options - Options for image processing
 */
async function processImage(
  image: any, 
  productSlug?: string, 
  imageIndex: number = 0,
  options?: {
    downloadImages?: boolean;
    skipImageDownload?: boolean;
  }
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
      importStats.images.skipped++;
      return imageMapping[image.id];
    }

    // Use product slug as the filename if provided, otherwise extract from URL
    let imageName = path.basename(image.src);
    const fileExtension = path.extname(imageName).toLowerCase();
    
    // Sanitize the slug for consistent naming with categories
    let sanitizedSlug = "";
    if (productSlug) {
      // Create a sanitized slug-based filename to avoid special characters issues
      sanitizedSlug = productSlug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      
      // Add sequential number for multiple images with v prefix (image.webp, image-v2.webp, image-v3.webp, etc.)
      // Only add version number if it's not the first image (index > 0)
      if (imageIndex > 0) {
        sanitizedSlug = `${sanitizedSlug}-v${imageIndex + 1}`;
      }
    }
    
    // Use sanitized slug or original name without extension
    const nameWithoutExt = productSlug ? 
      sanitizedSlug : 
      path.basename(imageName, fileExtension);
    
    // Check for WebP version in site-specific directory first
    const siteWebpImagePath = path.join(siteWebpImagesDir, `${nameWithoutExt}.webp`);
    
    // Check for WebP version in legacy directory as fallback
    const legacyWebpImagePath = path.join(legacyWebpImagesDir, `${nameWithoutExt}.webp`);
    
    // Define the regular image name with sanitized slug
    const regularImageName = productSlug ? 
      `${sanitizedSlug}${fileExtension}` : 
      imageName;
    
    // Check for regular version in site-specific directory first
    const siteRegularImagePath = path.join(siteTempImagesDir, regularImageName);
    
    // Check for regular version in legacy directory as fallback
    const legacyRegularImagePath = path.join(legacyTempImagesDir, regularImageName);
    
    let imageToUpload: string | null = null;
    let finalImageName = "";
    
    // First priority: Use WebP in site-specific directory if available
    if (fs.existsSync(siteWebpImagePath)) {
      console.log(`  Using site-specific WebP image: ${path.basename(siteWebpImagePath)}`);
      imageToUpload = siteWebpImagePath;
      finalImageName = path.basename(siteWebpImagePath);
    }
    // Second priority: Use WebP in legacy directory if available
    else if (fs.existsSync(legacyWebpImagePath)) {
      console.log(`  Using legacy WebP image: ${path.basename(legacyWebpImagePath)}`);
      imageToUpload = legacyWebpImagePath;
      finalImageName = path.basename(legacyWebpImagePath);
    }
    // Third priority: Use regular image in site-specific directory if available
    else if (fs.existsSync(siteRegularImagePath)) {
      console.log(`  Using site-specific regular image: ${regularImageName}`);
      imageToUpload = siteRegularImagePath;
      finalImageName = regularImageName;
    }
    // Fourth priority: Use regular image in legacy directory if available
    else if (fs.existsSync(legacyRegularImagePath)) {
      console.log(`  Using legacy regular image: ${regularImageName}`);
      imageToUpload = legacyRegularImagePath;
      finalImageName = regularImageName;
    }
    // Fifth priority: Download if allowed
    else if (!options?.skipImageDownload) {
      if (productSlug) {
        console.log(`  Downloading image for product: ${productSlug}`);
      } else {
        console.log(`  Downloading image: ${imageName}`);
      }
      
      // Download the image with proper naming
      const downloadName = productSlug ? regularImageName : imageName;
      imageToUpload = await downloadImage(image.src, downloadName, options);
      finalImageName = downloadName;
    }
    // Skip if no image available and downloads not allowed
    else {
      console.log(`  Skipping image download (--skip-image-download): ${imageName}`);
      return null;
    }

    // If image is already downloaded, use it
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

