package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
)

// writeJSON encodes v as JSON with the provided status code and a JSON content-type.
// It intentionally ignores encode errors to match existing handler behavior.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	if status != 0 {
		w.WriteHeader(status)
	}
	_ = json.NewEncoder(w).Encode(v)
}

// writeError keeps the existing behavior of returning plain-text HTTP errors.
func writeError(w http.ResponseWriter, status int, msg string) {
	http.Error(w, msg, status)
}

// requireMethod returns false and writes StatusMethodNotAllowed if r.Method != method.
// It matches the existing pattern in this codebase (status only, no custom body).
func requireMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return false
	}
	return true
}

// pathVar returns the mux path var value (or empty string if missing).
func pathVar(r *http.Request, key string) string {
	return mux.Vars(r)[key]
}

// decodeJSON decodes JSON request bodies using the default decoder settings (no unknown-field rejection)
// to preserve current handler behavior.
func decodeJSON(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}
