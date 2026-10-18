package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"slices"
	"strings"
	"unicode"

	"github.com/m1k1o/neko/server/pkg/utils"
)

func (api *ApiManagerCtx) ProxyLoginConfig(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	return utils.HttpSuccess(w, struct {
		Enabled bool `json:"enabled"`
	}{api.proxyConfig.Configured()})
}

func singleHeader(r *http.Request, key string) string {
	values := r.Header.Values(key)
	if len(values) != 1 {
		return ""
	}
	return values[0]
}

// ProxyLogin accepts identity only from a proxy that proves possession of the
// configured secret. X-Forwarded-For and the display name never authorize login.
func (api *ApiManagerCtx) ProxyLogin(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Cache-Control", "no-store")
	cfg := api.proxyConfig
	if !cfg.Configured() {
		return utils.HttpNotFound()
	}
	supplied := sha256.Sum256([]byte(singleHeader(r, "Neko-Proxy-Secret")))
	expected := sha256.Sum256([]byte(cfg.Secret))
	login := singleHeader(r, "Tailscale-User-Login")
	if subtle.ConstantTimeCompare(supplied[:], expected[:]) != 1 || singleHeader(r, "Origin") != cfg.Origin || login == "" || strings.ContainsAny(login, ",\r\n") || !slices.Contains(cfg.Logins, login) {
		return utils.HttpUnauthorized()
	}
	profile := api.proxyProfile
	if !profile.CanLogin {
		return utils.HttpForbidden("login is disabled")
	}
	if !profile.IsAdmin && api.sessions.Settings().LockedLogins {
		return utils.HttpForbidden("logins are locked")
	}
	if profile.Name == "" {
		name := singleHeader(r, "Tailscale-User-Name")
		if name == "" || len(name) > 256 || strings.ContainsFunc(name, unicode.IsControl) {
			name = login
		}
		profile.Name = name
	}
	// Each device gets its own session; signing in must not evict another viewer.
	id, err := utils.NewUID(16)
	if err != nil {
		return utils.HttpInternalServerError().WithInternalErr(err)
	}
	session, token, err := api.sessions.Create("proxy-"+id, profile)
	if err != nil {
		return utils.HttpInternalServerError().WithInternalErr(err)
	}
	data := SessionDataPayload{ID: session.ID(), Profile: session.Profile(), State: session.State()}
	if api.sessions.CookieEnabled() {
		api.sessions.CookieSetToken(w, token)
	} else {
		data.Token = token
	}
	return utils.HttpSuccess(w, data)
}
