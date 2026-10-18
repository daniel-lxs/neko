package config

import (
	"net/url"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// ProxyLogin supplements multiuser password login; it never replaces it.
// Secret authenticates the proxy, while Logins limits the identities it may assert.
type ProxyLogin struct {
	Enabled bool
	Secret  string
	Origin  string
	Logins  []string
	Admin   bool
}

func (p ProxyLogin) Configured() bool {
	u, err := url.Parse(p.Origin)
	if !p.Enabled || len(p.Secret) < 32 || len(p.Logins) == 0 || err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") || u.String() != u.Scheme+"://"+u.Host {
		return false
	}
	for _, login := range p.Logins {
		if login == "" || strings.ContainsAny(login, ",\r\n") || strings.TrimSpace(login) != login {
			return false
		}
	}
	return true
}

func initProxyLogin(cmd *cobra.Command) error {
	cmd.PersistentFlags().Bool("member.proxy.enabled", false, "enable supplemental trusted-proxy login (multiuser only)")
	cmd.PersistentFlags().String("member.proxy.secret", "", "shared proxy authentication secret (at least 32 random bytes)")
	cmd.PersistentFlags().String("member.proxy.origin", "", "exact browser origin permitted for proxy login")
	cmd.PersistentFlags().StringSlice("member.proxy.logins", nil, "exact Tailscale-User-Login identities permitted for proxy login")
	cmd.PersistentFlags().Bool("member.proxy.admin", false, "use the multiuser admin profile for allowed proxy identities")
	for _, key := range []string{"enabled", "secret", "origin", "logins", "admin"} {
		name := "member.proxy." + key
		if err := viper.BindPFlag(name, cmd.PersistentFlags().Lookup(name)); err != nil {
			return err
		}
	}
	return nil
}

func proxyLoginConfig() ProxyLogin {
	return ProxyLogin{
		Enabled: viper.GetBool("member.proxy.enabled"), Secret: viper.GetString("member.proxy.secret"),
		Origin: viper.GetString("member.proxy.origin"), Logins: viper.GetStringSlice("member.proxy.logins"),
		Admin: viper.GetBool("member.proxy.admin"),
	}
}
