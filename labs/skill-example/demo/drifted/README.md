# Pantry

An invented recipe site, with two deliberate mistakes in its environment tables, so the
`keeping-env-docs-in-step` checker has something to report: nothing here runs.

## Environment variables

Copy `.env.example` to `.env`. Every name appears in the same group in both places.

### server

| Name | Default | Required | Secret | Purpose |
|------|---------|----------|--------|---------|
| `PORT` | 8080 | no | no | Port the web server listens on |
| `LOG_LEVEL` | info | no | no | One of debug, info, warning, error |

### database

| Name | Default | Required | Secret | Purpose |
|------|---------|----------|--------|---------|
| `DATABASE_URL` | none | yes | yes | Connection string, including the password |

### search

| Name | Default | Required | Secret | Purpose |
|------|---------|----------|--------|---------|
| `SEARCH_API_KEY` | none | yes | yes | Key for the hosted search service |
| `SEARCH_RESULTS_PER_PAGE` | 20 | no | no | Recipes shown on one results page |
| `CACHE_TTL_SECONDS` | 300 | no | no | How long a results page is cached |

## Running it

Not applicable: this is a demonstration folder.
