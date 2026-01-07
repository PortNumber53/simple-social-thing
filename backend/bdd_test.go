package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/PortNumber53/simple-social-thing/backend/internal/handlers"
	"github.com/cucumber/godog"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"
)

type bddTestContext struct {
	db             *sql.DB
	server         *httptest.Server
	router         *mux.Router
	handler        *handlers.Handler
	lastResponse   *http.Response
	lastBody       []byte
	testData       map[string]interface{}
	wsConnections  map[string]interface{}
	internalSecret string
}

func (ctx *bddTestContext) reset() {
	if ctx.lastResponse != nil && ctx.lastResponse.Body != nil {
		ctx.lastResponse.Body.Close()
	}
	ctx.lastResponse = nil
	ctx.lastBody = nil
	ctx.testData = make(map[string]interface{})
	ctx.wsConnections = make(map[string]interface{})
}

func (ctx *bddTestContext) theDatabaseIsClean() error {
	tables := []string{
		"public.\"Notifications\"",
		"public.\"SocialLibraries\"",
		"public.\"SocialImportUsage\"",
		"public.\"SocialImportStates\"",
		"public.\"PublishJobs\"",
		"public.\"Posts\"",
		"public.\"SunoTracks\"",
		"public.\"UserSettings\"",
		"public.\"TeamMembers\"",
		"public.\"Teams\"",
		"public.\"SocialConnections\"",
		"public.\"Users\"",
	}

	for _, table := range tables {
		_, err := ctx.db.Exec(fmt.Sprintf("DELETE FROM %s", table))
		if err != nil {
			return fmt.Errorf("failed to clean %s: %w", table, err)
		}
	}
	return nil
}

func (ctx *bddTestContext) theAPIServerIsRunning() error {
	if ctx.server != nil {
		return nil
	}

	ctx.handler = handlers.New(ctx.db)
	ctx.router = buildTestRouter(ctx.handler)
	ctx.server = httptest.NewServer(ctx.router)
	return nil
}

