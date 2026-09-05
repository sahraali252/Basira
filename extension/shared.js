/* Shared constants and small URL helpers. Kept dependency-free for the MVP. */
const BASIRA = {
  EVENTS_KEY: "privacyEvents",
  SHIELD_KEY: "shieldEnabled",
  MAX_EVENTS: 200,

  hostnameFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  },

  // A deliberately small registrable-domain approximation. It handles common
  // two-part country suffixes without bringing a public-suffix-list dependency
  // into this hackathon extension.
  siteDomain(hostname) {
    if (!hostname) return null;
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    const twoPartSuffixes = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "com.mx"]);
    const suffix = parts.slice(-2).join(".");
    return twoPartSuffixes.has(suffix) && parts.length >= 3 ? parts.slice(-3).join(".") : suffix;
  },

  isSameSite(firstPartyHost, requestHost) {
    const firstParty = this.siteDomain(firstPartyHost);
    const requested = this.siteDomain(requestHost);
    return Boolean(firstParty && requested && firstParty === requested);
  },

  makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};
