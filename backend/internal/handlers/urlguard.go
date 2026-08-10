package handlers

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// validateURL checks that a user-provided URL is safe to fetch from the server.
// It ensures the scheme is http or https and the host does not resolve to a
// private, loopback, or link-local address (SSRF protection).
func validateURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported scheme %q: only http and https are allowed", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL is missing a host")
	}
	// If the host is an IP literal, check it directly.
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			return fmt.Errorf("URL host %s is a blocked address", host)
		}
		return nil
	}
	// Resolve hostname and check all resulting IPs.
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("failed to resolve host %s: %w", host, err)
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return fmt.Errorf("URL host %s resolves to blocked address %s", host, ip)
		}
	}
	return nil
}

// isBlockedIP returns true for IP addresses that should not be fetched
// from the server (loopback, private, link-local, unspecified, etc.).
func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	// Block AWS metadata endpoint 169.254.169.254 explicitly (already covered
	// by IsLinkLocalUnicast but kept for clarity).
	if ip.Equal(net.ParseIP("169.254.169.254")) {
		return true
	}
	return false
}

// sanitizeURLForLog returns a URL string safe for logging (removes credentials).
func sanitizeURLForLog(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "[invalid-url]"
	}
	u.User = nil
	return u.String()
}

// isAllowedExternalHost checks if a hostname belongs to an allowlist of
// external providers. This is used for endpoints that should only fetch from
// known social media / music provider domains.
func isAllowedExternalHost(rawURL string, allowlist []string) error {
	if err := validateURL(rawURL); err != nil {
		return err
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	host := strings.ToLower(u.Hostname())
	for _, allowed := range allowlist {
		allowed = strings.ToLower(allowed)
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return nil
		}
	}
	return fmt.Errorf("host %q is not in the allowlist", host)
}
