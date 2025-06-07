<?php
/**
 * WordPress File Cleanup Endpoint
 * 
 * This file should be placed in your WordPress root directory or in a custom plugin.
 * It creates a REST API endpoint that can delete physical files from the uploads directory.
 */

// Exit if accessed directly
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Register the REST API endpoint for file cleanup
 */
function register_file_cleanup_endpoint() {
    register_rest_route('wpp/v1', '/cleanup-files', array(
        'methods' => 'POST',
        'callback' => 'handle_file_cleanup',
        'permission_callback' => function() {
            return current_user_can('upload_files');
        },
    ));
}
add_action('rest_api_init', 'register_file_cleanup_endpoint');

/**
 * Handle the file cleanup request
 * 
 * @param WP_REST_Request $request The request object
 * @return WP_REST_Response The response
 */
function handle_file_cleanup($request) {
    $params = $request->get_params();
    
    if (empty($params['base_filename']) || empty($params['extension'])) {
        return new WP_REST_Response(
            array('success' => false, 'message' => 'Missing required parameters'),
            400
        );
    }
    
    $base_filename = sanitize_file_name($params['base_filename']);
    $extension = sanitize_file_name($params['extension']);
    
    // Get the uploads directory
    $upload_dir = wp_upload_dir();
    $base_dir = $upload_dir['basedir'];
    
    // Find all matching files
    $deleted_files = array();
    $failed_files = array();
    
    // Get all year directories
    $year_dirs = glob($base_dir . '/*', GLOB_ONLYDIR);
    foreach ($year_dirs as $year_dir) {
        if (!is_numeric(basename($year_dir))) {
            continue;
        }
        
        // Get all month directories
        $month_dirs = glob($year_dir . '/*', GLOB_ONLYDIR);
        foreach ($month_dirs as $month_dir) {
            if (!is_numeric(basename($month_dir))) {
                continue;
            }
            
            // Look for the main file
            $main_file = $month_dir . '/' . $base_filename . $extension;
            if (file_exists($main_file)) {
                if (unlink($main_file)) {
                    $deleted_files[] = $main_file;
                } else {
                    $failed_files[] = $main_file;
                }
            }
            
            // Look for thumbnail files
            $thumbnail_pattern = $month_dir . '/' . $base_filename . '-*x*' . $extension;
            $thumbnail_files = glob($thumbnail_pattern);
            
            foreach ($thumbnail_files as $thumbnail_file) {
                if (file_exists($thumbnail_file)) {
                    if (unlink($thumbnail_file)) {
                        $deleted_files[] = $thumbnail_file;
                    } else {
                        $failed_files[] = $thumbnail_file;
                    }
                }
            }
        }
    }
    
    return new WP_REST_Response(array(
        'success' => true,
        'deleted_count' => count($deleted_files),
        'deleted_files' => $deleted_files,
        'failed_count' => count($failed_files),
        'failed_files' => $failed_files
    ), 200);
}
