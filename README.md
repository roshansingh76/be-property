# be-property

## Development super-admin login

For local development only, the API accepts the fixed OTP `123456` when
`NODE_ENV=development`. To sign in as a super admin:

1. Set `NODE_ENV=development` and your 10-digit Indian mobile number as
   `ADMIN_PHONE` in the backend `.env` file.
2. Start the local database and apply migrations.
3. Run `npm run prisma:migrate` to apply the local database migrations.
4. Start the backend with `npm run dev`. Its `predev` script creates or promotes
   `ADMIN_PHONE` as `SUPER_ADMIN` before the server starts.
5. Set the frontend `.env.local` to
   `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`.
6. Open `http://localhost:3000/login`, enter the `ADMIN_PHONE` number, request
   an OTP, and enter `123456`. The app redirects the signed-in super admin to
   `/admin`.

The fixed OTP is only enabled in development mode. Never expose a development
backend publicly; production sign-in must use the configured OTP provider.

## CORS

The API allows requests from the configured `WEB_ORIGIN`, the production
frontend at `https://veda-fe-property.onrender.com`, and any comma-separated
origins listed in `EXTRA_WEB_ORIGINS`. Origins must be exact scheme-and-host
values (without a trailing slash). Redeploy the backend after changing its
allowed origins.