# Local Sandqube

Create independent WordPress sites inside a single [Local](https://localwp.com/)
environment. Each site gets its own folder and database while sharing Local's
Nginx, PHP, MySQL, and Mailpit services.

- Configure Nginx and download a reusable default WordPress blueprint.
- Create sites from WordPress files or blueprints with database exports.
- Capture existing sites as reusable blueprints.
- Migrate imported URLs, including serialized WordPress data.

## Usage

Run with npx from your Local site's root directory—the folder containing
`app/` and `conf/`:

```sh
cd "/path/to/local-site"
npx local-sandqube setup
```

Stop and start the site in Local to activate the Nginx configuration, then create
a site:

```sh
npx local-sandqube create-site my_project
```

For a parent site at `https://example.local`, the new site will be available at
`https://example.local/my-project` with administrator credentials `admin` / `123`.
These defaults are intended for local development.

## Installation

No global installation is required. npx downloads and caches the npm package
when needed. Local and its PHP, MySQL, and WP-CLI tools must already be available.

If you prefer a global command:

```sh
npm install --global local-sandqube
local-sandqube --help
```

## Requirements

- Node.js **22 or newer**, with npm/npx, on macOS or Linux.
- A Local environment using **Nginx** and a normal single-site WordPress root
  installation. WordPress Multisite networks are not supported.
- The Local site must be running for setup, site creation, and blueprint capture.
- Local's `php` and `wp`; `mysql` for SQL imports; `mysqldump` for blueprint
  exports. The CLI reads the selected root's `app/.envrc` if present. Otherwise,
  run from Local's **Site shell**.
- Write access to the selected site. Its parent database user needs database
  creation privileges and permission to remove a new database if setup fails.
- Run `setup` once and stop/start the Local site before creating subsites.
  Use Local's SSL controls to trust its certificate for HTTPS URLs.

## Choosing a Local site

**Every command defaults to the current terminal directory (`process.cwd()`).**
The npm installation directory, npx cache, and location of the executable are
never used as the default Local root.

Run from a Local site root containing `app/` and `conf/`, or pass `--root PATH`:

```sh
npx local-sandqube setup --root "/path/to/local-site"
npx local-sandqube create-site my_project --root "/path/to/local-site"
npx local-sandqube create-blueprint my-project my-template --root "/path/to/local-site"
```

`--root` works before or after the command; `-r` is an alias. Relative paths are
resolved against the current terminal directory. `setup` additionally accepts
its root as an optional positional argument:

```sh
npx local-sandqube setup "/path/to/local-site"
npx local-sandqube --root ../sandbox create-site my_project my-template
```

Do not supply both a positional setup root and `--root`. For `create-site`
and `create-blueprint`, use `--root` to distinguish the root from blueprint names.

## Commands

| Command | Purpose |
| --- | --- |
| `setup [ROOT] [--dry-run] [--root PATH]` | Configure Nginx and prepare the default WordPress blueprint. |
| `create-site DATABASE_NAME [BLUEPRINT] [--root PATH]` | Create a site from a blueprint, importing SQL when present. |
| `create-blueprint SITE_DIRECTORY BLUEPRINT_NAME [--root PATH]` | Save an existing site's files and database as a unique blueprint. |

Arguments in brackets are optional. All commands support `--help` and `-h`.
`--version` and `-v` show the package version.

## Blueprint storage

Blueprints always belong to the **selected Local site**, separate from the
installed/cached CLI package:

```text
SITE_ROOT/
├── app/
│   ├── .envrc
│   └── public/
│       ├── wp-config.php            # Parent installation
│       └── my-project/              # Independent child installation
├── conf/
└── local-sandqube/
    └── blueprints/
        ├── default/
        │   └── site/                # Full WordPress installation
        └── my-template/
            ├── site/
            └── db/db.sql            # Optional SQL dump
```

Blueprint storage is created under the selected Local site as needed. It is
independent of the CLI installation and npx cache. User blueprints,
configurations, uploads, and SQL dumps are excluded from the npm package.

## Command reference

### setup

```sh
npx local-sandqube setup
```

Setup also creates the `default` blueprint when it is absent. An existing
blueprint is preserved, including when Nginx already matches.

**Stop and start the site in Local afterward** to regenerate the running
configuration. Adding another subsite later does not require a restart.

Previewing is optional; you do not need to run two commands:

```sh
npx local-sandqube setup --dry-run
```

`--dry-run` previews both Nginx and blueprint changes without downloading
WordPress or modifying files.

The command replaces these three templates, including their customizations:

- `conf/nginx/nginx.conf.hbs`
- `conf/nginx/site.conf.hbs`
- `conf/nginx/includes/wordpress-single.conf.hbs`

Originals are backed up under `conf/nginx-backups/<timestamp>-<unique-suffix>/`.
The backup location is printed. Repeated runs skip template replacement when
the templates already match. On a partial failure, modified files are restored where possible.
PHP, Mailpit, WordPress files, and database contents are preserved.

To undo a change, restore the three files from the printed backup directory to
`conf/nginx`, preserving its `includes` subdirectory, and restart the Local site.

### create-site

```sh
npx local-sandqube create-site My_Project
npx local-sandqube create-site another_project my-template
```

| Argument | Required? | Meaning |
| --- | --- | --- |
| `DATABASE_NAME` | Yes | ASCII letters, digits, and underscores; normalized to lowercase; maximum 64 characters. |
| `BLUEPRINT` | No | Exact directory name in this root's blueprint storage. Defaults to `default`. |
| `--root PATH` | No | Target Local site; otherwise the current terminal directory. |

For `My_Project`, with parent home URL `https://sandbox.local`:

| Setting | Value |
| --- | --- |
| Database | `my_project` |
| Folder | `app/public/my-project` |
| Site title | `My Project` |
| Site and WordPress URL | `https://sandbox.local/my-project` |
| Admin URL | `https://sandbox.local/my-project/wp-admin/` |
| Administrator | `admin` / `123` |
| Site and administrator email | `admin@my-project.com` |
| Search engine indexing | Enabled |

The parent home URL is forced to HTTPS and the normalized folder is appended.
Database credentials come from the parent configuration. The new configuration
gets fresh authentication salts, its own database name, and environment type
`local`. Existing databases and destination folders are never overwritten.

#### Default blueprint

`setup` prepares `ROOT/local-sandqube/blueprints/default/site` using WP-CLI to
download official WordPress core matching the parent installation's version.
It generates `wp-config.php` with the parent's database user, password, and host,
a placeholder database name `default`, and environment type `local`. No blueprint
database is created. Site creation replaces the database name and sets fresh
authentication keys and salts.

The initial setup needs internet access and Local's PHP and WP-CLI. Repeated
setup runs skip blueprint creation whenever `default` already exists, preserving
its files and customizations. If download or configuration fails, the incomplete
new blueprint is removed so setup can be retried.

`create-site` uses `default` when no blueprint is supplied. It requires an
existing blueprint; run `setup` if `default` is missing. An older blueprint
named `wp` remains available by passing `wp` explicitly.

#### Custom blueprints and SQL imports

A blueprint must contain a full WordPress installation in `site/`, with
`wp-config.php` or `wp-config-sample.php`. Quote names with spaces:

```sh
npx local-sandqube create-site my_project "Custom Blueprint"
```

- Without `db/db.sql`, the CLI installs a fresh database.
- With `db/db.sql`, the CLI imports it instead. Its table prefix must match the
  blueprint configuration. Use a single-site table export without `USE` or
  database-level `CREATE`, `ALTER`, or `DROP` statements. `create-blueprint`
  produces the expected format.

Imported content, plugin/theme settings, and permalink structure are preserved.
The generated title, database name, HTTPS URLs, email, `admin` / `123` login,
and indexing setting override imported values. An existing `admin` account is
updated; otherwise the first administrator is renamed while retaining its ID
and post authorship, or an administrator is created if none exists. Other
imported users are retained.

URL migration reads the old stored `home` and `siteurl` values and performs one
serialization-aware replacement across the new database. HTTP, HTTPS,
protocol-relative, and JSON-escaped forms are handled, including options,
metadata, GUIDs, and plugin tables. Rewrite rules regenerate on the next normal
request using the preserved permalink structure.

Normal plugins and themes are skipped during setup; must-use plugins still
run. Installation and administrator-change notification emails are skipped.
Failures trigger cleanup of only the newly created database and folder; a
failed database cleanup is reported for manual recovery.

### create-blueprint

```sh
npx local-sandqube create-blueprint my-project my-template
```

| Argument | Required? | Meaning |
| --- | --- | --- |
| `SITE_DIRECTORY` | Yes | Exact name of an installed WordPress folder directly inside `ROOT/app/public`. |
| `BLUEPRINT_NAME` | Yes | New, unique directory name in this root's blueprint storage. |
| `--root PATH` | No | Target Local site; otherwise the current terminal directory. |

Names are used exactly as supplied. Use the source **folder** name (for example
`my-project`), not its database name (`my_project`). Names are single directory
components, not paths; `.` and `..` are rejected. Existing names, even empty
directories, are rejected. Quote names with spaces:

```sh
npx local-sandqube create-blueprint my-project "Project Template"
```

The resulting blueprint contains `site/` with all WordPress files, including
hidden files, uploads, plugins, themes, and configuration, and `db/db.sql` with
all tables from the source site's configured database. Symlinked files and
directories are copied as real files so the blueprint is self-contained.

Keep the source idle during capture: file copying and export happen in sequence.
InnoDB data is exported in a transaction without table locks. Source files,
database contents, and existing blueprints are preserved. An incomplete new
blueprint is removed if copying or export fails.

Restore it with a new database name:

```sh
npx local-sandqube create-site second_project my-template
```

## Complete workflow

1. Run `npx local-sandqube setup`, then stop and start the environment in Local.
2. Run `npx local-sandqube create-site demo_project`.
3. Customize the new site through its printed URL.
4. Run `npx local-sandqube create-blueprint demo-project demo-template`.
5. Run `npx local-sandqube create-site second_project demo-template`.

## Mailpit and Local controls

Subsites share the selected environment's PHP service and Mailpit inbox. Standard
`wp_mail()` uses the inherited PHP mail transport. Open **Tools > Mailpit** in
Local to inspect messages. An SMTP or email API plugin may use another transport.
Local's Open Site, WP Admin, and one-click login controls target the parent
installation; open the subsite URLs directly.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Not a Local site root | Run from the folder containing `app/` and `conf/`, or pass `--root PATH`. |
| Missing PHP, WP-CLI, MySQL, or mysqldump | Start the selected Local site and use its Site shell, or check `app/.envrc`. |
| Database unavailable | Check that Local is running and the source configuration uses the correct database. |
| Existing database, folder, or blueprint | Choose a new name; these resources are not overwritten. |
| Missing custom blueprint | Capture one using `create-blueprint`, or prepare its `site/` directory. |
| Invalid dump or table prefix | Export a matching single-site blueprint with `create-blueprint`. |
| Subdirectory URLs return 404 | Run `setup`, then stop and start the selected Local site. |
| HTTPS is untrusted | Trust the environment's certificate using Local's SSL controls. |

## Help

```sh
npx local-sandqube --help
npx local-sandqube setup --help
npx local-sandqube create-site --help
npx local-sandqube create-blueprint --help
npx local-sandqube --version
```

## Development

The CLI uses Node.js built-in modules and has no npm dependencies. From a source
checkout, run:

```sh
node bin/local-sandqube.js --help
node bin/local-sandqube.js setup --root "/path/to/local-site"
node bin/local-sandqube.js create-site my_project --root "/path/to/local-site"
npm test
```

Preview the package contents or create an installable tarball:

```sh
npm pack --dry-run
npm pack
```

To run the tarball against a Local site:

```sh
cd "/path/to/local-site"
npx --yes --package=/path/to/local-sandqube-0.1.1.tgz local-sandqube --help
```

The npm package includes the CLI source, Nginx templates, PHP helpers, metadata,
and this README. It excludes site files, blueprints, and database dumps.

## License

UNLICENSED. No open-source license is currently granted.
