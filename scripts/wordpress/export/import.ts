import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import config from "./config";

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

interface ImportStats {
  totalImported: number;
  byLanguage: Record<string, {
    created: number;
    skipped: number;
    failed: number;
  }>;
  translationConnections: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
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

// Check if a category exists by slug
async function categoryExists(slug: string, lang: string): Promise<number | null> {
  try {
    const response = await fetchJSON(
      `${config.importBaseUrl}/wp-json/wc/v3/products/categories?slug=${slug}&lang=${lang}`
    );
    
    if (response && response.length > 0) {
      return response[0].id;
    }
    return null;
  } catch (error) {
    console.warn("Error checking if category exists:", error);
    return null;
  }
}

async function importCategories(): Promise<void> {
  // Initialize statistics
  const stats: ImportStats = {
    totalImported: 0,
    byLanguage: {},
    translationConnections: {
      attempted: 0,
      succeeded: 0,
      failed: 0
    }
  };
  
  // Load and parse the export file
  console.log(`Loading export data from ${config.inputFile}...`);
  const raw = fs.readFileSync(config.inputFile, "utf-8");
  const exportData: ExportData = JSON.parse(raw);
  
  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  
  // Initialize statistics for each language
  [mainLanguage, ...otherLanguages].forEach(lang => {
    stats.byLanguage[lang] = {
      created: 0,
      skipped: 0,
      failed: 0
    };
  });
  
  console.log(`Export metadata:`);
  console.log(`- Main language: ${mainLanguage}`);
  console.log(`- Other languages: ${otherLanguages.join(", ")}`);
  console.log(`- Exported at: ${meta.exported_at}`);
  console.log(`- Skip existing: ${config.skipExisting ? "Yes" : "No"}`);
  
  // Track the mapping between original IDs and newly created IDs
  const idMapping: Record<string, Record<string, number>> = {};
  
  // 1. Import main language categories first
  console.log(`\nImporting main language categories (${mainLanguage})...`);
  for (const category of data[mainLanguage]) {
    console.log(`Processing "${category.name}" (${category.slug})...`);
    
    // Check if category already exists
    const existingId = await categoryExists(category.slug, mainLanguage);
    if (existingId && config.skipExisting) {
      console.log(`  Category already exists with ID: ${existingId}, skipping`);
      
      // Store the mapping using the existing ID
      if (!idMapping[mainLanguage]) {
        idMapping[mainLanguage] = {};
      }
      idMapping[mainLanguage][category.id] = existingId;
      
      // Update statistics
      stats.byLanguage[mainLanguage].skipped++;
      continue;
    }
    
    try {
      const response = await fetchJSON(
        `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=${mainLanguage}`,
        {
          method: "POST",
          body: JSON.stringify({
            name: category.name,
            slug: category.slug,
            parent: 0, // Handle parent-child separately if needed
            description: category.description || "",
            image: category.image ? { id: category.image.id } : null,
          }),
        }
      );
      
      // Store the mapping between original ID and new ID
      if (!idMapping[mainLanguage]) {
        idMapping[mainLanguage] = {};
      }
      idMapping[mainLanguage][category.id] = response.id;
      
      // Update statistics
      stats.byLanguage[mainLanguage].created++;
      stats.totalImported++;
      
      console.log(`  Created with ID: ${response.id}`);
    } catch (error) {
      console.error("Failed to create category:", error);
      
      // Update statistics
      stats.byLanguage[mainLanguage].failed++;
      
      // If we failed but the category might exist, try to get its ID
      if (!existingId) {
        const retryExistingId = await categoryExists(category.slug, mainLanguage);
        if (retryExistingId) {
          console.log(`  Found existing category with ID: ${retryExistingId}, using that`);
          if (!idMapping[mainLanguage]) {
            idMapping[mainLanguage] = {};
          }
          idMapping[mainLanguage][category.id] = retryExistingId;
          
          // Update statistics - change from failed to skipped
          stats.byLanguage[mainLanguage].failed--;
          stats.byLanguage[mainLanguage].skipped++;
        }
      }
    }
  }
  
  // 2. Import translations for other languages
  for (const lang of otherLanguages) {
    console.log(`\nImporting translations for ${lang}...`);
    
    for (const category of data[lang]) {
      console.log(`Processing "${category.name}" (${category.slug})...`);
      
      // Check if category already exists
      const existingId = await categoryExists(category.slug, lang);
      if (existingId && config.skipExisting) {
        console.log(`  Category already exists with ID: ${existingId}, skipping`);
        
        // Store the mapping using the existing ID
        if (!idMapping[lang]) {
          idMapping[lang] = {};
        }
        idMapping[lang][category.id] = existingId;
        
        // Update statistics
        stats.byLanguage[lang].skipped++;
        continue;
      }
      
      // Find if this category has a translation relationship
      let mainCategoryId = null;
      let translationGroup = null;
      
      // Look through translation relationships to find main language counterpart
      if (translations.wpml) {
        for (const [slug, langMap] of Object.entries(translations.wpml)) {
          if (langMap[lang] === category.id && langMap[mainLanguage]) {
            mainCategoryId = langMap[mainLanguage];
            translationGroup = slug;
            break;
          }
        }
      }
      
      try {
        // If no translation relationship found, create as standalone
        if (!mainCategoryId) {
          console.log(`Creating standalone category "${category.name}" (${category.slug})...`);
          
          const response = await fetchJSON(
            `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=${lang}`,
            {
              method: "POST",
              body: JSON.stringify({
                name: category.name,
                slug: category.slug,
                parent: 0,
                description: category.description || "",
                image: category.image ? { id: category.image.id } : null,
              }),
            }
          );
          
          // Store the mapping
          if (!idMapping[lang]) {
            idMapping[lang] = {};
          }
          idMapping[lang][category.id] = response.id;
          
          // Update statistics
          stats.byLanguage[lang].created++;
          stats.totalImported++;
          
          console.log(`  Created with ID: ${response.id}`);
        } 
        // Create as translation of main language category
        else {
          const mainNewId = idMapping[mainLanguage]?.[mainCategoryId];
          
          if (!mainNewId) {
            console.warn(`  Skipping ${category.slug} in ${lang} — main language category not imported.`);
            
            // Update statistics
            stats.byLanguage[lang].failed++;
            continue;
          }
          
          console.log(`Creating "${category.name}" as translation of ID ${mainNewId}...`);
          
          const response = await fetchJSON(
            `${config.importBaseUrl}/wp-json/wc/v3/products/categories?lang=${lang}`,
            {
              method: "POST",
              body: JSON.stringify({
                name: category.name,
                slug: category.slug,
                parent: 0,
                description: category.description || "",
                image: category.image ? { id: category.image.id } : null,
                translation_of: mainNewId,
              }),
            }
          );
          
          // Store the mapping
          if (!idMapping[lang]) {
            idMapping[lang] = {};
          }
          idMapping[lang][category.id] = response.id;
          
          // Update statistics
          stats.byLanguage[lang].created++;
          stats.totalImported++;
          
          console.log(`  Created with ID: ${response.id} as translation of ${mainNewId}`);
        }
      } catch (error) {
        console.error("Failed to create category:", error);
        
        // Update statistics
        stats.byLanguage[lang].failed++;
        
        // If we failed but the category might exist, try to get its ID
        if (!existingId) {
          const retryExistingId = await categoryExists(category.slug, lang);
          if (retryExistingId) {
            console.log(`  Found existing category with ID: ${retryExistingId}, using that`);
            if (!idMapping[lang]) {
              idMapping[lang] = {};
            }
            idMapping[lang][category.id] = retryExistingId;
            
            // Update statistics - change from failed to skipped
            stats.byLanguage[lang].failed--;
            stats.byLanguage[lang].skipped++;
          }
        }
      }
    }
  }
  
  // 3. Link translations via WPML REST API if needed
  // This step may not be necessary if using translation_of parameter above
  console.log("\nVerifying translation connections...");
  
  // For each translation group in the original data
  for (const [slug, langMap] of Object.entries(translations.wpml)) {
    // Create a new language map with the new IDs
    const newLangMap: Record<string, number> = {};
    let hasAllTranslations = true;
    
    // For each language in this translation group
    for (const [lang, originalId] of Object.entries(langMap)) {
      if (idMapping[lang] && idMapping[lang][originalId]) {
        newLangMap[lang] = idMapping[lang][originalId];
      } else {
        hasAllTranslations = false;
        console.warn(`  Missing mapping for ${lang} category ID ${originalId} in group ${slug}`);
      }
    }
    
    // If we have at least two languages in this group, connect them
    if (hasAllTranslations && Object.keys(newLangMap).length >= 2) {
      stats.translationConnections.attempted++;
      
      try {
        const tridResponse = await fetchJSON(
          `${config.importBaseUrl}/wp-json/wpml/v1/translate/set_translation`,
          {
            method: "POST",
            body: JSON.stringify({ translations: newLangMap }),
          }
        );
        console.log(`  Linked translation group ${slug} (TRID: ${tridResponse.trid})`);
        
        // Update statistics
        stats.translationConnections.succeeded++;
      } catch (error) {
        console.warn(`  Failed to link translation group ${slug}:`, error);
        console.warn("  This is expected if translations were already connected via translation_of parameter");
        
        // Update statistics
        stats.translationConnections.failed++;
      }
    }
  }

  // Print import statistics
  console.log("\n📊 Import Statistics:");
  console.log(`Total categories imported: ${stats.totalImported}`);
  
  console.log("\nBy language:");
  Object.entries(stats.byLanguage).forEach(([lang, langStats]) => {
    console.log(`- ${lang}: ${langStats.created} created, ${langStats.skipped} skipped, ${langStats.failed} failed`);
  });
  
  console.log("\nTranslation connections:");
  console.log(`- Attempted: ${stats.translationConnections.attempted}`);
  console.log(`- Succeeded: ${stats.translationConnections.succeeded}`);
  console.log(`- Failed: ${stats.translationConnections.failed} (expected if using translation_of parameter)`);

  console.log("\n✅ Import complete");
}

importCategories().catch((err) => {
  console.error("❌ Import failed:", err);
});
