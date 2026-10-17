<?php
global $wpdb;
// Updating a cloned user should not notify the source site's old email address.
add_filter('send_password_change_email', '__return_false');
add_filter('send_email_change_email', '__return_false');
$user = get_user_by('login', 'admin');
if (!$user) {
    $administrators = get_users(['role' => 'administrator', 'orderby' => 'ID', 'order' => 'ASC', 'number' => 1]);
    $user = $administrators ? $administrators[0] : false;
}
if ($user && $user->user_login !== 'admin') {
    if (false === $wpdb->update($wpdb->users, ['user_login' => 'admin'], ['ID' => $user->ID])) {
        WP_CLI::error('Could not rename the imported administrator.');
    }
    clean_user_cache($user->ID);
}
$data = ['user_email' => getenv('CREATE_SUBSITE_ADMIN_EMAIL'), 'user_pass' => '123', 'display_name' => 'admin'];
if ($user) {
    $data['ID'] = $user->ID;
    $id = wp_update_user($data);
} else {
    $data['user_login'] = 'admin';
    $data['role'] = 'administrator';
    $id = wp_insert_user($data);
}
if (is_wp_error($id)) {
    WP_CLI::error($id->get_error_message());
}
(new WP_User($id))->set_role('administrator');
update_option('blogname', getenv('CREATE_SUBSITE_TITLE'));
update_option('admin_email', getenv('CREATE_SUBSITE_ADMIN_EMAIL'));
update_option('blog_public', '1');
delete_option('new_admin_email');
// Constants can make update_option() think these already match. Write the raw
// stored values too, so later removing the constants cannot restore old URLs.
foreach (['home', 'siteurl'] as $key) {
    if (false === $wpdb->update($wpdb->options, ['option_value' => getenv('CREATE_SUBSITE_URL')], ['option_name' => $key])) {
        WP_CLI::error('Could not update the stored ' . $key . ' URL.');
    }
    wp_cache_delete($key, 'options');
}
wp_cache_delete('alloptions', 'options');
// Preserve permalink_structure, regenerate rules on the next normal request
// when the blueprint's plugins and theme are loaded.
delete_option('rewrite_rules');
