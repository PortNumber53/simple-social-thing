package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type newsCollectRequest struct {
	Categories []string `json:"categories,omitempty"`
	Query      string   `json:"query,omitempty"`
}

type newsHeadline struct {
	Title         string `json:"title"`
	Link          string `json:"link"`
	Summary       string `json:"summary"`
	Source        string `json:"source"`
	PublishedDate string `json:"publishedDate,omitempty"`
}

type newsArticleRequest struct {
	URL string `json:"url"`
}

type newsArticleResponse struct {
	OK    bool   `json:"ok"`
	Title string `json:"title"`
	Text  string `json:"text"`
	URL   string `json:"url"`
}

// ---------------------------------------------------------------------------
// RSS feed registry — keyed by category
// ---------------------------------------------------------------------------

var newsFeedRegistry = map[string][]newsFeedSource{
	"general": {
		{"BBC News", "https://feeds.bbci.co.uk/news/rss.xml"},
		{"NYT", "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"},
		{"NPR", "https://feeds.npr.org/1001/rss.xml"},
	},
	"technology": {
		{"Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"},
		{"TechCrunch", "https://techcrunch.com/feed/"},
		{"The Verge", "https://www.theverge.com/rss/index.xml"},
		{"WIRED", "https://www.wired.com/feed/rss"},
		{"Hacker News", "https://hnrss.org/frontpage"},
		{"Guardian Tech", "https://www.theguardian.com/technology/rss"},
		{"BBC Technology", "https://feeds.bbci.co.uk/news/technology/rss.xml"},
	},
	"science": {
		{"Guardian Science", "https://www.theguardian.com/science/rss"},
		{"BBC Science", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"},
	},
	"business": {
		{"Guardian Business", "https://www.theguardian.com/business/rss"},
	},
}

type newsFeedSource struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

var newsHTTPClient = &http.Client{Timeout: 30 * time.Second}

// ---------------------------------------------------------------------------
// CollectNews — fetches RSS feeds, parses headlines, returns structured JSON
// ---------------------------------------------------------------------------

func (h *Handler) CollectNews(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	var input newsCollectRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		// Allow empty body — default to general news
		input = newsCollectRequest{}
	}

	// Determine which categories to fetch
	categories := input.Categories
	if len(categories) == 0 {
		categories = []string{"general"}
	}

	// Gather feed URLs for requested categories
	var feeds []newsFeedSource
	seen := make(map[string]bool)
	for _, cat := range categories {
		cat = strings.ToLower(strings.TrimSpace(cat))
		if cat == "all" {
			for _, fs := range newsFeedRegistry {
				for _, f := range fs {
					if !seen[f.URL] {
						feeds = append(feeds, f)
						seen[f.URL] = true
					}
				}
			}
			break
		}
		if srcs, ok := newsFeedRegistry[cat]; ok {
			for _, f := range srcs {
				if !seen[f.URL] {
					feeds = append(feeds, f)
					seen[f.URL] = true
				}
			}
		}
	}
	if len(feeds) == 0 {
		writeError(w, http.StatusBadRequest, "no feeds found for requested categories")
		return
	}

	// Fetch and parse all feeds in parallel
	headlines := fetchFeedsConcurrently(r.Context(), feeds)

	// Sort by published date (newest first), undated items go last
	sort.SliceStable(headlines, func(i, j int) bool {
		ti := parseRSSDate(headlines[i].PublishedDate)
		tj := parseRSSDate(headlines[j].PublishedDate)
		if ti.IsZero() && tj.IsZero() {
			return headlines[i].Title < headlines[j].Title
		}
		if ti.IsZero() {
			return false
		}
		if tj.IsZero() {
			return true
		}
		return ti.After(tj)
	})

	// Limit to 100 headlines
	if len(headlines) > 100 {
		headlines = headlines[:100]
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"count":     len(headlines),
		"headlines": headlines,
	})
}