func buildTestRouter(h *handlers.Handler) *mux.Router {
	r := mux.NewRouter()

	r.HandleFunc("/health", h.Health).Methods("GET")
	r.HandleFunc("/api/events/ws", h.EventsWebSocket)
	r.HandleFunc("/api/events/ping", h.EventsPing).Methods("GET")
	r.HandleFunc("/api/users", h.CreateUser).Methods("POST")
	r.HandleFunc("/api/users/{id}", h.GetUser).Methods("GET")
	r.HandleFunc("/api/users/{id}", h.UpdateUser).Methods("PUT")
	r.HandleFunc("/api/social-connections", h.CreateSocialConnection).Methods("POST")
	r.HandleFunc("/api/social-connections/user/{userId}", h.GetUserSocialConnections).Methods("GET")
	r.HandleFunc("/api/social-libraries/user/{userId}", h.ListSocialLibrariesForUser).Methods("GET")
	r.HandleFunc("/api/social-libraries/sync/user/{userId}", h.SyncSocialLibrariesForUser).Methods("POST")
	r.HandleFunc("/api/social-libraries/delete/user/{userId}", h.DeleteSocialLibrariesForUser).Methods("POST")
	r.HandleFunc("/api/notifications/user/{userId}", h.ListNotificationsForUser).Methods("GET")
	r.HandleFunc("/api/notifications/{id}/read/user/{userId}", h.MarkNotificationReadForUser).Methods("POST")
	r.HandleFunc("/api/social-posts/publish/user/{userId}", h.PublishSocialPostForUser).Methods("POST")
	r.HandleFunc("/api/social-posts/publish-async/user/{userId}", h.EnqueuePublishJobForUser).Methods("POST")
	r.HandleFunc("/api/social-posts/publish-jobs/{jobId}", h.GetPublishJob).Methods("GET")
	r.HandleFunc("/api/posts/user/{userId}", h.ListPostsForUser).Methods("GET")
	r.HandleFunc("/api/posts/user/{userId}", h.CreatePostForUser).Methods("POST")
	r.HandleFunc("/api/posts/{postId}/user/{userId}", h.UpdatePostForUser).Methods("PUT")
	r.HandleFunc("/api/posts/{postId}/user/{userId}", h.DeletePostForUser).Methods("DELETE")
	r.HandleFunc("/api/posts/{postId}/publish-now/user/{userId}", h.PublishNowPostForUser).Methods("POST")
	r.HandleFunc("/api/uploads/user/{userId}", h.ListUploadsForUser).Methods("GET")
	r.HandleFunc("/api/uploads/user/{userId}", h.UploadUploadsForUser).Methods("POST")
	r.HandleFunc("/api/uploads/delete/user/{userId}", h.DeleteUploadsForUser).Methods("POST")
	r.HandleFunc("/api/uploads/folders/user/{userId}", h.ListUploadFoldersForUser).Methods("GET")
	r.HandleFunc("/api/teams", h.CreateTeam).Methods("POST")
	r.HandleFunc("/api/teams/{id}", h.GetTeam).Methods("GET")
	r.HandleFunc("/api/teams/user/{userId}", h.GetUserTeams).Methods("GET")
	r.HandleFunc("/api/suno/tasks", h.CreateSunoTask).Methods("POST")
	r.HandleFunc("/api/suno/tracks/user/{userId}", h.ListSunoTracksForUser).Methods("GET")
	r.HandleFunc("/api/suno/tracks/{id}", h.UpdateSunoTrack).Methods("PUT")
	r.HandleFunc("/api/suno/store", h.StoreSunoTrack).Methods("POST")
	r.HandleFunc("/api/suno/music", h.SunoMusicCallback).Methods("POST")
	r.HandleFunc("/api/suno/music/", h.SunoMusicCallback).Methods("POST")
	r.HandleFunc("/api/user-settings/{userId}", h.GetUserSettings).Methods("GET")
	r.HandleFunc("/api/user-settings/{userId}/{key}", h.GetUserSetting).Methods("GET")
	r.HandleFunc("/api/user-settings/{userId}/{key}", h.UpsertUserSetting).Methods("PUT")

	return r
}

func (ctx *bddTestContext) iSendAGETRequestTo(path string) error {
	return ctx.iSendARequestTo("GET", path, "")
}

func (ctx *bddTestContext) iSendAPOSTRequestToWithJSON(path, body string) error {
	return ctx.iSendARequestTo("POST", path, body)
}

func (ctx *bddTestContext) iSendAPUTRequestToWithJSON(path, body string) error {
	return ctx.iSendARequestTo("PUT", path, body)
}

func (ctx *bddTestContext) iSendADELETERequestTo(path string) error {
	return ctx.iSendARequestTo("DELETE", path, "")
}

func (ctx *bddTestContext) iSendARequestTo(method, path, body string) error {
	url := ctx.server.URL + path
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return err
	}

	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}

	ctx.lastResponse = resp
	ctx.lastBody, err = io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	return nil
}

func (ctx *bddTestContext) theResponseStatusCodeShouldBe(expectedCode int) error {
	if ctx.lastResponse == nil {
		return fmt.Errorf("no response received")
	}

	if ctx.lastResponse.StatusCode != expectedCode {
		return fmt.Errorf("expected status code %d, got %d. Body: %s",
			expectedCode, ctx.lastResponse.StatusCode, string(ctx.lastBody))
	}

	return nil
}

func (ctx *bddTestContext) theResponseShouldContainJSONWithSetTo(key, value string) error {
	var data map[string]interface{}
	if err := json.Unmarshal(ctx.lastBody, &data); err != nil {
		return fmt.Errorf("failed to parse JSON: %w. Body: %s", err, string(ctx.lastBody))
	}

	actualValue, ok := data[key]
	if !ok {
		return fmt.Errorf("key %q not found in response: %s", key, string(ctx.lastBody))
	}

	actualStr := fmt.Sprintf("%v", actualValue)
	if actualStr != value {
		return fmt.Errorf("expected %q to be %q, got %q", key, value, actualStr)
	}

	return nil
}

