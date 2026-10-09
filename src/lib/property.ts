import type { Property } from "@prisma/client";

export function slugify(title: string): string {
  return title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}

type Owner = {
  id: string;
  name: string | null;
  phone?: string;
  role: string;
  isVerified: boolean;
} | null | undefined;

export function serializeProperty(property: Property & { owner?: Owner }) {
  return {
    ...property,
    price: Number(property.price),
    pricePerBigha: property.pricePerBigha === null ? null : Number(property.pricePerBigha),
    pricePerAcre: property.pricePerAcre === null ? null : Number(property.pricePerAcre),
    // owner is passed through as-is (already a plain object, no BigInt fields)
    owner: property.owner ?? undefined,
  };
}
