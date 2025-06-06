/**
 * Utility to filter import data based on a limit
 * This ensures we only import a specific number of items from the main language
 * and their corresponding translations in other languages
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
  
  // Create a set of slugs to import
  const selectedSlugs = new Set<string>();
  for (const item of limitedMainItems) {
    selectedSlugs.add(item.slug);
  }
  
  // Filter other languages to only include translations of selected items
  for (const lang of otherLanguages) {
    if (data[lang] && data[lang].length > 0) {
      filteredData[lang] = data[lang].filter(item => {
        // Check if this item is a translation of any selected main language item
        for (const [slug, langMap] of Object.entries(translations.wpml)) {
          if (selectedSlugs.has(slug) && langMap[lang] === item.id) {
            return true;
          }
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
