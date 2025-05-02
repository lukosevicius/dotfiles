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
    
    // Print table header
    console.log(
      "Slug/Group".padEnd(30),
      mainLanguage.toUpperCase().padEnd(8),
      ...otherLanguages.map(l => l.toUpperCase().padEnd(8))
    );
    console.log("-".repeat(80));
    
    // Print each translation group
    Object.entries(translations.wpml).forEach(([slug, langMap]) => {
      const row = [
        slug.padEnd(30),
        (langMap[mainLanguage] || "-").toString().padEnd(8),
        ...otherLanguages.map((lang) =>
          (langMap[lang] || "-").toString().padEnd(8)
        ),
      ];
      console.log(row.join(" "));
    });
  } else {
    console.log("No translation relationships found in the export data.");
  }
}

function findCategoryNameById(exportData: ExportData, lang: string, id: number): string {
  const category = exportData.data[lang]?.find(cat => cat.id === id);
  return category ? category.name : `Unknown (ID: ${id})`;
}

function showDetailedTranslations(exportData: ExportData) {
  const { translations, meta } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  
  console.log("\n📋 Translation Pairs:");
  
  if (translations.wpml && Object.keys(translations.wpml).length > 0) {
    Object.entries(translations.wpml).forEach(([slug, langMap]) => {
      if (langMap[mainLanguage] && Object.keys(langMap).length > 1) {
        const mainCategoryId = langMap[mainLanguage];
        const mainCategoryName = findCategoryNameById(exportData, mainLanguage, mainCategoryId);
        
        console.log(`\n${mainCategoryName} (${mainLanguage}, ID: ${mainCategoryId})`);
        
        for (const lang of otherLanguages) {
          if (langMap[lang]) {
            const translatedName = findCategoryNameById(exportData, lang, langMap[lang]);
            console.log(`  → ${translatedName} (${lang}, ID: ${langMap[lang]})`);
          } else {
            console.log(`  → No translation for ${lang}`);
          }
        }
      }
    });
  } else {
    console.log("No translation relationships found.");
  }
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
    showDetailedTranslations(exportData);
    analyzeTranslationCoverage(exportData);
  } catch (error) {
    console.error("Error processing export data:", error);
  }
}

main();
