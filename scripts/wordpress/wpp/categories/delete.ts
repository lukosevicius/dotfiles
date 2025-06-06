import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import readline from "readline";
import chalk from "chalk";
import config from "../config";
import { getImportSite } from "../utils/config-utils";
import { getFlagEmoji } from "../utils/language";
import { fetchJSON, getSiteName } from "../utils/api";

// Check if --confirm flag is provided
const shouldConfirm = !process.argv.includes("--confirm");

interface CategoryData {
  id: number;
  name: string;
  slug: string;
  lang?: string;
}

/**
 * Delete a single category by ID and language
 * @param categoryId - The ID of the category to delete
 * @param lang - The language code of the category
 * @returns true if deleted successfully, 'default' if skipped due to being a default category, false if failed
 */
export async function deleteCategory(categoryId: number, lang: string): Promise<boolean | 'default'> {
  const importSite = getImportSite();
  try {
    // First try to get the category details to show better error messages
    try {
      const detailsUrl = `${importSite.baseUrl}/wp-json/wc/v3/products/categories/${categoryId}?lang=${lang}`;
      const categoryDetails = await fetchJSON(detailsUrl);
      
      // Check if this is a default category based on metadata or slug
      if (categoryDetails.slug === 'uncategorized' || 
          categoryDetails.slug === 'uncategorised' || 
          categoryDetails.slug === 'default' ||
          (categoryDetails.meta && categoryDetails.meta.is_default)) {
        console.log(chalk.yellow(`⚠️ Skipping default category: ${categoryDetails.name} (ID: ${categoryId}, Lang: ${lang})`));
        return 'default';
      }
    } catch (detailsError) {
      // Silently continue if we can't get details - we'll try to delete anyway
    }
    
    // Proceed with deletion
    const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories/${categoryId}?force=true&lang=${lang}`;
    const response = await fetchJSON(url, { method: "DELETE" });
    console.log(chalk.green(`✓ Deleted category: ${response.name} (ID: ${response.id}, Lang: ${lang})`));
    return true;
  } catch (error: any) {
    // Handle specific error cases
    if (error.message && typeof error.message === 'string') {
      const errorMsg = error.message.toLowerCase();
      
      // Default category detection
      if (errorMsg.includes('term is shared') || 
          errorMsg.includes('default') || 
          errorMsg.includes('uncategorized') || 
          errorMsg.includes('uncategorised') || 
          (errorMsg.includes('http 500') && errorMsg.includes('cannot_delete'))) {
        console.log(chalk.yellow(`⚠️ Skipping category ID ${categoryId} (Lang: ${lang}) - This appears to be a default category that cannot be deleted`));
        return 'default';
      }
      
      // Permission issues
      if (errorMsg.includes('permission') || errorMsg.includes('401') || errorMsg.includes('403')) {
        console.log(chalk.red(`✗ Permission denied when deleting category ID ${categoryId} (Lang: ${lang})`));
        return false;
      }
      
      // Category not found
      if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        console.log(chalk.yellow(`⚠️ Category ID ${categoryId} (Lang: ${lang}) not found - may have been already deleted`));
        return true;
      }
    }
    
    console.error(chalk.red(`✗ Failed to delete category ID ${categoryId} (Lang: ${lang}):`), error);
    return false;
  }
}

/**
 * Fetch all categories from all languages
 */
async function fetchAllCategories(): Promise<any[]> {
  let page = 1;
  let allCategories: any[] = [];
  let hasMorePages = true;
  const importSite = getImportSite();
  
  console.log(chalk.cyan("Fetching all categories from all languages..."));
  
  // First try with lang=all parameter which should get all categories across languages
  while (hasMorePages) {
    const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories?per_page=100&page=${page}&lang=all`;
    
    try {
      const categories = await fetchJSON(url);
      
      if (categories.length === 0) {
        hasMorePages = false;
      } else {
        allCategories = [...allCategories, ...categories];
        console.log(chalk.dim(`Fetched page ${page} (${categories.length} categories)`));
        page++;
      }
    } catch (error) {
      console.error(chalk.red(`Error fetching categories with lang=all parameter:`), error);
      console.log(chalk.yellow("Falling back to fetching categories by individual languages..."));
      hasMorePages = false;
    }
  }
  
  // Try to detect available languages from the site
  let availableLanguages: string[] = [];
  
  try {
    // Try to get languages from WPML API
    const wpmlUrl = `${importSite.baseUrl}/wp-json/wpml/v1/active_languages`;
    try {
      const wpmlResponse = await fetchJSON(wpmlUrl);
      if (Array.isArray(wpmlResponse)) {
        availableLanguages = wpmlResponse.map((lang: any) => lang.code || lang.slug || lang);
        console.log(chalk.green(`✓ Detected languages from WPML API: ${availableLanguages.join(', ')}`));
      }
    } catch (wpmlError) {
      // Try Polylang API
      try {
        const polylangUrl = `${importSite.baseUrl}/wp-json/pll/v1/languages`;
        const polylangResponse = await fetchJSON(polylangUrl);
        if (Array.isArray(polylangResponse)) {
          availableLanguages = polylangResponse.map((lang: any) => lang.slug || lang.code || lang);
          console.log(chalk.green(`✓ Detected languages from Polylang API: ${availableLanguages.join(', ')}`));
        }
      } catch (polylangError) {
        // Fallback to default languages
        availableLanguages = ['en', 'lt', 'ru', 'lv', 'de'];
        console.log(chalk.yellow(`Could not detect languages from API. Using defaults: ${availableLanguages.join(', ')}`));
      }
    }
  } catch (error) {
    // Fallback to default languages
    availableLanguages = ['en', 'lt', 'ru', 'lv', 'de'];
    console.log(chalk.yellow(`Could not detect languages from API. Using defaults: ${availableLanguages.join(', ')}`));
  }
  
  // If we didn't get enough categories with lang=all, try fetching for each language separately
  if (allCategories.length < 5) {
    console.log(chalk.yellow(`Only found ${allCategories.length} categories with lang=all parameter. Trying individual languages...`));
    
    for (const lang of availableLanguages) {
      page = 1;
      hasMorePages = true;
      
      while (hasMorePages) {
        const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories?per_page=100&page=${page}&lang=${lang}`;
        
        try {
          const categories = await fetchJSON(url);
          
          if (categories.length === 0) {
            hasMorePages = false;
          } else {
            // Add language info to each category
            const categoriesWithLang = categories.map((cat: any) => ({ ...cat, lang }));
            
            // Check for duplicates before adding
            const newCategories = categoriesWithLang.filter(
              (newCat: any) => !allCategories.some((existingCat: any) => existingCat.id === newCat.id)
            );
            
            allCategories = [...allCategories, ...newCategories];
            console.log(chalk.dim(`Fetched page ${page} for ${lang} (${categories.length} categories, ${newCategories.length} new)`));
            page++;
          }
        } catch (error) {
          console.log(chalk.yellow(`Could not fetch categories for language ${lang}. Skipping.`));
          hasMorePages = false;
        }
      }
    }
  }
  
  // If we still don't have language info for some categories, try to infer it
  const categoriesWithoutLang = allCategories.filter(cat => !cat.lang);
  if (categoriesWithoutLang.length > 0) {
    console.log(chalk.yellow(`Found ${categoriesWithoutLang.length} categories without language info. Trying to infer language...`));
    
    // Try to get language info from the API
    for (const cat of categoriesWithoutLang) {
      try {
        const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories/${cat.id}`;
        const detailedCat = await fetchJSON(url);
        
        if (detailedCat && detailedCat.lang) {
          // Update the category in our array
          const index = allCategories.findIndex(c => c.id === cat.id);
          if (index !== -1) {
            allCategories[index].lang = detailedCat.lang;
            console.log(chalk.dim(`Inferred language ${detailedCat.lang} for category ${cat.name} (ID: ${cat.id})`));
          }
        }
      } catch (error) {
        // Silent fail - we'll handle these in the next step
      }
    }
  }
  
  // For any remaining categories without language, assign a default
  const stillWithoutLang = allCategories.filter(cat => !cat.lang);
  if (stillWithoutLang.length > 0) {
    console.log(chalk.yellow(`Still have ${stillWithoutLang.length} categories without language info. Assigning default language 'en'...`));
    
    for (const cat of stillWithoutLang) {
      const index = allCategories.findIndex(c => c.id === cat.id);
      if (index !== -1) {
        allCategories[index].lang = 'en';
      }
    }
  }
  
  console.log(chalk.green(`✓ Successfully fetched ${allCategories.length} categories across ${availableLanguages.length} languages`));
  return allCategories;
}

