import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import chalk from "chalk";
import config from "../config";
import { getImportBaseUrl, getImportCredentials, getMainLanguage, getOtherLanguages } from "../utils/config-utils";
import { getFlagEmoji } from "../utils/language";
import { getSiteName } from "../utils/api";
import { deleteCategory, deleteAllCategories as deleteAllCategoriesImpl } from "../categories/delete";

// Wrapper function that calls the implementation from categories/delete.ts
async function deleteAllCategories(): Promise<void> {
  await deleteAllCategoriesImpl();
}

interface CategoryData {
  id: number;
  name: string;
  slug: string;
  lang?: string;
}

async function main(): Promise<void> {
  try {
    // Ask for confirmation before proceeding
    console.log(
      " WARNING: This will delete ALL product categories from the WordPress site."
    );
    const siteName = await getSiteName(getImportBaseUrl());
    console.log(
      "This action cannot be undone. Make sure you have a backup if needed."
    );
    console.log(
      "To proceed, run with --confirm flag: yarn delete-wp --confirm"
    );

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
