package models

import "time"

type User struct {
	ID        string     `json:"id"`
	Email     string     `json:"email"`
	Name      string     `json:"name"`
	ImageURL  *string    `json:"imageUrl,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type SocialConnection struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	Provider   string    `json:"provider"`
	ProviderID string    `json:"providerId"`
	Email      *string   `json:"email,omitempty"`
	Name       *string   `json:"name,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Team struct {
	ID                   string     `json:"id"`
	OwnerID              *string    `json:"ownerId,omitempty"`
	CurrentTier          *string    `json:"currentTier,omitempty"`
	PostsCreatedToday    *int       `json:"postsCreatedToday,omitempty"`
	UsageResetDate       *time.Time `json:"usageResetDate,omitempty"`
	IgLlat               *string    `json:"igLlat,omitempty"`
	StripeCustomerID     *string    `json:"stripeCustomerId,omitempty"`
	StripeSubscriptionID *string    `json:"stripeSubscriptionId,omitempty"`
	CreatedAt            time.Time  `json:"createdAt"`
}

type TeamMember struct {
	ID        string    `json:"id"`
	TeamID    string    `json:"teamId"`
	UserID    string    `json:"userId"`
	Role      *string   `json:"role,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Post struct {
	ID           string     `json:"id"`
	TeamID       string     `json:"teamId"`
	UserID       string     `json:"userId"`
	Content      *string    `json:"content,omitempty"`
	Status       string     `json:"status"`
	ScheduledFor *time.Time `json:"scheduledFor,omitempty"`
	PublishedAt  *time.Time `json:"publishedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}
