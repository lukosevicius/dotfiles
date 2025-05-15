// product-test.ts
import fs from "fs";
import path from "path";
import config from "../shared/config";
import chalk from "chalk";

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
  console.log("\n📋 " + chalk.cyan.bold("Export Metadata:"));
  console.log(`- Exported at: ${chalk.yellow(exportData.meta.exported_at)}`);
  console.log(`- Main language: ${chalk.yellow(exportData.meta.main_language)}`);
  console.log(`- Other languages: ${chalk.yellow(exportData.meta.other_languages.join(", "))}`);
}

function countByLang(exportData: ExportData) {
  console.log("\n📊 " + chalk.cyan.bold("Product Count by Language:"));
  for (const [lang, products] of Object.entries(exportData.data)) {
    console.log(`- ${lang}: ${chalk.yellow(products.length.toString())}`);
  }
}

function visualizeTranslationRelationships(exportData: ExportData) {
  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  
  console.log("\n🔗 " + chalk.cyan.bold("Translation Relationships:"));
  
  if (translations.wpml && Object.keys(translations.wpml).length > 0) {
    console.log(`Found ${chalk.yellow(Object.keys(translations.wpml).length.toString())} translation groups`);
    
    // Sort slugs alphabetically
    const sortedSlugs = Object.keys(translations.wpml).sort();
    
    // Find main language products to get their slugs
    const mainLanguageProducts = data[mainLanguage] || [];
    const mainLanguageSlugs = new Set(mainLanguageProducts.map(product => product.slug));
    
    // Table 1: Only main language slugs with all related IDs
    console.log(`\n📊 ${chalk.cyan.bold(`Products with ${mainLanguage.toUpperCase()} slugs:`)}`);
    
    // Header row
    const slugHeader = "Slug".padEnd(40);
    const langHeaders = [mainLanguage.toUpperCase(), ...otherLanguages.map(l => l.toUpperCase())].map(l => l.padEnd(8));
    console.log(chalk.dim(slugHeader + langHeaders.join(" ")));
    console.log(chalk.dim("-".repeat(40 + (langHeaders.length * 9))));
    
    // Filter slugs that are in the main language
    const mainLanguageSlugsList = sortedSlugs.filter(slug => mainLanguageSlugs.has(slug));
    
    // Only show first 20 products to avoid overwhelming output
    const displayLimit = 20;
    const displayedSlugs = mainLanguageSlugsList.slice(0, displayLimit);
    
    for (const slug of displayedSlugs) {
      const langMap = translations.wpml[slug];
      
      // Format the row with proper padding
      const slugCell = slug.padEnd(40);
      const idCells = [
        (langMap[mainLanguage] || "-").toString().padEnd(8),
        ...otherLanguages.map(lang => (langMap[lang] || "-").toString().padEnd(8))
      ];
      
      console.log(slugCell + idCells.join(" "));
    }
    
    if (mainLanguageSlugsList.length > displayLimit) {
      console.log(chalk.dim(`... and ${mainLanguageSlugsList.length - displayLimit} more products (showing ${displayLimit} of ${mainLanguageSlugsList.length})`));
    }
    
    // Table 2: Products without main language assigned
    const slugsWithoutMainLang = sortedSlugs.filter(slug => {
      const langMap = translations.wpml[slug];
      return !langMap[mainLanguage]; // Only include if there's no main language ID
    });
    
    if (slugsWithoutMainLang.length > 0) {
      console.log(`\n📊 ${chalk.cyan.bold(`Products without ${mainLanguage.toUpperCase()} assigned:`)}`);
      
      // Header row
      const slugHeader = "Slug".padEnd(40);
      const langHeaders = [mainLanguage.toUpperCase(), ...otherLanguages.map(l => l.toUpperCase())].map(l => l.padEnd(8));
      console.log(chalk.dim(slugHeader + langHeaders.join(" ")));
      console.log(chalk.dim("-".repeat(40 + (langHeaders.length * 9))));
      
      // Only show first 20 products to avoid overwhelming output
      const displayedSlugsWithoutMain = slugsWithoutMainLang.slice(0, displayLimit);
      
      for (const slug of displayedSlugsWithoutMain) {
        const langMap = translations.wpml[slug];
        
        // Format the row with proper padding
        const slugCell = slug.padEnd(40);
        const idCells = [
          "-".padEnd(8), // Main language is missing
          ...otherLanguages.map(lang => (langMap[lang] || "-").toString().padEnd(8))
        ];
        
        console.log(slugCell + idCells.join(" "));
      }
      
      if (slugsWithoutMainLang.length > displayLimit) {
        console.log(chalk.dim(`... and ${slugsWithoutMainLang.length - displayLimit} more products (showing ${displayLimit} of ${slugsWithoutMainLang.length})`));
      }
    }
  } else {
    console.log(chalk.yellow("No translation relationships found in the export data."));
  }
}

