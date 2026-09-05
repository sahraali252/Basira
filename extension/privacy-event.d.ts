export type PrivacyEvent = {
  id: string;
  timestamp: number;
  pageUrl: string;
  domain: string;
  category:
    | "Advertising"
    | "Analytics"
    | "Location"
    | "Device"
    | "Fingerprinting"
    | "Identifiers"
    | "Extension Probing"
    | "Other";
  risk: "low" | "medium" | "high";
  blocked: boolean;
  explanation: string;
};
