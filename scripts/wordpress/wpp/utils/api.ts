/**
 * Shared API utilities for WordPress scripts
 */
import fetch from "node-fetch";
import config from "../config";
import {
  getExportBaseUrl,
  getImportBaseUrl,
  getExportCredentials,
  getImportCredentials
} from "./config-utils";

/**
 * Fetch JSON data from a URL with authentication
 * Handles both import and export authentication based on the URL
 */
export async function fetchJSON(url: string, options: any = {}): Promise<any> {
  // Determine which credentials to use based on the URL
  const importBaseUrl = getImportBaseUrl();
  const exportBaseUrl = getExportBaseUrl();
  
  const isImportUrl = url.includes(importBaseUrl);
  
  // Get the appropriate credentials
  const credentials = isImportUrl 
    ? getImportCredentials() 
    : getExportCredentials();
  
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      Authorization:
        "Basic " +
        Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64"),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} - ${url}\n${text}`);
  }
  return await res.json();
}

/**
 * Fetch all pages of data from a paginated API endpoint
 */
export async function fetchAllPages(baseUrl: string): Promise<any[]> {
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

/**
 * Get the site name from WordPress
 */
export async function getSiteName(baseUrl: string): Promise<string> {
  try {
    const response = await fetchJSON(`${baseUrl}/wp-json`);
    return response.name || "Unknown Site";
  } catch (error) {
    console.warn("Could not fetch site name:", error);
    return "Unknown Site";
  }
}
