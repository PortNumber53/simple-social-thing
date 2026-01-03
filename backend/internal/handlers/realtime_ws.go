package handlers

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

type realtimeHub struct {
	mu    sync.Mutex
	conns map[string]map[*websocket.Conn]struct{}
}

func newRealtimeHub() *realtimeHub {
	return &realtimeHub{
		conns: make(map[string]map[*websocket.Conn]struct{}),
	}
}

func (h *realtimeHub) add(userID string, c *websocket.Conn) {
	if h == nil || c == nil || strings.TrimSpace(userID) == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	m := h.conns[userID]
	if m == nil {
		m = make(map[*websocket.Conn]struct{})
		h.conns[userID] = m
	}
	m[c] = struct{}{}
}

func (h *realtimeHub) remove(userID string, c *websocket.Conn) {
	if h == nil || c == nil || strings.TrimSpace(userID) == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	m := h.conns[userID]
	if m == nil {
		return
	}
	delete(m, c)
	if len(m) == 0 {
		delete(h.conns, userID)
	}
}

func (h *realtimeHub) broadcast(userID string, msg []byte) {
	if h == nil || strings.TrimSpace(userID) == "" || len(msg) == 0 {
		return
	}

	h.mu.Lock()
	conns := make([]*websocket.Conn, 0, 8)
	for c := range h.conns[userID] {
		conns = append(conns, c)
	}
	h.mu.Unlock()

	for _, c := range conns {
		if err := websocket.Message.Send(c, string(msg)); err != nil {
			_ = c.Close()
			h.remove(userID, c)
		}
	}
}

func (h *realtimeHub) count(userID string) int {
	if h == nil || strings.TrimSpace(userID) == "" {
		return 0
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns[userID])
}

