/**
 * Utility to filter import data based on a limit
 * This ensures we only import a specific number of items from the main language
 * and their corresponding translations in other languages
 * 
 * @file limit-imports.ts
 */
import chalk from "chalk";

/**
 * Filter import data to limit the number of items from the main language
 * and include only their translations in other languages
 */
export function limitImportData(
  data: Record<string, any[]>,
  translations: { wpml: Record<string, Record<string, number>> },
  mainLanguage: string,
  otherLanguages: string[],
  limit: number
): Record<string, any[]> {
  if (!limit || limit <= 0 || !data[mainLanguage] || data[mainLanguage].length === 0) {
    return data; // No limit or no main language data, return original data
  }

  // Create a copy of the data to modify
  const filteredData: Record<string, any[]> = {};
  
  // Get limited items from main language
  const limitedMainItems = data[mainLanguage].slice(0, limit);
  filteredData[mainLanguage] = limitedMainItems;
  
  // Create a set of IDs for the selected main language products
  const selectedMainIds = new Set<number>();
  const selectedMainSlugs = new Set<string>();
  
  // Store both IDs and slugs for matching
  for (const item of limitedMainItems) {
    selectedMainIds.add(item.id);
    selectedMainSlugs.add(item.slug);
  }
  
  // Create a map of translation IDs for each language
  const translationMap: Record<string, Set<number>> = {};
  
  // Initialize translation maps for each language
  for (const lang of otherLanguages) {
    translationMap[lang] = new Set<number>();
  }
  
  // First approach: Use direct translation mappings from WPML data
  for (const [slug, langMap] of Object.entries(translations.wpml)) {
    // Check if this is one of our selected products by matching slug
    if (selectedMainSlugs.has(slug)) {
      // Add all translations of this product to our map
      for (const lang of otherLanguages) {
        if (langMap[lang]) {
          translationMap[lang].add(langMap[lang]);
        }
      }
    }
  }
  
  // Second approach: Check if products in other languages have translations pointing to main language
  for (const lang of otherLanguages) {
    if (data[lang]) {
      for (const product of data[lang]) {
        // If this product has translations and one of them points to a selected main product
        if (product.translations && product.translations[mainLanguage] && 
            selectedMainIds.has(product.translations[mainLanguage])) {
          translationMap[lang].add(product.id);
        }
      }
    }
  }
  
  // Filter other languages to only include translations of selected items
  for (const lang of otherLanguages) {
    if (data[lang] && data[lang].length > 0) {
      // Filter products in this language to only include translations of our selected main products
      filteredData[lang] = data[lang].filter(item => {
        // Include if the product ID is in our translation map
        if (translationMap[lang].has(item.id)) {
          return true;
        }
        
        // Also include if this is a variation of a product in our translation map
        // This ensures all variations of translated variable products are included
        if (item.parent && translationMap[lang].has(item.parent)) {
          return true;
        }
        
        return false;
      });
    } else {
      filteredData[lang] = [];
    }
  }
  
  // Log what we're doing
  console.log(chalk.yellow(`Limiting import to ${limitedMainItems.length} items from main language and their translations`));
  
  // Log how many items we're importing per language
  for (const lang of [mainLanguage, ...otherLanguages]) {
    if (filteredData[lang]) {
      console.log(chalk.dim(`  - ${lang}: ${filteredData[lang].length} items`));
    }
  }
  
  return filteredData;
}
