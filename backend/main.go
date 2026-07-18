package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
	"google.golang.org/genai"
)

// DraftRequest is the JSON payload the frontend sends to /draft.
type DraftRequest struct {
	Text        string `json:"text"`
	Formality   int    `json:"formality"`   // 1 (casual) .. 10 (formal)
	Friendliness int   `json:"friendliness"` // 1 (blunt) .. 10 (warm)
}

// sseEvent wraps a payload as an SSE message.
// Format: "event: <name>\ndata: <json>\n\n"
func sseEvent(w io.Writer, event string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
		return err
	}
	return nil
}

// BuildSystemPrompt turns the two scores into an explicit, deterministic
// instruction set. We keep it declarative so the model behaves consistently
// across runs and does not invent extra politeness/filler.
func BuildSystemPrompt(formality, friendliness int) string {
	// Clamp to a safe range in case of bad client input.
	formality = clamp(formality, 1, 10)
	friendliness = clamp(friendliness, 1, 10)

	tone := describeAxis("formality", formality,
		"extremely casual, slangy, and relaxed",
		"balanced and neutral",
		"highly formal, precise, and professional")
	warmth := describeAxis("friendliness", friendliness,
		"direct, terse, and matter-of-fact",
		"balanced and polite",
		"warm, encouraging, and empathetic")

	var b strings.Builder
	b.WriteString("You are a professional writing assistant that refines a user's rough, messy message into a polished version.\n")
	b.WriteString("You ONLY return the rewritten message. No explanations, no headings, no quotes around the output.\n\n")
	b.WriteString(fmt.Sprintf("Target tone: %s.\n", tone))
	b.WriteString(fmt.Sprintf("Target warmth: %s.\n", warmth))
	b.WriteString(fmt.Sprintf("Formality score (1-10): %d.\n", formality))
	b.WriteString(fmt.Sprintf("Friendliness score (1-10): %d.\n", friendliness))
	b.WriteString("\nRules:\n")
	b.WriteString("- Preserve the user's original meaning, intent, and any key facts or names.\n")
	b.WriteString("- Fix grammar, spelling, and punctuation.\n")
	b.WriteString("- Do not add new information that was not implied by the original.\n")
	b.WriteString("- Keep the length roughly similar to the original unless clarity demands otherwise.\n")
	return b.String()
}

