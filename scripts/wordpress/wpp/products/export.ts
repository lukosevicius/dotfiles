import fs from "fs";
import path from "path";
import { fetchJSON, fetchAllPages, getSiteName } from "../shared/utils/api";
import config from "../shared/config";
import { getFlagEmoji } from "../shared/utils/language";

// Type for the export data structure
interface ExportData {
  meta: {
    exported_at: string;
    main_language: string;
    other_languages: string[];
    source_site: string; // Source site name
  };
  translations: {
    wpml: Record<string, Record<string, number>>;
  };
  data: Record<string, any[]>;
}

async function exportProducts(): Promise<void> {
  // Ensure output directory exists
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  // Get site name
  const sourceSiteName = await getSiteName(config.exportBaseUrl);

  console.log(`🔄 Exporting products from: ${config.exportBaseUrl} (${sourceSiteName})`);
  console.log("🔍 Fetching products from WooCommerce API...");

  // Step 1: Fetch all products in all languages to get translation information
  const allProducts = await fetchAllPages(
    `${config.exportBaseUrl}/wp-json/wc/v3/products?lang=all`
  );

  console.log(`✅ Fetched ${allProducts.length} products in total`);

  // Debug: Check what languages are actually present in the response
  const languagesInResponse = new Set<string>();
  allProducts.forEach((product) => {
    if (product.lang) {
      languagesInResponse.add(product.lang);
    }

    // Also check translations property
    if (product.translations) {
      Object.keys(product.translations).forEach((lang) => {
        languagesInResponse.add(lang);
      });
    }
  });

  console.log(
    "📊 Languages found in API response:",
    Array.from(languagesInResponse).join(", ")
  );

  // Step 2: Organize products by language
  const productsByLang: Record<string, any[]> = {};
  const translationMap: Record<string, Record<string, number>> = {};

  // Initialize language buckets
  productsByLang[config.mainLanguage] = [];
  for (const lang of config.otherLanguages) {
    productsByLang[lang] = [];
  }

  // Process each product
  for (const product of allProducts) {
    const productLang = product.lang || config.mainLanguage;

    // Filter out yoast_head and yoast_head_json fields
    const filteredProduct = { ...product };
    delete filteredProduct.yoast_head;
    delete filteredProduct.yoast_head_json;

    // Add to the appropriate language bucket
    if (productsByLang[productLang]) {
      productsByLang[productLang].push(filteredProduct);
    }

    // Process translation information if available
    if (product.translations) {
      // Use slug as the key for the translation group
      const slug = product.slug;

      if (!translationMap[slug]) {
        translationMap[slug] = {};
      }

      // Add this product to the translation map
      translationMap[slug][productLang] = product.id;

      // Add all translations to the map
      for (const [lang, id] of Object.entries(product.translations)) {
        if (!translationMap[slug]) {
          translationMap[slug] = {};
        }
        translationMap[slug][lang] = id as number;
      }
    }
  }

  console.log("\n📊 Export Statistics:");
  console.log(
    `Total products: ${Object.values(productsByLang).flat().length}`
  );

  console.log("\nBy language:");
  for (const [lang, products] of Object.entries(productsByLang)) {
    const flag = getFlagEmoji(lang);
    console.log(`- ${flag} ${lang}: ${products.length}`);
  }

  console.log(
    `\nTranslation relationships: ${Object.keys(translationMap).length}`
  );

  // Save to file with translation relationships
  const exportData: ExportData = {
    meta: {
      exported_at: new Date().toISOString(),
      main_language: config.mainLanguage,
      other_languages: config.otherLanguages,
      source_site: sourceSiteName, // Include source site name
    },
    translations: {
      wpml: translationMap,
    },
    data: productsByLang,
  };

  const outFile = path.join(config.outputDir, `exported-products.json`);
  fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2));
  console.log(
    `✅ Exported products to ${outFile} (Total: ${allProducts.length} items)`
  );
}

async function main(): Promise<void> {
  try {
    await exportProducts();
  } catch (error) {
    console.error("❌ Export failed:", error);
  }
}

main();