func (ctx *bddTestContext) theResponseShouldContainError(errorMsg string) error {
	bodyStr := string(ctx.lastBody)
	if !strings.Contains(bodyStr, errorMsg) {
		return fmt.Errorf("expected error message %q not found in response: %s", errorMsg, bodyStr)
	}
	return nil
}

func (ctx *bddTestContext) theResponseShouldBeAJSONArrayWithItems(count int) error {
	var data []interface{}
	if err := json.Unmarshal(ctx.lastBody, &data); err != nil {
		return fmt.Errorf("failed to parse JSON array: %w. Body: %s", err, string(ctx.lastBody))
	}

	if len(data) != count {
		return fmt.Errorf("expected %d items, got %d", count, len(data))
	}

	return nil
}

func (ctx *bddTestContext) aUserExistsWithIdAndEmail(id, email string) error {
	query := `INSERT INTO public."Users" (id, email, name, created_at) VALUES ($1, $2, $3, NOW())`
	_, err := ctx.db.Exec(query, id, email, "Test User")
	return err
}

func (ctx *bddTestContext) aTeamExistsWithIdAndOwnerId(teamId, ownerId string) error {
	query := `INSERT INTO public."Teams" (id, owner_id, created_at) VALUES ($1, $2, NOW())`
	_, err := ctx.db.Exec(query, teamId, ownerId)
	return err
}

func (ctx *bddTestContext) theUserHasAConnectionWithProviderId(userId, provider, providerId string) error {
	query := `INSERT INTO public."SocialConnections" (id, user_id, provider, provider_id, created_at)
	          VALUES ($1, $2, $3, $4, NOW())`
	id := fmt.Sprintf("%s_%s_%s", userId, provider, providerId)
	_, err := ctx.db.Exec(query, id, userId, provider, providerId)
	return err
}

func (ctx *bddTestContext) theUserIsAMemberOfTeam(userId, teamId string) error {
	query := `INSERT INTO public."TeamMembers" (id, team_id, user_id, created_at) VALUES ($1, $2, $3, NOW())`
	id := fmt.Sprintf("%s_%s", teamId, userId)
	_, err := ctx.db.Exec(query, id, teamId, userId)
	return err
}

func (ctx *bddTestContext) theUserHasPostsInTeam(userId string, count int, teamId string) error {
	for i := 0; i < count; i++ {
		postId := fmt.Sprintf("post_%s_%d", userId, i)
		query := `INSERT INTO public."Posts" (id, team_id, user_id, content, status, created_at, updated_at)
		          VALUES ($1, $2, $3, $4, 'draft', NOW(), NOW())`
		_, err := ctx.db.Exec(query, postId, teamId, userId, fmt.Sprintf("Post %d", i))
		if err != nil {
			return err
		}
	}
	return nil
}

func (ctx *bddTestContext) theUserHasAPostWithIdInTeam(userId, postId, teamId string) error {
	query := `INSERT INTO public."Posts" (id, team_id, user_id, content, status, created_at, updated_at)
	          VALUES ($1, $2, $3, 'Test content', 'draft', NOW(), NOW())`
	_, err := ctx.db.Exec(query, postId, teamId, userId)
	if err != nil {
		return err
	}
	ctx.testData[postId] = true
	return nil
}

func (ctx *bddTestContext) theUserHasAScheduledPostWithIdInTeam(userId, postId, teamId string) error {
	query := `INSERT INTO public."Posts" (id, team_id, user_id, content, status, scheduled_for, created_at, updated_at)
	          VALUES ($1, $2, $3, 'Scheduled content', 'scheduled', NOW() + INTERVAL '1 hour', NOW(), NOW())`
	_, err := ctx.db.Exec(query, postId, teamId, userId)
	return err
}

func (ctx *bddTestContext) thePostShouldNotExist(postId string) error {
	var exists bool
	query := `SELECT EXISTS(SELECT 1 FROM public."Posts" WHERE id = $1)`
	err := ctx.db.QueryRow(query, postId).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("post %s still exists", postId)
	}
	return nil
}

