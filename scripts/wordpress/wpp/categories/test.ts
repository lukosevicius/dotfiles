// wpml-relationship-test.ts
import fs from "fs";
import path from "path";
import readline from "readline";
import { spawn } from "child_process";
import chalk from "chalk";
import config from "../shared/config";
import { getFlagEmoji } from "../shared/utils/language";

interface ExportData {
  meta: {
    exported_at: string;
    main_language: string;
    other_languages: string[];
    source_site?: string;
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
    
    // For Russian Cyrillic characters, ensure proper decoding
    // This helps with displaying Cyrillic characters correctly in the terminal
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
  console.log(chalk.cyan("\n📋 Export Metadata:"));
  console.log(chalk.cyan(`- Exported at: ${chalk.white(exportData.meta.exported_at)}`));
  console.log(chalk.cyan(`- Main language: ${chalk.white(exportData.meta.main_language)} ${getFlagEmoji(exportData.meta.main_language)}`));
  console.log(chalk.cyan(`- Other languages: ${chalk.white(exportData.meta.other_languages.map(lang => `${lang} ${getFlagEmoji(lang)}`).join(", "))}`));
  if (exportData.meta.source_site) {
    console.log(chalk.cyan(`- Source site: ${chalk.white.bold(exportData.meta.source_site)}`));
  }
}

function countByLang(exportData: ExportData) {
  console.log(chalk.cyan("\n📊 Category Count by Language:"));
  for (const [lang, categories] of Object.entries(exportData.data)) {
    const flag = getFlagEmoji(lang);
    console.log(chalk.cyan(`- ${flag} ${lang}: ${chalk.white.bold(categories.length)}`));
  }
}

function visualizeTranslationRelationships(exportData: ExportData) {
  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  
  console.log(chalk.cyan("\n🔗 Translation Relationships:"));
  
  if (translations.wpml && Object.keys(translations.wpml).length > 0) {
    console.log(chalk.cyan(`Found ${chalk.white.bold(Object.keys(translations.wpml).length)} translation groups`));
    
    // Sort slugs alphabetically
    const sortedSlugs = Object.keys(translations.wpml).sort();
    
    // Find main language categories to get their slugs
    const mainLanguageCategories = data[mainLanguage] || [];
    const mainLanguageSlugs = new Set(mainLanguageCategories.map(cat => cat.slug));
    
    // Table 1: Only main language slugs with all related IDs
    console.log(chalk.cyan(`\n📊 Categories with ${chalk.white.bold(mainLanguage.toUpperCase())} slugs:`));
    
    // Header row
    const slugHeader = chalk.blue("Slug".padEnd(40));
    const langHeaders = [mainLanguage.toUpperCase(), ...otherLanguages.map(l => l.toUpperCase())].map(l => chalk.blue(l.padEnd(8)));
    console.log(slugHeader + langHeaders.join(" "));
    console.log(chalk.dim("-".repeat(40 + (langHeaders.length * 9))));
    
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
    
    // Table 2: Categories without main language assigned
    const slugsWithoutMainLang = sortedSlugs.filter(slug => {
      const langMap = translations.wpml[slug];
      return !langMap[mainLanguage]; // Only include if there's no main language ID
    });
    
    if (slugsWithoutMainLang.length > 0) {
      console.log(chalk.yellow(`\n📊 Categories without ${chalk.white.bold(mainLanguage.toUpperCase())} assigned:`));
      
      // Header row
      const slugHeader = chalk.blue("Slug".padEnd(40));
      const langHeaders = [mainLanguage.toUpperCase(), ...otherLanguages.map(l => l.toUpperCase())].map(l => chalk.blue(l.padEnd(8)));
      console.log(slugHeader + langHeaders.join(" "));
      console.log(chalk.dim("-".repeat(40 + (langHeaders.length * 9))));
      
      for (const slug of slugsWithoutMainLang) {
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
  
  // First check if the search term matches a slug in the translation map
  const matchingSlugs = Object.keys(translations.wpml).filter(slug => 
    slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
    decodeSlug(slug).toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  // If no direct slug match, look for categories with matching name or slug
  if (matchingSlugs.length === 0) {
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
      console.log(chalk.red(`✗ No categories found matching "${searchTerm}"`));
      return;
    }
    
    console.log(chalk.green(`Found ${chalk.white.bold(Object.values(matchingCategories).flat().length)} categories by name/slug:`));
    
    for (const [lang, categories] of Object.entries(matchingCategories)) {
      console.log(chalk.cyan(`\n${lang.toUpperCase()} ${getFlagEmoji(lang)}:`));
      for (const cat of categories) {
        console.log(chalk.white(`- ${cat.name} (slug: ${chalk.dim(cat.slug)}, ID: ${chalk.dim(cat.id.toString())})`));
        
        // Find translation group for this category
        for (const [slug, langMap] of Object.entries(translations.wpml)) {
          if (langMap[lang] === cat.id) {
            console.log(chalk.dim(`  Translation group: ${slug}`));
            console.log(chalk.cyan(`  Translations:`));
            
            for (const [transLang, transId] of Object.entries(langMap)) {
              if (transLang !== lang) {
                const transName = findCategoryNameById(exportData, transLang, transId as number);
                console.log(chalk.cyan(`    - ${transLang} ${getFlagEmoji(transLang)}: ${chalk.white(transName)} (ID: ${chalk.dim(transId.toString())})`));
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
  console.log(chalk.green(`Found ${chalk.white.bold(matchingSlugs.length)} matching translation groups:`));
  
  for (const slug of matchingSlugs) {
    const langMap = translations.wpml[slug];
    const displaySlug = slug.includes('%') ? `${decodeSlug(slug)} (${slug})` : slug;
    
    console.log(chalk.cyan(`\n📎 Translation Group: ${chalk.white.bold(displaySlug)}`));
    console.log(chalk.cyan(`IDs by language:`));
    
    for (const lang of allLanguages) {
      const id = langMap[lang];
      if (id) {
        const category = data[lang]?.find(cat => cat.id === id);
        if (category) {
          console.log(chalk.cyan(`- ${lang.toUpperCase()} ${getFlagEmoji(lang)}: ${chalk.white(category.name)} (ID: ${chalk.dim(id.toString())}, slug: ${chalk.dim(category.slug)})`));
          
          // Display additional category information
          if (category.description) {
            const shortDesc = category.description.length > 50 
              ? category.description.substring(0, 47) + "..." 
              : category.description;
            console.log(chalk.dim(`  Description: ${shortDesc}`));
          }
          
          if (category.parent) {
            const parentCategory = data[lang]?.find(cat => cat.id === category.parent);
            const parentName = parentCategory ? parentCategory.name : `Unknown (ID: ${category.parent})`;
            console.log(chalk.dim(`  Parent: ${parentName} (ID: ${category.parent})`));
          }
          
          if (category.image) {
            console.log(chalk.dim(`  Has image: Yes (ID: ${category.image.id})`));
          }
          
          if (category.count !== undefined) {
            console.log(chalk.dim(`  Product count: ${category.count}`));
          }
        } else {
          console.log(chalk.yellow(`- ${lang.toUpperCase()} ${getFlagEmoji(lang)}: Unknown category (ID: ${id})`));
        }
      } else {
        console.log(chalk.gray(`- ${lang.toUpperCase()} ${getFlagEmoji(lang)}: No translation`));
      }
    }
  }
}

async function runExport(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.cyan("\n🔄 Running category export script..."));
    
    const exportScript = path.resolve(__dirname, "export.ts");
    const tsNodePath = path.resolve(__dirname, "../node_modules/.bin/ts-node");
    const child = spawn(tsNodePath, [exportScript], {
      stdio: "inherit"
    });
    
    child.on("close", (code) => {
      if (code === 0) {
        console.log(chalk.green("\n✓ Export completed successfully!"));
        resolve(true);
      } else {
        console.error(chalk.red(`\n✗ Export failed with code ${code}`));
        resolve(false);
      }
    });
  });
}

async function main() {
  try {
    console.log(chalk.cyan.bold("\n📊 WordPress Category Test Tool"));
    
    if (!fs.existsSync(config.inputFile)) {
      console.error(chalk.red(`\n✗ Error: Category export file not found at ${config.inputFile}`));
      
      // Ask if the user wants to run the export script
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow('\nWould you like to run the export script now? (y/n): '), resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() === "y") {
        const exportSuccess = await runExport();
        if (!exportSuccess) {
          console.log(chalk.yellow("\nExport failed. Please run the export script manually and try again."));
          process.exit(1);
        }
        
        // Check if the file exists now
        if (!fs.existsSync(config.inputFile)) {
          console.error(chalk.red(`\n✗ Export file still not found at ${config.inputFile} after running export.`));
          process.exit(1);
        }
      } else {
        console.log(chalk.blue("\nTest cancelled. Please run the export script first."));
        process.exit(1);
      }
    }
    
    console.log(chalk.cyan(`\n📂 Loading category data from: ${config.inputFile}`));
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
      
      console.log(chalk.green.bold("\n✓ Test completed successfully!"));
    }
  } catch (error) {
    console.error(chalk.red.bold("\n✗ Error processing export data:"), error);
    process.exit(1);
  }
}

main();
