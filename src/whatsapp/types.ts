export type WhatsAppTemplateLanguage = "en" | "hi";

export type WhatsAppEventName =
  | "buyer_inquiry_ack"
  | "new_lead_owner_notice"
  | "property_received"
  | "property_approved"
  | "property_rejected"
  | "saved_search_alert"
  | "site_visit_reminder"
  | "lead_follow_up"
  | "chatbot_menu";

export interface WhatsAppJobPayload {
  phone: string;
  eventName: WhatsAppEventName;
  locale?: WhatsAppTemplateLanguage;
  message?: string;
  templateName?: string;
  variables?: Record<string, string>;
  dedupeKey?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface WhatsAppTemplateDefinition {
  name: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  language: WhatsAppTemplateLanguage;
  englishBody: string;
  hindiBody: string;
  variables: string[];
}
