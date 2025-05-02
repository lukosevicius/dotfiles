// wpml-relationship-test.ts
import fs from "fs";
import path from "path";
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

/**
 * Decodes URL-encoded strings for display in terminal
 */
function decodeSlug(slug: string): string {
  try {
    // First try to decode as URI component
    const decoded = decodeURIComponent(slug);
    return decoded;
  } catch (error) {
    // If decoding fails, return the original string
    return slug;
  }
}

function loadData(filePath: string): ExportData {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function showMetadata(exportData: ExportData) {
  console.log("\n📋 Export Metadata:");
  console.log(`- Exported at: ${exportData.meta.exported_at}`);
  console.log(`- Main language: ${exportData.meta.main_language}`);
  console.log(`- Other languages: ${exportData.meta.other_languages.join(", ")}`);
}

function countByLang(exportData: ExportData) {
  console.log("\n📊 Category Count by Language:");
  for (const [lang, categories] of Object.entries(exportData.data)) {
    console.log(`- ${lang}: ${categories.length}`);
  }
}

function visualizeTranslationRelationships(exportData: ExportData) {
  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  
  console.log("\n🔗 Translation Relationships:");
  
  if (translations.wpml && Object.keys(translations.wpml).length > 0) {
    console.log(`Found ${Object.keys(translations.wpml).length} translation groups`);
    
    // Sort slugs alphabetically
    const sortedSlugs = Object.keys(translations.wpml).sort();
    
    // Table 1: Main language (LT) with all related IDs
    console.log(`\n📊 Categories with ${mainLanguage.toUpperCase()} translations:`);
    
    // Header row
    const slugHeader = "Slug".padEnd(40);
    const langHeaders = [mainLanguage.toUpperCase(), ...otherLanguages.map(l => l.toUpperCase())].map(l => l.padEnd(8));
    console.log(slugHeader + langHeaders.join(" "));
    console.log("-".repeat(40 + (langHeaders.length * 9)));
    
    // Filter slugs that have main language entries
    const mainLangSlugs = sortedSlugs.filter(slug => translations.wpml[slug][mainLanguage]);
    
    for (const slug of mainLangSlugs) {
      const langMap = translations.wpml[slug];
      
      // Display decoded slug if it contains URL-encoded characters
      let displaySlug = slug;
      if (slug.includes('%')) {
        displaySlug = decodeSlug(slug);
        // Truncate long slugs
        if (displaySlug.length > 37) {
          displaySlug = displaySlug.substring(0, 34) + "...";
        }
      }
      
      // Format the row with proper padding
      const slugCell = displaySlug.padEnd(40);
      const idCells = [
        langMap[mainLanguage].toString().padEnd(8),
        ...otherLanguages.map(lang => (langMap[lang] || "-").toString().padEnd(8))
      ];
      
      console.log(slugCell + idCells.join(" "));
    }
    
    // Table 2: Categories without main language (LT) counterpart
    // Filter slugs that don't have main language entries but have other language entries
    const nonMainLangSlugs = sortedSlugs.filter(slug => {
      const langMap = translations.wpml[slug];
      return !langMap[mainLanguage] && otherLanguages.some(lang => langMap[lang]);
    });
    
    if (nonMainLangSlugs.length > 0) {
      console.log(`\n📊 Categories without ${mainLanguage.toUpperCase()} counterpart:`);
      
      // Header row
      const slugHeader = "Slug".padEnd(40);
      const langHeaders = otherLanguages.map(l => l.toUpperCase().padEnd(8));
      console.log(slugHeader + langHeaders.join(" "));
      console.log("-".repeat(40 + (langHeaders.length * 9)));
      
      for (const slug of nonMainLangSlugs) {
        const langMap = translations.wpml[slug];
        
        // Display decoded slug if it contains URL-encoded characters
        let displaySlug = slug;
        if (slug.includes('%')) {
          displaySlug = decodeSlug(slug);
          // Truncate long slugs
          if (displaySlug.length > 37) {
            displaySlug = displaySlug.substring(0, 34) + "...";
          }
        }
        
        // Format the row with proper padding
        const slugCell = displaySlug.padEnd(40);
        const idCells = otherLanguages.map(lang => 
          (langMap[lang] || "-").toString().padEnd(8)
        );
        
        console.log(slugCell + idCells.join(" "));
      }
    } else {
      console.log("\nAll categories have a main language counterpart.");
    }
  } else {
    console.log("No translation relationships found in the export data.");
  }
}

function findCategoryNameById(exportData: ExportData, lang: string, id: number): string {
  const category = exportData.data[lang]?.find(cat => cat.id === id);
  return category ? category.name : `Unknown (ID: ${id})`;
}

function analyzeTranslationCoverage(exportData: ExportData) {
  const { translations, meta, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  
  console.log("\n📊 Translation Coverage Analysis:");
  
  // For each language, check how many categories have translations
  for (const lang of otherLanguages) {
    if (!data[lang] || data[lang].length === 0) {
      console.log(`- ${lang}: No categories found`);
      continue;
    }
    
    let translatedCount = 0;
    let untranslatedCount = 0;
    
    // Count how many main language categories have translations in this language
    for (const category of data[mainLanguage]) {
      let hasTranslation = false;
      
      // Check if this category is in any translation group with this language
      for (const [slug, langMap] of Object.entries(translations.wpml)) {
        if (langMap[mainLanguage] === category.id && langMap[lang]) {
          hasTranslation = true;
          break;
        }
      }
      
      if (hasTranslation) {
        translatedCount++;
      } else {
        untranslatedCount++;
      }
    }
    
    const totalMainCategories = data[mainLanguage].length;
    const coveragePercent = (translatedCount / totalMainCategories) * 100;
    
    console.log(`- ${lang}: ${translatedCount}/${totalMainCategories} categories translated (${coveragePercent.toFixed(1)}%)`);
    
    if (untranslatedCount > 0) {
      console.log(`  Missing translations for ${untranslatedCount} categories`);
    }
  }
}

function main() {
  try {
    const exportData = loadData(config.inputFile);
    showMetadata(exportData);
    countByLang(exportData);
    visualizeTranslationRelationships(exportData);
    analyzeTranslationCoverage(exportData);
  } catch (error) {
    console.error("Error processing export data:", error);
  }
}

main();
