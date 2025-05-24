import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import readline from "readline";
import chalk from "chalk";
import config, { getImportSite } from "../config";
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

async function deleteCategory(categoryId: number, lang: string): Promise<boolean> {
  try {
    // Force parameter ensures the category is deleted even if it has children
    const importSite = getImportSite();
    const url = `${importSite.baseUrl}/wp-json/wc/v3/products/categories/${categoryId}?force=true&lang=${lang}`;
    const response = await fetchJSON(url, { method: "DELETE" });

    console.log(
      chalk.green(`✓ Deleted category: ${response.name} (ID: ${response.id}, Lang: ${lang})`)
    );
    return true;
  } catch (error) {
    console.error(chalk.red(`✗ Failed to delete category ID ${categoryId}:`), error);
    return false;
  }
}

async function fetchAllCategories(): Promise<any[]> {
  let page = 1;
  let allCategories: any[] = [];
  let hasMorePages = true;
  
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
  
  return allCategories;
}

async function deleteAllCategories(): Promise<void> {
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

    // Delete categories for each language
    for (const lang of languages) {
      if (!categoriesByLang[lang] || categoriesByLang[lang].length === 0) {
        continue;
      }

      console.log(chalk.cyan(`\nDeleting categories for language: ${lang} ${getFlagEmoji(lang)}`));

      // Sort categories by ID in descending order to delete children before parents
      // This helps avoid dependency issues
      const sortedCategories = [...categoriesByLang[lang]].sort(
        (a, b) => b.id - a.id
      );

      for (const category of sortedCategories) {
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