export async function deleteAllCategories(): Promise<void> {
  try {
    // Fetch all categories from all languages
    const allCategories = await fetchAllCategories();
    
    if (allCategories.length === 0) {
      console.log(chalk.yellow("No categories found to delete. Exiting."));
      return;
    }
    
    console.log(chalk.cyan(`\nFound ${allCategories.length} categories to process`));
    
    // Statistics for deletion
    const stats = {
      total: allCategories.length,
      deleted: 0,
      failed: 0,
      skipped: 0,
      byLanguage: {} as Record<string, { total: number; deleted: number; failed: number; skipped: number }>
    };
    
    // Group categories by language
    const categoriesByLang: Record<string, CategoryData[]> = {};
    const detectedLanguages = new Set<string>();
    
    for (const category of allCategories) {
      const lang = category.lang || 'en'; // Default to 'en' if no language specified
      detectedLanguages.add(lang);
      
      if (!categoriesByLang[lang]) {
        categoriesByLang[lang] = [];
      }
      
      categoriesByLang[lang].push({
        id: category.id,
        name: category.name,
        slug: category.slug,
        lang
      });
    }
    
    // Initialize stats for each language
    for (const lang of detectedLanguages) {
      stats.byLanguage[lang] = {
        total: categoriesByLang[lang]?.length || 0,
        deleted: 0,
        failed: 0,
        skipped: 0
      };
    }
    
    console.log(chalk.cyan("\nCategories by language:"));
    for (const [lang, langCategories] of Object.entries(categoriesByLang)) {
      const flag = getFlagEmoji(lang);
      console.log(`- ${flag} ${lang}: ${chalk.yellow(langCategories.length.toString())} categories`);
    }

    // Delete categories for each language in categoriesByLang
    for (const lang of Array.from(detectedLanguages).sort()) {
      const langCategories = categoriesByLang[lang] || [];
      
      if (langCategories.length === 0) {
        console.log(chalk.dim(`No categories found for language: ${lang} ${getFlagEmoji(lang)}`));
        continue;
      }

      console.log(chalk.cyan(`\nDeleting categories for language: ${lang} ${getFlagEmoji(lang)}`));

      // Sort categories by ID in descending order to delete children before parents
      // This helps avoid dependency issues
      const sortedCategories = [...langCategories].sort((a, b) => b.id - a.id);

      let categoryCount = 0;
      let processedCount = 0;
      let batchCount = 0;
      const totalCategories = sortedCategories.length;
      const batchSize = 10; // Show progress every 10 categories
      
      for (const category of sortedCategories) {
        categoryCount++;
        processedCount++;
        
        // Show progress at regular intervals or for the last one
        if (processedCount >= batchSize || categoryCount === totalCategories) {
          batchCount++;
          const percentComplete = Math.floor((categoryCount / totalCategories) * 100);
          console.log(chalk.dim(`Batch ${batchCount}: Progress ${categoryCount}/${totalCategories} categories (${percentComplete}%)`));
          processedCount = 0;
        }
        
        try {
          const result = await deleteCategory(category.id, lang);

          if (result === true) {
            // Successfully deleted
            stats.deleted++;
            stats.byLanguage[lang].deleted++;
          } else if (result === 'default') {
            // Default category that was skipped
            stats.skipped++;
            stats.byLanguage[lang].skipped++;
          } else {
            // Failed to delete
            stats.failed++;
            stats.byLanguage[lang].failed++;
          }
        } catch (error) {
          console.error(chalk.red(`Error deleting category ${category.name} (ID: ${category.id}, Lang: ${lang}):`), error);
          stats.failed++;
          stats.byLanguage[lang].failed++;
        }
        
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log(chalk.green(`Completed processing ${totalCategories} categories for language: ${lang} ${getFlagEmoji(lang)}`));
    }

    // Print deletion statistics
    console.log(chalk.green.bold(`\n✓ Deletion complete!`));
    console.log(chalk.cyan(`Total categories processed: ${stats.total}`));
    console.log(chalk.green(`Successfully deleted: ${stats.deleted}`));
    
    if (stats.skipped > 0) {
      console.log(chalk.yellow(`Categories skipped: ${stats.skipped}`));
    }
    
    if (stats.failed > 0) {
      console.log(chalk.red(`Failed to delete: ${stats.failed}`));
    }

    console.log(chalk.cyan(`\nBy language:`));
    for (const lang of Array.from(detectedLanguages).sort()) {
      const langStats = stats.byLanguage[lang];
      if (langStats && langStats.total > 0) {
        const flag = getFlagEmoji(lang);
        console.log(`${flag} ${lang}: ${langStats.deleted} deleted, ${langStats.skipped} skipped, ${langStats.failed} failed (Total: ${langStats.total})`);
      }
    }
  } catch (error) {
    console.error(chalk.red.bold("✗ Error during category deletion:"), error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Get site name first
  const importSite = getImportSite();
  console.log(chalk.cyan(`🔄 Connecting to: ${importSite.baseUrl}`));
  
  try {
    // Skip the confirmation prompt entirely since it's already handled in wpp.ts
    // The --confirm flag is passed from wpp.ts when confirmation is already given
    await deleteAllCategories();
  } catch (error) {
    console.error(chalk.red.bold("✗ Deletion process failed:"), error);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error(chalk.red.bold("✗ Fatal error:"), error);
  process.exit(1);
});