// describeAxis maps a 1..10 score to a human-readable description.
func describeAxis(name string, v int, low, mid, high string) string {
	switch {
	case v <= 3:
		return fmt.Sprintf("%s %d/10 — %s", name, v, low)
	case v <= 7:
		return fmt.Sprintf("%s %d/10 — %s", name, v, mid)
	default:
		return fmt.Sprintf("%s %d/10 — %s", name, v, high)
	}
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// freeTierModels is the fallback chain of Gemini free-tier models. The handler
// walks this list in order: when one model is rate-limited (429), it switches
// to the next. Order is a preference list, not a quality ranking.
//
// Keep these to models available on the Gemini *Free Tier* (API key auth).
// Verify current availability at https://ai.google.dev/gemini-api/docs/models
var freeTierModels = []string{
	"gemini-3.5-flash",
	"gemini-3.1-flash-lite",
	"gemini-3-flash-preview",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
	"gemini-2.5-pro",
}

// draftHandler streams a refined message from Gemini as Server-Sent Events.
func draftHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req DraftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		writeError(w, http.StatusBadRequest, "text must not be empty")
		return
	}
	if req.Formality < 1 || req.Formality > 10 || req.Friendliness < 1 || req.Friendliness > 10 {
		writeError(w, http.StatusBadRequest, "scores must be between 1 and 10")
		return
	}

	// --- SSE plumbing -------------------------------------------------------
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable proxy buffering (nginx)
	flusher.Flush()

	// --- Gemini client ------------------------------------------------------
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		sseEvent(w, "error", map[string]string{"message": "server missing GEMINI_API_KEY"})
		flusher.Flush()
		return
	}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		sseEvent(w, "error", map[string]string{"message": "failed to initialize AI client"})
		flusher.Flush()
		return
	}

	config := &genai.GenerateContentConfig{
		SystemInstruction: &genai.Content{
			Parts: []*genai.Part{{Text: BuildSystemPrompt(req.Formality, req.Friendliness)}},
		},
		Temperature: ptr[float32](0.7),
		MaxOutputTokens: 1024,
	}

	// Streaming generation with automatic fallback across free-tier models.
	// We walk freeTierModels in order; on a 429 (rate limit) for the current
	// model we switch to the next one instead of retrying the same model.
	var lastErr error
	for mi := 0; mi < len(freeTierModels); mi++ {
		model := freeTierModels[mi]

		// Small backoff before trying the *next* model (not before the first).
		if mi > 0 {
			backoff := time.Duration(mi) * 700 * time.Millisecond
			sseEvent(w, "status", map[string]string{
				"message": fmt.Sprintf("Model %s is rate-limited — switching to %s…", freeTierModels[mi-1], model),
			})
			flusher.Flush()
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return
			}
		}

		stream := client.Models.GenerateContentStream(ctx,
			model,
			[]*genai.Content{{
				Parts: []*genai.Part{{Text: req.Text}},
			}},
			config,
		)

		streamed := false
		rateLimited := false
		for chunk, err := range stream {
			if err != nil {
				// Detect 429 / quota errors from the SDK → try next model.
				if isRateLimit(err) {
					lastErr = err
					rateLimited = true
					break
				}
				sseEvent(w, "error", map[string]string{"message": "generation failed: " + humanize(err)})
				flusher.Flush()
				return
			}
			if len(chunk.Candidates) == 0 {
				continue
			}
			text := chunk.Text()
			if text == "" {
				continue
			}
			streamed = true
			_ = sseEvent(w, "chunk", map[string]string{"text": text})
			flusher.Flush()
		}

		if streamed {
			sseEvent(w, "status", map[string]string{"message": "via " + model})
			sseEvent(w, "done", map[string]bool{"ok": true})
			flusher.Flush()
			return
		}

		// No chunks AND a rate-limit → fall through to the next model.
		// No chunks without a rate-limit means the model returned nothing useful;
		// also try the next model rather than failing hard.
		if !rateLimited && !streamed {
			lastErr = fmt.Errorf("model %s returned no content", model)
		}
	}

	// Exhausted the whole fallback chain.
	sseEvent(w, "error", map[string]string{
		"message": "All available AI models are rate-limited right now. Please try again in a moment.",
	})
	flusher.Flush()
	_ = lastErr
}

// isRateLimit inspects the SDK error for 429 / quota signals.
func isRateLimit(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "429") ||
		strings.Contains(msg, "rate limit") ||
		strings.Contains(msg, "quota") ||
		strings.Contains(msg, "resource has been exhausted")
}

func humanize(err error) string {
	msg := err.Error()
	// Trim noisy SDK prefixes for a cleaner client message.
	if i := strings.Index(msg, ":"); i != -1 {
		return strings.TrimSpace(msg[i+1:])
	}
	return msg
}

// writeError sends a JSON error when SSE headers are not yet committed.
func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func main() {
	// Load .env for local development. A missing file is fine (real env vars
	// or deployment secrets take precedence), so we ignore the error.
	_ = godotenv.Load()

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	// CORS: allow the local Next.js dev server plus any deployed origins
	// supplied via CORS_ORIGINS (comma-separated, e.g. the Vercel URL).
	origins := []string{"http://localhost:3000"}
	if extra := os.Getenv("CORS_ORIGINS"); extra != "" {
		for _, o := range strings.Split(extra, ",") {
			if t := strings.TrimSpace(o); t != "" {
				origins = append(origins, t)
			}
		}
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type"},
		ExposedHeaders:   []string{"Content-Type"},
		AllowCredentials: false,
		MaxAge:           int(12 * 60 * 60), // 12 hours
	}))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	r.Post("/draft", draftHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Printf("refine-text backend listening on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}

// ptr is a small helper to take the address of a literal.
func ptr[T any](v T) *T { return &v }