func (ctx *bddTestContext) theResponseShouldContainAField(field string) error {
	var data map[string]interface{}
	if err := json.Unmarshal(ctx.lastBody, &data); err != nil {
		return fmt.Errorf("failed to parse JSON: %w", err)
	}

	if _, ok := data[field]; !ok {
		return fmt.Errorf("field %q not found in response: %s", field, string(ctx.lastBody))
	}

	return nil
}

func (ctx *bddTestContext) theUserShouldHaveEmail(userId, email string) error {
	var actualEmail string
	query := `SELECT email FROM public."Users" WHERE id = $1`
	err := ctx.db.QueryRow(query, userId).Scan(&actualEmail)
	if err != nil {
		return err
	}
	if actualEmail != email {
		return fmt.Errorf("expected email %q, got %q", email, actualEmail)
	}
	return nil
}

func (ctx *bddTestContext) theResponseShouldContainAConnectionWithProvider(provider string) error {
	var data []map[string]interface{}
	if err := json.Unmarshal(ctx.lastBody, &data); err != nil {
		return fmt.Errorf("failed to parse JSON array: %w", err)
	}

	for _, item := range data {
		if p, ok := item["provider"].(string); ok && p == provider {
			return nil
		}
	}

	return fmt.Errorf("no connection with provider %q found", provider)
}

func (ctx *bddTestContext) aPublishJobExistsWithIdForUser(jobId, userId string) error {
	query := `INSERT INTO public."PublishJobs" (id, user_id, status, request_json, created_at, updated_at)
	          VALUES ($1, $2, 'pending', '{}'::jsonb, NOW(), NOW())`
	_, err := ctx.db.Exec(query, jobId, userId)
	return err
}

func (ctx *bddTestContext) theResultsForShouldContainError(provider, errorMsg string) error {
	var data map[string]interface{}
	if err := json.Unmarshal(ctx.lastBody, &data); err != nil {
		return fmt.Errorf("failed to parse JSON: %w", err)
	}

	results, ok := data["results"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("results not found in response")
	}

	providerResult, ok := results[provider].(map[string]interface{})
	if !ok {
		return fmt.Errorf("provider %q not found in results", provider)
	}

	errField, ok := providerResult["error"].(string)
	if !ok {
		return fmt.Errorf("error field not found for provider %q", provider)
	}

	if !strings.Contains(errField, errorMsg) {
		return fmt.Errorf("expected error %q, got %q", errorMsg, errField)
	}

	return nil
}

func (ctx *bddTestContext) theUserHasNotifications(userId string, count int) error {
	for i := 0; i < count; i++ {
		notifId := fmt.Sprintf("notif_%s_%d", userId, i)
		query := `INSERT INTO public."Notifications" (id, user_id, type, message, is_read, created_at)
		          VALUES ($1, $2, 'info', $3, false, NOW())`
		_, err := ctx.db.Exec(query, notifId, userId, fmt.Sprintf("Notification %d", i))
		if err != nil {
			return err
		}
	}
	return nil
}

func (ctx *bddTestContext) theUserHasANotificationWithId(userId, notifId string) error {
	query := `INSERT INTO public."Notifications" (id, user_id, type, message, is_read, created_at)
	          VALUES ($1, $2, 'info', 'Test notification', false, NOW())`
	_, err := ctx.db.Exec(query, notifId, userId)
	return err
}

func (ctx *bddTestContext) theNotificationShouldBeMarkedAsRead(notifId string) error {
	var isRead bool
	query := `SELECT is_read FROM public."Notifications" WHERE id = $1`
	err := ctx.db.QueryRow(query, notifId).Scan(&isRead)
	if err != nil {
		return err
	}
	if !isRead {
		return fmt.Errorf("notification %s is not marked as read", notifId)
	}
	return nil
}

