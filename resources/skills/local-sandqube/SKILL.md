---
name: local-sandqube
description: Set up Local by Flywheel environments and create independent WordPress sites or reusable blueprints using the local-sandqube npm CLI. Use for Local Sandqube commands, directory-based WordPress sandboxes, blueprint capture or restore, and troubleshooting those workflows. Does not provision WordPress Multisite networks.
---

# Local Sandqube

Use the published Node.js CLI to manage independent WordPress installations under one Local environment. Each site has its own directory and database; all share Local's Nginx, PHP, MySQL, and Mailpit services.

## Establish the target

- Use the user's selected Local site root, or the current terminal directory when it contains `app/public` and `conf`. Do not assume the CLI installation or this skill directory is the target. Ask for a root only if the target cannot be determined.
- Pass an absolute `--root` to commands when working outside that root or handling multiple environments. `--root` is supported by every command; `-r` is its alias.
- Use the Node CLI, not the separate `local-sandqube-sh` scripts. Their blueprint stores and behavior differ.
- Require Node.js 22+, npm/npx, a running Local Nginx environment, and a normal single-site parent WordPress installation. The CLI loads `ROOT/app/.envrc` when present; otherwise use Local's Site shell environment. PHP and WP-CLI are needed for initial setup and site creation; SQL imports need `mysql`, and blueprint capture needs `mysqldump`.
- Use the package's help to check current syntax when needed:

```sh
npx --yes local-sandqube --help
npx --yes local-sandqube setup --help
npx --yes local-sandqube create-site --help
npx --yes local-sandqube create-blueprint --help
```

`npx` fetches/caches the package; no global install is necessary. If executing from the CLI's own source checkout causes executable resolution problems, run npx from the Local root or a neutral working directory with `--root`. When explicitly testing source changes, use `node /path/to/checkout/bin/local-sandqube.js` instead.

## Configure an environment

```sh
npx --yes local-sandqube setup --root "/path/to/local-site"
```

Setup backs up and replaces these Nginx templates, including customizations:

- `conf/nginx/nginx.conf.hbs`
- `conf/nginx/site.conf.hbs`
- `conf/nginx/includes/wordpress-single.conf.hbs`

Backups go under `conf/nginx-backups/`. Inspect relevant custom configuration before replacing it when that matters to the requested task. `setup --dry-run` is an optional preview, not a required first command. It downloads nothing and changes no files.

Setup also downloads official WordPress core through WP-CLI, matching the parent's WordPress version, into `ROOT/local-sandqube/blueprints/default/site`. It generates `wp-config.php` using the parent's database connection settings, placeholder `DB_NAME=default`, and environment type `local`. It creates no blueprint database.

Repeated setup runs skip creation whenever `default` exists, even if Nginx already matches. Do not delete an existing blueprint merely to force a download. A failed new blueprint download/configuration is cleaned up so setup can be retried.

After Nginx changes, stop and start the selected site in Local to regenerate the running configuration. If app control is unavailable, tell the user which site needs restarting and distinguish applied templates from activated routing. Creating additional sites later does not itself require a restart.

## Create or restore a site

```sh
npx --yes local-sandqube create-site my_project --root "/path/to/local-site"
npx --yes local-sandqube create-site my_project my-template --root "/path/to/local-site"
```

- `DATABASE_NAME` is required: ASCII letters, digits, and underscores, at most 64 characters. Uppercase is normalized to lowercase. Reject unsupported names rather than silently changing them beyond the CLI's normalization.
- The optional second argument is the exact blueprint directory name. It defaults to `default`, not `wp`. Run setup if the default is absent; `create-site` does not download it. An older blueprint named `wp` is usable when explicitly selected.
- Blueprint storage belongs to the selected environment at `ROOT/local-sandqube/blueprints`, outside the npx cache. A blueprint contains a full WordPress installation in `site/`, with `wp-config.php` or `wp-config-sample.php`, and optionally `db/db.sql`.
- Existing destination folders and databases are rejected. Do not remove them automatically to retry a failed command. The CLI cleans up resources it creates on failure; report any cleanup failure before attempting recovery.

For input `My_Project`, expect:

| Setting | Result |
| --- | --- |
| Database | `my_project` |
| Folder | `ROOT/app/public/my-project` |
| Title | `My Project` |
| URL | Parent home URL forced to HTTPS, plus `/my-project` |
| Administrator | `admin` / `123` |
| Site and admin email | `admin@my-project.com` |
| Search engine indexing | Enabled |

These credentials and indexing defaults are for local development. The CLI inherits parent database credentials and generates fresh authentication keys and salts for each site.

When `db/db.sql` exists, it is imported. The generated site defaults above override imported values; content, other users, plugin/theme settings, and permalink structure are retained. Old stored home/site URLs are replaced across the database with serialization-aware handling. Do not substitute raw text replacement on SQL or serialized options.

The dump's table prefix must match its blueprint configuration. Database-level `CREATE`, `ALTER`, `DROP`, or `USE` statements are rejected. Prefer exports produced by `create-blueprint`. If import fails, diagnose the dump/configuration before retrying; never import into the parent's database.

## Capture a blueprint

```sh
npx --yes local-sandqube create-blueprint my-project my-template --root "/path/to/local-site"
```

Both arguments are required. The source is the exact folder name directly under `ROOT/app/public`, such as `my-project`, not the database name `my_project`. The blueprint name must be unique in the selected root's blueprint storage. Names must be single directory components; quote spaces.

The command copies the full installation, including hidden files and uploads, to `BLUEPRINT/site`, and exports all tables from the source's configured database to `BLUEPRINT/db/db.sql`. Linked files are materialized in the copy. Keep the source idle during capture because file copying and database export happen sequentially. An incomplete new blueprint is removed on failure.

To use the result:

```sh
npx --yes local-sandqube create-site second_project my-template --root "/path/to/local-site"
```

Blueprints contain site configuration and database contents. Keep captures in the selected local blueprint storage; capturing does not imply publishing or uploading them.

## Verify and troubleshoot

Report the command outcome, target root, created paths, site/admin URLs, and any restart still required. Use printed CLI output and appropriate file/configuration checks. When services are reachable, check the new site's URL and WordPress installation; do not claim browser or mail checks that were not performed.

- **Wrong root:** select the folder containing `app/` and `conf/`, then pass `--root` explicitly.
- **Missing tools or database connection:** start the selected Local site and check its Site shell or generated `app/.envrc`. Use its service versions and connection settings.
- **Existing name:** choose another name or ask for the intended handling when replacement is actually requested; do not overwrite by default.
- **Missing/invalid blueprint:** inspect that root's blueprint storage and its `site/` and `db/db.sql`. Existing `default` is skipped even if incomplete; diagnose before removing or replacing it.
- **404s:** confirm setup templates and Local restart; inspect the imported permalink structure and generated URL if routing is active.
- **HTTPS trust:** use Local's SSL trust controls. A diagnostic request that bypasses certificate verification does not establish that trust is fixed.
- **Mail:** sites share the environment's PHP mail transport and Mailpit inbox. Open Local's Tools > Mailpit for inspection. SMTP/API plugins may bypass it. Send test mail only when mail testing is requested or included in the user's task.

Local's Open Site, WP Admin, and one-click login target the parent installation. Use the new site's printed subdirectory URL for child sites.
