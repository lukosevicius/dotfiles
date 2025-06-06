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

export async function deleteCategory(categoryId: number, lang: string): Promise<boolean> {
  try {
    // Force parameter ensures the category is deleted even if it has children
    const importSite = getImportSite();
    const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories/${categoryId}?force=true&lang=${lang}`;
    const response = await fetchJSON(url, { method: "DELETE" });

    console.log(
      chalk.green(`✓ Deleted category: ${response.name} (ID: ${response.id}, Lang: ${lang})`)
    );
    return true;
  } catch (error: any) {
    // Check if this is the default category which cannot be deleted
    if (error.message && typeof error.message === 'string') {
      // Check for default category error messages
      if (error.message.includes('term is shared') || 
          error.message.includes('default') || 
          (error.message.includes('HTTP 500') && error.message.includes('cannot_delete'))) {
        console.log(chalk.yellow(`⚠️ Skipping category ID ${categoryId} (Lang: ${lang}) - This is a default category that cannot be deleted`));
        // We return true here to indicate that we handled this case and should continue with other categories
        return true;
      }
      
      // Check for permission issues
      if (error.message.includes('permission') || error.message.includes('401') || error.message.includes('403')) {
        console.log(chalk.red(`✗ Permission denied when deleting category ID ${categoryId} (Lang: ${lang})`));
        return false;
      }
    }
    
    // Check the error response for more details
    if (error.response && typeof error.response === 'object') {
      const response = error.response;
      if (response.code === 'woocommerce_rest_cannot_delete' && response.message && response.message.includes('Default')) {
        console.log(chalk.yellow(`⚠️ Skipping category ID ${categoryId} (Lang: ${lang}) - This is a default category that cannot be deleted`));
        // We return true here to indicate that we handled this case and should continue with other categories
        return true;
      }
    }
    
    console.error(chalk.red(`✗ Failed to delete category ID ${categoryId} (Lang: ${lang}):`), error);
    return false;
  }
}

async function fetchAllCategories(): Promise<any[]> {
  let page = 1;
  let allCategories: any[] = [];
  let hasMorePages = true;
  
  console.log(chalk.cyan("Fetching all categories from all languages..."));
  
  // First try with lang=all parameter
  while (hasMorePages) {
    const importSite = getImportSite();
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
      console.error(chalk.red(`Error fetching categories page ${page}:`), error);
      hasMorePages = false;
    }
  }
  
  // If we didn't get any categories or very few, try fetching for each language separately
  if (allCategories.length < 5) {
    console.log(chalk.yellow(`Only found ${allCategories.length} categories with lang=all parameter. Trying individual languages...`));
    
    // Get languages from config or use defaults
    const languages = ['en', 'lt', 'ru']; // Default languages if not specified
    
    for (const lang of languages) {
      page = 1;
      hasMorePages = true;
      
      while (hasMorePages) {
        const importSite = getImportSite();
        const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories?per_page=100&page=${page}&lang=${lang}`;
        
        try {
          const categories = await fetchJSON(url);
          
          if (categories.length === 0) {
            hasMorePages = false;
          } else {
            // Add language info to each category
            const categoriesWithLang = categories.map((cat: any) => ({
              ...cat,
              lang
            }));
            
            // Check for duplicates before adding
            const newCategories = categoriesWithLang.filter((newCat: any) => 
              !allCategories.some((existingCat: any) => existingCat.id === newCat.id)
            );
            
            if (newCategories.length > 0) {
              allCategories = [...allCategories, ...newCategories];
              console.log(chalk.dim(`Fetched page ${page} for ${lang} (${newCategories.length} new categories)`));
            }
            page++;
          }
        } catch (error) {
          console.error(chalk.red(`Error fetching categories page ${page} for ${lang}:`), error);
          hasMorePages = false;
        }
      }
    }
  }
  
  // Log some details about the categories we found
  if (allCategories.length > 0) {
    console.log(chalk.green(`Found a total of ${allCategories.length} categories`));
    
    // Log the first few categories to help with debugging
    console.log(chalk.dim("Sample categories:"));
    for (let i = 0; i < Math.min(5, allCategories.length); i++) {
      const cat = allCategories[i];
      console.log(chalk.dim(`- ${cat.name} (ID: ${cat.id}, Lang: ${cat.lang || 'unknown'})`));
    }
  } else {
    console.log(chalk.yellow("No categories found. This could indicate an issue with the API or permissions."));
  }
  
  return allCategories;
}

