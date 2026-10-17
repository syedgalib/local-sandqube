<?php
if (is_multisite()) {
    WP_CLI::error('Use an independent single-site WordPress installation, not a multisite network.');
}
echo json_encode(['database' => DB_NAME, 'home' => home_url()]);