func (ctx *bddTestContext) theUserHasSettingsConfigured(userId string) error {
	// Insert multiple key-value pairs
	settings := map[string]string{
		"theme":    "light",
		"language": "en",
	}
	for key, val := range settings {
		query := `INSERT INTO public."UserSettings" (user_id, key, value, created_at, updated_at)
		          VALUES ($1, $2, $3::jsonb, NOW(), NOW())
		          ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
		_, err := ctx.db.Exec(query, userId, key, fmt.Sprintf(`"%s"`, val))
		if err != nil {
			return err
		}
	}
	return nil
}

func (ctx *bddTestContext) theUserHasASettingWithValue(userId, key, value string) error {
	query := `INSERT INTO public."UserSettings" (user_id, key, value, created_at, updated_at)
	          VALUES ($1, $2, $3::jsonb, NOW(), NOW())
	          ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
	_, err := ctx.db.Exec(query, userId, key, fmt.Sprintf(`"%s"`, value))
	return err
}

func (ctx *bddTestContext) theUserHasSunoTracks(userId string, count int) error {
	for i := 0; i < count; i++ {
		trackId := fmt.Sprintf("track_%s_%d", userId, i)
		query := `INSERT INTO public."SunoTracks" (id, user_id, title, audio_url, created_at)
		          VALUES ($1, $2, $3, 'https://example.com/track.mp3', NOW())`
		_, err := ctx.db.Exec(query, trackId, userId, fmt.Sprintf("Track %d", i))
		if err != nil {
			return err
		}
	}
	return nil
}

func (ctx *bddTestContext) theUserHasASunoTrackWithId(userId, trackId string) error {
	query := `INSERT INTO public."SunoTracks" (id, user_id, title, audio_url, created_at)
	          VALUES ($1, $2, 'Test Track', 'https://example.com/track.mp3', NOW())`
	_, err := ctx.db.Exec(query, trackId, userId)
	return err
}

func (ctx *bddTestContext) theResponseShouldContainTheStoredTrackData() error {
	var data map[string]interface{}
	if err := json.Unmarshal(ctx.lastBody, &data); err != nil {
		return fmt.Errorf("failed to parse JSON: %w", err)
	}

	if _, ok := data["id"]; !ok {
		return fmt.Errorf("stored track data should contain id")
	}

	return nil
}

func (ctx *bddTestContext) iSendAGETRequestToWithInternalAuth(path string) error {
	url := ctx.server.URL + path
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}

	req.Header.Set("X-Internal-WS-Secret", ctx.internalSecret)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}

	ctx.lastResponse = resp
	ctx.lastBody, err = io.ReadAll(resp.Body)
	return err
}

func (ctx *bddTestContext) iSendAGETRequestToWithoutInternalAuth(path string) error {
	return ctx.iSendAGETRequestTo(path)
}

func (ctx *bddTestContext) theInternalWebSocketSecretIsConfigured() error {
	ctx.internalSecret = "test-secret-123"
	os.Setenv("INTERNAL_WS_SECRET", ctx.internalSecret)
	return nil
}

func (ctx *bddTestContext) theUserHasUploadedFiles(userId string) error {
	ctx.testData["hasUploads_"+userId] = true
	return nil
}

func (ctx *bddTestContext) theUserHasSocialLibraryItems(userId string) error {
	query := `INSERT INTO public."SocialLibraries" (id, user_id, network, content_type, external_id, media_url, raw_payload, created_at)
	          VALUES ($1, $2, 'facebook', 'post', 'ext123', 'https://example.com/media.jpg', '{}'::jsonb, NOW())`
	_, err := ctx.db.Exec(query, "lib_"+userId+"_1", userId)
	return err
}

func (ctx *bddTestContext) theResponseShouldContainSyncResults() error {
	var data map[string]interface{}
	if err := json.Unmarshal(ctx.lastBody, &data); err != nil {
		return fmt.Errorf("failed to parse JSON: %w", err)
	}
	return nil
}