function findProductNameById(exportData: ExportData, lang: string, id: number): string {
  return exportData.data[lang]?.find(product => product.id === id)?.name || `Unknown (ID: ${id})`;
}

function analyzeTranslationCoverage(exportData: ExportData) {
  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  const allLanguages = [mainLanguage, ...otherLanguages];
  
  console.log("\n📊 " + chalk.cyan.bold("Translation Coverage Analysis:"));
  
  // Count products by language
  const productCounts: Record<string, number> = {};
  for (const lang of allLanguages) {
    productCounts[lang] = data[lang]?.length || 0;
  }
  
  // Count products with translations
  const productsWithTranslations: Record<string, number> = {};
  const productsWithCompleteTranslations: Record<string, number> = {};
  
  for (const lang of allLanguages) {
    productsWithTranslations[lang] = 0;
    productsWithCompleteTranslations[lang] = 0;
  }
  
  // Analyze translation groups
  for (const [slug, langMap] of Object.entries(translations.wpml)) {
    const availableLanguages = Object.keys(langMap);
    
    for (const lang of availableLanguages) {
      if (productsWithTranslations[lang] !== undefined) {
        productsWithTranslations[lang]++;
        
        // Check if this product has translations in all languages
        if (availableLanguages.length === allLanguages.length) {
          productsWithCompleteTranslations[lang]++;
        }
      }
    }
  }
  
  // Display results in a table
  console.log("\nLanguage".padEnd(15) + "Total".padEnd(10) + "With Trans.".padEnd(15) + "Complete".padEnd(10) + "Coverage");
  console.log(chalk.dim("-".repeat(65)));
  
  for (const lang of allLanguages) {
    const total = productCounts[lang];
    const withTrans = productsWithTranslations[lang];
    const complete = productsWithCompleteTranslations[lang];
    const coverage = total > 0 ? Math.round((withTrans / total) * 100) : 0;
    const completeCoverage = total > 0 ? Math.round((complete / total) * 100) : 0;
    
    console.log(
      lang.padEnd(15) + 
      total.toString().padEnd(10) + 
      withTrans.toString().padEnd(15) + 
      complete.toString().padEnd(10) + 
      `${coverage}% (${completeCoverage}% complete)`
    );
  }
}

function analyzeProductTypes(exportData: ExportData) {
  const { data } = exportData;
  const mainLanguage = exportData.meta.main_language;
  const products = data[mainLanguage] || [];
  
  console.log("\n🏷️ " + chalk.cyan.bold("Product Types Analysis:"));
  
  // Count products by type
  const typeCount: Record<string, number> = {};
  
  for (const product of products) {
    const type = product.type || "unknown";
    typeCount[type] = (typeCount[type] || 0) + 1;
  }
  
  // Display results
  console.log("\nType".padEnd(20) + "Count".padEnd(10) + "Percentage");
  console.log(chalk.dim("-".repeat(50)));
  
  for (const [type, count] of Object.entries(typeCount)) {
    const percentage = Math.round((count / products.length) * 100);
    console.log(type.padEnd(20) + count.toString().padEnd(10) + `${percentage}%`);
  }
}