export async function deleteAllCategories(): Promise<void> {
  try {
    // Statistics for deletion
    const stats = {
      total: 0,
      deleted: 0,
      failed: 0,
      byLanguage: {} as Record<string, { total: number; deleted: number; failed: number }>,
    };

    // Initialize stats for each language
    // Get languages from the export file or use defaults
    const languages = ['en', 'lt', 'ru']; // Default languages if not specified
    languages.forEach((lang) => {
      stats.byLanguage[lang] = { total: 0, deleted: 0, failed: 0 };
    });

    const importSite = getImportSite();
    console.log(chalk.cyan(`🔄 Deleting all product categories from ${importSite.baseUrl}...`));

    // Get all categories in all languages
    console.log(chalk.cyan("📋 Fetching category list..."));
    
    const allCategories = await fetchAllCategories();
    
    if (allCategories.length === 0) {
      console.log(chalk.yellow("No categories found to delete."));
      return;
    }

    console.log(chalk.yellow(`Found ${allCategories.length} categories to delete`));
    stats.total = allCategories.length;

    // Group categories by language
    const categoriesByLang: Record<string, CategoryData[]> = {};

    for (const category of allCategories) {
      const lang = category.lang || 'en'; // Default to English if language not specified

      // Ensure the language exists in both objects
      if (!categoriesByLang[lang]) {
        categoriesByLang[lang] = [];
      }

      // Make sure stats.byLanguage has an entry for this language
      if (!stats.byLanguage[lang]) {
        stats.byLanguage[lang] = { total: 0, deleted: 0, failed: 0 };
      }

      categoriesByLang[lang].push(category);
      stats.byLanguage[lang].total++;
    }

    // Display categories by language
    console.log(chalk.cyan("\nCategories by language:"));
    for (const [lang, categories] of Object.entries(categoriesByLang)) {
      const flag = getFlagEmoji(lang);
      console.log(`- ${flag} ${lang}: ${chalk.yellow(categories.length.toString())} categories`);
    }

    // Delete categories for each language in categoriesByLang
    for (const [lang, categories] of Object.entries(categoriesByLang)) {
      if (categories.length === 0) {
        console.log(chalk.dim(`No categories found for language: ${lang} ${getFlagEmoji(lang)}`));
        continue;
      }

      console.log(chalk.cyan(`\nDeleting categories for language: ${lang} ${getFlagEmoji(lang)}`));

      // Sort categories by ID in descending order to delete children before parents
      // This helps avoid dependency issues
      const sortedCategories = [...categoriesByLang[lang]].sort(
        (a, b) => b.id - a.id
      );

      let categoryCount = 0;
      let processedCount = 0;
      const totalCategories = sortedCategories.length;
      
      for (const category of sortedCategories) {
        categoryCount++;
        processedCount++;
        
        // Show progress every 5 categories or for the last one
        if (processedCount >= 5 || categoryCount === totalCategories) {
          console.log(chalk.dim(`Progress: ${categoryCount}/${totalCategories} categories`));
          processedCount = 0;
        }
        
        const success = await deleteCategory(category.id, lang);

        if (success) {
          stats.deleted++;
          stats.byLanguage[lang].deleted++;
        } else {
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
    
    if (stats.failed > 0) {
      console.log(chalk.red(`Failed to delete: ${stats.failed}`));
    }

    console.log(chalk.cyan(`\nBy language:`));
    for (const [lang, langStats] of Object.entries(stats.byLanguage)) {
      if (langStats.total > 0) {
        const flag = getFlagEmoji(lang);
        console.log(`${flag} ${lang}: ${langStats.deleted} deleted, ${langStats.failed} failed (Total: ${langStats.total})`);
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
    const siteName = await getSiteName(importSite.baseUrl);
    
    if (shouldConfirm) {
      console.log(chalk.red.bold(`⚠️ WARNING: This will delete ALL categories from: ${chalk.white.bgRed(` ${siteName} (${importSite.baseUrl}) `)}!`));
      console.log(chalk.yellow("Run with --confirm flag to skip this confirmation."));
      
      // Ask for explicit confirmation
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.red.bold('\nAre you sure you want to delete all categories? (y/n): '), resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== "y") {
        console.log(chalk.blue("Deletion cancelled."));
        return;
      }
    }
    
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
