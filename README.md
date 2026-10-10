# be-property

## CORS

The API allows requests from the configured `WEB_ORIGIN`, the production
frontend at `https://veda-fe-property.onrender.com`, and any comma-separated
origins listed in `EXTRA_WEB_ORIGINS`. Origins must be exact scheme-and-host
values (without a trailing slash). Redeploy the backend after changing its
allowed origins.