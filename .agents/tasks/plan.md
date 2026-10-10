# Implementation Plan

## Overview

Three problems to solve across three repos:
1. **Broker cannot update property images** — backend already has `POST /properties/:id/images` but it only allows owner OR admin. Broker role is excluded. Fix: extend the auth check to also allow `BROKER`/`AGENT` roles when the property's `ownerId` matches them, **OR** allow any broker (the property is managed by the broker on behalf of an owner). Reading the code: `isOwner` checks `property.ownerId === request.authUser.userId`, which only works when the broker created the property (they are the `ownerId`). The broker flow creates properties with `ownerId = broker's userId`, so this actually works — the bug is that `BROKER` role is not blocked, it's just untested in the UI. The real gap is the **frontend** and **mobile**: neither exposes an image upload UI for properties in the broker dashboard. The `uploadPropertyImages` / `deletePropertyImage` API functions already exist in `client.ts`.
2. **Broker cannot upload legal documents** — `POST /properties/:id/documents` exists in `workflows.ts` but has a role-check bug: it ANDs `ownerRoles.includes(role)` with `property.ownerId !== userId` (using `!==` instead of `===`), so it always rejects owners too. Fix the logic and add the UI.
3. **WhatsApp automation** — four new events need templates + `enqueueWhatsApp` calls wired into route handlers. The `enqueueWhatsApp` service is already complete; only templates and hook call-sites are missing.

---

- [ ] 1. **Fix document upload authorization bug in `workflows.ts`**

      The condition `!ownerRoles.includes(...) || property.ownerId !== request.authUser.userId` is inverted — `!==` should be `===`. Also add `BROKER`/`AGENT` roles explicitly. No migration needed.

      Files: `/var/www/html/be-property/src/routes/workflows.ts`

      Change: replace line
      ```ts
      if (!ownerRoles.includes(request.authUser.role) || property.ownerId !== request.authUser.userId)
      ```
      with
      ```ts
      if (!ownerRoles.includes(request.authUser.role) || property.ownerId !== request.authUser.userId)
      ```
      Wait — re-reading: the check is `!ownerRoles.includes(role) || property.ownerId !== userId`. This means "deny if NOT in ownerRoles OR if not the owner". That is the correct intent (deny if role is wrong, deny if not owner), so the logic is correct — it just blocks non-owners even when role is valid. The issue is `||` should be `&&`. Change to:
      ```ts
      if (!ownerRoles.includes(request.authUser.role) && property.ownerId !== request.authUser.userId)
      ```
      This allows admins (ownerRoles includes ADMIN) even if they don't own it, and allows owners regardless of role.
      Also add PDF mime-type validation: only `application/pdf`, `image/jpeg`, `image/png` should be accepted.

      Verify: `npm run build` in `/var/www/html/be-property` compiles cleanly (TypeScript).

- [ ] 2. **Add broker image update permission to `properties.ts`**

      The image upload route (`POST /properties/:id/images`) currently checks `isOwner = property.ownerId === request.authUser.userId`. Brokers create properties with themselves as `ownerId`, so this already works. However, verify the `DELETE /properties/:id/images` endpoint has identical logic and confirm no role restriction blocks `BROKER`.

      Actual change needed: None on backend for brokers who own the property. But add a new `PATCH /properties/:id/images` endpoint that **replaces** the entire images array (not just appends) — the current `POST` only appends. This is needed for the "replace images" use case.

      Files: `/var/www/html/be-property/src/routes/properties.ts`

      Add after the DELETE images handler:
      ```ts
      // PATCH /properties/:id/images — replace the entire images array
      app.patch<{ Params: { id: string } }>("/properties/:id/images", { preHandler: app.authenticate }, async (request, reply) => { ... })
      ```
      Accept multipart: delete all existing files from disk, upload the new batch, set `images` to the new array.

      Verify: `npm run build` passes.

- [ ] 3. **Add four new WhatsApp event types and templates**

      Add to `types.ts`: four new `WhatsAppEventName` values:
      - `"broker_images_uploaded"` — broker uploaded property images
      - `"broker_document_uploaded"` — broker uploaded legal document
      - `"new_property_inquiry_broker"` — new inquiry → notify broker
      - `"new_lead_broker_notice"` — new lead → notify broker

      Add to `templates.ts`: four new entries in `WHATSAPP_TEMPLATES`:

      ```
      broker_images_uploaded:
        englishBody: "Hi {{1}}, {{2}} has uploaded {{3}} new photos for your property \"{{4}}\" in {{5}}. View your listing to review the images."
        variables: ["owner_name", "broker_name", "photo_count", "property_title", "village"]

      broker_document_uploaded:
        englishBody: "A legal document ({{1}}) has been uploaded for property \"{{2}}\" in {{3}} by broker {{4}}. Please review and verify."
        variables: ["document_type", "property_title", "village", "broker_name"]

      new_property_inquiry_broker:
        englishBody: "Hi {{1}}, new buyer inquiry for your listing \"{{2}}\" in {{3}} from {{4}}. Purpose: {{5}}. Reply to connect."
        variables: ["broker_name", "property_title", "village", "buyer_name", "purpose"]

      new_lead_broker_notice:
        englishBody: "Hi {{1}}, {{2}} is interested in \"{{3}}\" in {{4}}. Phone: {{5}}. Tap to follow up."
        variables: ["broker_name", "buyer_name", "property_title", "village", "buyer_phone"]
      ```

      Files:
      - `/var/www/html/be-property/src/whatsapp/types.ts`
      - `/var/www/html/be-property/src/whatsapp/templates.ts`

      Verify: `npm run build` passes.

- [ ] 4. **Wire WhatsApp notifications into route handlers**

      **A. `POST /properties/:id/images` in `properties.ts`**
      After updating the DB, fetch the property owner (`include: { owner: { select: { whatsappNumber, phone, name } } }`), then if the uploader is NOT the owner (i.e. a broker uploaded on behalf of an owner), enqueue `broker_images_uploaded` to the owner's `whatsappNumber ?? phone`.

      **B. `POST /properties/:id/documents` in `workflows.ts`**
      After saving each document, fetch the property owner. If uploader ≠ owner, enqueue `broker_document_uploaded` to the owner's phone. Additionally notify admin: read `process.env.ADMIN_PHONE` (already in `.env.example`) and enqueue the same template to admin.

      **C. `POST /leads` in `leads.ts`**
      After creating the lead, fetch the property with its owner (`include: { owner: { select: { role, whatsappNumber, phone, name } } }`). If the owner's role is `BROKER` or `AGENT`, enqueue `new_lead_broker_notice` to the owner's `whatsappNumber ?? phone`.
      Also keep the existing `new_lead_owner_notice` template — no change to buyer-side behavior.

      **D. `POST /inquiries` in `inquiries.ts`**
      After the existing buyer ACK, find all active BROKER/AGENT users and send `new_property_inquiry_broker` — BUT this is a general inquiry with no specific property, so only send to admin's phone using `ADMIN_PHONE` env var (or skip per-broker fan-out for general inquiries to avoid spam). Use `dedupeKey: \`inquiry-broker:${inquiry.id}\`` to prevent duplicates.

      Import `enqueueWhatsApp` in `properties.ts`, `workflows.ts`, and `leads.ts` (it's already imported in `inquiries.ts`).

      Files:
      - `/var/www/html/be-property/src/routes/properties.ts`
      - `/var/www/html/be-property/src/routes/workflows.ts`
      - `/var/www/html/be-property/src/routes/leads.ts`
      - `/var/www/html/be-property/src/routes/inquiries.ts`

      Verify: `npm run build` passes.

- [ ] 5. **Frontend: Add image management UI to broker/seller dashboard**

      The `SellerDashboard` component already shows a listing per property with edit/delete buttons. Add an "Images" management section within the property tile's expanded/edit view.

      Decision: Add a new `PropertyImagesPanel` component (a compact inline panel, not a modal) rendered inside the existing property tile when an "Images" icon button is clicked. It shows current images as thumbnails with individual delete buttons, plus a file input for uploading new images.

      The `uploadPropertyImages` and `deletePropertyImage` functions already exist in `client.ts` — use them directly.

      New file: `/var/www/html/fe-property/components/property-images-panel.tsx`

      Modify: `/var/www/html/fe-property/components/seller-dashboard.tsx`
      - Import `PropertyImagesPanel`
      - Add `imagesOpenId` state (track which property has images panel open)
      - Add a camera/image icon button alongside the existing edit/view/delete buttons per property tile
      - Render `<PropertyImagesPanel>` below the tile when `imagesOpenId === prop.id`
      - On upload success, refresh that property's image list (update `properties` state)

      Verify: `npm run build` in `/var/www/html/fe-property` — Next.js build completes with no TypeScript errors.

- [ ] 6. **Frontend: Add legal document upload UI to broker/seller dashboard**

      Decision: Add a `PropertyDocumentsPanel` component rendered similarly to the images panel. Shows existing documents fetched from `GET /properties/:id/documents` (need to add this API call to `client.ts`). Shows each doc with type label and a delete button. Provides a file input (PDF only) with a document type selector (KHATAUNI/KHASRA/REGISTRY/OTHER).

      The `uploadPropertyDocument` function already exists in `client.ts`.

      Add to `client.ts`: `fetchPropertyDocuments(propertyId: string)` — GET `/properties/:id/documents` (need to add a backend route for this — see item 7).

      New file: `/var/www/html/fe-property/components/property-documents-panel.tsx`

      Modify:
      - `/var/www/html/fe-property/lib/api/client.ts` — add `fetchPropertyDocuments`
      - `/var/www/html/fe-property/components/seller-dashboard.tsx` — add documents panel toggle button and render `<PropertyDocumentsPanel>`

      Verify: `npm run build` in `/var/www/html/fe-property` — no TypeScript errors.

- [ ] 7. **Backend: Add GET /properties/:id/documents route**

      The frontend and mobile need to list existing documents for a property. Add this to `workflows.ts`.

      Route: `GET /properties/:id/documents` — authenticated, owner/admin only. Returns all documents for the property.

      Files: `/var/www/html/be-property/src/routes/workflows.ts`

      Verify: `npm run build` passes.

- [ ] 8. **Mobile: Add image upload to seller dashboard**

      The Flutter `SellerDashboard` has a property tile with a `PopupMenuButton` offering "View", "Enquiries", "Archive". Add a 4th option "Manage Images" that opens a new screen/bottom sheet `ManageImagesSheet`.

      The `ApiClient.uploadImages` method already exists in `api_client.dart`. Need to add:
      - `PropertyService.deletePropertyImage(propertyId, imageUrl)` static method using a new `ApiClient.deleteImage` method (HTTP DELETE with JSON body).
      - `PropertyService.fetchPropertyImages(propertyId)` — GET `/properties/mine` already returns full images array; extract from existing data rather than a new call.

      New file: `/var/www/html/property-app/lib/screens/seller/manage_images_sheet.dart`

      The sheet:
      - Shows existing images as a `GridView` with delete buttons (confirmation dialog before delete)
      - Has a FAB/button "Add Photos" that uses `image_picker` — BUT `image_picker` is NOT in `pubspec.yaml`.
        Decision: use `file_picker` package instead of `image_picker` since neither is in the manifest. Since neither is available, use the platform gallery via `FilePicker` — but `file_picker` is also not in `pubspec.yaml`.
        **Resolution**: add `image_picker: ^1.1.2` to `pubspec.yaml` under dependencies (widely maintained, works on Android/iOS). This is the minimal necessary new dependency.
      - On selection, calls `ApiClient.uploadImages` and refreshes the list.

      Modify:
      - `/var/www/html/property-app/pubspec.yaml` — add `image_picker: ^1.1.2`
      - `/var/www/html/property-app/lib/services/api_client.dart` — add `deleteImage(propertyId, imageUrl)` method
      - `/var/www/html/property-app/lib/services/property_service.dart` — add `deletePropertyImage`, `fetchPropertyDocuments`
      - `/var/www/html/property-app/lib/screens/seller/seller_dashboard.dart` — add "Manage Images" menu option

      Verify: `flutter pub get` runs successfully (no dependency conflicts). `flutter analyze` passes.

- [ ] 9. **Mobile: Add document upload to seller dashboard**

      Add a 5th popup menu option "Legal Documents" that opens `ManageDocumentsSheet`.

      Document upload needs `file_picker` for PDF selection. Add `file_picker: ^8.1.7` to `pubspec.yaml`.

      New file: `/var/www/html/property-app/lib/screens/seller/manage_documents_sheet.dart`

      The sheet:
      - Fetches existing documents via `PropertyService.fetchPropertyDocuments(propertyId)` (new service method calling `GET /properties/:id/documents`)
      - Shows each doc with type badge and filename
      - "Upload Document" button opens `FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['pdf'])`
      - Type selector dropdown: KHATAUNI, KHASRA, REGISTRY, OTHER
      - On pick, calls `ApiClient.uploadDocument(propertyId, file, documentType)` (new method — multipart POST)
      - Shows snackbar on success

      Add to `ApiClient`:
      - `uploadDocument(propertyId, filePath, fileName, documentType)` — multipart POST to `/properties/:propertyId/documents`
      - `fetchDocuments(propertyId)` — GET `/properties/:propertyId/documents`

      Modify:
      - `/var/www/html/property-app/pubspec.yaml` — add `file_picker: ^8.1.7`
      - `/var/www/html/property-app/lib/services/api_client.dart`
      - `/var/www/html/property-app/lib/services/property_service.dart`
      - `/var/www/html/property-app/lib/screens/seller/seller_dashboard.dart`

      Verify: `flutter pub get` succeeds. `flutter analyze` passes.

---

## Migration notes

No new Prisma models are needed. The `PropertyDocument` model already exists with `type`, `url`, `filename`, `mimeType` fields. No `prisma migrate` commands are required.

## `.env` keys needed (already in `config.ts`, absent from `.env.example`)

Add these to `.env.example` for documentation:
```
WHATSAPP_TOKEN=
PHONE_NUMBER_ID=
WABA_ID=
VERIFY_TOKEN=
APP_SECRET=
WHATSAPP_API_BASE=https://graph.facebook.com/v19.0
ADMIN_PHONE=9876543210
```
`ADMIN_PHONE` is already present. The WhatsApp keys are in `config.ts` but not in `.env.example` — add them.

File: `/var/www/html/be-property/.env.example`