// ---------------------------------------------------------------------------
// FetchArticle — fetches full article text via TinyFish Fetch API
// ---------------------------------------------------------------------------

func (h *Handler) FetchArticle(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	var input newsArticleRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	input.URL = strings.TrimSpace(input.URL)
	if input.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("TINYFISH_API_KEY"))
	if apiKey == "" {
		writeError(w, http.StatusServiceUnavailable, "tinyfish_not_configured")
		return
	}

	payload := map[string]interface{}{
		"urls":    []string{input.URL},
		"format":  "markdown",
		"purpose": "Extract full article text for generating Instagram post content",
		"ttl":     0,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://api.fetch.tinyfish.ai", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "article_request_failed")
		return
	}
	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := newsHTTPClient.Do(req)
	if err != nil {
		log.Printf("[News] TinyFish fetch failed: url=%s err=%v", input.URL, err)
		writeError(w, http.StatusBadGateway, "article_fetch_failed")
		return
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		log.Printf("[News] TinyFish fetch non-2xx: status=%d body=%s", res.StatusCode, truncate(string(b), 200))
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error":  "article_fetch_failed",
			"status": res.StatusCode,
		})
		return
	}

	var result struct {
		Results []struct {
			URL   string `json:"url"`
			Title string `json:"title"`
			Text  string `json:"text"`
		} `json:"results"`
		Errors []struct {
			URL   string `json:"url"`
			Error string `json:"error"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(&result); err != nil {
		log.Printf("[News] TinyFish response decode failed: err=%v", err)
		writeError(w, http.StatusBadGateway, "article_invalid_response")
		return
	}

	if len(result.Errors) > 0 {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{
			"error": result.Errors[0].Error,
			"url":   result.Errors[0].URL,
		})
		return
	}
	if len(result.Results) == 0 {
		writeError(w, http.StatusBadGateway, "article_empty_response")
		return
	}

	article := result.Results[0]
	writeJSON(w, http.StatusOK, newsArticleResponse{
		OK:    true,
		Title: article.Title,
		Text:  article.Text,
		URL:   article.URL,
	})
}

// ---------------------------------------------------------------------------
// Helpers — RSS fetching and parsing
// ---------------------------------------------------------------------------

func fetchFeedsConcurrently(ctx context.Context, feeds []newsFeedSource) []newsHeadline {
	var mu sync.Mutex
	var wg sync.WaitGroup
	var allHeadlines []newsHeadline

	for _, feed := range feeds {
		wg.Add(1)
		go func(fs newsFeedSource) {
			defer wg.Done()
			headlines, err := fetchAndParseRSS(ctx, fs)
			if err != nil {
				log.Printf("[News] feed fetch failed: source=%s url=%s err=%v", fs.Name, fs.URL, err)
				return
			}
			mu.Lock()
			allHeadlines = append(allHeadlines, headlines...)
			mu.Unlock()
		}(feed)
	}
	wg.Wait()
	return allHeadlines
}

func fetchAndParseRSS(ctx context.Context, source newsFeedSource) ([]newsHeadline, error) {
	// Try TinyFish first for JS-heavy sites, fall back to direct fetch
	apiKey := strings.TrimSpace(os.Getenv("TINYFISH_API_KEY"))

	var body []byte
	var err error

	if apiKey != "" {
		body, err = fetchViaTinyFish(ctx, apiKey, source.URL)
	}
	if err != nil || len(body) == 0 {
		// Direct HTTP fetch as fallback
		body, err = fetchDirect(ctx, source.URL)
		if err != nil {
			return nil, fmt.Errorf("direct fetch: %w", err)
		}
	}

	return parseRSSXML(body, source.Name)
}

func fetchViaTinyFish(ctx context.Context, apiKey, feedURL string) ([]byte, error) {
	payload := map[string]interface{}{
		"urls":    []string{feedURL},
		"format":  "markdown",
		"purpose": "Collect news headlines from RSS feed for Instagram content generation",
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.fetch.tinyfish.ai", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := newsHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("tinyfish status %d", res.StatusCode)
	}

	var result struct {
		Results []struct {
			Text string `json:"text"`
		} `json:"results"`
		Errors []struct {
			Error string `json:"error"`
		} `json:"errors"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&result); err != nil {
		return nil, err
	}
	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("tinyfish: %s", result.Errors[0].Error)
	}
	if len(result.Results) == 0 {
		return nil, fmt.Errorf("tinyfish: empty response")
	}
	return []byte(result.Results[0].Text), nil
}

