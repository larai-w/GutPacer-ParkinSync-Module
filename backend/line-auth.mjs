const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

export class LineAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = "LineAuthError";
    }
}

function getHeader(event, name) {
    const headers = event?.headers || {};
    const wanted = name.toLowerCase();
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
    return entry?.[1] || "";
}

/**
 * Verify a LIFF ID token at LINE's token verification endpoint.
 * The user ID must come from the verified `sub` claim, never from request data.
 */
export async function verifyLineIdToken(idToken, options = {}) {
    const channelId = options.channelId || process.env.LINE_LOGIN_CHANNEL_ID;
    const fetchImpl = options.fetchImpl || fetch;

    if (!idToken) throw new LineAuthError("LIFF ID token is required");
    if (!channelId) throw new LineAuthError("LINE_LOGIN_CHANNEL_ID is not configured");

    const response = await fetchImpl(VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId })
    });

    if (!response.ok) {
        throw new LineAuthError(`LINE token verification failed (${response.status})`);
    }

    const claims = await response.json();
    if (!claims.sub) throw new LineAuthError("LINE token has no user subject");

    return {
        userId: claims.sub,
        displayName: claims.name || "",
        pictureUrl: claims.picture || "",
        email: claims.email || ""
    };
}

export function getLineIdToken(event) {
    return getHeader(event, "X-Line-Id-Token");
}
