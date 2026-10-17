<?php
global $wpdb;
if (is_multisite()) {
    WP_CLI::error('Blueprint database imports support single-site WordPress installations only.');
}
$originals = $wpdb->get_col("SELECT option_value FROM {$wpdb->options} WHERE option_name IN ('home', 'siteurl')");
$urls = [];
foreach ($originals as $original) {
    $original = rtrim($original, '/');
    $parts = parse_url($original);
    if (!$parts || empty($parts['host']) || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)) {
        WP_CLI::error('Imported home/siteurl must contain valid HTTP or HTTPS URLs.');
    }
    $base = preg_replace('~^https?://~i', '//', $original);
    foreach ([$base, 'http:' . $base, 'https:' . $base] as $url) {
        $urls[$url] = true;
        // JSON often escapes slashes inside a serialized option or post meta.
        $urls[str_replace('/', '\\/', $url)] = true;
    }
}
if (!$urls) {
    WP_CLI::error('Cannot find the source site URLs in the imported options table.');
}
$urls = array_keys($urls);
usort($urls, static function ($a, $b) { return strlen($b) <=> strlen($a); });
// One pass, longest URL first: prevents doubled paths when the source and
// destination share a hostname or home and siteurl use overlapping paths.
echo '(?:' . implode('|', array_map(static function ($url) { return preg_quote($url, '~'); }, $urls)) . ')';
