/**
 * Shared API utilities for WordPress scripts
 */
import fetch from "node-fetch";
import config from "../config";
import {
  getExportBaseUrl,
  getImportBaseUrl,
  getExportCredentials,
  getImportCredentials,
  getImportSite
} from "./config-utils";

/**
 * Fetch JSON data from a URL with authentication
 * Handles both import and export authentication based on the URL
 * Includes retry logic for handling connection errors
 */
export async function fetchJSON(url: string, options: any = {}, retries = 3, delay = 1000): Promise<any> {
  // Determine if this is an export or import request based on the URL
  const exportBaseUrl = getExportBaseUrl();
  const importBaseUrl = getImportBaseUrl();
  
  // Choose the appropriate credentials based on the URL
  let credentials;
  if (url.startsWith(exportBaseUrl)) {
    credentials = getExportCredentials();
  } else if (url.startsWith(importBaseUrl)) {
    credentials = getImportCredentials();
  } else {
    // If URL doesn't match either base URL, use import credentials as default
    credentials = getImportCredentials();
  }
  
  // Add authentication if not already provided
  if (!options.headers) {
    options.headers = {};
  }
  
  if (!options.headers.Authorization && credentials.username && credentials.password) {
    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    options.headers.Authorization = `Basic ${auth}`;
  }

  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type');
    
    let responseData;
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (!response.ok) {
      // Format error message with proper encoding for non-ASCII characters
      let errorMessage = `HTTP ${response.status} - ${url}`;
      
      if (responseData) {
        if (typeof responseData === 'object') {
          // For better display of error messages with non-ASCII characters
          if (responseData.message) {
            // Ensure proper UTF-8 encoding for the message
            const formattedMessage = responseData.message;
            errorMessage += `\n${JSON.stringify({...responseData, message: formattedMessage})}`;  
          } else {
            errorMessage += `\n${JSON.stringify(responseData)}`;  
          }
        } else {
          errorMessage += `\n${responseData}`;
        }
      }
      
      throw new Error(errorMessage);
    }
    
    return responseData;
  } catch (error: any) {
    // Check if we should retry (connection errors like ECONNRESET, socket hang up, etc.)
    const isConnectionError = error.message && (
      error.message.includes('ECONNRESET') ||
      error.message.includes('socket hang up') ||
      error.message.includes('network timeout') ||
      error.message.includes('connection refused') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('ECONNABORTED') ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNABORTED'
    );
    
    // Retry for connection errors if we have retries left
    if (isConnectionError && retries > 0) {
      console.log(`\x1b[33m⚠️ Connection error: ${error.message}. Retrying... (${retries} attempts left)\x1b[0m`);
      
      // Wait before retrying with exponential backoff and jitter
      const jitter = Math.random() * 1000;
      const backoffDelay = delay + jitter;
      console.log(`\x1b[33mWaiting ${Math.round(backoffDelay/1000)}s before retry...\x1b[0m`);
      
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      
      // Retry with one less retry attempt and increased delay (exponential backoff)
      return fetchJSON(url, options, retries - 1, Math.min(delay * 2, 15000)); // Cap at 15 seconds
    }
    
    throw error;
  }
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
