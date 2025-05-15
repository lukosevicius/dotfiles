import fs from "fs";
import path from "path";
import chalk from "chalk";
import config from "../shared/config";
import { fetchJSON, getSiteName } from "../shared/utils/api";
import { getFlagEmoji } from "../shared/utils/language";

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

// Track imported products for reporting
const importStats = {
  total: 0,
  created: 0,
  skipped: 0,
  failed: 0,
  byLanguage: {} as Record<string, { total: number; created: number; skipped: number; failed: number }>,
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
  
  // Get site name
  const siteName = await getSiteName(config.importBaseUrl);
  
  console.log(chalk.cyan(`🔄 Importing to: ${config.importBaseUrl} (${siteName})`));
  console.log(chalk.cyan(`📊 Found ${Object.values(data).flat().length} products in ${Object.keys(data).length} languages`));
  
  // Initialize stats for each language
  const allLanguages = [meta.main_language, ...meta.other_languages];
  for (const lang of allLanguages) {
    importStats.byLanguage[lang] = { total: 0, created: 0, skipped: 0, failed: 0 };
  }
  
  // First pass: Import all products without setting translations
  console.log(chalk.cyan("\n🔄 First pass: Importing products..."));
  
  // Import main language first
  const mainLang = meta.main_language;
  if (data[mainLang] && data[mainLang].length > 0) {
    console.log(chalk.cyan(`\n🌐 Importing ${data[mainLang].length} products in main language: ${mainLang} ${getFlagEmoji(mainLang)}`));
    await importProductsForLanguage(data[mainLang], mainLang);
  }
  
  // Then import other languages
  for (const lang of meta.other_languages) {
    if (data[lang] && data[lang].length > 0) {
      console.log(chalk.cyan(`\n🌐 Importing ${data[lang].length} products in language: ${lang} ${getFlagEmoji(lang)}`));
      await importProductsForLanguage(data[lang], lang);
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
        const originalId = langMap[lang];
        const newId = idMap[lang][originalId];
        
        if (newId) {
          translationData[lang] = newId;
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

async function importProductsForLanguage(products: any[], lang: string): Promise<void> {
  let count = 0;
  
  for (const product of products) {
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
      
      // Prepare product data for import
      const productData = prepareProductData(product, lang);
      
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

function prepareProductData(product: any, lang: string): any {
  // Create a clean copy of the product data
  const cleanProduct = { ...product };
  
  // Remove fields that shouldn't be sent to the API
  delete cleanProduct.id;
  delete cleanProduct._links;
  delete cleanProduct.lang;
  delete cleanProduct.translations;
  
  // Add language information
  cleanProduct.lang = lang;
  
  return cleanProduct;
}

async function findProductBySku(sku: string, lang: string): Promise<any | null> {
  try {
    const url = `${config.importBaseUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&lang=${lang}`;
    const products = await fetchJSON(url);
    
    return products.length > 0 ? products[0] : null;
  } catch (error) {
    return null;
  }
}

async function findProductBySlug(slug: string, lang: string): Promise<any | null> {
  try {
    const url = `${config.importBaseUrl}/wp-json/wc/v3/products?slug=${encodeURIComponent(slug)}&lang=${lang}`;
    const products = await fetchJSON(url);
    
    return products.length > 0 ? products[0] : null;
  } catch (error) {
    return null;
  }
}

async function createProduct(productData: any, lang: string): Promise<any> {
  const url = `${config.importBaseUrl}/wp-json/wc/v3/products?lang=${lang}`;
  
  return await fetchJSON(url, {
    method: "POST",
    body: JSON.stringify(productData)
  });
}

async function createTranslationRelationship(translationData: Record<string, number>): Promise<void> {
  const url = `${config.importBaseUrl}/wp-json/wpml/v1/products/connect`;
  
  await fetchJSON(url, {
    method: "POST",
    body: JSON.stringify(translationData)
  });
}

// Run the script
importProducts().catch(error => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
