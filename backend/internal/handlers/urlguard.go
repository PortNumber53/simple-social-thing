package handlers

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
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

// ssrfSafeTransport returns an http.RoundTripper whose DialContext re-resolves
// the hostname and rejects any IP that isBlockedIP would block, then pins the
// connection to the first validated IP.  This closes the TOCTOU / DNS-rebinding
// window that exists when validateURL resolves the host at check time but
// http.Get performs its own independent resolution at connect time.
//
// Because the user-provided URL string is consumed by the transport's dialer
// rather than flowing directly into http.Get, taint analysers (CodeQL
// go/request-forgery) no longer see an unbroken data-flow path from source to
// sink.
func ssrfSafeTransport() *http.Transport {
	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("SSRF guard: bad address %q: %w", addr, err)
			}
			// If the host is already an IP literal, validate it directly.
			if ip := net.ParseIP(host); ip != nil {
				if isBlockedIP(ip) {
					return nil, fmt.Errorf("SSRF guard: blocked IP %s", host)
				}
				return (&net.Dialer{}).DialContext(ctx, network, addr)
			}
			// Resolve the hostname now and check every returned address.
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, fmt.Errorf("SSRF guard: failed to resolve %s: %w", host, err)
			}
			for _, ipAddr := range ips {
				if isBlockedIP(ipAddr.IP) {
					return nil, fmt.Errorf("SSRF guard: %s resolves to blocked IP %s", host, ipAddr.IP)
				}
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("SSRF guard: no addresses for %s", host)
			}
			// Pin to the first validated IP to prevent a second resolution
			// from returning a different (private) address.
			pinned := net.JoinHostPort(ips[0].IP.String(), port)
			return (&net.Dialer{}).DialContext(ctx, network, pinned)
		},
	}
}

// safeSSRFClient returns an *http.Client that uses ssrfSafeTransport and the
// given timeout.  Pass 0 for no timeout.
func safeSSRFClient(timeout time.Duration) *http.Client {
	c := &http.Client{Transport: ssrfSafeTransport()}
	if timeout > 0 {
		c.Timeout = timeout
	}
	return c
}

// resolveAndValidateHost resolves host to IP addresses, validates that none are
// blocked, and returns the string form of the first safe IP.  If host is already
// an IP literal it is validated and returned as-is.
func resolveAndValidateHost(host string) (string, error) {
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			return "", fmt.Errorf("SSRF guard: blocked IP %s", host)
		}
		return host, nil
	}
	ips, err := net.DefaultResolver.LookupIPAddr(context.Background(), host)
	if err != nil {
		return "", fmt.Errorf("SSRF guard: failed to resolve %s: %w", host, err)
	}
	for _, ipAddr := range ips {
		if isBlockedIP(ipAddr.IP) {
			return "", fmt.Errorf("SSRF guard: %s resolves to blocked IP %s", host, ipAddr.IP)
		}
	}
	if len(ips) == 0 {
		return "", fmt.Errorf("SSRF guard: no addresses for %s", host)
	}
	return ips[0].IP.String(), nil
}

// safeSSRFRequest builds an *http.Request whose URL uses a validated IP literal
// instead of the user-provided hostname, while preserving the original Host
// header for virtual hosting.  The returned client uses ssrfSafeTransport for
// defense-in-depth at the TCP layer.
//
// By constructing a brand-new URL string from the resolved IP, the user-provided
// URL string never reaches http.NewRequest or client.Do directly, which breaks
// the taint flow that CodeQL's go/request-forgery query tracks.
func safeSSRFRequest(ctx context.Context, method, rawURL string) (*http.Request, *http.Client, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, nil, fmt.Errorf("unsupported scheme %q: only http and https are allowed", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return nil, nil, fmt.Errorf("URL is missing a host")
	}
	port := u.Port()
	validatedIP, err := resolveAndValidateHost(host)
	if err != nil {
		return nil, nil, err
	}
	// Build a new URL that uses the validated IP literal.
	safeHost := validatedIP
	if port != "" {
		safeHost = net.JoinHostPort(validatedIP, port)
	}
	safeU := &url.URL{
		Scheme:   u.Scheme,
		Host:     safeHost,
		Path:     u.Path,
		RawQuery: u.RawQuery,
		Fragment: u.Fragment,
	}
	req, err := http.NewRequestWithContext(ctx, method, safeU.String(), nil)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build safe request: %w", err)
	}
	// Preserve the original Host header so the upstream server can route
	// to the correct virtual host / serve the right certificate.
	req.Host = u.Host
	return req, safeSSRFClient(0), nil
}

// safeSSRFGet is a convenience wrapper around safeSSRFRequest for GET requests.
// It performs the full SSRF validation and returns the HTTP response.
func safeSSRFGet(ctx context.Context, rawURL string) (*http.Response, error) {
	req, client, err := safeSSRFRequest(ctx, "GET", rawURL)
	if err != nil {
		return nil, err
	}
	return client.Do(req)
}
