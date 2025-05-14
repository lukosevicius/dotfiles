import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import config from "./config";

interface CategoryData {
  id: number;
  name: string;
  slug: string;
  lang?: string;
}

async function fetchJSON(url: string, options: any = {}): Promise<any> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      Authorization:
        "Basic " +
        Buffer.from(`${config.importUsername}:${config.importPassword}`).toString("base64"),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} - ${url}\n${text}`);
  }
  return await res.json();
}

async function fetchAllPages(baseUrl: string): Promise<any[]> {
  let page = 1;
  let allData: any[] = [];
  let hasMorePages = true;

  console.log(`Fetching data from ${baseUrl}`);

  while (hasMorePages) {
    const url = `${baseUrl}&page=${page}&per_page=${config.perPage}`;
    console.log(`Fetching page ${page}...`);

    const data = await fetchJSON(url);

    if (data.length === 0) {
      hasMorePages = false;
    } else {
      allData = [...allData, ...data];
      page++;
    }
  }

  return allData;
}

/**
 * Get flag emoji for language code
 */
function getFlagEmoji(langCode: string): string {
  const flagMap: Record<string, string> = {
    'lt': '🇱🇹', // Lithuania
    'en': '🇬🇧', // United Kingdom
    'lv': '🇱🇻', // Latvia
    'ru': '🇷🇺', // Russia
    'de': '🇩🇪', // Germany
    // Add more as needed
  };
  
  return flagMap[langCode] || '';
}

async function deleteCategory(categoryId: number, lang: string): Promise<boolean> {
  try {
    // Force parameter ensures the category is deleted even if it has children
    const url = `${config.importBaseUrl}/wp-json/wc/v3/products/categories/${categoryId}?force=true&lang=${lang}`;
    const response = await fetchJSON(url, { method: "DELETE" });
    
    console.log(`✅ Deleted category: ${response.name} (ID: ${response.id}, Lang: ${lang})`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to delete category ID ${categoryId}:`, error);
    return false;
  }
}

async function deleteAllCategories(): Promise<void> {
  // Statistics for deletion
  const stats = {
    total: 0,
    deleted: 0,
    failed: 0,
    byLanguage: {} as Record<string, { total: number, deleted: number, failed: number }>
  };
  
  // Initialize stats for each language
  const languages = [config.mainLanguage, ...config.otherLanguages];
  languages.forEach(lang => {
    stats.byLanguage[lang] = { total: 0, deleted: 0, failed: 0 };
  });
  
  console.log(`Deleting all product categories from ${config.importBaseUrl}...`);
  
  // Get all categories in all languages
  const allCategories = await fetchAllPages(
    `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=all`
  );
  
  console.log(`Found ${allCategories.length} categories to delete`);
  stats.total = allCategories.length;
  
  // Group categories by language
  const categoriesByLang: Record<string, CategoryData[]> = {};
  
  for (const category of allCategories) {
    const lang = category.lang || config.mainLanguage;
    
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
  console.log("\nCategories by language:");
  for (const [lang, categories] of Object.entries(categoriesByLang)) {
    const flag = getFlagEmoji(lang);
    console.log(`- ${flag} ${lang}: ${categories.length} categories`);
  }
  
  // Delete categories for each language
  for (const lang of languages) {
    if (!categoriesByLang[lang] || categoriesByLang[lang].length === 0) {
      console.log(`\nNo categories found for language: ${lang}`);
      continue;
    }
    
    console.log(`\nDeleting categories for language: ${lang}`);
    
    // Sort categories by ID in descending order to delete children before parents
    // This helps avoid dependency issues
    const sortedCategories = [...categoriesByLang[lang]].sort((a, b) => b.id - a.id);
    
    for (const category of sortedCategories) {
      console.log(`Deleting "${category.name}" (ID: ${category.id})...`);
      
      const success = await deleteCategory(category.id, lang);
      
      if (success) {
        stats.deleted++;
        stats.byLanguage[lang].deleted++;
      } else {
        stats.failed++;
        stats.byLanguage[lang].failed++;
      }
    }
  }
  
  // Print deletion statistics
  console.log("\n📊 Deletion Statistics:");
  console.log(`Total: ${stats.deleted}/${stats.total} deleted, ${stats.failed} failed`);
  
  console.log("\nBy language:");
  for (const [lang, langStats] of Object.entries(stats.byLanguage)) {
    const flag = getFlagEmoji(lang);
    console.log(`- ${flag} ${lang}: ${langStats.deleted}/${langStats.total} deleted, ${langStats.failed} failed`);
  }
  
  console.log("\n✅ Deletion process completed");
}

async function main(): Promise<void> {
  try {
    // Ask for confirmation before proceeding
    console.log("⚠️  WARNING: This will delete ALL product categories from the WordPress site.");
    console.log(`Target site: ${config.importBaseUrl}`);
    console.log("This action cannot be undone. Make sure you have a backup if needed.");
    console.log("To proceed, run with --confirm flag: yarn delete-wp --confirm");
    
    // Check if --confirm flag is present
    const hasConfirmFlag = process.argv.includes("--confirm");
    
    if (hasConfirmFlag) {
      console.log("\nConfirmation received. Proceeding with deletion...");
      await deleteAllCategories();
    } else {
      console.log("\n❌ Deletion aborted. Run with --confirm flag to proceed.");
    }
  } catch (error) {
    console.error("❌ Deletion process failed:", error);
  }
}

main();