func isLocalhostRemoteAddr(remoteAddr string) bool {
	host := remoteAddr
	if h, _, err := net.SplitHostPort(remoteAddr); err == nil && h != "" {
		host = h
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// internalWSAllowed returns true if the request is allowed to open a backend WS connection.
// In production, set INTERNAL_WS_SECRET and send it via X-Internal-WS-Secret from the Worker.
func internalWSAllowed(r *http.Request) bool {
	sec := strings.TrimSpace(os.Getenv("INTERNAL_WS_SECRET"))
	// Dev convenience: always allow localhost loopback connections.
	// This keeps local wrangler->backend WS working even if INTERNAL_WS_SECRET is set.
	if isLocalhostRemoteAddr(r.RemoteAddr) {
		return true
	}
	// For non-local connections, require explicit secret.
	if sec == "" {
		return false
	}
	return strings.TrimSpace(r.Header.Get("X-Internal-WS-Secret")) == sec
}

func internalWSDebug(r *http.Request) map[string]any {
	sec := strings.TrimSpace(os.Getenv("INTERNAL_WS_SECRET"))
	hdr := strings.TrimSpace(r.Header.Get("X-Internal-WS-Secret"))
	secSet := sec != ""
	hasHeader := hdr != ""
	return map[string]any{
		"remote":      r.RemoteAddr,
		"host":        r.Host,
		"loopback":    isLocalhostRemoteAddr(r.RemoteAddr),
		"secSet":      secSet,
		"hasHeader":   hasHeader,
		"headerMatch": secSet && hasHeader && hdr == sec,
	}
}

// EventsPing is a non-WS endpoint used to debug internal WS auth from the Worker.
// URL: /api/events/ping
func (h *Handler) EventsPing(w http.ResponseWriter, r *http.Request) {
	resp := internalWSDebug(r)
	resp["ok"] = internalWSAllowed(r)
	if resp["ok"] != true {
		writeJSON(w, http.StatusForbidden, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

type realtimeEvent struct {
	Type string `json:"type"`

	UserID string `json:"user_id"`
	PostID string `json:"postId,omitempty"`
	JobID  string `json:"jobId,omitempty"`

	Status string `json:"status,omitempty"`
	IDs    []string `json:"ids,omitempty"`
	Now    string `json:"now,omitempty"`
	At     string `json:"at"`
}

// EventsWebSocket is an internal WS endpoint (meant to be proxied by the Worker) that streams realtime events.
//
// URL: /api/events/ws?userId=...
// Auth: X-Internal-WS-Secret (or localhost-only if INTERNAL_WS_SECRET is unset)
func (h *Handler) EventsWebSocket(w http.ResponseWriter, r *http.Request) {
	if !internalWSAllowed(r) {
		d := internalWSDebug(r)
		log.Printf("[RealtimeWS] forbidden remote=%v host=%v loopback=%v secSet=%v hasHeader=%v headerMatch=%v",
			d["remote"], d["host"], d["loopback"], d["secSet"], d["hasHeader"], d["headerMatch"])
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	userID := strings.TrimSpace(r.URL.Query().Get("userId"))
	if userID == "" {
		http.Error(w, "missing_userId", http.StatusBadRequest)
		return
	}

	// IMPORTANT: golang.org/x/net/websocket's default origin check can return 403 (Forbidden) if the
	// Origin header doesn't match Host. Our WS is internal (Worker -> Backend), so we allow any Origin.
	wsServer := websocket.Server{
		Handshake: func(cfg *websocket.Config, req *http.Request) error {
			// Accept any origin (auth is handled by internalWSAllowed).
			return nil
		},
		Handler: func(c *websocket.Conn) {
			log.Printf("[RealtimeWS] connect userId=%s remote=%s ua=%q", userID, r.RemoteAddr, truncate(r.UserAgent(), 120))
			if h != nil && h.rt != nil {
				h.rt.add(userID, c)
				defer h.rt.remove(userID, c)
			}
			defer log.Printf("[RealtimeWS] disconnect userId=%s remote=%s", userID, r.RemoteAddr)

			// Send a hello so clients can confirm the channel.
			hello := realtimeEvent{
				Type:   "hello",
				UserID: userID,
				At:     time.Now().UTC().Format(time.RFC3339),
			}
			if b, err := json.Marshal(hello); err == nil {
				_ = websocket.Message.Send(c, string(b))
			}

			// Send a simple server-time clock tick (useful for debugging WS connectivity).
			done := make(chan struct{})
			var doneOnce sync.Once
			closeDone := func() { doneOnce.Do(func() { close(done) }) }
			go func() {
				ticker := time.NewTicker(1 * time.Second)
				defer ticker.Stop()
				for {
					select {
					case <-done:
						return
					case <-ticker.C:
						now := time.Now().UTC()
						ev := realtimeEvent{
							Type:   "clock",
							UserID: userID,
							Now:    now.Format("15:04:05"),
							At:     now.Format(time.RFC3339),
						}
						b, err := json.Marshal(ev)
						if err != nil {
							continue
						}
						if err := websocket.Message.Send(c, string(b)); err != nil {
							closeDone()
							return
						}
					}
				}
			}()

			// Read loop to keep the connection open and detect disconnects.
			for {
				var ignored string
				if err := websocket.Message.Receive(c, &ignored); err != nil {
					closeDone()
					break
				}
			}
		},
	}

	wsServer.ServeHTTP(w, r)
}

func (h *Handler) emitEvent(userID string, ev realtimeEvent) {
	if h == nil || h.rt == nil || strings.TrimSpace(userID) == "" {
		return
	}
	ev.UserID = userID
	if strings.TrimSpace(ev.At) == "" {
		ev.At = time.Now().UTC().Format(time.RFC3339)
	}
	b, err := json.Marshal(ev)
	if err != nil {
		log.Printf("[Realtime] marshal_failed userId=%s err=%v", userID, err)
		return
	}
	log.Printf("[Realtime] emit userId=%s type=%s postId=%s jobId=%s status=%s subs=%d",
		userID, ev.Type, ev.PostID, ev.JobID, ev.Status, h.rt.count(userID))
	h.rt.broadcast(userID, b)
}
