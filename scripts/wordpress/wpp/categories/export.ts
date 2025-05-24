import fs from "fs";
import path from "path";
import chalk from "chalk";
import { fetchJSON, fetchAllPages, getSiteName } from "../shared/utils/api";
import config, {
  getMainLanguage,
  getOtherLanguages,
  getExportBaseUrl
} from "../shared/config";
import { getFlagEmoji } from "../shared/utils/language";

// Type for the export data structure
interface ExportData {
  meta: {
    exported_at: string;
    main_language: string;
    other_languages: string[];
    source_site: string;
  };
  translations: {
    wpml: Record<string, Record<string, number>>;
  };
  data: Record<string, any[]>;
}

// These functions are now imported from ../shared/utils/api

async function exportCategories(): Promise<void> {
  // Ensure output directory exists
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  // Get site name
  const exportBaseUrl = getExportBaseUrl();
  const siteName = await getSiteName(exportBaseUrl);

  console.log(chalk.cyan(`🔄 Exporting from: ${exportBaseUrl} (${chalk.white.bold(siteName)}))`));
  console.log(chalk.cyan("🔍 Fetching categories from WooCommerce API..."));

  // Step 1: Fetch all categories in all languages to get translation information
  const allCategories = await fetchAllPages(
    `${exportBaseUrl}/wp-json/wc/v3/products/categories?lang=all`
  );

  console.log(chalk.green(`✓ Fetched ${allCategories.length} categories in total`));

  // Debug: Check what languages are actually present in the response
  const languagesInResponse = new Set<string>();
  allCategories.forEach((cat) => {
    if (cat.lang) {
      languagesInResponse.add(cat.lang);
    }

    // Also check translations property
    if (cat.translations) {
      Object.keys(cat.translations).forEach((lang) => {
        languagesInResponse.add(lang);
      });
    }
  });

  console.log(
    chalk.cyan("📊 Languages found in API response:"),
    chalk.white(Array.from(languagesInResponse).join(", "))
  );

  // Step 2: Organize categories by language
  const categoriesByLang: Record<string, any[]> = {};
  const translationMap: Record<string, Record<string, number>> = {};

  // Initialize language buckets
  const mainLanguage = getMainLanguage();
  const otherLanguages = getOtherLanguages();
  
  categoriesByLang[mainLanguage] = [];
  for (const lang of otherLanguages) {
    categoriesByLang[lang] = [];
  }

  // Process each category
  for (const category of allCategories) {
    const categoryLang = category.lang || mainLanguage;

    // Filter out yoast_head and yoast_head_json fields
    const filteredCategory = { ...category };
    delete filteredCategory.yoast_head;
    delete filteredCategory.yoast_head_json;

    // Add to the appropriate language bucket
    if (categoriesByLang[categoryLang]) {
      categoriesByLang[categoryLang].push(filteredCategory);
    }

    // Process translation information if available
    if (category.translations) {
      // Use slug as the key for the translation group
      const slug = category.slug;

      if (!translationMap[slug]) {
        translationMap[slug] = {};
      }

      // Add this category to the translation map
      translationMap[slug][categoryLang] = category.id;

      // Add all translations to the map
      for (const [lang, id] of Object.entries(category.translations)) {
        if (!translationMap[slug]) {
          translationMap[slug] = {};
        }
        translationMap[slug][lang] = id as number;
      }
    }
  }

  console.log(chalk.cyan("\n📊 Export Statistics:"));
  console.log(
    chalk.cyan(`Total categories: ${chalk.white.bold(Object.values(categoriesByLang).flat().length)}`)
  );

  console.log(chalk.cyan("\nBy language:"));
  for (const [lang, categories] of Object.entries(categoriesByLang)) {
    const flag = getFlagEmoji(lang);
    console.log(chalk.cyan(`- ${flag} ${lang}: ${chalk.white.bold(categories.length)}`));
  }

  console.log(
    chalk.cyan(`\nTranslation relationships: ${chalk.white.bold(Object.keys(translationMap).length)}`)
  );

  // Save to file with translation relationships
  const exportData: ExportData = {
    meta: {
      exported_at: new Date().toISOString(),
      main_language: mainLanguage,
      other_languages: otherLanguages,
      source_site: siteName,
    },
    translations: {
      wpml: translationMap,
    },
    data: categoriesByLang,
  };

  const outFile = path.join(config.outputDir, `exported-categories.json`);
  fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2));
  console.log(
    chalk.green.bold(`✓ Exported categories to ${outFile} (Total: ${allCategories.length} items)`)
  );
}

async function main(): Promise<void> {
  try {
    await exportCategories();
  } catch (error) {
    console.error(chalk.red.bold("✗ Export failed:"), error);
  }
}

main();