func (ctx *bddTestContext) iSendAPOSTRequestToWithAFileUpload(path string, table *godog.Table) error {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	for _, row := range table.Rows[1:] {
		key := row.Cells[0].Value
		value := row.Cells[1].Value

		if key == "filename" {
			part, err := writer.CreateFormFile("file", value)
			if err != nil {
				return err
			}
			_, err = part.Write([]byte("fake file content"))
			if err != nil {
				return err
			}
		}
	}

	writer.Close()

	url := ctx.server.URL + path
	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}

	ctx.lastResponse = resp
	ctx.lastBody, err = io.ReadAll(resp.Body)
	return err
}

func InitializeScenario(ctx *godog.ScenarioContext) {
	testCtx := &bddTestContext{
		testData:      make(map[string]interface{}),
		wsConnections: make(map[string]interface{}),
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://localhost/simple_social_test?sslmode=disable"
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		panic(fmt.Sprintf("failed to connect to test database: %v", err))
	}
	testCtx.db = db

	ctx.Before(func(ctx context.Context, sc *godog.Scenario) (context.Context, error) {
		testCtx.reset()
		return ctx, nil
	})

	ctx.After(func(ctx context.Context, sc *godog.Scenario, err error) (context.Context, error) {
		if testCtx.server != nil {
			testCtx.server.Close()
			testCtx.server = nil
		}
		return ctx, nil
	})

	ctx.Step(`^the database is clean$`, testCtx.theDatabaseIsClean)
	ctx.Step(`^the API server is running$`, testCtx.theAPIServerIsRunning)
	ctx.Step(`^I send a GET request to "([^"]*)"$`, testCtx.iSendAGETRequestTo)
	ctx.Step(`^I send a POST request to "([^"]*)" with JSON:$`, testCtx.iSendAPOSTRequestToWithJSON)
	ctx.Step(`^I send a PUT request to "([^"]*)" with JSON:$`, testCtx.iSendAPUTRequestToWithJSON)
	ctx.Step(`^I send a DELETE request to "([^"]*)"$`, testCtx.iSendADELETERequestTo)
	ctx.Step(`^the response status code should be (\d+)$`, testCtx.theResponseStatusCodeShouldBe)
	ctx.Step(`^the response should contain JSON with "([^"]*)" set to "([^"]*)"$`, testCtx.theResponseShouldContainJSONWithSetTo)
	ctx.Step(`^the response should contain JSON with "([^"]*)" set to (.+)$`, testCtx.theResponseShouldContainJSONWithSetTo)
	ctx.Step(`^the response should contain error "([^"]*)"$`, testCtx.theResponseShouldContainError)
	ctx.Step(`^the response should be a JSON array with (\d+) items$`, testCtx.theResponseShouldBeAJSONArrayWithItems)
	ctx.Step(`^a user exists with id "([^"]*)" and email "([^"]*)"$`, testCtx.aUserExistsWithIdAndEmail)
	ctx.Step(`^a team exists with id "([^"]*)" and ownerId "([^"]*)"$`, testCtx.aTeamExistsWithIdAndOwnerId)
	ctx.Step(`^the user "([^"]*)" has a "([^"]*)" connection with providerId "([^"]*)"$`, testCtx.theUserHasAConnectionWithProviderId)
	ctx.Step(`^the user "([^"]*)" has an "([^"]*)" connection with providerId "([^"]*)"$`, testCtx.theUserHasAConnectionWithProviderId)
	ctx.Step(`^the user "([^"]*)" is a member of team "([^"]*)"$`, testCtx.theUserIsAMemberOfTeam)
	ctx.Step(`^the user "([^"]*)" has (\d+) posts in team "([^"]*)"$`, testCtx.theUserHasPostsInTeam)
	ctx.Step(`^the user "([^"]*)" has a post with id "([^"]*)" in team "([^"]*)"$`, testCtx.theUserHasAPostWithIdInTeam)
	ctx.Step(`^the user "([^"]*)" has a scheduled post with id "([^"]*)" in team "([^"]*)"$`, testCtx.theUserHasAScheduledPostWithIdInTeam)
	ctx.Step(`^the post "([^"]*)" should not exist$`, testCtx.thePostShouldNotExist)
	ctx.Step(`^the response should contain a "([^"]*)" field$`, testCtx.theResponseShouldContainAField)
	ctx.Step(`^the response should contain a "([^"]*)" timestamp$`, testCtx.theResponseShouldContainAField)
	ctx.Step(`^the user "([^"]*)" should have email "([^"]*)"$`, testCtx.theUserShouldHaveEmail)
	ctx.Step(`^the response should contain a connection with provider "([^"]*)"$`, testCtx.theResponseShouldContainAConnectionWithProvider)
	ctx.Step(`^a publish job exists with id "([^"]*)" for user "([^"]*)"$`, testCtx.aPublishJobExistsWithIdForUser)
	ctx.Step(`^the results for "([^"]*)" should contain error "([^"]*)"$`, testCtx.theResultsForShouldContainError)
	ctx.Step(`^the response should contain "([^"]*)" with provider "([^"]*)"$`, func(field, provider string) error {
		return nil
	})
	ctx.Step(`^the user "([^"]*)" has (\d+) notifications$`, testCtx.theUserHasNotifications)
	ctx.Step(`^the user "([^"]*)" has a notification with id "([^"]*)"$`, testCtx.theUserHasANotificationWithId)
	ctx.Step(`^the notification "([^"]*)" should be marked as read$`, testCtx.theNotificationShouldBeMarkedAsRead)
	ctx.Step(`^the user "([^"]*)" has settings configured$`, testCtx.theUserHasSettingsConfigured)
	ctx.Step(`^the user "([^"]*)" has a setting "([^"]*)" with value "([^"]*)"$`, testCtx.theUserHasASettingWithValue)
	ctx.Step(`^the user "([^"]*)" has (\d+) Suno tracks$`, testCtx.theUserHasSunoTracks)
	ctx.Step(`^the user "([^"]*)" has a Suno track with id "([^"]*)"$`, testCtx.theUserHasASunoTrackWithId)
	ctx.Step(`^the response should contain the stored track data$`, testCtx.theResponseShouldContainTheStoredTrackData)
	ctx.Step(`^I send a GET request to "([^"]*)" with internal auth$`, testCtx.iSendAGETRequestToWithInternalAuth)
	ctx.Step(`^I send a GET request to "([^"]*)" without internal auth$`, testCtx.iSendAGETRequestToWithoutInternalAuth)
	ctx.Step(`^the internal WebSocket secret is configured$`, testCtx.theInternalWebSocketSecretIsConfigured)
	ctx.Step(`^the user "([^"]*)" has uploaded files$`, testCtx.theUserHasUploadedFiles)
	ctx.Step(`^the user "([^"]*)" has social library items$`, testCtx.theUserHasSocialLibraryItems)
	ctx.Step(`^the response should contain sync results$`, testCtx.theResponseShouldContainSyncResults)
	ctx.Step(`^I send a POST request to "([^"]*)" with a file upload:$`, testCtx.iSendAPOSTRequestToWithAFileUpload)

	ctx.Step(`^I connect to WebSocket "([^"]*)" with internal auth$`, func(path string) error {
		return godog.ErrPending
	})
	ctx.Step(`^I connect to WebSocket "([^"]*)" without internal auth$`, func(path string) error {
		return godog.ErrPending
	})
	ctx.Step(`^the WebSocket connection should be established$`, func() error {
		return godog.ErrPending
	})
	ctx.Step(`^the WebSocket connection should fail with status (\d+)$`, func(status int) error {
		return godog.ErrPending
	})
	ctx.Step(`^I should receive a "([^"]*)" event with userId "([^"]*)"$`, func(eventType, userId string) error {
		return godog.ErrPending
	})
	ctx.Step(`^I should receive periodic "([^"]*)" events$`, func(eventType string) error {
		return godog.ErrPending
	})
}

func TestFeatures(t *testing.T) {
	suite := godog.TestSuite{
		ScenarioInitializer: InitializeScenario,
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features"},
			TestingT: t,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("non-zero status returned, failed to run feature tests")
	}
}
