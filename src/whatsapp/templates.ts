import type { WhatsAppTemplateDefinition, WhatsAppTemplateLanguage } from "./types.js";

export const WHATSAPP_TEMPLATES: Record<string, WhatsAppTemplateDefinition> = {
  buyer_inquiry_ack: {
    name: "buyer_inquiry_ack",
    category: "UTILITY",
    language: "en",
    englishBody: "Hi {{1}}, we received your land requirement for {{2}}. Our local expert will contact you within 4 hours. Reply STOP to opt out.",
    hindiBody: "नमस्कार {{1}}, आपने {{2}} के लिए जमीन की आवश्यकता दर्ज कराई है। हमारा स्थानीय विशेषज्ञ 4 घंटे के भीतर आपसे संपर्क करेगा। STOP लिखकर बाहर निकलें।",
    variables: ["buyer_name", "requirement_summary"],
  },
  new_lead_owner_notice: {
    name: "new_lead_owner_notice",
    category: "MARKETING",
    language: "en",
    englishBody: "New buyer interest for {{1}} in {{2}}. Buyer: {{3}}. Tap: {{4}} to respond. Reply STOP to opt out.",
    hindiBody: "{{1}} में {{2}} के लिए नया खरीददार रुचि। खरीदार: {{3}}। उत्तर देने के लिए: {{4}}। STOP लिखकर बाहर निकलें।",
    variables: ["property_title", "village", "buyer_name", "chat_link"],
  },
  property_received: {
    name: "property_received",
    category: "UTILITY",
    language: "en",
    englishBody: "We received your listing for {{1}} in {{2}}. It is under review and we will notify you after verification.",
    hindiBody: "हमें {{1}} के लिए {{2}} में आपकी सूची प्राप्त हो गई है। यह समीक्षा के तहत है और सत्यापन के बाद हम आपको सूचित करेंगे।",
    variables: ["property_title", "village"],
  },
  property_approved: {
    name: "property_approved",
    category: "MARKETING",
    englishBody: "Your listing {{1}} in {{2}} has been approved and is now live on PaliaProperty. View it here: {{3}}",
    hindiBody: "आपकी सूची {{1}} ({{2}}) को मंजूरी मिल गई है और अब PaliaProperty पर लाइव है। देखें: {{3}}",
    variables: ["property_title", "village", "listing_link"],
    language: "en",
  },
  property_rejected: {
    name: "property_rejected",
    category: "UTILITY",
    language: "en",
    englishBody: "Your listing {{1}} could not be approved at this time. Reason: {{2}}. Please update the details and submit again.",
    hindiBody: "आपकी सूची {{1}} इस समय मंजूर नहीं की जा सकी। कारण: {{2}}। कृपया विवरण अपडेट करें और फिर से जमा करें।",
    variables: ["property_title", "rejection_reason"],
  },
  saved_search_alert: {
    name: "saved_search_alert",
    category: "MARKETING",
    language: "en",
    englishBody: "A new matching property has been added: {{1}} in {{2}} for {{3}}. Details: {{4}}",
    hindiBody: "एक नया मैचिंग प्रॉपर्टी उपलब्ध है: {{1}} {{2}} में, कीमत {{3}}। विवरण: {{4}}",
    variables: ["property_title", "village", "price", "link"],
  },
  site_visit_reminder: {
    name: "site_visit_reminder",
    category: "UTILITY",
    language: "en",
    englishBody: "Reminder: your site visit for {{1}} is scheduled on {{2}}. Reply YES to confirm or NO to reschedule.",
    hindiBody: "रिमाइंडर: {{1}} के लिए आपकी साइट विजिट {{2}} को निर्धारित है। पुष्टि के लिए YES लिखें या पुनर्निर्धारण के लिए NO लिखें।",
    variables: ["property_title", "visit_time"],
  },
  lead_follow_up: {
    name: "lead_follow_up",
    category: "UTILITY",
    language: "en",
    englishBody: "Hi {{1}}, we haven’t heard from you yet regarding {{2}}. Would you like a callback or site visit? Reply 1 for callback, 2 for site visit.",
    hindiBody: "नमस्कार {{1}}, {{2}} के संबंध में अभी तक हमें कोई प्रतिक्रिया नहीं मिली है। क्या आप कॉलबैक या साइट विजिट चाहते हैं? 1 के लिए कॉलबैक, 2 के लिए साइट विजिट लिखें।",
    variables: ["buyer_name", "property_title"],
  },
};

export function resolveTemplateBody(templateName: string, locale: WhatsAppTemplateLanguage = "en", variables: Record<string, string> = {}): string {
  const def = WHATSAPP_TEMPLATES[templateName];
  if (!def) {
    return "Thanks for your interest in PaliaProperty. We will contact you soon.";
  }
  const body = locale === "hi" ? def.hindiBody : def.englishBody;
  return def.variables.reduce((result, key) => {
    const templateIndex = def.variables.indexOf(key) + 1;
    const token = new RegExp(`\\{\\{${templateIndex}\\}\\}`, "g");
    return result.replace(token, variables[key] ?? "");
  }, body).replace(/\{\{\d+\}\}/g, "");
}

export function buildTemplateVariables(values: Record<string, string>): Array<{ type: "text"; text: string }> {
  return Object.values(values)
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => ({ type: "text", text: String(value) }));
}
