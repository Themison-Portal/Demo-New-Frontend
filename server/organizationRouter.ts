import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { callBackend } from "./_core/backendClient";

const USER_AGENT = "ThemisonOrganizationBot/1.0 (+https://themison.ai)";
const MAX_HTML_CHARS = 750_000;
const MAX_IMAGE_BYTES = 2_000_000;

function ensureWebsiteUrl(rawWebsite?: string | null) {
    const website = String(rawWebsite || "").trim();
    if (!website) return null;
    const withProtocol = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    try {
        const parsed = new URL(withProtocol);
        return parsed.toString();
    } catch {
        return null;
    }
}

function readMeta(html: string, key: string) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(
            `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
            "i"
        ),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return match[1].trim();
    }
    return "";
}

function readLinkHref(html: string, relValue: string) {
    const escaped = relValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
        `<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>`,
        "i"
    );
    const match = html.match(pattern);
    return match?.[1]?.trim() || "";
}

function extractTitle(html: string) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = String(match?.[1] || "")
        .replace(/\s+/g, " ")
        .trim();
    return title;
}

function stripHtml(input: string) {
    return String(input || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|section|article|address|h\d)>/gi, "\n")
        .replace(/<\/?[^>]+>/g, " ")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeNameFromTitle(title: string) {
    const trimmed = String(title || "").trim();
    if (!trimmed) return "";
    const split = trimmed.split(/\s[|\-–—:]\s/).map((token) => token.trim());
    return split[0] || trimmed;
}

function firstLikelyEmail(text: string) {
    const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const candidates = matches.map((entry) => entry.trim());
    const preferred = candidates.find((entry) => !/(noreply|no-reply|example\.com)/i.test(entry));
    return preferred || candidates[0] || "";
}

function normalizePhone(raw: string) {
    const cleaned = String(raw || "")
        .replace(/^tel:/i, "")
        .replace(/[\u00a0]/g, " ")
        .replace(/[^\d+()\-.\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";
    return cleaned;
}

function extractPhoneFromTelLinks(html: string) {
    const phones: string[] = [];
    const pattern = /<a[^>]+href=["']tel:([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
        const normalized = normalizePhone(match[1] || "");
        if (normalized) phones.push(normalized);
    }
    return phones;
}

function firstLikelyPhone(text: string) {
    const matches =
        text.match(
            /(?:\+\d{1,3}[\s.-]*)?(?:\(?\d{2,4}\)?[\s.-]*){2,4}\d{2,4}/g
        ) || [];
    for (const raw of matches) {
        const normalized = normalizePhone(raw);
        if (!normalized) continue;
        if (/^\d{4}$/.test(normalized.replace(/\D/g, ""))) continue;
        return normalized;
    }
    return "";
}

function parseJsonLdCandidates(html: string) {
    const candidates: Array<Record<string, any>> = [];
    const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = pattern.exec(html)) !== null) {
        const raw = String(scriptMatch[1] || "").trim();
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                parsed.forEach((entry) => {
                    if (entry && typeof entry === "object") candidates.push(entry);
                });
            } else if (parsed && typeof parsed === "object") {
                candidates.push(parsed);
            }
        } catch {
            // ignore malformed json-ld
        }
    }
    return candidates;
}

function pickAddressFromJsonLd(entries: Array<Record<string, any>>) {
    for (const entry of entries) {
        const address = entry?.address;
        if (!address) continue;
        if (typeof address === "string") {
            return {
                fullAddress: address.trim(),
                location: address.trim(),
            };
        }
        if (address && typeof address === "object") {
            const street = String(address.streetAddress || "").trim();
            const postal = String(address.postalCode || "").trim();
            const city = String(address.addressLocality || "").trim();
            const region = String(address.addressRegion || "").trim();
            const country = String(address.addressCountry || "").trim();
            const pieces = [street, [postal, city].filter(Boolean).join(" "), region, country].filter(Boolean);
            const fullAddress = pieces.join(", ");
            const location = [city, country].filter(Boolean).join(", ");
            if (fullAddress || location) {
                return {
                    fullAddress,
                    location: location || fullAddress,
                };
            }
        }
    }
    return null;
}

function extractAddressTagSnippets(html: string) {
    const snippets: string[] = [];
    const pattern = /<address[^>]*>([\s\S]*?)<\/address>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
        const text = stripHtml(String(match[1] || "")).replace(/\s+/g, " ").trim();
        if (text.length >= 10) snippets.push(text);
    }
    return snippets;
}

function splitTextLines(text: string) {
    return String(text || "")
        .replace(/\u00a0/g, " ")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function parseCityCountryFromAddress(value: string) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const cityCountryMatch = text.match(
        /\b\d{4,6}\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'-]+?)(?:,\s*([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'-]+))?$/i
    );
    if (cityCountryMatch) {
        const city = String(cityCountryMatch[1] || "").trim();
        const country = String(cityCountryMatch[2] || "").trim();
        return [city, country].filter(Boolean).join(", ");
    }
    return "";
}

function looksLikeStreetLine(line: string) {
    return (
        /\d/.test(line) &&
        /\b(street|st\.|road|rd\.|avenue|ave\.|boulevard|blvd\.|lane|ln\.|drive|dr\.|way|straat|laan|weg|gade|nytorv|plaza|square)\b/i.test(
            line
        )
    );
}

function extractAddressFromText(text: string) {
    const lines = splitTextLines(text).slice(0, 400);
    const postalLinePattern = /\b\d{4,6}\s+[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ .'-]{2,}\b/i;
    for (let i = 0; i < lines.length; i++) {
        const current = lines[i];
        if (!postalLinePattern.test(current)) continue;
        const prev = lines[i - 1] || "";
        const next = lines[i + 1] || "";
        const addressParts: string[] = [];
        if (looksLikeStreetLine(prev) || /\d/.test(prev)) {
            addressParts.push(prev);
        }
        addressParts.push(current);
        if (/^[A-Za-zÀ-ÖØ-öø-ÿ .'-]{3,}$/.test(next) && next.length <= 40) {
            addressParts.push(next);
        }
        const fullAddress = addressParts.join(", ").replace(/\s+/g, " ").trim();
        const location = parseCityCountryFromAddress(fullAddress || current) || current;
        if (fullAddress || location) {
            return {
                fullAddress: fullAddress || current,
                location,
            };
        }
    }
    return null;
}

function extractInfoLinks(html: string, base: URL) {
    const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const links: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) !== null) {
        const href = String(match[1] || "").trim();
        const label = stripHtml(String(match[2] || "")).toLowerCase();
        if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) continue;
        const token = `${href} ${label}`.toLowerCase();
        if (!/\b(contact|about|impress|legal|office|location|where|find us|adresse|adres|kontakt)\b/.test(token)) {
            continue;
        }
        try {
            const absolute = new URL(href, base);
            if (absolute.hostname !== base.hostname) continue;
            if (!/^https?:$/i.test(absolute.protocol)) continue;
            links.push(absolute.toString());
        } catch {
            // ignore invalid links
        }
        if (links.length >= 3) break;
    }
    return Array.from(new Set(links));
}

async function fetchHtml(url: string) {
    try {
        const response = await fetch(url, {
            headers: {
                "user-agent": USER_AGENT,
                accept: "text/html,application/xhtml+xml",
            },
            redirect: "follow",
        });
        if (!response.ok) return null;
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
        const html = (await response.text()).slice(0, MAX_HTML_CHARS);
        return { html, finalUrl: response.url || url };
    } catch {
        return null;
    }
}

async function fetchLogoAsDataUrl(logoUrl: string) {
    try {
        const response = await fetch(logoUrl, {
            headers: { "user-agent": USER_AGENT, accept: "image/*,*/*;q=0.8" },
            redirect: "follow",
        });
        if (!response.ok) return null;
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.startsWith("image/")) return null;
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_IMAGE_BYTES) return null;
        const encoded = Buffer.from(arrayBuffer).toString("base64");
        return `data:${contentType};base64,${encoded}`;
    } catch {
        return null;
    }
}

/**
 * Maps the real backend Organization (app/models/organizations.py) to the
 * client shape. NOTE: the backend model currently only stores `name` (plus
 * onboarding/support flags) — location/address/website/etc. are NOT
 * persisted server-side yet. Those fields are returned as empty strings
 * until the backend model is extended to store them.
 */
function mapBackendOrgToClient(org: any) {
    return {
        id: org.id,
        name: org.name,
        onboardingCompleted: Boolean(org.onboarding_completed),
        supportEnabled: Boolean(org.support_enabled),
    };
}

export const organizationRouter = router({
    /**
     * Returns the real organization the authenticated member belongs to,
     * proxied from GET /api/organizations/me on the FastAPI backend. This
     * replaces the old localStorage-based fake org profile.
     *
     * Uses publicProcedure + a manual authToken check (rather than
     * protectedProcedure) because this BFF's own local `User` DB lookup
     * (ctx.user) can be unavailable independent of Auth0 login state —
     * see "[Database] Cannot get user: database not available" in server
     * logs. The real backend independently validates the Bearer token, so
     * ctx.authToken alone is sufficient and correct here.
     */
    getMine: publicProcedure.query(async ({ ctx }) => {
        if (!ctx.authToken) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "Please log in." });
        }
        const org = await callBackend<any>(`/api/organizations/me`, {
            user: ctx.user,
            authToken: ctx.authToken,
        });
        return mapBackendOrgToClient(org);
    }),

    /**
     * Updates the authenticated member's organization. Proxies to
     * PUT /api/organizations/me on the FastAPI backend. NOTE: the backend
     * Organization model currently only persists `name` — other profile
     * fields on the Organization Overview page (address, website, etc.)
     * are not yet backed by real storage.
     */
    update: publicProcedure
        .input(
            z.object({
                name: z.string().optional(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            if (!ctx.authToken) {
                throw new TRPCError({ code: "UNAUTHORIZED", message: "Please log in." });
            }
            const org = await callBackend<any>(`/api/organizations/me`, {
                method: "PUT",
                body: { name: input.name },
                user: ctx.user,
                authToken: ctx.authToken,
            });
            return mapBackendOrgToClient(org);
        }),

    suggestFromWebsite: protectedProcedure
        .input(
            z.object({
                name: z.string().max(200).optional(),
                website: z.string().max(500).optional(),
            })
        )
        .mutation(async ({ input }) => {
            const normalizedUrl = ensureWebsiteUrl(input.website);
            if (!normalizedUrl) {
                throw new Error("A valid organization website is required for web autofill.");
            }

            const websiteUrl = new URL(normalizedUrl);
            const primaryPage = await fetchHtml(websiteUrl.toString());
            if (!primaryPage) {
                throw new Error("Unable to fetch the website for organization autofill.");
            }

            const html = primaryPage.html;
            const finalUrl = primaryPage.finalUrl || websiteUrl.toString();
            const finalBase = new URL(finalUrl);
            const finalDomain = finalBase.hostname.replace(/^www\./, "");
            const title = extractTitle(html);
            const ogSiteName = readMeta(html, "og:site_name");
            const appName = readMeta(html, "application-name");
            const metaDescription = readMeta(html, "description") || readMeta(html, "og:description");
            const ogImage = readMeta(html, "og:image");
            const iconHref =
                readLinkHref(html, "apple-touch-icon") ||
                readLinkHref(html, "icon") ||
                readLinkHref(html, "shortcut icon");
            const logoCandidate = readMeta(html, "og:logo") || ogImage || iconHref;

            let resolvedLogoUrl = "";
            if (logoCandidate) {
                try {
                    resolvedLogoUrl = new URL(logoCandidate, finalBase).toString();
                } catch {
                    resolvedLogoUrl = "";
                }
            }

            const jsonLd = parseJsonLdCandidates(html);
            let addressCandidate = pickAddressFromJsonLd(jsonLd);
            const jsonLdName =
                jsonLd.find((entry) => typeof entry?.name === "string")?.name?.toString().trim() || "";
            const emailFromJsonLd =
                jsonLd.find((entry) => typeof entry?.email === "string")?.email?.toString().trim() || "";
            const phoneFromJsonLd =
                jsonLd.find((entry) => typeof entry?.telephone === "string")?.telephone?.toString().trim() || "";
            const textContent = stripHtml(html);
            const emailFromText = firstLikelyEmail(textContent);
            const phoneFromText = firstLikelyPhone(textContent);
            const phoneFromTelHref = extractPhoneFromTelLinks(html)[0] || "";
            const addressTagSnippet = extractAddressTagSnippets(html)[0] || "";
            if (!addressCandidate && addressTagSnippet) {
                addressCandidate = {
                    fullAddress: addressTagSnippet,
                    location: parseCityCountryFromAddress(addressTagSnippet),
                };
            }
            if (!addressCandidate) {
                addressCandidate = extractAddressFromText(textContent);
            }

            let contactEmail = emailFromJsonLd || emailFromText || "";
            let contactPhone = normalizePhone(phoneFromJsonLd) || phoneFromTelHref || phoneFromText || "";
            if (!addressCandidate || !contactEmail || !contactPhone) {
                const infoLinks = extractInfoLinks(html, finalBase);
                for (const infoLink of infoLinks) {
                    if (addressCandidate && contactEmail && contactPhone) break;
                    const infoPage = await fetchHtml(infoLink);
                    if (!infoPage) continue;
                    const infoText = stripHtml(infoPage.html);
                    if (!contactEmail) {
                        contactEmail = firstLikelyEmail(infoText) || contactEmail;
                    }
                    if (!contactPhone) {
                        const fromLink = extractPhoneFromTelLinks(infoPage.html)[0] || "";
                        const fromText = firstLikelyPhone(infoText);
                        contactPhone = fromLink || fromText || contactPhone;
                    }
                    if (!addressCandidate) {
                        const pageAddressTagSnippet = extractAddressTagSnippets(infoPage.html)[0] || "";
                        if (pageAddressTagSnippet) {
                            addressCandidate = {
                                fullAddress: pageAddressTagSnippet,
                                location: parseCityCountryFromAddress(pageAddressTagSnippet),
                            };
                        }
                    }
                    if (!addressCandidate) {
                        addressCandidate = extractAddressFromText(infoText);
                    }
                }
            }
            if (addressCandidate && !addressCandidate.location) {
                addressCandidate.location = parseCityCountryFromAddress(addressCandidate.fullAddress);
            }

            const inferredName =
                jsonLdName || ogSiteName || appName || normalizeNameFromTitle(title) || finalDomain;

            const legalName =
                jsonLd.find((entry) => typeof entry?.legalName === "string")?.legalName?.toString().trim() ||
                inferredName;

            const summary =
                metaDescription ||
                jsonLd.find((entry) => typeof entry?.description === "string")?.description?.toString().trim() ||
                "";

            const logoDataUrl = resolvedLogoUrl ? await fetchLogoAsDataUrl(resolvedLogoUrl) : null;

            return {
                name: inferredName,
                legalName,
                website: finalBase.origin,
                location: addressCandidate?.location || "",
                address: addressCandidate?.fullAddress || "",
                contactEmail: contactEmail || "",
                contactPhone: contactPhone || "",
                description: summary,
                logoDataUrl,
                logoUrl: resolvedLogoUrl || null,
                sourceUrl: finalUrl,
            };
        }),
});