function analyzeProductCategories(exportData: ExportData) {
  const { data } = exportData;
  const mainLanguage = exportData.meta.main_language;
  const products = data[mainLanguage] || [];
  
  console.log("\n📁 " + chalk.cyan.bold("Product Categories Analysis:"));
  
  // Count products by category
  const categoryCount: Record<number, number> = {};
  const categoryNames: Record<number, string> = {};
  let productsWithCategories = 0;
  let productsWithoutCategories = 0;
  
  for (const product of products) {
    if (product.categories && product.categories.length > 0) {
      productsWithCategories++;
      
      for (const category of product.categories) {
        const categoryId = category.id;
        categoryCount[categoryId] = (categoryCount[categoryId] || 0) + 1;
        categoryNames[categoryId] = category.name;
      }
    } else {
      productsWithoutCategories++;
    }
  }
  
  // Display results
  console.log(`\nProducts with categories: ${chalk.yellow(productsWithCategories.toString())} (${Math.round((productsWithCategories / products.length) * 100)}%)`);
  console.log(`Products without categories: ${chalk.yellow(productsWithoutCategories.toString())} (${Math.round((productsWithoutCategories / products.length) * 100)}%)`);
  
  // Sort categories by count
  const sortedCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Show top 10 categories
  
  if (sortedCategories.length > 0) {
    console.log("\n" + chalk.cyan("Top 10 Categories:"));
    console.log("Category".padEnd(30) + "Count".padEnd(10) + "Percentage");
    console.log(chalk.dim("-".repeat(60)));
    
    for (const [categoryId, count] of sortedCategories) {
      const name = categoryNames[Number(categoryId)] || `Unknown (ID: ${categoryId})`;
      const percentage = Math.round((count / products.length) * 100);
      console.log(name.padEnd(30) + count.toString().padEnd(10) + `${percentage}%`);
    }
  }
}

