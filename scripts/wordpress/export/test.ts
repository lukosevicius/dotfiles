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
    
    // Find main language categories to get their slugs
    const mainLanguageCategories = data[mainLanguage] || [];
    const mainLanguageSlugs = new Set(mainLanguageCategories.map(cat => cat.slug));
    
    // Table 1: Only main language slugs with all related IDs
    console.log(`\n📊 Categories with ${mainLanguage.toUpperCase()} slugs:`);
    
    // Header row
    const slugHeader = "Slug".padEnd(40);
    const langHeaders = [mainLanguage.toUpperCase(), ...otherLanguages.map(l => l.toUpperCase())].map(l => l.padEnd(8));
    console.log(slugHeader + langHeaders.join(" "));
    console.log("-".repeat(40 + (langHeaders.length * 9)));
    
    // Filter slugs that are in the main language
    const mainLanguageSlugsList = sortedSlugs.filter(slug => mainLanguageSlugs.has(slug));
    
    for (const slug of mainLanguageSlugsList) {
      const langMap = translations.wpml[slug];
      
      // Format the row with proper padding
      const slugCell = slug.padEnd(40);
      const idCells = [
        (langMap[mainLanguage] || "-").toString().padEnd(8),
        ...otherLanguages.map(lang => (langMap[lang] || "-").toString().padEnd(8))
      ];
      
      console.log(slugCell + idCells.join(" "));
    }
    
    // Table 2: Non-main language slugs
    const nonMainLanguageSlugs = sortedSlugs.filter(slug => !mainLanguageSlugs.has(slug));
    
    if (nonMainLanguageSlugs.length > 0) {
      console.log(`\n📊 Categories with non-${mainLanguage.toUpperCase()} slugs:`);
      
      // Header row
      const slugHeader = "Slug".padEnd(40);
      const langHeaders = [mainLanguage.toUpperCase(), ...otherLanguages.map(l => l.toUpperCase())].map(l => l.padEnd(8));
      console.log(slugHeader + langHeaders.join(" "));
      console.log("-".repeat(40 + (langHeaders.length * 9)));
      
      for (const slug of nonMainLanguageSlugs) {
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
          (langMap[mainLanguage] || "-").toString().padEnd(8),
          ...otherLanguages.map(lang => (langMap[lang] || "-").toString().padEnd(8))
        ];
        
        console.log(slugCell + idCells.join(" "));
      }
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

/**
 * Analyze a specific category in depth
 */
function analyzeCategory(exportData: ExportData, searchTerm: string) {
  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  const allLanguages = [mainLanguage, ...otherLanguages];
  
  console.log(`\n🔍 Analyzing category: "${searchTerm}"`);
  
  // Step 1: Find all slugs that match or contain the search term
  const matchingSlugs = Object.keys(translations.wpml).filter(slug => {
    // Check if the slug matches or contains the search term
    if (slug.includes(searchTerm)) return true;
    
    // Check if the decoded slug matches or contains the search term
    if (slug.includes('%')) {
      const decoded = decodeSlug(slug);
      if (decoded.includes(searchTerm)) return true;
    }
    
    return false;
  });
  
  if (matchingSlugs.length === 0) {
    // If no slug matches, try to find categories by name
    const matchingCategories: Record<string, any[]> = {};
    
    for (const lang of allLanguages) {
      if (!data[lang]) continue;
      
      const matches = data[lang].filter(cat => 
        cat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.slug.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      if (matches.length > 0) {
        matchingCategories[lang] = matches;
      }
    }
    
    if (Object.keys(matchingCategories).length === 0) {
      console.log(`❌ No categories found matching "${searchTerm}"`);
      return;
    }
    
    console.log(`Found ${Object.values(matchingCategories).flat().length} categories by name/slug:`);
    
    for (const [lang, categories] of Object.entries(matchingCategories)) {
      console.log(`\n${lang.toUpperCase()}:`);
      for (const cat of categories) {
        console.log(`- ${cat.name} (slug: ${cat.slug}, ID: ${cat.id})`);
        
        // Find translation group for this category
        for (const [slug, langMap] of Object.entries(translations.wpml)) {
          if (langMap[lang] === cat.id) {
            console.log(`  Translation group: ${slug}`);
            console.log(`  Translations:`);
            
            for (const [transLang, transId] of Object.entries(langMap)) {
              if (transLang !== lang) {
                const transName = findCategoryNameById(exportData, transLang, transId as number);
                console.log(`    - ${transLang}: ${transName} (ID: ${transId})`);
              }
            }
            
            break;
          }
        }
      }
    }
    
    return;
  }
  
  // Display detailed information for each matching slug
  console.log(`Found ${matchingSlugs.length} matching translation groups:`);
  
  for (const slug of matchingSlugs) {
    const langMap = translations.wpml[slug];
    const displaySlug = slug.includes('%') ? `${decodeSlug(slug)} (${slug})` : slug;
    
    console.log(`\n📎 Translation Group: ${displaySlug}`);
    console.log(`IDs by language:`);
    
    for (const lang of allLanguages) {
      const id = langMap[lang];
      if (id) {
        const category = data[lang]?.find(cat => cat.id === id);
        if (category) {
          console.log(`- ${lang.toUpperCase()}: ${category.name} (ID: ${id}, slug: ${category.slug})`);
          
          // Display additional category information
          if (category.description) {
            const shortDesc = category.description.length > 50 
              ? category.description.substring(0, 47) + "..." 
              : category.description;
            console.log(`  Description: ${shortDesc}`);
          }
          
          if (category.parent) {
            const parentCategory = data[lang]?.find(cat => cat.id === category.parent);
            const parentName = parentCategory ? parentCategory.name : `Unknown (ID: ${category.parent})`;
            console.log(`  Parent: ${parentName} (ID: ${category.parent})`);
          }
          
          if (category.image) {
            console.log(`  Has image: Yes (ID: ${category.image.id})`);
          }
          
          if (category.count !== undefined) {
            console.log(`  Product count: ${category.count}`);
          }
        } else {
          console.log(`- ${lang.toUpperCase()}: Unknown category (ID: ${id})`);
        }
      } else {
        console.log(`- ${lang.toUpperCase()}: No translation`);
      }
    }
  }
}

function main() {
  try {
    const exportData = loadData(config.inputFile);
    
    // Check if a specific category was requested
    const searchTerm = process.argv[2];
    
    if (searchTerm) {
      // If a search term is provided, only analyze that category
      analyzeCategory(exportData, searchTerm);
    } else {
      // Otherwise run the full test
      showMetadata(exportData);
      countByLang(exportData);
      visualizeTranslationRelationships(exportData);
      analyzeTranslationCoverage(exportData);
    }
  } catch (error) {
    console.error("Error processing export data:", error);
  }
}

main();
