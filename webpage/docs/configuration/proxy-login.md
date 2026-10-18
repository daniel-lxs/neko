# Trusted proxy login

Trusted proxy login supplements the `multiuser` provider; existing `POST /api/login`
password/API clients keep working. Other providers disable this path. The proxy
proves its identity with `Neko-Proxy-Secret`; the asserted `Tailscale-User-Login`
must match an exact allowlist. `Tailscale-User-Name` is display-only.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `NEKO_MEMBER_PROXY_ENABLED` | `false` | Enable supplemental login. |
| `NEKO_MEMBER_PROXY_SECRET` | empty | Private proxy secret; generate with `openssl rand -hex 32`. |
| `NEKO_MEMBER_PROXY_ORIGIN` | empty | Exact public origin, without trailing slash. |
| `NEKO_MEMBER_PROXY_LOGINS` | empty | Comma-separated exact login identities; no wildcards. |
| `NEKO_MEMBER_PROXY_ADMIN` | `false` | Use multiuser admin profile instead of user profile. |

Missing configuration or a secret shorter than 32 characters disables the endpoint.
The selected profile must permit login; the existing locked-logins rule applies.
Every login creates a separate session so multiple devices coexist. The existing
session cookie/token policy is preserved.

Keep all existing device/network gates. Identity matching must never replace a
device allowlist. Keep Neko HTTP and DevTools private. Authenticate the proxy with
a secret, not `X-Forwarded-For`. The proxy must overwrite the secret header; never
pass a browser's value through or expose the secret to URLs, responses or assets.

With Tailscale Serve, keep nginx reachable only through its existing Serve-only
listener. Serve strips spoofed identity headers and supplies verified ones. Keep
nginx's existing device gate unchanged, forward Serve's login/name headers, and
insert the private secret only for `/api/proxy/login`. Do not trust identity
headers arriving from other clients. Tagged devices without user identity keep
using password/API login. Use HTTPS in deployment and exact-origin
`NEKO_SERVER_CORS` (no wildcard). Non-browser API clients with no Origin still work.
If session cookies are enabled, make them Secure and HttpOnly.

The client first resumes its session. On 401 it checks `GET /api/proxy/config`
(which exposes only an enabled boolean), then posts to `/api/proxy/login` with its
native Origin. On 403 it does not automatically reauthenticate. Failure leaves the
normal login UI. Logout leaves the login UI until the next page load, when the
proxy can sign the browser in again. Batch subrequests cannot use proxy login.