function analyzeProductAttributes(exportData: ExportData) {
  const { data } = exportData;
  const mainLanguage = exportData.meta.main_language;
  const products = data[mainLanguage] || [];
  
  console.log("\n🔍 " + chalk.cyan.bold("Product Attributes Analysis:"));
  
  // Count products by attribute
  const attributeCount: Record<string, number> = {};
  let productsWithAttributes = 0;
  let productsWithoutAttributes = 0;
  
  for (const product of products) {
    if (product.attributes && product.attributes.length > 0) {
      productsWithAttributes++;
      
      for (const attribute of product.attributes) {
        const attributeName = attribute.name;
        attributeCount[attributeName] = (attributeCount[attributeName] || 0) + 1;
      }
    } else {
      productsWithoutAttributes++;
    }
  }
  
  // Display results
  console.log(`\nProducts with attributes: ${chalk.yellow(productsWithAttributes.toString())} (${Math.round((productsWithAttributes / products.length) * 100)}%)`);
  console.log(`Products without attributes: ${chalk.yellow(productsWithoutAttributes.toString())} (${Math.round((productsWithoutAttributes / products.length) * 100)}%)`);
  
  // Sort attributes by count
  const sortedAttributes = Object.entries(attributeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Show top 10 attributes
  
  if (sortedAttributes.length > 0) {
    console.log("\n" + chalk.cyan("Top 10 Attributes:"));
    console.log("Attribute".padEnd(30) + "Count".padEnd(10) + "Percentage");
    console.log(chalk.dim("-".repeat(60)));
    
    for (const [attributeName, count] of sortedAttributes) {
      const percentage = Math.round((count / products.length) * 100);
      console.log(attributeName.padEnd(30) + count.toString().padEnd(10) + `${percentage}%`);
    }
  }
}

function analyzeProduct(exportData: ExportData, searchTerm: string) {
  const { meta, translations, data } = exportData;
  const mainLanguage = meta.main_language;
  const otherLanguages = meta.other_languages;
  const allLanguages = [mainLanguage, ...otherLanguages];
  
  console.log("\n🔍 " + chalk.cyan.bold(`Searching for product: "${searchTerm}"`));
  
  // Try to find the product by slug in translation relationships
  const matchingSlugs = Object.keys(translations.wpml).filter(slug => 
    slug.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  if (matchingSlugs.length === 0) {
    // If no slug matches, try to find by name or ID
    const matchingProducts: Record<string, any[]> = {};
    
    for (const lang of allLanguages) {
      if (!data[lang]) continue;
      
      const matches = data[lang].filter(product => 
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.id.toString() === searchTerm
      );
      
      if (matches.length > 0) {
        matchingProducts[lang] = matches;
      }
    }
    
    if (Object.keys(matchingProducts).length === 0) {
      console.log(chalk.red(`❌ No products found matching "${searchTerm}"`));
      return;
    }
    
    console.log(`Found ${chalk.yellow(Object.values(matchingProducts).flat().length.toString())} products by name/slug/ID:`);
    
    for (const [lang, products] of Object.entries(matchingProducts)) {
      console.log(`\n${chalk.cyan(lang.toUpperCase())}:`);
      for (const product of products) {
        console.log(`- ${chalk.bold(product.name)} (slug: ${product.slug}, ID: ${product.id})`);
        
        // Find translation group for this product
        for (const [slug, langMap] of Object.entries(translations.wpml)) {
          if (langMap[lang] === product.id) {
            console.log(`  ${chalk.dim("Translation group:")} ${slug}`);
            console.log(`  ${chalk.dim("Translations:")}`);
            
            for (const [transLang, transId] of Object.entries(langMap)) {
              if (transLang !== lang) {
                const transName = findProductNameById(exportData, transLang, transId as number);
                console.log(`    - ${transLang}: ${transName} (ID: ${transId})`);
              }
            }
            
            break;
          }
        }
        
        // Show product details
        if (product.type) {
          console.log(`  ${chalk.dim("Type:")} ${product.type}`);
        }
        
        if (product.status) {
          console.log(`  ${chalk.dim("Status:")} ${product.status}`);
        }
        
        if (product.price) {
          console.log(`  ${chalk.dim("Price:")} ${product.price}`);
        }
        
        if (product.categories && product.categories.length > 0) {
          console.log(`  ${chalk.dim("Categories:")} ${product.categories.map((cat: any) => cat.name).join(", ")}`);
        }
      }
    }
    
    return;
  }
  
  // Display detailed information for each matching slug
  console.log(`Found ${chalk.yellow(matchingSlugs.length.toString())} matching translation groups:`);
  
  for (const slug of matchingSlugs) {
    const langMap = translations.wpml[slug];
    const displaySlug = slug.includes('%') ? `${decodeSlug(slug)} (${slug})` : slug;
    
    console.log(`\n📎 ${chalk.cyan.bold(`Translation Group: ${displaySlug}`)}`);
    console.log(`${chalk.dim("IDs by language:")}`);
    
    for (const lang of allLanguages) {
      const id = langMap[lang];
      if (id) {
        const product = data[lang]?.find(p => p.id === id);
        if (product) {
          console.log(`- ${chalk.cyan(lang.toUpperCase())}: ${chalk.bold(product.name)} (ID: ${id}, slug: ${product.slug})`);
          
          // Display additional product information
          if (product.description) {
            const shortDesc = product.description.length > 50 
              ? product.description.substring(0, 47) + "..." 
              : product.description;
            console.log(`  ${chalk.dim("Description:")} ${shortDesc}`);
          }
          
          if (product.type) {
            console.log(`  ${chalk.dim("Type:")} ${product.type}`);
          }
          
          if (product.status) {
            console.log(`  ${chalk.dim("Status:")} ${product.status}`);
          }
          
          if (product.price) {
            console.log(`  ${chalk.dim("Price:")} ${product.price}`);
          }
          
          if (product.categories && product.categories.length > 0) {
            console.log(`  ${chalk.dim("Categories:")} ${product.categories.map((cat: any) => cat.name).join(", ")}`);
          }
          
          if (product.attributes && product.attributes.length > 0) {
            console.log(`  ${chalk.dim("Attributes:")}`);
            for (const attr of product.attributes) {
              console.log(`    - ${attr.name}: ${attr.options.join(", ")}`);
            }
          }
          
          if (product.images && product.images.length > 0) {
            console.log(`  ${chalk.dim("Images:")} ${product.images.length}`);
          }
        } else {
          console.log(`- ${chalk.cyan(lang.toUpperCase())}: ${chalk.red(`Unknown product (ID: ${id})`)}`);
        }
      } else {
        console.log(`- ${chalk.cyan(lang.toUpperCase())}: ${chalk.yellow("No translation")}`);
      }
    }
  }
}

function main() {
  try {
    // Use a different input file for products
    const inputFile = config.inputFile.replace("exported-categories.json", "exported-products.json");
    
    if (!fs.existsSync(inputFile)) {
      console.error(chalk.red(`Error: Product export file not found at ${inputFile}`));
      console.log(chalk.yellow("Please run the product export first."));
      process.exit(1);
    }
    
    const exportData = loadData(inputFile);
    
    // Check if a specific product was requested
    const searchTerm = process.argv[2];
    
    if (searchTerm) {
      // If a search term is provided, only analyze that product
      analyzeProduct(exportData, searchTerm);
    } else {
      // Otherwise run the full test
      showMetadata(exportData);
      countByLang(exportData);
      visualizeTranslationRelationships(exportData);
      analyzeTranslationCoverage(exportData);
      analyzeProductTypes(exportData);
      analyzeProductCategories(exportData);
      analyzeProductAttributes(exportData);
    }
  } catch (error) {
    console.error(chalk.red("Error processing export data:"), error);
  }
}

main();
