<?php
global $wpdb;
$name = getenv('SANDQUBE_DATABASE');
$action = getenv('SANDQUBE_DATABASE_ACTION');
if (!preg_match('/\A[a-z0-9_]{1,64}\z/', $name) || !in_array($action, ['create', 'drop'], true)) {
    WP_CLI::error('Invalid database operation.');
}
$sql = $action === 'create'
    ? "CREATE DATABASE `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    : "DROP DATABASE `$name`";
if (false === $wpdb->query($sql)) {
    WP_CLI::error($action === 'create'
        ? 'Database creation failed. The name may already exist, or the parent database user may lack CREATE privileges.'
        : 'Could not remove the newly created database.');
}
