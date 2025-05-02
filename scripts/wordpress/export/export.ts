import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import config from "./config";

// Type for the export data structure
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

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${config.exportUsername}:${config.exportPassword}`).toString("base64"),
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
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

async function exportCategories(): Promise<void> {
  // Ensure output directory exists
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  console.log(`Exporting categories from ${config.exportBaseUrl}...`);

  // Step 1: Fetch all categories in all languages to get translation information
  const allCategories = await fetchAllPages(
    `${config.exportBaseUrl}/wp-json/wc/v3/products/categories?lang=all`
  );

  console.log(`Fetched ${allCategories.length} categories in all languages`);

  // Step 2: Organize categories by language
  const categoriesByLang: Record<string, any[]> = {};
  const translationMap: Record<string, Record<string, number>> = {};

  // Initialize language arrays
  categoriesByLang[config.mainLanguage] = [];
  for (const lang of config.otherLanguages) {
    categoriesByLang[lang] = [];
  }

  // Process each category
  for (const category of allCategories) {
    const categoryLang = category.lang || config.mainLanguage;

    // Add to appropriate language array
    if (categoriesByLang[categoryLang]) {
      categoriesByLang[categoryLang].push(category);
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

  // Count categories by language
  for (const [lang, categories] of Object.entries(categoriesByLang)) {
    console.log(`- ${lang}: ${categories.length} categories`);
  }

  // Check if we found any translation relationships
  const translationCount = Object.keys(translationMap).length;
  console.log(`Found ${translationCount} translation relationships`);

  // Save to file with translation relationships
  const exportData: ExportData = {
    meta: {
      exported_at: new Date().toISOString(),
      main_language: config.mainLanguage,
      other_languages: config.otherLanguages,
    },
    translations: {
      wpml: translationMap,
    },
    data: categoriesByLang,
  };

  const outFile = path.join(config.outputDir, `exported-categories.json`);
  fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2));
  console.log(
    `✅ Exported categories to ${outFile} (Total: ${allCategories.length} items)`
  );
}

async function main(): Promise<void> {
  try {
    await exportCategories();
  } catch (error) {
    console.error("❌ Export failed:", error);
  }
}

main();