func fetchDirect(ctx context.Context, feedURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; NewsCollector/1.0)")
	res, err := newsHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 4<<20))
}

// ---------------------------------------------------------------------------
// RSS XML parsing
// ---------------------------------------------------------------------------

type rssFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Title string    `xml:"title"`
	Items []rssItem `xml:"item"`
}

// Atom 1.0 support
type atomFeed struct {
	XMLName xml.Name   `xml:"feed"`
	Title   string     `xml:"title"`
	Entries []atomEntry `xml:"entry"`
}

type atomEntry struct {
	Title   string `xml:"title"`
	Summary string `xml:"summary"`
	Content string `xml:"content"`
	Updated string `xml:"updated"`
	Published string `xml:"published"`
	Links   []atomLink `xml:"link"`
}

type atomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
}

type rssItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	PubDate     string `xml:"pubDate"`
}

func parseRSSXML(data []byte, sourceName string) ([]newsHeadline, error) {
	// Try RSS 2.0 first
	var feed rssFeed
	if err := xml.Unmarshal(data, &feed); err == nil && len(feed.Channel.Items) > 0 {
		headlines := make([]newsHeadline, 0, len(feed.Channel.Items))
		for _, item := range feed.Channel.Items {
			title := strings.TrimSpace(item.Title)
			link := strings.TrimSpace(item.Link)
			if title == "" || link == "" {
				continue
			}
			headlines = append(headlines, newsHeadline{
				Title:         title,
				Link:          link,
				Summary:       strings.TrimSpace(stripHTMLTags(item.Description)),
				Source:        sourceName,
				PublishedDate: strings.TrimSpace(item.PubDate),
			})
		}
		return headlines, nil
	}

	// Try Atom 1.0
	var atom atomFeed
	if err := xml.Unmarshal(data, &atom); err == nil && len(atom.Entries) > 0 {
		headlines := make([]newsHeadline, 0, len(atom.Entries))
		for _, entry := range atom.Entries {
			title := strings.TrimSpace(entry.Title)
			link := ""
			for _, l := range entry.Links {
				if l.Rel == "" || l.Rel == "alternate" {
					link = l.Href
					break
				}
			}
			if title == "" || link == "" {
				continue
			}
			summary := entry.Summary
			if summary == "" {
				summary = entry.Content
			}
			pubDate := entry.Published
			if pubDate == "" {
				pubDate = entry.Updated
			}
			headlines = append(headlines, newsHeadline{
				Title:         title,
				Link:          link,
				Summary:       strings.TrimSpace(stripHTMLTags(summary)),
				Source:        sourceName,
				PublishedDate: pubDate,
			})
		}
		return headlines, nil
	}

	return nil, fmt.Errorf("could not parse as RSS or Atom")
}

func stripHTMLTags(s string) string {
	var buf strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			buf.WriteRune(r)
		}
	}
	// Collapse whitespace
	result := strings.Join(strings.Fields(buf.String()), " ")
	if len(result) > 300 {
		result = result[:300] + "…"
	}
	return result
}

func parseRSSDate(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	formats := []string{
		time.RFC1123Z,
		time.RFC1123,
		time.RFC3339,
		time.RFC3339Nano,
		"Mon, 2 Jan 2006 15:04:05 MST",
		"Mon, 2 Jan 2006 15:04:05 -0700",
		"Mon, 02 Jan 2006 15:04:05 MST",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t
		}
	}
	return time.Time{}
}
